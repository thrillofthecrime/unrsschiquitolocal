// Normaliza RSS 2.0 / RSS 1.0 (RDF) / Atom a una forma única.

import { parseXML, child, children, text, deepText, decodeEntities } from './xml.js';

const MAX_ITEMS = 100;
const SUMMARY_CHARS = 400;

export function stripTags(html) {
  if (!html) return '';
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function excerpt(html, max = SUMMARY_CHARS) {
  const plain = stripTags(html);
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + '…';
}

export function absoluteUrl(href, base) {
  if (!href) return null;
  try { return new URL(href.trim(), base).toString(); } catch { return null; }
}

function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  let t = Date.parse(s);
  if (!Number.isFinite(t)) {
    t = Date.parse(s.replace(/\s+([A-Z]{2,5})$/, ' GMT').replace(/(\d)-(\d)/g, '$1 $2'));
  }
  if (!Number.isFinite(t)) return null;
  const now = Date.now();
  if (t > now + 36e5 * 24) return new Date(now).toISOString();
  if (t < Date.parse('1990-01-01')) return null;
  return new Date(t).toISOString();
}

function linkOf(node, base) {
  if (!node) return null;
  const links = children(node, 'link');
  let best = null;
  for (const l of links) {
    const href = l.attrs.href;
    if (!href) continue;
    if ((l.attrs.rel || 'alternate').toLowerCase() !== 'alternate') continue;
    const type = (l.attrs.type || '').toLowerCase();
    if (!best || type === 'text/html') best = href;
    if (type === 'text/html') break;
  }
  if (!best) {
    for (const l of links) {
      const t = text(l);
      if (t) { best = t; break; }
    }
  }
  if (!best) best = text(child(node, 'origlink', 'guid')) || null;
  return absoluteUrl(best, base);
}

function contentOf(node) {
  const encoded = text(child(node, 'encoded'));
  if (encoded) return encoded;

  const atomContent = children(node, 'content').find((c) => !c.attrs.url);
  if (atomContent) {
    const t = text(atomContent) || deepText(atomContent);
    if (t) return t;
  }
  const plain = text(child(node, 'description', 'summary', 'subtitle'));
  if (plain) return plain;

  return text(child(child(node, 'group'), 'description')) || '';
}

function normalizeItem(node, base, index) {
  const link = linkOf(node, base);
  const title = stripTags(text(child(node, 'title'))) || '(sin título)';
  const content = contentOf(node);
  const guidNode = child(node, 'guid', 'id');
  const guid =
    text(guidNode) ||
    node.attrs.about ||
    link ||
    `${title}::${text(child(node, 'pubdate', 'published', 'updated', 'date')) || index}`;

  return {
    guid: guid.slice(0, 500),
    title: title.slice(0, 500),
    link,
    publishedAt: parseDate(text(child(node, 'pubdate', 'published', 'updated', 'date', 'created'))),
    summary: excerpt(content),
    content: content.slice(0, 200000) || null,
  };
}

export function parseFeed(xml, base) {
  const doc = parseXML(xml);

  const rss = child(doc, 'rss');
  const rdf = child(doc, 'rdf');
  const atom = child(doc, 'feed');

  let channel = null;
  let itemNodes = [];

  if (rss) {
    channel = child(rss, 'channel') || rss;
    itemNodes = children(channel, 'item');
    if (!itemNodes.length) itemNodes = children(rss, 'item');
  } else if (rdf) {
    channel = child(rdf, 'channel') || rdf;
    itemNodes = children(rdf, 'item');
  } else if (atom) {
    channel = atom;
    itemNodes = children(atom, 'entry');
  } else {
    return null;
  }

  const siteUrl = linkOf(channel, base);
  const items = itemNodes
    .slice(0, MAX_ITEMS)
    .map((node, i) => normalizeItem(node, siteUrl || base, i));

  const seen = new Set();
  const unique = items.filter((it) => (seen.has(it.guid) ? false : seen.add(it.guid)));

  return {
    title: stripTags(text(child(channel, 'title'))).slice(0, 300),
    siteUrl,
    description: excerpt(text(child(channel, 'description', 'subtitle', 'tagline')), 300),
    items: unique,
  };
}

export function looksLikeFeed(body, contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (/(rss|atom|xml)/.test(ct) && !ct.includes('xhtml')) return true;
  const head = body.slice(0, 1500).toLowerCase();
  return /<(rss|feed|rdf:rdf)[\s>]/.test(head);
}
