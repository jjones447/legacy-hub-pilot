import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  fixture,
  input,
  ADMIN,
  STAFF,
} from "../helpers/people-add-fixture.mjs";
const html = readFileSync(new URL("../../staff.html", import.meta.url), "utf8"),
  source = readFileSync(new URL("../../staff.js", import.meta.url), "utf8");
const until = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail("fixture did not settle");
};
async function page({ actor = STAFF } = {}) {
  const f = fixture(),
    dom = new JSDOM(html, {
      url: "https://fixture.example.invalid/staff",
      runScripts: "outside-only",
    }),
    w = dom.window;
  await new Promise((r) =>
    w.document.readyState === "loading"
      ? w.document.addEventListener("DOMContentLoaded", r, { once: true })
      : r(),
  );
  w.scrollTo = () => {};
  w.console.error = () => {};
  const calls = [];
  let loseNext = false;
  w.fetch = async (url, opts = {}) => {
    calls.push({
      url,
      method: opts.method || "GET",
      body: opts.body ? JSON.parse(opts.body) : null,
    });
    const response = await f.call(url, {
      method: opts.method || "GET",
      body: opts.body ? JSON.parse(opts.body) : undefined,
      actor,
    });
    if (loseNext && opts.method === "POST") {
      loseNext = false;
      throw Error("FICTIONAL lost acknowledgement");
    }
    return response;
  };
  w.eval(source);
  const click = (sel) => {
    const el = w.document.querySelector(sel);
    assert.ok(el, sel);
    el.click();
  };
  click('[data-action="open-people-add"]');
  await until(
    () =>
      w.document
        .querySelector('[data-action="open-people-add"]')
        .getAttribute("aria-expanded") === "true" &&
      w.document.querySelector("#staffTeamList table"),
  );
  const form = w.document.getElementById("addCaregiverForm");
  const fill = (values = input) => {
    click('[data-action="open-caregiver-create"]');
    for (const [key, value] of Object.entries(values))
      form.elements.namedItem(key).value = value;
  };
  return {
    f,
    w,
    dom,
    calls,
    click,
    fill,
    form,
    loseNextAck: () => {
      loseNext = true;
    },
    close() {
      w.close();
      f.close();
    },
  };
}

test("visible Add alongside Search creates a caregiver through real controls and API without enrollment or staff access", async () => {
  const p = await page();
  try {
    const search = p.w.document.querySelector(
      '[data-action="search-caregivers"]',
    );
    assert.equal(
      search.nextElementSibling.getAttribute("data-action"),
      "open-people-add",
    );
    assert.ok(
      p.w.document
        .getElementById("addStaffFromPeopleBtn")
        .classList.contains("d-none"),
    );
    p.fill();
    p.form.requestSubmit();
    await until(() => p.form.classList.contains("d-none"));
    const row = p.f.raw.prepare("SELECT * FROM caregiver").get();
    assert.equal(row.email, input.email);
    assert.equal(row.sanctuary_member, 0);
    assert.equal(p.f.raw.prepare("SELECT COUNT(*) n FROM followup").get().n, 0);
    assert.equal(
      p.f.raw
        .prepare("SELECT email FROM staff_member WHERE email=?")
        .get(input.email),
      undefined,
    );
    assert.match(
      p.w.document.getElementById("caregiverRecordPanel").textContent,
      /Fictional Caregiver/,
    );
    assert.match(
      p.w.document.getElementById("caregiverSearchResultsBody").textContent,
      /Fictional Caregiver/,
    );
    assert.match(
      p.w.document.getElementById("peopleAddMessage").textContent,
      /No enrollment, invitation or follow-up/,
    );
    assert.equal(p.calls.filter((c) => c.method === "POST").length, 1);
  } finally {
    p.close();
  }
});
test("matching archived caregiver remains unchanged, retains private history, and opens from the duplicate result", async () => {
  const p = await page();
  try {
    p.f.raw
      .prepare(
        "INSERT INTO caregiver(id,first_name,email,status)VALUES('cg_existing','Original',?,'archived')",
      )
      .run(input.email);
    p.f.raw
      .prepare(
        "INSERT INTO note(caregiver_id,author,body)VALUES('cg_existing',?,'FICTIONAL original history')",
      )
      .run(STAFF);
    const before = JSON.stringify(
      p.f.raw.prepare("SELECT * FROM caregiver").get(),
    );
    p.fill();
    p.form.requestSubmit();
    await until(() => p.form.querySelector('[data-action="view-caregiver"]'));
    assert.equal(p.form.elements.namedItem("first_name").value, "Fictional");
    assert.equal(p.form.classList.contains("d-none"), false);
    assert.equal(
      JSON.stringify(p.f.raw.prepare("SELECT * FROM caregiver").get()),
      before,
    );
    p.click('#addCaregiverForm [data-action="view-caregiver"]');
    await until(() =>
      p.w.document
        .getElementById("caregiverRecordPanel")
        .textContent.includes("FICTIONAL original history"),
    );
    assert.equal(
      p.f.raw.prepare("SELECT COUNT(*) n FROM caregiver").get().n,
      1,
    );
    assert.equal(
      p.f.raw.prepare("SELECT COUNT(*) n FROM audit_log").get().n,
      0,
    );
  } finally {
    p.close();
  }
});
test("uncertain acknowledgement preserves entries; retry surfaces original record without another creation", async () => {
  const p = await page();
  try {
    p.fill();
    p.loseNextAck();
    p.form.requestSubmit();
    await until(() => p.form.textContent.includes("Could not add caregiver"));
    assert.equal(p.form.elements.namedItem("email").value, input.email);
    assert.equal(p.form.querySelector('button[type="submit"]').disabled, false);
    p.form.requestSubmit();
    await until(() => p.form.querySelector('[data-action="view-caregiver"]'));
    assert.equal(
      p.f.raw.prepare("SELECT COUNT(*) n FROM caregiver").get().n,
      1,
    );
    assert.equal(
      p.f.raw
        .prepare(
          "SELECT COUNT(*) n FROM audit_log WHERE action='caregiver.created'",
        )
        .get().n,
      1,
    );
  } finally {
    p.close();
  }
});
test("admin Add staff action exposes the existing form and writer; successful record appears in normal team list", async () => {
  const p = await page({ actor: ADMIN });
  try {
    assert.equal(
      p.w.document
        .getElementById("addStaffFromPeopleBtn")
        .classList.contains("d-none"),
      false,
    );
    p.click('[data-action="open-staff-create"]');
    const form = p.w.document.querySelector(
      'form[data-action="submit-add-staff"]',
    );
    assert.equal(form.closest("details").open, true);
    form.elements.namedItem("display_name").value = "Fictional New Staff";
    form.elements.namedItem("email").value = "new.staff@example.invalid";
    form.elements.namedItem("role").value = "staff";
    form.requestSubmit();
    await until(() =>
      p.w.document
        .getElementById("staffTeamMessage")
        .textContent.includes("Staff member added"),
    );
    assert.match(
      p.w.document.getElementById("staffTeamList").textContent,
      /Fictional New Staff/,
    );
    assert.equal(
      p.f.raw
        .prepare("SELECT role FROM staff_member WHERE email=?")
        .get("new.staff@example.invalid").role,
      "staff",
    );
    assert.equal(
      p.f.raw.prepare("SELECT COUNT(*) n FROM caregiver").get().n,
      0,
    );
    assert.equal(
      p.calls.filter((c) => c.method === "POST" && c.url === "/api/staff/team")
        .length,
      1,
    );
  } finally {
    p.close();
  }
});
test("staff role cannot expose staff creation or escalate; duplicate admin submission retains fields and original staff", async () => {
  const p = await page();
  try {
    p.click('[data-action="open-staff-create"]');
    assert.match(
      p.w.document.getElementById("peopleAddMessage").textContent,
      /Only an active admin/,
    );
    assert.equal(
      p.w.document.querySelector('form[data-action="submit-add-staff"]'),
      null,
    );
    const res = await p.f.call("/api/staff/team", {
      method: "POST",
      actor: STAFF,
      body: {
        display_name: "Escalation",
        email: "bad@example.invalid",
        role: "admin",
      },
    });
    assert.equal(res.status, 403);
  } finally {
    p.close();
  }
  const a = await page({ actor: ADMIN });
  try {
    a.click('[data-action="open-staff-create"]');
    const form = a.w.document.querySelector(
      'form[data-action="submit-add-staff"]',
    );
    form.elements.namedItem("display_name").value = "Replacement";
    form.elements.namedItem("email").value = STAFF;
    form.elements.namedItem("role").value = "admin";
    form.requestSubmit();
    await until(() =>
      form
        .querySelector("[data-add-staff-message]")
        .textContent.includes("already has a staff record"),
    );
    assert.equal(form.elements.namedItem("display_name").value, "Replacement");
    assert.equal(
      a.f.raw.prepare("SELECT role FROM staff_member WHERE email=?").get(STAFF)
        .role,
      "staff",
    );
    assert.equal(
      a.f.raw.prepare("SELECT COUNT(*) n FROM audit_log").get().n,
      0,
    );
  } finally {
    a.close();
  }
});

// Integration proof: the merged submit dispatcher must preserve My Support triage.
test("staging integration retains connected My Support queue and triage alongside People Add", async () => {
  const p = await page();
  try {
    const { handlePortalSupport } =
      await import("../../functions/_lib/portal-support.js");
    p.f.raw
      .prepare(
        "INSERT INTO caregiver(id,first_name,email) VALUES('cg_support_fixture','Fictional Support',?)",
      )
      .run(input.email);
    const saved = await handlePortalSupport(
      new Request("https://fixture.example.invalid/api/portal/support", {
        method: "POST",
        headers: {
          Origin: "https://fixture.example.invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          request_id: "00112233-4455-4677-8899-aabbccddeeff",
          support_type: "respite_services",
          urgency: "general_inquiry",
          contact_preference: "email",
        }),
      }),
      p.f.db,
      "cg_support_fixture",
    );
    assert.equal(saved.status, 201);
    const originalFetch = p.w.fetch;
    const jwt =
      "fixture." +
      Buffer.from(JSON.stringify({ email: STAFF })).toString("base64url") +
      ".fixture";
    // Existing support handlers use the middleware-verified JWT actor, not dev headers.
    // The inert handler fixture supplies only a fictional assertion; no Access claim is made.
    p.w.fetch = (url, options = {}) =>
      options.method === "POST" && url.endsWith("/support")
        ? p.f.call(url, {
            method: "POST",
            body: JSON.parse(options.body),
            headers: { "Cf-Access-Jwt-Assertion": jwt },
          })
        : originalFetch(url, options);
    await p.w.loadFollowups();
    p.click('[data-action="support-in-progress"]');
    await until(() =>
      p.w.document
        .getElementById("needsAttentionBody")
        .textContent.includes("In Progress"),
    );
    await p.w.viewCaregiver("cg_support_fixture");
    const form = p.w.document.querySelector(
      'form[data-action="submit-support-triage"]',
    );
    assert.ok(form);
    form.elements.namedItem("status").value = "completed";
    form.elements.namedItem("note").value =
      "FICTIONAL preserved request triage";
    form.requestSubmit();
    await until(() =>
      p.w.document
        .getElementById("caregiverRecordPanel")
        .textContent.includes("FICTIONAL preserved request triage"),
    );
    assert.equal(
      p.f.raw
        .prepare(
          "SELECT COUNT(*) n FROM audit_log WHERE action='staff.support_request_updated'",
        )
        .get().n,
      2,
    );
    assert.equal(p.f.raw.prepare("SELECT COUNT(*) n FROM note").get().n, 1);
    assert.match(
      p.w.document.querySelector("#needsAttentionPanel summary").textContent,
      /Alerts/,
    );
    assert.match(
      p.w.document.querySelector("#eventsPanel summary").textContent,
      /Events/,
    );
    assert.equal(
      p.w.document.querySelector('[data-action="open-people-add"]').textContent,
      "Add person",
    );
  } finally {
    p.close();
  }
});
