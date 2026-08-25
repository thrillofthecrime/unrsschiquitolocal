// La base es un archivo sqlite y ya, no la rompas.

import { randomUUID } from 'node:crypto';

/* Driver */
async function openDriver(file) {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(file);
  } catch (err) {
    try {
      const { default: Database } = await import('better-sqlite3');
      return new Database(file);
    } catch {
      throw new Error(
        'No hay driver de sqlite. Usá Node 22.5 o superior (trae node:sqlite), ' +
        'o instalá el respaldo con: npm install better-sqlite3\n' +
        `Detalle: ${err.message}`
      );
    }
  }
}

const SCHEMA = `
create table if not exists folders (
  id         text primary key,
  name       text not null,
  position   integer not null default 0,
  created_at text not null
);

create table if not exists feeds (
  id              text primary key,
  folder_id       text references folders(id) on delete set null,
  url             text not null unique,
  title           text not null default '',
  site_url        text,
  last_fetched_at text,
  last_error      text,
  created_at      text not null
);

-- A diferencia de la versión en la nube, acá sí guardamos el texto completo
-- (columna content): el disco es tuyo y no hay cuota que cuidar. Eso es lo que
-- hace que el lector funcione con notas viejas y sin internet.
create table if not exists items (
  id           text primary key,
  feed_id      text not null references feeds(id) on delete cascade,
  guid         text not null,
  title        text not null default '',
  link         text,
  summary      text,
  content      text,
  published_at text not null,
  read         integer not null default 0,
  created_at   text not null,
  unique (feed_id, guid)
);

create index if not exists folders_pos_idx    on folders (position, name);
create index if not exists feeds_folder_idx   on feeds   (folder_id);
create index if not exists items_pub_idx      on items   (published_at desc, id desc);
create index if not exists items_unread_idx   on items   (published_at desc, id desc) where read = 0;
create index if not exists items_feed_pub_idx on items   (feed_id, published_at desc);
`;

const now = () => new Date().toISOString();

function isoOrNow(value) {
  if (!value) return now();
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : now();
}

const asBool = (row) => (row ? { ...row, read: Boolean(row.read) } : row);

export async function openDb(file) {
  const db = await openDriver(file);

  db.exec('pragma journal_mode = wal');
  db.exec('pragma foreign_keys = on');
  db.exec('pragma synchronous = normal');
  db.exec(SCHEMA);

  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  /* Carpetas y feeds */

  const listFolders = () =>
    all('select id, name, position from folders order by position, name');

  const listFeeds = () =>
    all(`select id, folder_id, url, title, site_url, last_error, last_fetched_at
         from feeds order by case when title = '' then url else title end collate nocase`);

  const feedById = (id) => one('select * from feeds where id = ?', id);

  const unreadCounts = () => {
    const rows = all('select feed_id, count(*) as n from items where read = 0 group by feed_id');
    return Object.fromEntries(rows.map((r) => [r.feed_id, Number(r.n)]));
  };

  const createFolder = (name) => {
    const { n } = one('select count(*) as n from folders');
    const row = { id: randomUUID(), name, position: Number(n), created_at: now() };
    run('insert into folders (id, name, position, created_at) values (?, ?, ?, ?)',
      row.id, row.name, row.position, row.created_at);
    return { id: row.id, name: row.name, position: row.position };
  };

  const renameFolder = (id, name) => run('update folders set name = ? where id = ?', name, id);
  const deleteFolder = (id) => run('delete from folders where id = ?', id);

  const createFeed = ({ url, title = '', siteUrl = null, folderId = null }) => {
    const id = randomUUID();
    run(`insert into feeds (id, folder_id, url, title, site_url, created_at)
         values (?, ?, ?, ?, ?, ?)`, id, folderId, url, title, siteUrl, now());
    return one(`select id, folder_id, url, title, site_url, last_error, last_fetched_at
                from feeds where id = ?`, id);
  };

  const updateFeed = (id, patch) => {
    const cols = [];
    const args = [];
    for (const key of ['title', 'folder_id']) {
      if (key in patch) { cols.push(`${key} = ?`); args.push(patch[key] ?? null); }
    }
    if (!cols.length) return;
    run(`update feeds set ${cols.join(', ')} where id = ?`, ...args, id);
  };

  const deleteFeed = (id) => run('delete from feeds where id = ?', id);

  /* Artículos */

  const ITEM_COLS = 'id, feed_id, guid, title, link, summary, published_at, read';

  const listItems = ({ view = 'unread', feedIds = null, offset = 0, limit = 50 }) => {
    const where = [];
    const args = [];
    if (view === 'unread') where.push('read = 0');
    if (feedIds) {
      if (!feedIds.length) return [];
      where.push(`feed_id in (${feedIds.map(() => '?').join(',')})`);
      args.push(...feedIds);
    }
    const sql = `select ${ITEM_COLS} from items
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by published_at desc, id desc limit ? offset ?`;
    return all(sql, ...args, limit, offset).map(asBool);
  };

  const itemContent = (id) => one('select content, summary from items where id = ?', id);

  const setItemRead = (id, read) =>
    run('update items set read = ? where id = ?', read ? 1 : 0, id);

  const insertItems = (feedId, items) => {
    if (!items.length) return 0;
    const insert = db.prepare(`insert or ignore into items
      (id, feed_id, guid, title, link, summary, content, published_at, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const fill = db.prepare(`update items set content = ?, summary = coalesce(summary, ?)
      where feed_id = ? and guid = ? and (content is null or content = '')`);

    const stamp = now();
    let added = 0;
    db.exec('begin');
    try {
      for (const it of items) {
        const guid = String(it.guid);
        const res = insert.run(randomUUID(), feedId, guid, it.title || '',
          it.link || null, it.summary || null, it.content || null,
          isoOrNow(it.publishedAt), stamp);

        if (Number(res.changes) > 0) added++;
        else if (it.content) fill.run(it.content, it.summary || null, feedId, guid);
      }
      db.exec('commit');
    } catch (err) {
      db.exec('rollback');
      throw err;
    }
    return added;
  };

  const markFeedFetched = (id, { title, siteUrl, error = null }) => {
    const feed = feedById(id);
    if (!feed) return null;
    const patch = {
      last_fetched_at: now(),
      last_error: error,
      title: feed.title || title || '',
      site_url: feed.site_url || siteUrl || null,
    };
    run(`update feeds set last_fetched_at = ?, last_error = ?, title = ?, site_url = ?
         where id = ?`, patch.last_fetched_at, patch.last_error, patch.title, patch.site_url, id);
    return one(`select id, folder_id, url, title, site_url, last_error, last_fetched_at
                from feeds where id = ?`, id);
  };

  /* Mantenimiento */

  const prune = (days = 90) => {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const res = run('delete from items where read = 1 and published_at < ?', cutoff);
    db.exec('vacuum');
    return Number(res.changes);
  };

  return {
    raw: db,
    listFolders, createFolder, renameFolder, deleteFolder,
    listFeeds, feedById, createFeed, updateFeed, deleteFeed,
    unreadCounts, listItems, itemContent, setItemRead, insertItems, markFeedFetched,
    prune,
  };
}
