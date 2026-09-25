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

export function isAllowedHref(href) {
  if (typeof href !== 'string') return false;
  const h = href.trim();
  if (!h) return false;
  // Disallow control characters, whitespace, quotes, angle brackets, backslashes
  if (/[\s"'<>\\]/.test(h)) return false;
  // Disallow protocol-relative URLs (e.g. //evil.com)
  if (h.startsWith('//')) return false;

  // Allowed absolute schemes: https:, mailto:, tel:
  if (/^https:\/\/[^\s"'<>\\]+$/i.test(h)) return true;
  if (/^mailto:[^\s"'<>\\]+$/i.test(h)) return true;
  if (/^tel:[^\s"'<>\\]+$/i.test(h)) return true;

  // Relative URLs: must not contain a scheme (colon before ? or #)
  const beforeQuery = h.split(/[?#]/)[0];
  if (beforeQuery.includes(':')) return false;

  return true;
}

export function isAllowedTag(tagStr) {
  if (typeof tagStr !== 'string') return false;
  const t = tagStr.trim();

  // Closing tags: </strong>, </em>, </span>, </a>
  if (/^<\/\s*(strong|em|span|a)\s*>$/i.test(t)) {
    return true;
  }

  // <br> or <br/> or <br />
  if (/^<\s*br\s*\/?>$/i.test(t)) {
    return true;
  }

  // <strong>
  if (/^<\s*strong\s*>$/i.test(t)) {
    return true;
  }

  // <em>
  if (/^<\s*em\s*>$/i.test(t)) {
    return true;
  }

  // <span class="..."> (only class attribute allowed)
  const spanMatch = t.match(/^<\s*span(?:\s+class=(?:"([^"]*)"|'([^']*)'))?\s*\/?>$/i);
  if (spanMatch) {
    const classVal = spanMatch[1] ?? spanMatch[2];
    if (classVal === undefined) return true;
    return /^[a-zA-Z0-9_\-\s]*$/.test(classVal);
  }

  // <a href="..."> (only href attribute allowed)
  const aMatch = t.match(/^<\s*a\s+href=(?:"([^"]*)"|'([^']*)')\s*\/?>$/i);
  if (aMatch) {
    const href = aMatch[1] ?? aMatch[2];
    return isAllowedHref(href);
  }

  return false;
}

export function sanitizeInlineHtml(input) {
  if (input == null) return '';
  const str = String(input);

  // We find all HTML tags <...>
  // If a tag is an allowed tag, we preserve it.
  // Any text between allowed tags (including disallowed tags and stray angle brackets)
  // has <, >, and " escaped.
  // Note: single quotes (') and entities like &amp; are preserved per D7-S0B.
  const tagRegex = /<[^>]*>/g;
  let out = '';
  let lastIndex = 0;
  let match;

  while ((match = tagRegex.exec(str)) !== null) {
    const textBefore = str.slice(lastIndex, match.index);
    if (textBefore) {
      out += textBefore
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    const tag = match[0];
    if (isAllowedTag(tag)) {
      out += tag;
    } else {
      out += tag
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    lastIndex = match.index + tag.length;
  }

  const remainingText = str.slice(lastIndex);
  if (remainingText) {
    out += remainingText
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return out;
}

export function findDisallowedHtml(val) {
  if (val == null) return null;
  if (typeof val === 'string') {
    const tags = val.match(/<[^>]*>/g);
    if (tags) {
      for (const tag of tags) {
        if (!isAllowedTag(tag)) {
          return `Disallowed HTML tag: ${tag}`;
        }
      }
    }
    const withoutAllowed = val.replace(/<[^>]*>/g, '');
    if (/<[a-zA-Z\/!]/.test(withoutAllowed)) {
      return `Malformed or disallowed HTML tag in string: ${val}`;
    }
    return null;
  }
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      const err = findDisallowedHtml(val[i]);
      if (err) return `[${i}]: ${err}`;
    }
    return null;
  }
  if (typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      const err = findDisallowedHtml(v);
      if (err) return `${k}: ${err}`;
    }
    return null;
  }
  return null;
}

export function validateInlineHtmlPayload(val) {
  const err = findDisallowedHtml(val);
  if (err) {
    throw new Error(err);
  }
  return true;
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
            const fullAttrs = `${beforeAttr} data-cs="${csVal}" ${afterAttr}`;
            const element = {
              tagName: tag.toLowerCase(),
              getAttribute: (attr) => {
                const m = fullAttrs.match(new RegExp(`\\b${attr}=(?:"([^"]*)"|'([^']*)')`, 'i'));
                return m ? (m[1] ?? m[2] ?? '') : null;
              },
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
            const fullAttrs = `${beforeAttr} data-cs-list="${csListVal}" ${afterAttr}`;
            const element = {
              tagName: tag.toLowerCase(),
              getAttribute: (attr) => {
                const m = fullAttrs.match(new RegExp(`\\b${attr}=(?:"([^"]*)"|'([^']*)')`, 'i'));
                return m ? (m[1] ?? m[2] ?? '') : null;
              },
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

      el.setInnerContent(sanitizeInlineHtml(val), { html: true });
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

      const itemAttr = el.getAttribute('data-cs-item') || 'p';
      const parts = itemAttr.trim().split('.');
      const tag = parts[0] || 'p';
      const classes = parts.slice(1).filter(Boolean).join(' ');
      const openTag = classes ? `<${tag} class="${classes}">` : `<${tag}>`;
      const closeTag = `</${tag}>`;

      const indent = '        ';
      const listHtml = '\n' + val.map((item) => `${indent}${openTag}${sanitizeInlineHtml(item)}${closeTag}`).join('\n') + '\n' + indent;
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
