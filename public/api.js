async function request(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // El servidor es local: si esto falla, casi siempre es que se apagó.
    throw new Error('No hay server. ¿Sigue vivo?');
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Error ${res.status}`);
  return payload;
}

export const api = {
  state: () => request('GET', '/state'),

  items: (params) => request('GET', '/items?' + new URLSearchParams(params)),
  content: (id) => request('GET', `/items/${encodeURIComponent(id)}/content`),
  setRead: (id, read) => request('PATCH', `/items/${encodeURIComponent(id)}`, { read }),

  createFolder: (name) => request('POST', '/folders', { name }),
  renameFolder: (id, name) => request('PATCH', `/folders/${encodeURIComponent(id)}`, { name }),
  deleteFolder: (id) => request('DELETE', `/folders/${encodeURIComponent(id)}`),

  addFeed: (feed) => request('POST', '/feeds', feed),
  updateFeed: (id, patch) => request('PATCH', `/feeds/${encodeURIComponent(id)}`, patch),
  deleteFeed: (id) => request('DELETE', `/feeds/${encodeURIComponent(id)}`),

  discover: (url) => request('POST', '/discover', { url }),

  refresh: (ids) => request('POST', '/refresh', { ids }),

  importOpml: (xml) => request('POST', '/opml', { xml }),
};
