#!/usr/bin/env node
// unrsschiquito self-host: un servidor, un archivo de base, cero dependencias.
//
//   node server.js                 → http://127.0.0.1:8080
//   node server.js prune 90        → borra artículos leídos de más de 90 días
//   node server.js import x.opml   → importa suscripciones
//   node server.js export > x.opml → exporta suscripciones
//
// Variables de entorno opcionales:
//   PORT                 puerto (8080)
//   HOST                 dirección donde escuchar (127.0.0.1)
//   UNRSS_DB             ruta del archivo sqlite (./unrsschiquito.db)
//   UNRSS_PASSWORD       si está, pide usuario/contraseña (HTTP Basic)
//   UNRSS_NO_AUTH        =1 para escuchar fuera de localhost SIN contraseña
//   UNRSS_ALLOWED_HOSTS  hosts extra permitidos en el header Host, separados por coma
//   ALLOW_PRIVATE_HOSTS  =1 para poder suscribirte a feeds de tu propia red

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

import { openDb } from './lib/db.js';
import { discover } from './lib/discover.js';
import { refreshFeeds } from './lib/refresh.js';
import { toOpml, fromOpml } from './lib/opml.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = process.env.UNRSS_DB || join(ROOT, 'unrsschiquito.db');
const PASSWORD = process.env.UNRSS_PASSWORD || '';
const NO_AUTH = /^(1|true|yes)$/i.test(process.env.UNRSS_NO_AUTH || '');
const EXTRA_HOSTS = (process.env.UNRSS_ALLOWED_HOSTS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const PAGE_MAX = 200;

/* Seguridá */

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '0:0:0:0:0:0:0:1']);
const isLoopback = (h) => LOOPBACK.has(String(h).replace(/^\[|\]$/g, '').toLowerCase());

/* Escuchar fuera de localhost sin contraseña deja tu historial de lectura abierto a toda la red. En vez de confiar en que nadie lo haga sin querer, el servidor no arranca.
  
   En Docker es distinto: adentro del contenedor hay que escuchar en 0.0.0.0 para
   que funcione el mapeo de puertos, y lo que te protege es a qué dirección
   publicás ese puerto en el compose. Por eso existe UNRSS_NO_AUTH, que el
   docker-compose.yml de acá ya trae puesto. */
function assertBindIsSafe() {
  if (isLoopback(HOST) || PASSWORD || NO_AUTH) return;
  console.error(`
  unrsschiquito no va a escuchar en ${HOST} sin contraseña.

  Cualquiera en tu red podría leer y borrar tus feeds. Elegí una:

    UNRSS_PASSWORD=tuclave node server.js     ← recomendado
    UNRSS_NO_AUTH=1 node server.js            ← red de confianza, bajo tu riesgo
    node server.js                            ← solo esta máquina (127.0.0.1)

  Si esto salió dentro de Docker: es normal, el contenedor tiene que escuchar en
  0.0.0.0 para que ande el mapeo de puertos. Usá el docker-compose.yml de este
  repo, que ya trae UNRSS_NO_AUTH=1 y publica el puerto solo en 127.0.0.1.
`);
  process.exit(1);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  // timingSafeEqual explota si los largos no coinciden, y el largo se filtra igual.
  return x.length === y.length && timingSafeEqual(x, y);
}

function authOk(req) {
  if (!PASSWORD) return true;
  const [scheme, value] = String(req.headers.authorization || '').split(' ');
  if (!/^basic$/i.test(scheme || '')) return false;
  const pass = Buffer.from(value || '', 'base64').toString('utf8').split(':').slice(1).join(':');
  return safeEqual(pass, PASSWORD);
}

/* Sin contraseña, la única defensa contra DNS rebinding —una página cualquiera
   que resuelve su dominio a 127.0.0.1 y te habla el servidor— es no atender a
   nadie que venga con un Host que no sea el de esta máquina. Con contraseña no
   hace falta: el Basic ya lo cubre. */
function hostOk(req) {
  if (PASSWORD) return true;
  const raw = String(req.headers.host || '');
  const name = raw.replace(/:\d+$/, '').toLowerCase();
  return isLoopback(name) || EXTRA_HOSTS.includes(name) || EXTRA_HOSTS.includes(raw.toLowerCase());
}

/** Las escrituras solo se aceptan desde la propia página, nunca de otro sitio. */
function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;   // fetch same-origin de GET no manda Origin
  try {
    return new URL(origin).host === String(req.headers.host || '');
  } catch {
    return false;
  }
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",   // las imágenes de los artículos son de cualquier sitio
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

function baseHeaders() {
  return {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
  };
}

/* HTTP */

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...baseHeaders(), ...headers });
  res.end(body);
}

const json = (res, status, data) =>
  send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8' });

async function readJsonBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 200000) throw new Error('Body demasiado grande');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('JSON inválido');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function serveStatic(res, pathname) {
  const rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  const file = resolve(PUBLIC, '.' + (rel.startsWith('/') ? rel : '/' + rel));
  // Ni ../ ni symlinks para afuera: todo tiene que caer dentro de public/.
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'No');

  try {
    const body = await readFile(file);
    send(res, 200, body, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
  } catch {
    send(res, 404, 'No existe', { 'content-type': 'text/plain; charset=utf-8' });
  }
}

/* Rutas */

function feedIdsForView(db, view, id) {
  if (view === 'feed') return id ? [id] : [];
  if (view === 'folder') return db.listFeeds().filter((f) => f.folder_id === id).map((f) => f.id);
  return null;   // unread / all: todos
}

const snapshot = (db) => ({
  folders: db.listFolders(),
  feeds: db.listFeeds(),
  counts: db.unreadCounts(),
});

async function api(db, req, res, url) {
  const { pathname, searchParams } = url;
  const method = req.method;
  const seg = pathname.split('/').filter(Boolean);   // ['api', 'items', id, ...]
  const [, section, id, sub] = seg;

  const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? await readJsonBody(req) : {};

  if (section === 'state' && method === 'GET') {
    return json(res, 200, snapshot(db));
  }

  if (section === 'items') {
    if (!id && method === 'GET') {
      const view = searchParams.get('view') || 'unread';
      const limit = Math.min(Number(searchParams.get('limit')) || 50, PAGE_MAX);
      const items = db.listItems({
        view,
        feedIds: feedIdsForView(db, view, searchParams.get('id')),
        offset: Math.max(0, Number(searchParams.get('offset')) || 0),
        limit,
      });
      return json(res, 200, { items });
    }
    if (id && sub === 'content' && method === 'GET') {
      const row = db.itemContent(id);
      if (!row) return json(res, 404, { error: 'No existe' });
      return json(res, 200, row);
    }
    if (id && method === 'PATCH') {
      db.setItemRead(id, Boolean(body.read));
      return json(res, 200, { counts: db.unreadCounts() });
    }
  }

  if (section === 'folders') {
    if (!id && method === 'POST') {
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { error: 'Falta el nombre' });
      return json(res, 200, { folder: db.createFolder(name) });
    }
    if (id && method === 'PATCH') {
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { error: 'Falta el nombre' });
      db.renameFolder(id, name);
      return json(res, 200, {});
    }
    if (id && method === 'DELETE') {
      db.deleteFolder(id);
      return json(res, 200, {});
    }
  }

  if (section === 'feeds') {
    if (!id && method === 'POST') {
      const feedUrl = String(body.url || '').trim();
      if (!feedUrl) return json(res, 400, { error: 'Falta la URL' });
      let feed;
      try {
        feed = db.createFeed({
          url: feedUrl,
          title: body.title || '',
          siteUrl: body.siteUrl || null,
          folderId: body.folderId || null,
        });
      } catch (err) {
        if (/unique/i.test(err.message)) return json(res, 409, { error: 'Ese feed ya está' });
        throw err;
      }
      const [result] = await refreshFeeds(db, [feed]);
      return json(res, 200, { feed: result.feed || feed, counts: db.unreadCounts() });
    }
    if (id && method === 'PATCH') {
      db.updateFeed(id, body);
      return json(res, 200, {});
    }
    if (id && method === 'DELETE') {
      db.deleteFeed(id);
      return json(res, 200, { counts: db.unreadCounts() });
    }
  }

  if (section === 'discover' && method === 'POST') {
    try {
      return json(res, 200, { candidates: await discover(body.url) });
    } catch (err) {
      return json(res, err.status || 502, { error: err.message || 'No se pudo leer el sitio', candidates: [] });
    }
  }

  if (section === 'refresh' && method === 'POST') {
    const ids = Array.isArray(body.ids) ? body.ids : null;
    const feeds = ids
      ? ids.map((i) => db.feedById(i)).filter(Boolean)
      : db.listFeeds();
    const results = await refreshFeeds(db, feeds);
    return json(res, 200, { results, ...snapshot(db) });
  }

  if (section === 'opml' && method === 'GET') {
    const { folders, feeds } = snapshot(db);
    return send(res, 200, toOpml({ folders, feeds }), {
      'content-type': 'text/x-opml; charset=utf-8',
      'content-disposition': 'attachment; filename="unrsschiquito.opml"',
    });
  }

  return json(res, 404, { error: 'Ruta desconocida' });
}

/* Server */

async function serve() {
  assertBindIsSafe();
  const db = await openDb(DB_FILE);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/health') {
      return send(res, 200, 'ok', { 'content-type': 'text/plain; charset=utf-8' });
    }

    if (!hostOk(req)) {
      return send(res, 421, 'Host no permitido. Entrá por http://localhost:' + PORT,
        { 'content-type': 'text/plain; charset=utf-8' });
    }
    if (!authOk(req)) {
      return send(res, 401, 'Contraseña requerida', {
        'www-authenticate': 'Basic realm="unrsschiquito", charset="UTF-8"',
        'content-type': 'text/plain; charset=utf-8',
      });
    }

    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
      return serveStatic(res, url.pathname);
    }

    if (!originOk(req)) return json(res, 403, { error: 'Origen no permitido' });

    try {
      await api(db, req, res, url);
    } catch (err) {
      console.error('✗', req.method, url.pathname, '—', err.message);
      if (!res.headersSent) json(res, 500, { error: err.message || 'Error interno' });
    }
  });

  server.listen(PORT, HOST, () => {
    const shown = isLoopback(HOST) ? 'localhost' : HOST;
    console.log(`  unrsschiquito → http://${shown}:${PORT}`);
    console.log(`  base: ${DB_FILE}`);
    if (PASSWORD) console.log('  con contraseña (usuario: cualquiera)');
    console.log('  ctrl-c para salir\n');
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      server.close();
      try { db.raw.close(); } catch {}
      process.exit(0);
    });
  }
}

/* Cli */

async function cli(cmd, args) {
  const db = await openDb(DB_FILE);

  if (cmd === 'prune') {
    const days = Number(args[0] || 90);
    console.log(`Borrados ${db.prune(days)} artículos leídos de más de ${days} días.`);
    return;
  }

  if (cmd === 'export') {
    const { folders, feeds } = snapshot(db);
    process.stdout.write(toOpml({ folders, feeds }));
    return;
  }

  if (cmd === 'import') {
    if (!args[0]) throw new Error('Uso: node server.js import archivo.opml');
    const entries = fromOpml(await readFile(args[0], 'utf8'));
    if (!entries.length) throw new Error('No encontré suscripciones en ese OPML');

    const folders = new Map(db.listFolders().map((f) => [f.name.toLowerCase(), f.id]));
    const existing = new Set(db.listFeeds().map((f) => f.url));
    const added = [];

    for (const entry of entries) {
      if (existing.has(entry.url)) continue;
      let folderId = null;
      if (entry.folder) {
        const key = entry.folder.toLowerCase();
        if (!folders.has(key)) folders.set(key, db.createFolder(entry.folder).id);
        folderId = folders.get(key);
      }
      try {
        added.push(db.createFeed({ url: entry.url, title: entry.title, folderId }));
      } catch (err) {
        console.error(`  ✗ ${entry.url} — ${err.message}`);
      }
    }

    console.log(`${added.length} feeds nuevos de ${entries.length} en el archivo. Bajando…`);
    let ok = 0;
    for (const result of await refreshFeeds(db, added)) {
      if (result.error) console.error(`  ✗ ${result.url} — ${result.error}`);
      else { ok++; console.log(`  ✓ ${result.feed?.title || result.url} (${result.added} artículos)`); }
    }
    console.log(`Listo: ${ok} de ${added.length} bajaron bien.`);
    return;
  }

  throw new Error(`Comando desconocido: ${cmd}`);
}

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd) await cli(cmd, args);
  else await serve();
} catch (err) {
  console.error('✗ ' + (err.message || err));
  process.exit(1);
}
