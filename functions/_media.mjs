// Media edge rewrite per ADR 0007 section 3.
// Reads manifest.json from R2 (binding MEDIA) and rewrites gallery grid, filter,
// carousel track, and section hero banners with HTMLRewriter.
//
// Hard fallback: if MEDIA is undefined, manifest is missing/unparsable, or version != 1,
// the response passes through untouched.

function escapeAttr(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const ROUTE_AREA_MAP = {
  '/about': 'about',
  '/about.html': 'about',
  '/programs-events': 'programs-events',
  '/programs-events.html': 'programs-events',
  '/resources': 'resources',
  '/resources.html': 'resources',
  '/get-involved': 'get-involved',
  '/get-involved.html': 'get-involved',
  '/sanctuary': 'sanctuary',
  '/sanctuary.html': 'sanctuary',
  '/donate': 'donate',
  '/donate.html': 'donate',
};

export function isGalleryRoute(path) {
  return path === '/gallery' || path === '/gallery.html';
}

export function isCarouselRoute(path) {
  return path === '/' || path === '/index.html' || path === '/programs-events' || path === '/programs-events.html';
}

export function getAreaKey(path) {
  return ROUTE_AREA_MAP[path] || null;
}

export function isMediaRewritableRoute(path) {
  return isGalleryRoute(path) || isCarouselRoute(path) || !!getAreaKey(path);
}

let _manifestCache = { manifest: null, at: 0 };
const CACHE_TTL_MS = 60 * 1000;

export function _resetManifestCache() {
  _manifestCache = { manifest: null, at: 0 };
}

export async function getManifest(env, now = Date.now()) {
  if (!env || !env.MEDIA || typeof env.MEDIA.get !== 'function') {
    return null;
  }
  if (_manifestCache.manifest && (now - _manifestCache.at < CACHE_TTL_MS)) {
    return _manifestCache.manifest;
  }
  try {
    const obj = await env.MEDIA.get('manifest.json');
    if (!obj) return null;
    const text = await obj.text();
    const data = JSON.parse(text);
    if (!data || data.version !== 1) return null;
    _manifestCache = { manifest: data, at: now };
    return data;
  } catch {
    return null;
  }
}

export function collectGroups(manifest) {
  const groupsByName = new Map();
  if (manifest && manifest.areas && typeof manifest.areas === 'object') {
    for (const area of Object.values(manifest.areas)) {
      if (area && area.groups && typeof area.groups === 'object') {
        for (const [groupName, groupObj] of Object.entries(area.groups)) {
          if (groupObj && Array.isArray(groupObj.items)) {
            groupsByName.set(groupName, groupObj);
          }
        }
      }
    }
  }
  return groupsByName;
}

export function buildGalleryGridHtml(manifest, groupsByName) {
  const orderedGroupNames = [];
  if (Array.isArray(manifest.gallery_order)) {
    for (const name of manifest.gallery_order) {
      if (groupsByName.has(name) && !orderedGroupNames.includes(name)) {
        orderedGroupNames.push(name);
      }
    }
  }
  for (const name of groupsByName.keys()) {
    if (!orderedGroupNames.includes(name)) {
      orderedGroupNames.push(name);
    }
  }

  let totalItems = 0;
  for (const name of orderedGroupNames) {
    const grp = groupsByName.get(name);
    totalItems += grp.items.length;
  }

  let html = '';
  let index = 1;
  for (const groupName of orderedGroupNames) {
    const grp = groupsByName.get(groupName);
    for (const item of grp.items) {
      const srcUrl = `/media/r2/${item.key}`;
      const thumbUrl = `/media/r2/${item.thumb || item.key}`;
      const altText = item.alt || '';
      const captionText = item.caption || '';
      const width = item.width || 800;
      const height = item.height || 600;

      html += `      <li class="gallery-cell" data-folder="${escapeAttr(groupName)}">\n`;
      html += `        <button type="button" class="gallery-open"\n`;
      html += `                data-src="${escapeAttr(srcUrl)}" data-alt="${escapeAttr(altText)}" data-caption="${escapeAttr(captionText)}"\n`;
      html += `                aria-label="View photograph ${index} of ${totalItems} larger">\n`;
      html += `          <img src="${escapeAttr(thumbUrl)}" alt="${escapeAttr(altText)}" loading="lazy" decoding="async"\n`;
      html += `               width="${width}" height="${height}">\n`;
      html += `        </button>\n`;
      html += `      </li>\n`;
      index++;
    }
  }
  return html.trimEnd();
}

export function buildGalleryFilterHtml(manifest, groupsByName) {
  const orderedGroupNames = [];
  if (Array.isArray(manifest.gallery_order)) {
    for (const name of manifest.gallery_order) {
      if (groupsByName.has(name) && !orderedGroupNames.includes(name)) {
        orderedGroupNames.push(name);
      }
    }
  }
  for (const name of groupsByName.keys()) {
    if (!orderedGroupNames.includes(name)) {
      orderedGroupNames.push(name);
    }
  }

  let html = `          <option value="">All photos</option>\n`;
  for (const name of orderedGroupNames) {
    html += `          <option value="${escapeAttr(name)}">${escapeHtml(name)}</option>\n`;
  }
  return html.trimEnd();
}

export function buildCarouselTrackHtml(manifest, groupsByName) {
  let carouselItems = [];
  const mainPreview = groupsByName.get('Main Page Gallery Preview Photos');
  if (mainPreview && Array.isArray(mainPreview.items) && mainPreview.items.length > 0) {
    carouselItems = mainPreview.items.slice(0, 10);
  } else {
    const orderedGroupNames = [];
    if (Array.isArray(manifest.gallery_order)) {
      for (const name of manifest.gallery_order) {
        if (groupsByName.has(name) && !orderedGroupNames.includes(name)) {
          orderedGroupNames.push(name);
        }
      }
    }
    for (const name of groupsByName.keys()) {
      if (!orderedGroupNames.includes(name)) {
        orderedGroupNames.push(name);
      }
    }
    for (const name of orderedGroupNames) {
      const grp = groupsByName.get(name);
      for (const it of grp.items) {
        carouselItems.push(it);
        if (carouselItems.length >= 10) break;
      }
      if (carouselItems.length >= 10) break;
    }
  }

  let html = '';
  for (const item of carouselItems) {
    const thumbUrl = `/media/r2/${item.thumb || item.key}`;
    const altText = item.alt || '';
    const label = altText ? `${altText} — View full photo gallery` : 'View full photo gallery';
    const width = item.width || 800;
    const height = item.height || 600;

    html += `        <li class="carousel-item">\n`;
    html += `          <a class="carousel-link" href="gallery.html"\n`;
    html += `             aria-label="${escapeAttr(label)}">\n`;
    html += `            <img src="${escapeAttr(thumbUrl)}" alt="${escapeAttr(altText)}"\n`;
    html += `                 loading="lazy" decoding="async" width="${width}" height="${height}" draggable="false">\n`;
    html += `          </a>\n`;
    html += `        </li>\n`;
  }
  return html.trimEnd();
}

function getBannerForPath(manifest, path) {
  const areaKey = getAreaKey(path);
  if (!areaKey || !manifest || !manifest.areas || !manifest.areas[areaKey]) return null;
  const area = manifest.areas[areaKey];
  return area.banner || null;
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
      if (selector === 'ul.gallery-grid') {
        html = html.replace(/(<ul[^>]*class="[^"]*gallery-grid[^"]*"[^>]*>)([\s\S]*?)(<\/ul>)/, (match, openTag, inner, closeTag) => {
          let innerContent = inner;
          const element = {
            tagName: 'ul',
            getAttribute: () => null,
            setAttribute: () => {},
            setInnerContent: (content) => {
              innerContent = '\n' + content + '\n    ';
            },
            replace: () => {},
          };
          if (handlers.element) handlers.element(element);
          return `${openTag}${innerContent}${closeTag}`;
        });
      } else if (selector === '[data-gallery-filter]' || selector === 'select[data-gallery-filter]') {
        html = html.replace(/(<select[^>]*data-gallery-filter[^>]*>)([\s\S]*?)(<\/select>)/, (match, openTag, inner, closeTag) => {
          let innerContent = inner;
          const element = {
            tagName: 'select',
            getAttribute: () => null,
            setAttribute: () => {},
            setInnerContent: (content) => {
              innerContent = '\n' + content + '\n        ';
            },
            replace: () => {},
          };
          if (handlers.element) handlers.element(element);
          return `${openTag}${innerContent}${closeTag}`;
        });
      } else if (selector === '[data-carousel-track]' || selector === 'ul[data-carousel-track]') {
        html = html.replace(/(<ul[^>]*data-carousel-track[^>]*>)([\s\S]*?)(<\/ul>)/, (match, openTag, inner, closeTag) => {
          let innerContent = inner;
          const element = {
            tagName: 'ul',
            getAttribute: () => null,
            setAttribute: () => {},
            setInnerContent: (content) => {
              innerContent = '\n' + content + '\n      ';
            },
            replace: () => {},
          };
          if (handlers.element) handlers.element(element);
          return `${openTag}${innerContent}${closeTag}`;
        });
      } else if (selector === 'img.hero-media' || selector === '.hero-media') {
        html = html.replace(/<img[^>]*class="[^"]*hero-media[^"]*"[^>]*>/, (match) => {
          let tag = match;
          const element = {
            tagName: 'img',
            getAttribute: (attr) => {
              const m = new RegExp(`${attr}="([^"]*)"`).exec(tag);
              return m ? m[1] : null;
            },
            setAttribute: (name, val) => {
              if (new RegExp(`${name}="[^"]*"`).test(tag)) {
                tag = tag.replace(new RegExp(`${name}="[^"]*"`), `${name}="${val}"`);
              } else {
                tag = tag.replace(/>$/, ` ${name}="${val}">`);
              }
            },
            setInnerContent: () => {},
            replace: (content) => {
              tag = content;
            },
          };
          if (handlers.element) handlers.element(element);
          return tag;
        });
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

export async function rewriteMedia(response, manifest, pathname) {
  const groupsByName = collectGroups(manifest);
  const RewriterClass = getHTMLRewriterClass();
  const rewriter = new RewriterClass();

  let hasHandlers = false;

  if (isGalleryRoute(pathname)) {
    const galleryHtml = buildGalleryGridHtml(manifest, groupsByName);
    const filterHtml = buildGalleryFilterHtml(manifest, groupsByName);

    rewriter.on('ul.gallery-grid', {
      element(el) {
        el.setInnerContent(galleryHtml, { html: true });
      },
    });
    rewriter.on('[data-gallery-filter]', {
      element(el) {
        el.setInnerContent(filterHtml, { html: true });
      },
    });
    hasHandlers = true;
  }

  if (isCarouselRoute(pathname)) {
    const carouselHtml = buildCarouselTrackHtml(manifest, groupsByName);
    rewriter.on('[data-carousel-track]', {
      element(el) {
        el.setInnerContent(carouselHtml, { html: true });
      },
    });
    hasHandlers = true;
  }

  const banner = getBannerForPath(manifest, pathname);
  if (banner && banner.key) {
    rewriter.on('img.hero-media', {
      element(el) {
        if (banner.kind === 'video') {
          el.replace(
            `<video class="hero-media" autoplay muted loop playsinline src="/media/r2/${escapeAttr(banner.key)}"><source src="/media/r2/${escapeAttr(banner.key)}"></video>`,
            { html: true }
          );
        } else {
          el.setAttribute('src', `/media/r2/${banner.key}`);
        }
      },
    });
    hasHandlers = true;
  }

  if (!hasHandlers) {
    return response;
  }

  return rewriter.transform(response);
}

export async function maybeRewriteMedia(context, response) {
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

    if (!isMediaRewritableRoute(path)) {
      return response;
    }

    if (!env || !env.MEDIA) {
      return response;
    }

    const manifest = await getManifest(env);
    if (!manifest || manifest.version !== 1) {
      return response;
    }

    return await rewriteMedia(response, manifest, path);
  } catch (err) {
    // Hard fallback: never break a page if rewrite fails
    return response;
  }
}
