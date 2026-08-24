const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’',
  lsquo: '‘', ldquo: '“', rdquo: '”', laquo: '«',
  raquo: '»', deg: '°', eacute: 'é', copy: '©',
  reg: '®', trade: '™', bull: '•', middot: '·',
};

export function decodeEntities(s) {
  if (!s || s.indexOf('&') === -1) return s;
  return s.replace(/&(#[Xx]?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]{1,31});/g, (m, e) => {
    if (e[0] === '#') {
      const hex = e[1] === 'x' || e[1] === 'X';
      const cp = parseInt(hex ? e.slice(2) : e.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return m;
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

function findTagEnd(s, from) {
  let quote = 0;
  for (let i = from + 1; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === (quote === 1 ? "'" : '"')) quote = 0; continue; }
    if (c === "'") quote = 1;
    else if (c === '"') quote = 2;
    else if (c === '>') return i;
  }
  return -1;
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function parseAttrs(src) {
  const attrs = {};
  if (!src || src.indexOf('=') === -1) return attrs;
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(src))) {
    const value = m[3] ?? m[4] ?? m[5] ?? '';
    attrs[m[1].toLowerCase()] = decodeEntities(value);
  }
  return attrs;
}

const MAX_DEPTH = 256;

export function parseXML(src) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  if (typeof src !== 'string' || !src) return root;

  const stack = [root];
  const top = () => stack[stack.length - 1];
  const n = src.length;
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { top().text += decodeEntities(src.slice(i)); break; }
    if (lt > i) top().text += decodeEntities(src.slice(i, lt));

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      top().text += src.slice(lt + 9, end === -1 ? n : end);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      let depth = 0, j = lt + 2;
      for (; j < n; j++) {
        const c = src[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }

    const gt = findTagEnd(src, lt);
    if (gt === -1) { top().text += decodeEntities(src.slice(lt)); break; }
    const inner = src.slice(lt + 1, gt);
    i = gt + 1;

    if (inner[0] === '/') {
      const name = inner.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) { stack.length = k; break; }
      }
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const m = /^([^\s/>]+)/.exec(body);
    if (!m) continue;

    const node = { name: m[1], attrs: parseAttrs(body.slice(m[1].length)), children: [], text: '' };
    top().children.push(node);
    if (!selfClosing && stack.length < MAX_DEPTH) stack.push(node);
  }

  return root;
}

export function localName(name) {
  const i = name.lastIndexOf(':');
  return (i === -1 ? name : name.slice(i + 1)).toLowerCase();
}

export function child(node, ...names) {
  if (!node) return null;
  for (const c of node.children) {
    if (names.includes(localName(c.name))) return c;
  }
  return null;
}

export function children(node, ...names) {
  if (!node) return [];
  return node.children.filter((c) => names.includes(localName(c.name)));
}

export function text(node) {
  return node ? node.text.trim() : '';
}

export function deepText(node) {
  if (!node) return '';
  let out = node.text;
  for (const c of node.children) out += deepText(c);
  return out.trim();
}
