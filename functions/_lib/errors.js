// Shared error handling helper for API endpoints.
// Formats unexpected server errors cleanly and logs server-side.

export function internalError(route, e, status = 500) {
  console.error(`${route} failed`, e);
  return new Response(JSON.stringify({ ok: false, error: 'internal_error' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
