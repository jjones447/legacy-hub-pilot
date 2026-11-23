// Minimal published homepage for tests of routing/headers, not content failure.
export const publishedHomeEnv = {
  LEGACY_DB: { prepare: () => ({ all: async () => ({ results: [
    { id: 'ps_home.journey', data: JSON.stringify({ paragraph: 'Published journey' }) },
  ] }) }) },
};
export const publishedHomeResponse = () => new Response(
  '<div data-cs-list="home.journey.paragraph">Unpublished source</div>',
  { headers: { 'content-type': 'text/html' } },
);
