import test from "node:test";
import assert from "node:assert/strict";
import { create } from "../functions/_lib/domain/caregivers.js";
import { onRequestPost } from "../functions/api/staff/[[path]].js";
import { fixture, input, ADMIN, STAFF } from "./helpers/people-add-fixture.mjs";

test("staff creates a record with one original audit and no enrollment, staff access or follow-up work", async () => {
  const f = fixture();
  try {
    const before = f.raw.prepare("SELECT COUNT(*) n FROM staff_member").get().n;
    const response = await f.call("/api/staff/caregivers", {
      method: "POST",
      body: input,
    });
    assert.equal(response.status, 201);
    const { profile } = await response.json();
    assert.equal(profile.email, input.email);
    assert.equal(profile.sanctuary_member, 0);
    assert.equal(profile.member_since, null);
    assert.equal(profile.source, "staff");
    assert.equal(profile.status, "active");
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM followup").get().n, 0);
    assert.equal(
      f.raw.prepare("SELECT COUNT(*) n FROM staff_member").get().n,
      before,
    );
    const a = f.raw
      .prepare("SELECT * FROM audit_log WHERE action='caregiver.created'")
      .all();
    assert.equal(a.length, 1);
    assert.equal(a[0].actor, STAFF);
    assert.equal(a[0].entity_id, profile.id);
  } finally {
    f.close();
  }
});
test("case-normalized email, normalized phone and archived matches refuse without changing history", async () => {
  const f = fixture();
  try {
    f.raw
      .prepare(
        "INSERT INTO caregiver(id,first_name,email,phone,status)VALUES('cg_existing','Original',' Mixed@Example.invalid ','+1 (414) 555-0101','archived')",
      )
      .run();
    f.raw
      .prepare(
        "INSERT INTO note(caregiver_id,author,body)VALUES('cg_existing',?,'FICTIONAL retained history')",
      )
      .run(STAFF);
    const before = JSON.stringify(
      f.raw.prepare("SELECT * FROM caregiver WHERE id='cg_existing'").get(),
    );
    for (const extra of [
      { email: "mixed@example.invalid", phone: "" },
      { email: "another@example.invalid", phone: "14145550101" },
    ]) {
      const res = await f.call("/api/staff/caregivers", {
        method: "POST",
        body: { ...input, ...extra },
      });
      assert.equal(res.status, 409);
      assert.equal((await res.json()).matches[0].id, "cg_existing");
    }
    assert.equal(
      JSON.stringify(
        f.raw.prepare("SELECT * FROM caregiver WHERE id='cg_existing'").get(),
      ),
      before,
    );
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM note").get().n, 1);
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM caregiver").get().n, 1);
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM audit_log").get().n, 0);
  } finally {
    f.close();
  }
});
test("concurrent contact match and permission revocation are fenced inside the create batch", async () => {
  for (const race of ["contact", "permission"]) {
    let f,
      once = false;
    f = fixture({
      beforeBatch: async () => {
        if (once) return;
        once = true;
        if (race === "contact")
          f.raw
            .prepare(
              "INSERT INTO caregiver(id,first_name,email)VALUES('cg_winner','Winner',?)",
            )
            .run(input.email);
        else
          f.raw
            .prepare(
              "UPDATE staff_member SET status='deactivated' WHERE email=?",
            )
            .run(STAFF);
      },
    });
    try {
      const result = await create(f.db, input, STAFF);
      assert.equal(result.status, race === "contact" ? 409 : 403);
      assert.equal(
        f.raw.prepare("SELECT COUNT(*) n FROM caregiver").get().n,
        race === "contact" ? 1 : 0,
      );
      assert.equal(
        f.raw.prepare("SELECT COUNT(*) n FROM audit_log").get().n,
        0,
      );
    } finally {
      f.close();
    }
  }
});
test("audit storage failure rolls back record; unknown committed acknowledgement never duplicates on retry", async () => {
  const f = fixture();
  try {
    f.raw.exec(
      "CREATE TRIGGER fail_create_audit BEFORE INSERT ON audit_log WHEN NEW.action='caregiver.created' BEGIN SELECT RAISE(ABORT,'FICTIONAL audit fault');END;",
    );
    await assert.rejects(create(f.db, input, STAFF), /audit fault/);
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM caregiver").get().n, 0);
    f.raw.exec("DROP TRIGGER fail_create_audit");
    const normal = f.db.batch.bind(f.db);
    f.db.batch = async (stmts) => {
      await normal(stmts);
      throw Error("FICTIONAL lost acknowledgement");
    };
    await assert.rejects(create(f.db, input, STAFF), /lost acknowledgement/);
    const retry = await create(f.db, input, STAFF);
    assert.equal(retry.status, 409);
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM caregiver").get().n, 1);
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM audit_log").get().n, 1);
  } finally {
    f.close();
  }
});
test("inactive, unknown and service actors cannot create; ordinary staff cannot create/promote staff", async () => {
  const f = fixture();
  try {
    for (const actor of [
      "anonymous_staff",
      "service:fictional",
      "unknown@example.invalid",
    ])
      assert.equal((await create(f.db, input, actor)).status, 403);
    f.raw
      .prepare("UPDATE staff_member SET status='deactivated' WHERE email=?")
      .run(STAFF);
    assert.equal((await create(f.db, input, STAFF)).status, 403);
    f.raw
      .prepare("UPDATE staff_member SET status='active' WHERE email=?")
      .run(STAFF);
    assert.equal(
      (
        await f.call("/api/staff/team", {
          method: "POST",
          body: {
            display_name: "Fictional New Admin",
            email: "new@example.invalid",
            role: "admin",
          },
        })
      ).status,
      403,
    );
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM caregiver").get().n, 0);
  } finally {
    f.close();
  }
});
test("record-only whitelist, text bounds, contact and strict origin/body limits refuse before effects", async () => {
  const f = fixture();
  try {
    for (const body of [
      null,
      [],
      {},
      { ...input, role: "admin" },
      { ...input, sanctuary_member: 1 },
      { ...input, consent: true },
      { ...input, id: "cg_override" },
      { ...input, email: "bad" },
      { ...input, first_name: "x\u0000y" },
      { ...input, first_name: "x".repeat(121) },
      { ...input, email: "", phone: "" },
    ])
      assert.equal(
        (await f.call("/api/staff/caregivers", { method: "POST", body }))
          .status,
        400,
      );
    const req = (headers, body) =>
      new Request("https://fixture.example.invalid/api/staff/caregivers", {
        method: "POST",
        headers: {
          Origin: "https://fixture.example.invalid",
          "Content-Type": "application/json",
          "x-dev-actor": ADMIN,
          ...headers,
        },
        body,
      });
    for (const origin of ["null", "https://other.example.invalid"])
      assert.equal(
        (
          await onRequestPost({
            env: f.env,
            request: req({ Origin: origin }, JSON.stringify(input)),
          })
        ).status,
        403,
      );
    assert.equal(
      (await onRequestPost({ env: f.env, request: req({}, "x".repeat(4097)) }))
        .status,
      413,
    );
    assert.equal(
      (
        await onRequestPost({
          env: f.env,
          request: req({ "Content-Type": "text/plain" }, "{}"),
        })
      ).status,
      415,
    );
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM caregiver").get().n, 0);
  } finally {
    f.close();
  }
});

test("revocation gates initial duplicate read, post-write refusal duplicate read and saved-profile projection", async () => {
  for (const phase of ["initial-match", "refused-match", "saved-profile"]) {
    let f;
    f = fixture({
      beforeBatch: async () => {
        if (phase === "refused-match") {
          f.raw
            .prepare(
              "INSERT INTO caregiver(id,first_name,email)VALUES('cg_private','PrivateName',?)",
            )
            .run(input.email);
          f.raw
            .prepare(
              "UPDATE staff_member SET status='deactivated' WHERE email=?",
            )
            .run(STAFF);
        }
      },
    });
    try {
      if (phase === "initial-match")
        f.raw
          .prepare(
            "INSERT INTO caregiver(id,first_name,email)VALUES('cg_private','PrivateName',?)",
          )
          .run(input.email);
      const prepare = f.db.prepare.bind(f.db);
      f.db.prepare = (sql) => {
        const statement = prepare(sql);
        const intercept =
          (phase === "initial-match" &&
            sql.startsWith("SELECT id, first_name")) ||
          (phase === "saved-profile" &&
            sql.startsWith("SELECT * FROM caregiver WHERE id"));
        if (!intercept) return statement;
        return {
          ...statement,
          bind: (...args) => {
            const bound = statement.bind(...args);
            const revoke = () =>
              f.raw
                .prepare(
                  "UPDATE staff_member SET status='deactivated' WHERE email=?",
                )
                .run(STAFF);
            return {
              ...bound,
              all: async () => {
                revoke();
                return bound.all();
              },
              first: async () => {
                revoke();
                return bound.first();
              },
            };
          },
        };
      };
      const result = await create(f.db, input, STAFF);
      assert.equal(result.ok, false, phase);
      assert.equal(result.matches, undefined, phase);
      assert.equal(result.profile, undefined, phase);
      assert.doesNotMatch(
        JSON.stringify(result),
        /PrivateName|fictional\.caregiver@example\.invalid/,
        phase,
      );
      assert.equal(result.status, phase === "saved-profile" ? 503 : 403, phase);
    } finally {
      f.close();
    }
  }
});
