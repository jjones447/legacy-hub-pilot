// GET /api/health — env + D1 reachability (slice 03).
export async function onRequestGet({ env }) {
  const out = { ok: true, service: 'legacy-hub', d1: false, tables: 0 };
  try {
    const row = await env.LEGACY_DB
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`)
      .first();
    out.d1 = true;
    out.tables = row.n;
  } catch (e) {
    out.ok = false;
    out.error = 'D1 unreachable';
  }
  return new Response(JSON.stringify(out), {
    status: out.ok ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  });
}
