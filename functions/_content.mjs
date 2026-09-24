// Content edge rewrite per D-011.
// Reads published page_section rows from D1 (binding LEGACY_DB) and rewrites
// [data-cs] text elements and [data-cs-list] paragraph containers with HTMLRewriter.
//
// Hard fallback: if LEGACY_DB is undefined, D1 query errors, key/field is missing,
// or type is unexpected, the response passes through untouched.

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isRewritableRoute(pathname) {
  if (!pathname || typeof pathname !== 'string') return false;
  if (pathname === '/staff.html' || pathname === '/staff' || pathname.startsWith('/staff/')) {
    return false;
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return false;
  }
  return true;
}

let _contentCache = { sections: null, at: 0 };
const CACHE_TTL_MS = 60 * 1000;

export function _resetContentCache() {
  _contentCache = { sections: null, at: 0 };
}

export async function getPublishedSections(env, now = Date.now()) {
  if (!env || !env.LEGACY_DB || typeof env.LEGACY_DB.prepare !== 'function') {
    return null;
  }
  if (_contentCache.sections && (now - _contentCache.at < CACHE_TTL_MS)) {
    return _contentCache.sections;
  }
  try {
    const stmt = env.LEGACY_DB.prepare(
      "SELECT id, data FROM content_item WHERE id LIKE 'ps_%' AND status = 'published'"
    );
    const { results } = await stmt.all();
    if (!results || !Array.isArray(results)) {
      return null;
    }
    const sections = {};
    for (const row of results) {
      if (!row || typeof row.id !== 'string' || !row.id.startsWith('ps_')) {
        continue;
      }
      const sectionKey = row.id.slice(3);
      let data = row.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          continue;
        }
      }
      if (data && typeof data === 'object') {
        sections[sectionKey] = data;
      }
    }
    _contentCache = { sections, at: now };
    return sections;
  } catch {
    return null;
  }
}

// Built-in shim when running under standard Node.js without Cloudflare runtime
class NodeHTMLRewriter {
  constructor() {
    this.rules = [];
  }
  on(selector, handlers) {
    this.rules.push({ selector, handlers });
    return this;
  }
  async transform(response) {
    let html = await response.text();

    for (const { selector, handlers } of this.rules) {
      if (selector === '[data-cs]') {
        html = html.replace(
          /<([a-zA-Z0-9]+)\b([^>]*)data-cs=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/\1>/gi,
          (match, tag, beforeAttr, csVal, afterAttr, inner) => {
            let innerContent = inner;
            const element = {
              tagName: tag.toLowerCase(),
              getAttribute: (attr) => (attr === 'data-cs' ? csVal : null),
              setAttribute: () => {},
              setInnerContent: (content, options = {}) => {
                if (options.html === false) {
                  innerContent = escapeHtml(content);
                } else {
                  innerContent = content;
                }
              },
              replace: () => {},
            };
            if (handlers.element) handlers.element(element);
            return `<${tag}${beforeAttr}data-cs="${csVal}"${afterAttr}>${innerContent}</${tag}>`;
          }
        );
      } else if (selector === '[data-cs-list]') {
        html = html.replace(
          /<([a-zA-Z0-9]+)\b([^>]*)data-cs-list=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/\1>/gi,
          (match, tag, beforeAttr, csListVal, afterAttr, inner) => {
            let innerContent = inner;
            const element = {
              tagName: tag.toLowerCase(),
              getAttribute: (attr) => (attr === 'data-cs-list' ? csListVal : null),
              setAttribute: () => {},
              setInnerContent: (content) => {
                innerContent = '\n' + content + '\n        ';
              },
              replace: () => {},
            };
            if (handlers.element) handlers.element(element);
            return `<${tag}${beforeAttr}data-cs-list="${csListVal}"${afterAttr}>${innerContent}</${tag}>`;
          }
        );
      }
    }

    const headers = new Headers(response.headers);
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

export function getHTMLRewriterClass() {
  return typeof globalThis.HTMLRewriter !== 'undefined' ? globalThis.HTMLRewriter : NodeHTMLRewriter;
}

export async function rewriteContent(response, sections) {
  const RewriterClass = getHTMLRewriterClass();
  const rewriter = new RewriterClass();

  rewriter.on('[data-cs]', {
    element(el) {
      const attr = el.getAttribute('data-cs');
      if (!attr) return;
      const dotIdx = attr.lastIndexOf('.');
      if (dotIdx === -1) return;
      const sectionKey = attr.slice(0, dotIdx);
      const fieldKey = attr.slice(dotIdx + 1);

      const section = sections[sectionKey];
      if (!section || typeof section !== 'object') return;

      const val = section[fieldKey];
      if (typeof val !== 'string') return;

      el.setInnerContent(val, { html: false });
    },
  });

  rewriter.on('[data-cs-list]', {
    element(el) {
      const attr = el.getAttribute('data-cs-list');
      if (!attr) return;
      const dotIdx = attr.lastIndexOf('.');
      if (dotIdx === -1) return;
      const sectionKey = attr.slice(0, dotIdx);
      const fieldKey = attr.slice(dotIdx + 1);

      const section = sections[sectionKey];
      if (!section || typeof section !== 'object') return;

      const val = section[fieldKey];
      if (!Array.isArray(val)) return;
      for (const item of val) {
        if (typeof item !== 'string') return;
      }

      const listHtml = val.map((item) => `<p>${escapeHtml(item)}</p>`).join('\n');
      el.setInnerContent(listHtml, { html: true });
    },
  });

  return rewriter.transform(response);
}

export async function maybeRewriteContent(context, response) {
  try {
    const { request, env } = context;
    if (!request || request.method !== 'GET') {
      return response;
    }
    if (!response || response.status !== 200) {
      return response;
    }
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('text/html')) {
      return response;
    }

    const url = new URL(request.url);
    let path = url.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    if (!isRewritableRoute(path)) {
      return response;
    }

    if (!env || !env.LEGACY_DB) {
      return response;
    }

    const sections = await getPublishedSections(env);
    if (!sections || Object.keys(sections).length === 0) {
      return response;
    }

    return await rewriteContent(response, sections);
  } catch {
    // Hard fallback: never break a page if rewrite fails
    return response;
  }
}
