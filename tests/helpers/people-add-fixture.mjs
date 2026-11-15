// Fictional, in-memory API fixture only. No provider, server, browser or customer state.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  onRequestGet,
  onRequestPost,
} from "../../functions/api/staff/[[path]].js";
export const ADMIN = "fictional.admin@example.invalid",
  STAFF = "fictional.staff@example.invalid";
export function fixture({ beforeBatch } = {}) {
  const raw = new DatabaseSync(":memory:");
  for (const name of [
    "0001_init",
    "0003_grant_award",
    "0006_caregiver_contact_history_outcomes",
    "0011_staff_member",
  ])
    raw.exec(
      readFileSync(
        new URL("../../schema/" + name + ".sql", import.meta.url),
        "utf8",
      ),
    );
  raw
    .prepare("INSERT INTO staff_member(email,display_name,role)VALUES(?,?,?)")
    .run(ADMIN, "Fictional Admin", "admin");
  raw
    .prepare("INSERT INTO staff_member(email,display_name,role)VALUES(?,?,?)")
    .run(STAFF, "Fictional Staff", "staff");
  raw.exec("DELETE FROM grant_application; DELETE FROM caregiver;");
  const db = {
    prepare(sql) {
      const bind = (...args) => ({
        first: async () => raw.prepare(sql).get(...args) || null,
        all: async () => ({ results: raw.prepare(sql).all(...args) }),
        run: async () => ({
          success: true,
          meta: raw.prepare(sql).run(...args),
        }),
      });
      return { ...bind(), bind };
    },
    async batch(stmts) {
      if (beforeBatch) await beforeBatch();
      raw.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const env = { LEGACY_DB: db, ALLOW_DEV_CONSOLE: "1" };
  const call = (
    path,
    { method = "GET", body, actor = STAFF, headers = {} } = {},
  ) => {
    const request = new Request("https://fixture.example.invalid" + path, {
      method,
      headers: {
        Origin: "https://fixture.example.invalid",
        "Content-Type": "application/json",
        "x-dev-actor": actor,
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return (method === "POST" ? onRequestPost : onRequestGet)({ request, env });
  };
  return { raw, db, env, call, close: () => raw.close() };
}
export const input = {
  first_name: "Fictional",
  last_name: "Caregiver",
  email: "fictional.caregiver@example.invalid",
  phone: "(414) 555-0100",
};
