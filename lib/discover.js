import { safeFetch } from './fetcher.js';
import { parseFeed, looksLikeFeed, absoluteUrl, stripTags } from './feed.js';

const GUESS_PATHS = [
  '/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml',
  '/index.xml', '/feed/', '/blog/feed', '/feeds/posts/default', '/?feed=rss2',
];

const LINK_TAG_RE = /<link\b[^>]*>/gi;
const ATTR_RE = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

export function normalizeInput(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new Error('Falta la URL');
  if (!/^[a-z][\w+.-]*:/i.test(s)) s = 'https://' + s;
  const url = new URL(s);

  if (/(^|\.)youtube\.com$/i.test(url.hostname)) {
    const m = /^\/channel\/([\w-]+)/.exec(url.pathname);
    if (m) return new URL(`https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`);
  }
  if (/(^|\.)reddit\.com$/i.test(url.hostname) && !url.pathname.endsWith('.rss')) {
    return new URL(url.pathname.replace(/\/$/, '') + '/.rss', url.origin);
  }
  return url;
}

function feedLinksFromHtml(html, base) {
  const out = [];
  for (const tag of html.slice(0, 400000).match(LINK_TAG_RE) || []) {
    const attrs = {};
    ATTR_RE.lastIndex = 0;
    let m;
    while ((m = ATTR_RE.exec(tag))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';

    const rel = (attrs.rel || '').toLowerCase();
    const type = (attrs.type || '').toLowerCase();
    if (!rel.includes('alternate') && rel !== 'feed') continue;
    if (!/(rss|atom)\+xml|application\/feed/.test(type)) continue;

    const href = absoluteUrl(attrs.href, base);
    if (href && !out.includes(href)) out.push(href);
  }
  return out;
}

function siteSpecificCandidates(pageUrl, html) {
  const host = new URL(pageUrl).hostname;
  if (/(^|\.)youtube\.com$/i.test(host)) {
    const id =
      /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']*\/channel\/(UC[\w-]+)/i.exec(html)?.[1] ||
      /<meta[^>]+itemprop=["']identifier["'][^>]+content=["'](UC[\w-]+)["']/i.exec(html)?.[1] ||
      /"externalId"\s*:\s*"(UC[\w-]+)"/.exec(html)?.[1] ||
      /\/channel\/(UC[\w-]+)/.exec(html)?.[1];
    if (id) return [`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`];
    const playlist = /[?&]list=([\w-]+)/.exec(pageUrl)?.[1];
    if (playlist) return [`https://www.youtube.com/feeds/videos.xml?playlist_id=${playlist}`];
  }
  if (/(^|\.)github\.com$/i.test(host)) {
    const m = /^\/([\w.-]+)(?:\/([\w.-]+))?/.exec(new URL(pageUrl).pathname);
    if (m?.[2]) return [`https://github.com/${m[1]}/${m[2]}/releases.atom`];
    if (m?.[1]) return [`https://github.com/${m[1]}.atom`];
  }
  return [];
}

function describe(url, feed) {
  return {
    url,
    title: feed.title || new URL(url).hostname,
    siteUrl: feed.siteUrl,
    description: feed.description,
    itemCount: feed.items.length,
  };
}

async function tryFeed(url) {
  try {
    const res = await safeFetch(url);
    if (!looksLikeFeed(res.body, res.contentType)) return null;
    const feed = parseFeed(res.body, res.url);
    if (!feed || !feed.items.length) return null;
    return describe(res.url, feed);
  } catch {
    return null;
  }
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((c) => (seen.has(c.url) ? false : seen.add(c.url)));
}

export async function discover(raw) {
  const start = normalizeInput(raw);
  const page = await safeFetch(start);

  if (looksLikeFeed(page.body, page.contentType)) {
    const feed = parseFeed(page.body, page.url);
    if (feed) return [describe(page.url, feed)];
  }

  const declared = feedLinksFromHtml(page.body, page.url).slice(0, 5);
  if (declared.length) {
    const found = (await Promise.all(declared.map(tryFeed))).filter(Boolean);
    if (found.length) return dedupe(found);
  }

  const special = siteSpecificCandidates(page.url, page.body);
  if (special.length) {
    const found = (await Promise.all(special.map(tryFeed))).filter(Boolean);
    if (found.length) return dedupe(found);
  }

  const origin = new URL(page.url).origin;
  const found = (await Promise.all(GUESS_PATHS.map((p) => tryFeed(origin + p)))).filter(Boolean);
  if (found.length) return dedupe(found).slice(0, 4);

  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.body)?.[1] || '');
  const err = new Error(`No encontré ningún feed en ${title || new URL(page.url).hostname}`);
  err.status = 404;
  throw err;
}
