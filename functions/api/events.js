// GET /api/events — returns published events with current registration counts from D1 (slice 05).
export async function onRequestGet({ env }) {
  try {
    const { results } = await env.LEGACY_DB
      .prepare(`
        SELECT e.id, e.title, e.type, e.starts_at, e.ends_at, e.location, e.capacity,
               COUNT(r.id) AS registered_count
        FROM event e
        LEFT JOIN registration r ON e.id = r.event_id AND r.status IN ('registered', 'attended')
        WHERE e.publish_state = 'published'
        GROUP BY e.id
        ORDER BY e.starts_at ASC
      `)
      .all();

    return new Response(JSON.stringify({ ok: true, events: results }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
