import { safeFetch } from './fetcher.js';
import { parseFeed, looksLikeFeed } from './feed.js';

const CONCURRENCY = 8;

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

export async function refreshFeeds(db, feeds) {
  return pool(feeds, CONCURRENCY, async (feed) => {
    try {
      const res = await safeFetch(feed.url);
      if (!looksLikeFeed(res.body, res.contentType)) {
        throw new Error('La respuesta no parece un feed');
      }
      const parsed = parseFeed(res.body, res.url);
      if (!parsed) throw new Error('No pude parsear el feed');

      const added = db.insertItems(feed.id, parsed.items);
      const row = db.markFeedFetched(feed.id, { title: parsed.title, siteUrl: parsed.siteUrl });
      return { id: feed.id, url: feed.url, added, feed: row };
    } catch (err) {
      const error = err.message || 'Error al descargar';
      const row = db.markFeedFetched(feed.id, { error });
      return { id: feed.id, url: feed.url, error, feed: row };
    }
  });
}
