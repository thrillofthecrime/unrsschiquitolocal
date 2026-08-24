// OPML porque soy copado.

import { parseXML, children, localName } from './xml.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export function toOpml({ folders, feeds }) {
  const outline = (f) =>
    `    <outline type="rss" text="${esc(f.title || f.url)}" title="${esc(f.title || f.url)}"` +
    ` xmlUrl="${esc(f.url)}"${f.site_url ? ` htmlUrl="${esc(f.site_url)}"` : ''}/>`;

  const inFolder = (id) => feeds.filter((f) => f.folder_id === id);

  const body = [
    ...folders.map((folder) => {
      const inside = inFolder(folder.id);
      if (!inside.length) return `    <outline text="${esc(folder.name)}" title="${esc(folder.name)}"/>`;
      return `    <outline text="${esc(folder.name)}" title="${esc(folder.name)}">\n` +
        inside.map((f) => '  ' + outline(f)).join('\n') + '\n    </outline>';
    }),
    ...inFolder(null).map(outline),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>unrsschiquito</title>
  </head>
  <body>
${body.join('\n')}
  </body>
</opml>
`;
}

export function fromOpml(xml) {
  const doc = parseXML(xml);
  const opml = children(doc, 'opml')[0];
  const body = opml ? children(opml, 'body')[0] : null;
  if (!body) return [];

  const out = [];
  const seen = new Set();

  const walk = (node, folder) => {
    for (const child of node.children) {
      if (localName(child.name) !== 'outline') continue;
      const url = child.attrs.xmlurl;
      if (url) {
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ url, title: child.attrs.title || child.attrs.text || '', folder });
        continue;
      }
      walk(child, folder || child.attrs.title || child.attrs.text || null);
    }
  };

  walk(body, null);
  return out;
}
