// Content edge rewrite per D-011.
// Reads published page_section rows from D1 (binding LEGACY_DB) and rewrites
// [data-cs] text elements and [data-cs-list] paragraph containers with HTMLRewriter.
//
// Hard fallback: if LEGACY_DB is undefined, D1 query errors, key/field is missing,
// or type is unexpected, the response passes through untouched.
import { confirmationActor, draftOwner, ownsDraft, confirmationBinding } from './_lib/agent-confirmation.mjs';
import { PREVIEW_TRANSFER_TTL_SECONDS, isPreviewTransferSource, previewTransferConfigured, signPreviewTransfer, verifyPreviewTransfer } from './_lib/preview-transfer.mjs';

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeOptionValue(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function decodeHtmlReferences(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&#x([0-9a-fA-F]+);?/gi, (_, hex) => {
      try {
        const cp = parseInt(hex, 16);
        return cp < 0x110000 ? String.fromCodePoint(cp) : '';
      } catch { return ''; }
    })
    .replace(/&#([0-9]+);?/g, (_, dec) => {
      try {
        const cp = parseInt(dec, 10);
        return cp < 0x110000 ? String.fromCodePoint(cp) : '';
      } catch { return ''; }
    })
    .replace(/&colon;?/gi, ':')
    .replace(/&tab;?/gi, '\t')
    .replace(/&newline;?/gi, '\n')
    .replace(/&sol;?/gi, '/')
    .replace(/&bsol;?/gi, '\\')
    .replace(/&quot;?/gi, '"')
    .replace(/&apos;?/gi, "'")
    .replace(/&amp;?/gi, '&');
}

export function isAllowedHref(href) {
  if (typeof href !== 'string') return false;
  const h = href.trim();
  if (!h) return false;

  // Disallow raw whitespace, quotes, angle brackets, backslashes
  if (/[\s"'<>\\]/.test(h)) return false;

  // Reject any '&' before '?' in the raw href (character references in path/scheme are disallowed)
  const rawBeforeQuery = h.split('?')[0];
  if (rawBeforeQuery.includes('&')) return false;

  // Decode any HTML character references
  const decoded = decodeHtmlReferences(h);

  // Strip ASCII control characters and whitespace (0x00-0x20, 0x7F)
  const normalized = decoded.replace(/[\x00-\x20\x7F]/g, '');

  // Disallow protocol-relative URLs (e.g. //evil.com)
  if (normalized.startsWith('//')) return false;

  // Allowed absolute schemes: https:, mailto:, tel:
  if (/^https:\/\/[^\s"'<>\\]+$/i.test(normalized)) return true;
  if (/^mailto:[^\s"'<>\\]+$/i.test(normalized)) return true;
  if (/^tel:[^\s"'<>\\]+$/i.test(normalized)) return true;

  // Relative URLs: must not contain a scheme (colon before ? or # in normalized string)
  const beforeQuery = normalized.split(/[?#]/)[0];
  if (beforeQuery.includes(':')) return false;

  // Must not contain forbidden characters after decoding
  if (/[\s"'<>\\]/.test(decoded)) return false;

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
      const counts = { strong: 0, em: 0, span: 0, a: 0 };
      for (const tag of tags) {
        if (!isAllowedTag(tag)) {
          return `Disallowed HTML tag: ${tag}`;
        }
        if (/^<\s*strong\s*>/i.test(tag)) counts.strong++;
        else if (/^<\/\s*strong\s*>/i.test(tag)) counts.strong--;
        else if (/^<\s*em\s*>/i.test(tag)) counts.em++;
        else if (/^<\/\s*em\s*>/i.test(tag)) counts.em--;
        else if (/^<\s*span\b/i.test(tag)) counts.span++;
        else if (/^<\/\s*span\s*>/i.test(tag)) counts.span--;
        else if (/^<\s*a\b/i.test(tag)) counts.a++;
        else if (/^<\/\s*a\s*>/i.test(tag)) counts.a--;

        if (counts.strong < 0 || counts.em < 0 || counts.span < 0 || counts.a < 0) {
          return `Unbalanced or misplaced closing HTML tag in string: ${val}`;
        }
      }
      if (counts.strong !== 0 || counts.em !== 0 || counts.span !== 0 || counts.a !== 0) {
        return `Unbalanced unclosed HTML tag in string: ${val}`;
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
      } else if (selector === '[data-cs-options]') {
        html = html.replace(
          /<([a-zA-Z0-9]+)\b([^>]*)data-cs-options=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/\1>/gi,
          (match, tag, beforeAttr, csOptionsVal, afterAttr, inner) => {
            let innerContent = inner;
            const fullAttrs = `${beforeAttr} data-cs-options="${csOptionsVal}" ${afterAttr}`;
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
            return `<${tag}${beforeAttr}data-cs-options="${csOptionsVal}"${afterAttr}>${innerContent}</${tag}>`;
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

  rewriter.on('[data-cs-options]', {
    element(el) {
      const attr = el.getAttribute('data-cs-options');
      if (!attr) return;
      const dotIdx = attr.lastIndexOf('.');
      if (dotIdx === -1) return;
      const sectionKey = attr.slice(0, dotIdx);
      const fieldKey = attr.slice(dotIdx + 1);

      const section = sections[sectionKey];
      if (!section || typeof section !== 'object') return;

      const val = section[fieldKey];
      if (!Array.isArray(val) || val.length === 0) return;
      for (const item of val) {
        if (typeof item !== 'string') return;
      }

      const optIndent = sectionKey === 'form.request_support' ? '              ' : '          ';
      const closeIndent = sectionKey === 'form.request_support' ? '            ' : '        ';
      const optionsHtml = '\n' + val
        .map((item) => `${optIndent}<option value="${escapeOptionValue(item)}">${escapeOptionValue(item)}</option>`)
        .join('\n') + '\n' + closeIndent;
      el.setInnerContent(optionsHtml, { html: true });
    },
  });

  return rewriter.transform(response);
}

const SECTION_PREVIEW_MAP = Object.freeze({
  'ps_home.hero': { page_path: '/index.html', anchor: '', label: 'Homepage — Hero Banner' },
  'ps_home.journey': { page_path: '/index.html', anchor: '', label: 'Homepage — Caregiving Journey' },
  'ps_home.support': { page_path: '/index.html', anchor: '', label: 'Homepage — How We Support Caregivers' },
  'ps_home.community_wellness_partners': { page_path: '/index.html', anchor: '', label: 'Homepage — Community Wellness Partners' },
  'ps_about.hero': { page_path: '/about.html', anchor: '', label: 'About Page — Hero Banner' },
  'ps_about.story': { page_path: '/about.html', anchor: '', label: 'About Page — Our Story' },
  'ps_about.values': { page_path: '/about.html', anchor: '', label: 'About Page — What Guides Us (Values)' },
  'ps_about.join': { page_path: '/about.html', anchor: '', label: 'About Page — Join Us Call to Action' },
  'ps_programs.hero': { page_path: '/programs.html', anchor: '', label: 'Programs Page — Hero Banner' },
  'ps_programs.membership': { page_path: '/programs.html', anchor: '#membership', label: 'Programs Page — Sanctuary Membership Section' },
  'ps_programs.support_group': { page_path: '/programs.html', anchor: '#support-group', label: 'Programs Page — Virtual Support Group Section' },
  'ps_programs.grants': { page_path: '/programs.html', anchor: '#grants', label: 'Programs Page — Wellness Grants Section' },
  'ps_programs.socials': { page_path: '/programs.html', anchor: '#memory-socials', label: 'Programs Page — Memory Socials Section' },
  'ps_programs.coaching': { page_path: '/programs.html', anchor: '#coaching', label: 'Programs Page — 1:1 Wellness Coaching Section' },
  'ps_request_support.hero': { page_path: '/request-support.html', anchor: '', label: 'Request Support Page — Hero Banner' },
  'ps_request_support.next': { page_path: '/request-support.html', anchor: '', label: 'Request Support Page — What Happens Next' },
  'ps_form.membership': { page_path: '/index.html', anchor: '#membershipModal', label: 'Form — Sanctuary Membership Signup' },
  'ps_form.grant_apply': { page_path: '/programs.html', anchor: '#grantApplyModal', label: 'Form — Wellness Grant Application' },
  'ps_form.coaching_interest': { page_path: '/programs.html', anchor: '#coachingInterestModal', label: 'Form — 1:1 Wellness Coaching Interest' },
  'ps_form.request_support': { page_path: '/request-support.html', anchor: '#supportForm', label: 'Form — Request Support Intake' },
});

export function getContentTargetMeta(targetId, typeId, itemData = null) {
  const id = typeof targetId === 'string' ? targetId : '';
  if (id && SECTION_PREVIEW_MAP[id]) {
    return { id, type_id: typeId || 'page_section', ...SECTION_PREVIEW_MAP[id] };
  }
  const sectionKey = id.startsWith('ps_') ? id.slice(3) : (typeof itemData?.section_key === 'string' ? itemData.section_key : '');
  if (sectionKey && SECTION_PREVIEW_MAP[`ps_${sectionKey}`]) {
    return { id: id || `ps_${sectionKey}`, type_id: typeId || 'page_section', ...SECTION_PREVIEW_MAP[`ps_${sectionKey}`] };
  }
  if (sectionKey.startsWith('home.')) return { id, type_id: typeId || 'page_section', page_path: '/index.html', anchor: '', label: `Homepage — ${sectionKey}` };
  if (sectionKey.startsWith('about.')) return { id, type_id: typeId || 'page_section', page_path: '/about.html', anchor: '', label: `About Page — ${sectionKey}` };
  if (sectionKey.startsWith('programs.')) return { id, type_id: typeId || 'page_section', page_path: '/programs.html', anchor: '', label: `Programs Page — ${sectionKey}` };
  if (sectionKey.startsWith('request_support.')) return { id, type_id: typeId || 'page_section', page_path: '/request-support.html', anchor: '', label: `Request Support Page — ${sectionKey}` };
  if (sectionKey.startsWith('form.')) return { id, type_id: typeId || 'page_section', page_path: '/index.html', anchor: '', label: `Form — ${sectionKey}` };
  if (typeId === 'resource' || id.startsWith('res_')) {
    return { id, type_id: 'resource', page_path: '/resources.html', anchor: '', label: itemData?.title ? `Resource — ${itemData.title}` : `Resource (${id || 'new'})` };
  }
  if (typeId === 'faq' || id.startsWith('faq_')) {
    return { id, type_id: 'faq', page_path: '/faq.html', anchor: '', label: itemData?.question ? `FAQ — ${itemData.question}` : `FAQ (${id || 'new'})` };
  }
  if (typeId === 'partner' || id.startsWith('partner_')) {
    return { id, type_id: 'partner', page_path: '/sanctuary.html', anchor: '', label: itemData?.name ? `Partner — ${itemData.name}` : `Partner (${id || 'new'})` };
  }
  return { id, type_id: typeId || 'content', page_path: '/index.html', anchor: '', label: id || typeId || 'Website Content' };
}

function normalizePreviewPagePath(path) {
  let p = typeof path === 'string' ? path.trim() : '';
  if (!p || p === '/') return '/index';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (p.endsWith('.html')) p = p.slice(0, -5);
  return p || '/index';
}

export function isSupportedPageSectionPreviewTarget(targetId, typeId, itemData = null) {
  const meta = getContentTargetMeta(targetId, typeId, itemData);
  return Boolean(
    meta &&
    meta.type_id === 'page_section' &&
    typeof meta.id === 'string' &&
    Object.prototype.hasOwnProperty.call(SECTION_PREVIEW_MAP, meta.id)
  );
}

function canonicalPreviewValue(value) {
  if (Array.isArray(value)) return value.map(canonicalPreviewValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalPreviewValue(value[key])])
    );
  }
  return value;
}

async function sha256Hex(value) {
  const str = typeof value === 'string' ? value : JSON.stringify(canonicalPreviewValue(value));
  const bytes = new TextEncoder().encode(str);
  const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digestBytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function encodeBase64UrlUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64UrlUtf8(token) {
  if (typeof token !== 'string' || !token || token.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return null;
  }
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((token.length + 3) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export async function buildContentPreviewInfo({
  draftId,
  targetId,
  typeId,
  itemData = null,
  previewVersion = null,
  requestUrl = '',
  env = {},
  authorized = true,
  owner = null,
  draftRow = null,
  targetRow = null,
}) {
  const meta = getContentTargetMeta(targetId, typeId, itemData);
  if (!isSupportedPageSectionPreviewTarget(targetId, typeId, itemData)) {
    return {
      target_label: meta.label,
      page_path: meta.page_path || null,
      preview_path: null,
      staging_preview_url: null,
      preview_url: null,
      staging_preview_supported: false,
      preview_unavailable_reason: `Rendered page preview is not supported for ${meta.type_id || 'this content type'}; review the proposed before/after fields in the Assistant card.`,
    };
  }

  if (!authorized || !draftId || typeof previewVersion !== 'string' || !/^[0-9a-f]{64}$/i.test(previewVersion)) {
    return {
      target_label: meta.label,
      page_path: meta.page_path,
      preview_path: null,
      staging_preview_url: null,
      preview_url: null,
      staging_preview_supported: false,
      preview_unavailable_reason: 'Rendered page preview requires a verified staff session and exact draft version.',
    };
  }

  const fallbackStagingOrigin = (typeof env?.STAGING_PREVIEW_ORIGIN === 'string' && env.STAGING_PREVIEW_ORIGIN.trim())
    ? env.STAGING_PREVIEW_ORIGIN.trim().replace(/\/+$/, '')
    : 'https://staging.caregiversanctuary.org';

  if (!env || env.ENVIRONMENT !== 'preview') {
    const effectiveOwner = (typeof owner === 'string' && owner)
      ? owner
      : (typeof draftRow?.updated_by === 'string' ? draftRow.updated_by : null);
    if (
      !/^(?:cid_|ci_)[A-Za-z0-9_-]{1,128}$/.test(draftId) ||
      typeof effectiveOwner !== 'string' ||
      !effectiveOwner.startsWith('access_staff:') ||
      !draftRow ||
      typeof draftRow !== 'object' ||
      Array.isArray(draftRow) ||
      !itemData ||
      typeof itemData !== 'object' ||
      Array.isArray(itemData) ||
      findDisallowedHtml(itemData)
    ) {
      return {
        target_label: meta.label,
        page_path: meta.page_path,
        preview_path: null,
        staging_preview_url: null,
        preview_url: null,
        staging_preview_supported: false,
        preview_unavailable_reason: 'Rendered page preview requires a verified staff session and exact draft version.',
      };
    }

    let sourceOrigin = 'https://caregiversanctuary.org';
    try {
      if (requestUrl) {
        const parsed = new URL(requestUrl);
        if (parsed.origin && parsed.origin !== 'null') {
          sourceOrigin = parsed.origin;
        }
      }
    } catch {}

    if (!previewTransferConfigured(env) || !isPreviewTransferSource(sourceOrigin)) {
      return {
        target_label: meta.label, page_path: meta.page_path, preview_path: null,
        staging_preview_url: null, preview_url: null, staging_preview_supported: false,
        preview_unavailable_reason: 'Authenticated staging preview transfer is not configured for this environment.',
      };
    }
    const transferEnvelope = canonicalPreviewValue({
      v: 1,
      audience: fallbackStagingOrigin,
      expires_at: Math.floor(Date.now() / 1000) + PREVIEW_TRANSFER_TTL_SECONDS,
      source_origin: sourceOrigin,
      source_draft_id: draftId,
      source_preview_version: previewVersion.toLowerCase(),
      owner: effectiveOwner,
      target_id: meta.id,
      type_id: 'page_section',
      data: itemData,
      source_draft: draftRow,
      source_target: (targetRow && typeof targetRow === 'object') ? targetRow : null,
    });
    const transferToken = encodeBase64UrlUtf8(JSON.stringify(transferEnvelope));
    if (transferToken.length > 16384) {
      return {
        target_label: meta.label, page_path: meta.page_path, preview_path: null,
        staging_preview_url: null, preview_url: null, staging_preview_supported: false,
        preview_unavailable_reason: 'This draft exceeds the supported staging preview transfer size.',
      };
    }
    const signature = await signPreviewTransfer(transferToken, env);
    const stagingQuery = `?transfer=${encodeURIComponent(transferToken)}&transfer_signature=${signature}&source_version=${encodeURIComponent(previewVersion.toLowerCase())}`;
    const stagingPreviewUrl = `${fallbackStagingOrigin}/api/agent/preview/page${stagingQuery}${meta.anchor || ''}`;

    return {
      target_label: meta.label,
      page_path: meta.page_path,
      preview_path: null,
      staging_preview_url: stagingPreviewUrl,
      preview_url: stagingPreviewUrl,
      staging_preview_supported: true,
      preview_unavailable_reason: null,
    };
  }

  const query = `?draft_id=${encodeURIComponent(draftId)}&preview_version=${encodeURIComponent(previewVersion)}`;
  const previewPath = `/api/agent/preview/page${query}${meta.anchor || ''}`;

  let origin = fallbackStagingOrigin;
  try {
    if (requestUrl) {
      const parsed = new URL(requestUrl);
      if (parsed.origin && parsed.origin !== 'null' && parsed.hostname !== 'caregiversanctuary.org' && parsed.hostname !== 'www.caregiversanctuary.org') {
        origin = parsed.origin;
      }
    }
  } catch {}
  const previewUrl = `${origin}${previewPath}`;

  return {
    target_label: meta.label,
    page_path: meta.page_path,
    preview_path: previewPath,
    staging_preview_url: previewUrl,
    preview_url: previewUrl,
    staging_preview_supported: true,
    preview_unavailable_reason: null,
  };
}

async function getContentItemById(env, itemId) {
  if (!env || !env.LEGACY_DB || typeof env.LEGACY_DB.prepare !== 'function') return null;
  if (typeof itemId !== 'string' || !itemId) return null;
  try {
    const stmt = env.LEGACY_DB.prepare(
      'SELECT * FROM content_item WHERE id = ?'
    );
    if (typeof stmt.bind === 'function') {
      const bound = stmt.bind(itemId);
      if (typeof bound.first === 'function') {
        return await bound.first();
      }
      if (typeof bound.all === 'function') {
        const { results } = await bound.all();
        return Array.isArray(results) ? (results.find((r) => r.id === itemId) || null) : null;
      }
    }
    if (typeof stmt.all === 'function') {
      const { results } = await stmt.all();
      return Array.isArray(results) ? (results.find((r) => r.id === itemId) || null) : null;
    }
  } catch {}
  return null;
}

async function validatePageSectionSchemaInDb(env, targetId, proposedData) {
  if (!env || !env.LEGACY_DB || typeof env.LEGACY_DB.prepare !== 'function') return null;
  try {
    const stmt = env.LEGACY_DB.prepare('SELECT id, json_schema FROM content_type WHERE id = ?');
    const ctRow = typeof stmt.bind === 'function' ? await stmt.bind('page_section').first?.() : await stmt.first?.();
    if (!ctRow || !ctRow.json_schema) return null;
    const schema = typeof ctRow.json_schema === 'string' ? JSON.parse(ctRow.json_schema) : ctRow.json_schema;
    if (!schema || !Array.isArray(schema.oneOf)) return null;
    const sectionKey = targetId.startsWith('ps_') ? targetId.slice(3) : targetId;
    const candidate = { ...proposedData, section_key: sectionKey };
    const branch = schema.oneOf.find(
      (b) =>
        b.properties?.section_key?.const === sectionKey ||
        b.properties?.section_key?.enum?.includes(sectionKey)
    );
    if (!branch) return `section_key '${sectionKey}' does not match any valid section schema`;
    if (Array.isArray(branch.required)) {
      for (const req of branch.required) {
        if (!(req in candidate) || candidate[req] === undefined || candidate[req] === null) {
          return `missing required property: ${req}`;
        }
      }
    }
    for (const [key, val] of Object.entries(candidate)) {
      const propSchema = branch.properties?.[key];
      if (!propSchema) {
        if (branch.additionalProperties === false) return `unsupported additional property: ${key}`;
        continue;
      }
      if (propSchema.readOnly) return `cannot modify read-only property: ${key}`;
      if (propSchema.type === 'string') {
        if (typeof val !== 'string') return `property ${key} must be a string`;
        if (propSchema.maxLength && val.length > propSchema.maxLength) return `property ${key} exceeds maximum length`;
      } else if (propSchema.type === 'array') {
        if (!Array.isArray(val)) return `property ${key} must be an array`;
        if (propSchema.maxItems && val.length > propSchema.maxItems) return `property ${key} exceeds maximum items`;
        if (propSchema.items) {
          for (const it of val) {
            if (propSchema.items.type === 'string' && typeof it !== 'string') return `items of ${key} must be strings`;
            if (propSchema.items.maxLength && typeof it === 'string' && it.length > propSchema.items.maxLength) return `item of ${key} exceeds maximum length`;
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function previewFailClosed(status, error, message) {
  return new Response(
    JSON.stringify({ ok: false, error, message }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    }
  );
}

async function injectDraftPreviewBanner(response, draftRow, targetLabel, previewVersion = null, anchor = '', options = {}) {
  let html = await response.text();
  if (options?.injectBaseHref && !/<base\b/i.test(html)) {
    html = /<head\b[^>]*>/i.test(html)
      ? html.replace(/<head\b[^>]*>/i, (match) => `${match}\n  <base href="/">`)
      : `<base href="/">\n${html}`;
  }
  if (typeof anchor === 'string' && /^#(membershipModal|grantApplyModal|coachingInterestModal)$/.test(anchor)) {
    const modalId = anchor.slice(1);
    html = html.replace(
      new RegExp(`<div\\b[^>]*\\bid=["']${modalId}["'][^>]*>`, 'i'),
      (tag) => {
        if (/\bclass=["'][^"']*\bopen\b[^"']*["']/i.test(tag)) return tag;
        return tag.replace(/\bclass=(["'])([^"']*)\1/i, (m, q, cls) => `class=${q}${cls.trim()} open${q}`);
      }
    );
  }
  const safeDraftId = escapeHtml(draftRow.id);
  const safeTarget = escapeHtml(targetLabel || draftRow.draft_of || draftRow.type_id || 'content');
  const safeVer = previewVersion ? escapeHtml(previewVersion) : '';
  const shortVer = previewVersion ? ` · version <code>${escapeHtml(String(previewVersion).slice(0, 12))}</code>` : '';
  const verAttr = safeVer ? ` data-preview-version="${safeVer}"` : '';
  const sourceDraftAttr = options?.sourceDraftId ? ` data-source-draft-id="${escapeHtml(options.sourceDraftId)}"` : '';
  const sourceVerAttr = options?.sourcePreviewVersion ? ` data-source-preview-version="${escapeHtml(options.sourcePreviewVersion)}"` : '';
  const sourceNote = options?.sourceDraftId
    ? ` · production draft <code>${escapeHtml(options.sourceDraftId)}</code>`
    : '';
  const bannerHtml =
    `<div class="staging-draft-preview-banner" data-preview-draft-id="${safeDraftId}"${verAttr}${sourceDraftAttr}${sourceVerAttr} role="status" aria-live="polite">` +
    `<strong>Staging Draft Preview</strong> (<code>${safeDraftId}</code>${sourceNote}${shortVer} · ${safeTarget}) — ` +
    `This proposed wording is a draft preview and is <strong>not yet published</strong> to the live site. ` +
    `Return to the Staff Assistant to click <em>Confirm &amp; publish</em> or <em>Discard</em>.` +
    `</div>`;
  const updatedHtml = /<body\b[^>]*>/i.test(html)
    ? html.replace(/<body\b[^>]*>/i, (match) => `${match}\n  ${bannerHtml}`)
    : `${bannerHtml}\n${html}`;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(updatedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const ALLOWED_TRANSFER_KEYS = new Set([
  'v',
  'audience',
  'expires_at',
  'source_origin',
  'source_draft_id',
  'source_preview_version',
  'owner',
  'target_id',
  'type_id',
  'data',
  'source_draft',
  'source_target',
]);

async function materializeCrossOriginDraftTransfer({ url, env, actor, expectedPathCheck }) {
  if (expectedPathCheck !== null) {
    return {
      errorResponse: previewFailClosed(
        403,
        'preview_protected_route_required',
        'Cross-environment draft preview requires the protected /api/agent/preview/page entrypoint.'
      ),
    };
  }
  if (url.searchParams.has('draft_id') || url.searchParams.has('preview_draft')) {
    return {
      errorResponse: previewFailClosed(
        400,
        'invalid_preview_transfer',
        'Cannot combine transfer with a direct draft_id query parameter.'
      ),
    };
  }
  const transferParam = url.searchParams.get('transfer');
  const sourceVersionParam = url.searchParams.get('source_version') || url.searchParams.get('preview_version');
  if (!sourceVersionParam || !/^[0-9a-f]{64}$/i.test(sourceVersionParam)) {
    return {
      errorResponse: previewFailClosed(
        409,
        'preview_version_required',
        'Current exact source_version is required to render a transferred draft preview.'
      ),
    };
  }
  const decodedJson = decodeBase64UrlUtf8(transferParam);
  if (!decodedJson) {
    return {
      errorResponse: previewFailClosed(400, 'invalid_preview_transfer', 'Malformed transfer envelope.'),
    };
  }
  let transfer;
  try {
    transfer = JSON.parse(decodedJson);
  } catch {
    return {
      errorResponse: previewFailClosed(400, 'invalid_preview_transfer', 'Invalid transfer JSON.'),
    };
  }
  if (
    !transfer ||
    typeof transfer !== 'object' ||
    Array.isArray(transfer) ||
    transfer.v !== 1 ||
    !Object.keys(transfer).every((k) => ALLOWED_TRANSFER_KEYS.has(k))
  ) {
    return {
      errorResponse: previewFailClosed(400, 'invalid_preview_transfer', 'Unsupported transfer envelope structure.'),
    };
  }

  // Public SHA versions cannot authenticate client-controlled snapshots.
  // Verify source authentication before staging draft reads or writes.
  if (!previewTransferConfigured(env)) {
    return { errorResponse: previewFailClosed(503, 'preview_transfer_unconfigured', 'Authenticated preview transfer is not configured.') };
  }
  if (!await verifyPreviewTransfer(transferParam, url.searchParams.get('transfer_signature'), env)) {
    return { errorResponse: previewFailClosed(403, 'preview_transfer_unauthenticated', 'Preview transfer authentication failed.') };
  }
  const now = Math.floor(Date.now() / 1000);
  if (transfer.audience !== url.origin || !Number.isSafeInteger(transfer.expires_at)
      || transfer.expires_at <= now || transfer.expires_at > now + PREVIEW_TRANSFER_TTL_SECONDS + 30) {
    return { errorResponse: previewFailClosed(403, 'preview_transfer_expired_or_wrong_audience', 'Preview transfer has expired or targets another environment.') };
  }
  if (!isPreviewTransferSource(transfer.source_origin)) {
    return { errorResponse: previewFailClosed(403, 'preview_transfer_invalid_source', 'Preview transfer source is not a production origin.') };
  }

  let parsedSourceOrigin;
  try {
    parsedSourceOrigin = new URL(transfer.source_origin);
  } catch {
    return {
      errorResponse: previewFailClosed(400, 'invalid_preview_transfer', 'Invalid transfer source_origin.'),
    };
  }
  if (
    !/^https?:$/i.test(parsedSourceOrigin.protocol) ||
    parsedSourceOrigin.origin !== transfer.source_origin ||
    parsedSourceOrigin.origin === url.origin
  ) {
    return {
      errorResponse: previewFailClosed(
        400,
        'invalid_preview_transfer',
        'Cross-environment draft transfer requires a distinct valid source_origin.'
      ),
    };
  }

  if (
    typeof transfer.source_draft_id !== 'string' ||
    !/^(?:cid_|ci_)[A-Za-z0-9_-]{1,128}$/.test(transfer.source_draft_id) ||
    transfer.source_draft_id.startsWith('cid_stg_') ||
    typeof transfer.source_preview_version !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(transfer.source_preview_version)
  ) {
    return {
      errorResponse: previewFailClosed(400, 'invalid_preview_transfer', 'Invalid source draft identifiers in transfer.'),
    };
  }

  if (transfer.source_preview_version.toLowerCase() !== sourceVersionParam.toLowerCase()) {
    return {
      errorResponse: previewFailClosed(
        409,
        'preview_version_mismatch',
        'Transfer source_preview_version does not match source_version.'
      ),
    };
  }

  if (typeof transfer.owner !== 'string' || !ownsDraft(transfer.owner, actor)) {
    return {
      errorResponse: previewFailClosed(
        403,
        'preview_forbidden_owner',
        'Only the verified initiating staff member who owns this draft can preview it.'
      ),
    };
  }

  if (
    transfer.type_id !== 'page_section' ||
    typeof transfer.target_id !== 'string' ||
    !isSupportedPageSectionPreviewTarget(transfer.target_id, transfer.type_id, transfer.data)
  ) {
    return {
      errorResponse: previewFailClosed(
        422,
        'preview_unsupported_type',
        `Rendered page preview is not supported for ${transfer.type_id || 'this content type'}.`
      ),
    };
  }

  if (!transfer.data || typeof transfer.data !== 'object' || Array.isArray(transfer.data) || findDisallowedHtml(transfer.data)) {
    return {
      errorResponse: previewFailClosed(422, 'preview_invalid_data', 'Draft payload failed preview validation.'),
    };
  }

  const sd = transfer.source_draft;
  if (
    !sd ||
    typeof sd !== 'object' ||
    Array.isArray(sd) ||
    sd.id !== transfer.source_draft_id ||
    sd.type_id !== 'page_section' ||
    sd.status !== 'draft' ||
    sd.draft_of !== transfer.target_id ||
    sd.updated_by !== transfer.owner
  ) {
    return {
      errorResponse: previewFailClosed(409, 'preview_version_mismatch', 'Source draft snapshot does not match transfer metadata.'),
    };
  }
  let sdData;
  try {
    sdData = typeof sd.data === 'string' ? JSON.parse(sd.data) : sd.data;
  } catch {
    return {
      errorResponse: previewFailClosed(409, 'preview_version_mismatch', 'Invalid source draft data snapshot.'),
    };
  }
  if (JSON.stringify(canonicalPreviewValue(sdData)) !== JSON.stringify(canonicalPreviewValue(transfer.data))) {
    return {
      errorResponse: previewFailClosed(409, 'preview_version_mismatch', 'Transfer data does not match source draft snapshot.'),
    };
  }
  const recomputedSourceVersion = await sha256Hex({
    kind: 'content',
    origin: parsedSourceOrigin.origin,
    draft: sd,
    table: 'content_item',
    targetId: transfer.target_id,
    target: transfer.source_target ?? null,
    linkedAward: null,
  });
  if (recomputedSourceVersion !== transfer.source_preview_version.toLowerCase()) {
    return {
      errorResponse: previewFailClosed(
        409,
        'preview_version_mismatch',
        'Transferred draft snapshot does not match its source confirmation binding.'
      ),
    };
  }

  const schemaErr = await validatePageSectionSchemaInDb(env, transfer.target_id, transfer.data);
  if (schemaErr) {
    return {
      errorResponse: previewFailClosed(422, 'preview_invalid_data', `Draft payload failed schema validation: ${schemaErr}`),
    };
  }

  const stagingTargetRow = await getContentItemById(env, transfer.target_id);
  if (!stagingTargetRow || stagingTargetRow.status !== 'published') {
    return {
      errorResponse: previewFailClosed(404, 'preview_target_not_found', 'Target page section is not published in the staging database.'),
    };
  }

  const stagingDraftHash = await sha256Hex({
    v: 1,
    staging_origin: url.origin,
    source_origin: parsedSourceOrigin.origin,
    source_draft_id: transfer.source_draft_id,
    source_preview_version: transfer.source_preview_version.toLowerCase(),
    owner: draftOwner(actor),
    target_id: transfer.target_id,
    data: transfer.data,
  });
  const stagingDraftId = `cid_stg_${stagingDraftHash.slice(0, 32)}`;

  let stagingDraftRow = await getContentItemById(env, stagingDraftId);
  if (!stagingDraftRow) {
    let targetBaseData = {};
    try {
      targetBaseData = typeof stagingTargetRow.data === 'string'
        ? JSON.parse(stagingTargetRow.data)
        : (stagingTargetRow.data || {});
    } catch {}
    const stagedData = {
      ...targetBaseData,
      ...transfer.data,
      section_key: transfer.target_id.slice(3),
    };
    const stagedDataStr = JSON.stringify(stagedData);
    const auditBeforeStr = JSON.stringify({
      source_origin: parsedSourceOrigin.origin,
      source_draft_id: transfer.source_draft_id,
      source_preview_version: transfer.source_preview_version.toLowerCase(),
      draft_of: transfer.target_id,
    });
    const insertDraftStmt = env.LEGACY_DB
      .prepare(
        `INSERT INTO content_item (id, type_id, data, status, draft_of, updated_by, updated_at)
         VALUES (?, 'page_section', ?, 'draft', ?, ?, datetime('now'))`
      )
      .bind(stagingDraftId, stagedDataStr, transfer.target_id, draftOwner(actor));
    const insertAuditStmt = env.LEGACY_DB
      .prepare(
        `INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
         VALUES (?, 'content_item.staging_preview_stage', 'content_item', ?, ?, ?)`
      )
      .bind(actor, stagingDraftId, auditBeforeStr, stagedDataStr);

    if (typeof env.LEGACY_DB.batch === 'function') {
      await env.LEGACY_DB.batch([insertDraftStmt, insertAuditStmt]);
    } else {
      await insertDraftStmt.run();
      await insertAuditStmt.run();
    }
    stagingDraftRow = await getContentItemById(env, stagingDraftId);
  } else {
    if (stagingDraftRow.status !== 'draft') {
      return {
        errorResponse: previewFailClosed(
          409,
          'preview_draft_not_active',
          `Draft is in status ${stagingDraftRow.status} and can no longer be previewed.`
        ),
      };
    }
    if (!ownsDraft(stagingDraftRow.updated_by, actor)) {
      return {
        errorResponse: previewFailClosed(
          403,
          'preview_forbidden_owner',
          'Only the verified initiating staff member who owns this draft can preview it.'
        ),
      };
    }
    if (stagingDraftRow.draft_of !== transfer.target_id) {
      return {
        errorResponse: previewFailClosed(409, 'preview_page_mismatch', 'Staging draft target mismatch.'),
      };
    }
  }

  if (!stagingDraftRow) {
    return {
      errorResponse: previewFailClosed(500, 'preview_error', 'Failed to materialize staging preview draft.'),
    };
  }

  const stagingBinding = await confirmationBinding(env.LEGACY_DB, 'content', stagingDraftRow, url.origin, stagingTargetRow);
  return {
    draftRow: stagingDraftRow,
    targetRow: stagingTargetRow,
    binding: stagingBinding,
    sourceDraftId: transfer.source_draft_id,
    sourcePreviewVersion: transfer.source_preview_version.toLowerCase(),
  };
}

async function validateAndRenderDraftPreview({
  request,
  env,
  data,
  upstreamResponse = null,
  expectedPathCheck = null,
  injectBaseHref = false,
}) {
  if (!env || env.ENVIRONMENT !== 'preview') {
    return previewFailClosed(403, 'preview_environment_required', 'Draft page preview is only available in the explicit staging preview environment.');
  }
  if (!env.LEGACY_DB || typeof env.LEGACY_DB.prepare !== 'function') {
    return previewFailClosed(503, 'preview_db_unavailable', 'Preview database is unavailable.');
  }
  const actor = confirmationActor(data);
  if (!actor) {
    return previewFailClosed(403, 'preview_unauthorized', 'Draft page preview requires a verified active staff identity.');
  }
  const url = new URL(request.url);

  let draftRow = null;
  let targetRow = null;
  let binding = null;
  let sourceDraftId = null;
  let sourcePreviewVersion = null;

  if (url.searchParams.has('transfer')) {
    const materialized = await materializeCrossOriginDraftTransfer({
      url,
      env,
      actor,
      expectedPathCheck,
    });
    if (materialized.errorResponse) {
      return materialized.errorResponse;
    }
    draftRow = materialized.draftRow;
    targetRow = materialized.targetRow;
    binding = materialized.binding;
    sourceDraftId = materialized.sourceDraftId;
    sourcePreviewVersion = materialized.sourcePreviewVersion;
  } else {
    const previewDraftId = url.searchParams.get('draft_id') || url.searchParams.get('preview_draft');
    const previewVersionParam = url.searchParams.get('preview_version');
    if (!previewDraftId || !/^(?:cid_|ci_)[A-Za-z0-9_-]{1,128}$/.test(previewDraftId)) {
      return previewFailClosed(400, 'invalid_preview_draft', 'A valid preview_draft ID is required.');
    }
    if (!previewVersionParam || !/^[0-9a-f]{64}$/i.test(previewVersionParam)) {
      return previewFailClosed(409, 'preview_version_required', 'Current exact preview_version is required to render a draft preview.');
    }

    draftRow = await getContentItemById(env, previewDraftId);
    if (!draftRow) {
      return previewFailClosed(404, 'preview_draft_not_found', 'Draft was not found in this environment database; production and staging use separate isolated databases.');
    }
    if (draftRow.status !== 'draft') {
      return previewFailClosed(409, 'preview_draft_not_active', `Draft is in status ${draftRow.status} and can no longer be previewed.`);
    }
    if (!ownsDraft(draftRow.updated_by, actor)) {
      return previewFailClosed(403, 'preview_forbidden_owner', 'Only the verified initiating staff member who owns this draft can preview it.');
    }
  }

  const targetId = typeof draftRow.draft_of === 'string' ? draftRow.draft_of : '';
  if (draftRow.type_id !== 'page_section' || !targetId || !Object.prototype.hasOwnProperty.call(SECTION_PREVIEW_MAP, targetId)) {
    return previewFailClosed(422, 'preview_unsupported_type', `Rendered page preview is not supported for ${draftRow.type_id || 'this content type'}.`);
  }

  const expectedPagePath = SECTION_PREVIEW_MAP[targetId].page_path;
  if (expectedPathCheck !== null && normalizePreviewPagePath(expectedPathCheck) !== normalizePreviewPagePath(expectedPagePath)) {
    return previewFailClosed(409, 'preview_page_mismatch', `Draft ${draftRow.id} targets ${expectedPagePath}, not ${expectedPathCheck}.`);
  }

  if (!binding) {
    targetRow = await getContentItemById(env, targetId);
    binding = await confirmationBinding(env.LEGACY_DB, 'content', draftRow, url.origin, targetRow);
    const previewVersionParam = url.searchParams.get('preview_version');
    if (!binding || binding.version !== previewVersionParam) {
      return previewFailClosed(409, 'preview_version_mismatch', 'Preview version is stale or does not match the current draft and target state.');
    }
  }

  let pageResponse = upstreamResponse;
  if (!pageResponse) {
    const assetReq = new Request(new URL(expectedPagePath, url.origin), { method: 'GET' });
    if (typeof env?.ASSETS?.fetch === 'function') {
      pageResponse = await env.ASSETS.fetch(assetReq);
    } else if (typeof data?.previewAssetFetch === 'function') {
      pageResponse = await data.previewAssetFetch(expectedPagePath);
    } else {
      pageResponse = await fetch(assetReq);
    }
  }

  if (!pageResponse || pageResponse.status !== 200) {
    return previewFailClosed(502, 'preview_upstream_unavailable', 'Target page response is unavailable for preview.');
  }
  const contentType = pageResponse.headers.get('content-type');
  if (contentType && !contentType.includes('text/html')) {
    return previewFailClosed(422, 'preview_non_html_target', 'Target route is not an HTML page.');
  }

  const draftData = typeof draftRow.data === 'string' ? JSON.parse(draftRow.data) : draftRow.data;
  if (!draftData || typeof draftData !== 'object' || Array.isArray(draftData) || findDisallowedHtml(draftData)) {
    return previewFailClosed(422, 'preview_invalid_data', 'Draft payload failed preview validation.');
  }

  const publishedSections = await getPublishedSections(env);
  const baseSections = publishedSections ? { ...publishedSections } : {};
  const sectionKey = targetId.slice(3);
  baseSections[sectionKey] = {
    ...(baseSections[sectionKey] || {}),
    ...draftData,
  };
  const rewritten = await rewriteContent(pageResponse, baseSections);
  const meta = getContentTargetMeta(targetId, draftRow.type_id, draftData);
  return await injectDraftPreviewBanner(rewritten, draftRow, meta.label, binding.version, meta.anchor, {
    injectBaseHref,
    sourceDraftId,
    sourcePreviewVersion,
  });
}

export async function renderProtectedDraftPreviewPage(context) {
  try {
    const { request, env, data } = context || {};
    if (!request || request.method !== 'GET') {
      return previewFailClosed(405, 'method_not_allowed', 'GET is required for draft page preview.');
    }
    return await validateAndRenderDraftPreview({
      request,
      env,
      data,
      upstreamResponse: null,
      expectedPathCheck: null,
      injectBaseHref: true,
    });
  } catch {
    return previewFailClosed(500, 'preview_error', 'Draft preview failed closed.');
  }
}

export async function maybeRewriteContent(context, response) {
  let isPreviewRequest = false;
  try {
    const { request, env } = context;
    if (!request || request.method !== 'GET') {
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

    isPreviewRequest = url.searchParams.has('preview_draft') || url.searchParams.has('preview_version');

    if (isPreviewRequest) {
      return await validateAndRenderDraftPreview({
        request,
        env,
        data: context?.data,
        upstreamResponse: response,
        expectedPathCheck: path,
        injectBaseHref: false,
      });
    }

    if (!response || response.status !== 200) {
      return response;
    }
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('text/html')) {
      return response;
    }

    if (!env || !env.LEGACY_DB) {
      return response;
    }

    const publishedSections = await getPublishedSections(env);
    if (!publishedSections || Object.keys(publishedSections).length === 0) {
      return response;
    }

    return await rewriteContent(response, publishedSections);
  } catch {
    if (isPreviewRequest) {
      return previewFailClosed(500, 'preview_error', 'Draft preview failed closed.');
    }
    // Hard fallback: never break a public page if rewrite fails
    return response;
  }
}
