import { api } from './api.js';

const PAGE = 50;
const AUTO_REFRESH_MS = 15 * 60 * 1000;
const TEXT_CACHE_MAX = 1500;

const articleText = new Map();

function cacheText(id, text) {
  articleText.set(id, text || '');
  if (articleText.size > TEXT_CACHE_MAX) {
    for (const k of articleText.keys()) {
      articleText.delete(k);
      if (articleText.size <= TEXT_CACHE_MAX) break;
    }
  }
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(message, ms = 2600) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}

async function copyLink(url) {
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    toast('URL copiada');
  } catch {
    toast('No se pudo copiar');
  }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const secs = (Date.now() - d.getTime()) / 1000;
  if (secs < 90) return 'recién';
  if (secs < 3600) return `hace ${Math.floor(secs / 60)} min`;
  if (secs < 86400) return `hace ${Math.floor(secs / 3600)} h`;
  if (secs < 6 * 86400) return `hace ${Math.floor(secs / 86400)} d`;
  return d.toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  });
}

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'HR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUB', 'SUP', 'SMALL',
  'A', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'BLOCKQUOTE', 'Q', 'CITE',
  'CODE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'IMG', 'FIGURE', 'FIGCAPTION', 'PICTURE', 'SOURCE',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION',
  'SPAN', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'TIME',
]);
const KEEP_ATTRS = { A: ['href', 'title'], IMG: ['src', 'alt'], SOURCE: ['srcset'], TIME: ['datetime'] };
const BAD_URL = /^\s*(javascript|vbscript|file):/i;

function sanitize(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,form,input,button,select,textarea,link,meta,base,svg,math,noscript,video,audio,canvas')
    .forEach((el) => el.remove());

  for (const el of doc.body.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const keep = (KEEP_ATTRS[el.tagName] || []).includes(attr.name.toLowerCase());
      if (!keep) { el.removeAttribute(attr.name); continue; }
      if (/^(href|src|srcset)$/i.test(attr.name) && BAD_URL.test(attr.value)) el.removeAttribute(attr.name);
    }
    if (el.tagName === 'A') { el.target = '_blank'; el.rel = 'noopener noreferrer nofollow'; }
    if (el.tagName === 'IMG') { el.loading = 'lazy'; el.referrerPolicy = 'no-referrer'; }
    if (!ALLOWED_TAGS.has(el.tagName)) el.replaceWith(...el.childNodes);
  }
  return doc.body.innerHTML;
}

function openModal(build) {
  return new Promise((resolve) => {
    const host = $('#modal');
    const card = document.createElement('div');
    card.className = 'card';
    host.replaceChildren(card);
    host.hidden = false;

    const close = (result = null) => {
      document.removeEventListener('keydown', onKey, true);
      host.hidden = true;
      host.replaceChildren();
      host.onclick = null;
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (card.querySelector('.picker-list:not([hidden])')) return;
      e.stopPropagation();
      close();
    };
    document.addEventListener('keydown', onKey, true);
    host.onclick = (e) => { if (e.target === host) close(); };

    build(card, close);
    (card.querySelector('input, select') || card.querySelector('button'))?.focus();
  });
}

function enhanceSelect(sel) {
  if (!sel || sel.dataset.picker) return;
  sel.dataset.picker = 'on';

  const wrap = document.createElement('div');
  wrap.className = 'picker';
  sel.parentNode.insertBefore(wrap, sel);
  wrap.append(sel);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'picker-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');

  const list = document.createElement('ul');
  list.className = 'picker-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.append(btn, list);

  const label = () => { btn.textContent = sel.options[sel.selectedIndex]?.textContent || ''; };

  const draw = () => {
    list.innerHTML = [...sel.options].map((o, i) => `<li role="option" data-i="${i}"
      class="${i === sel.selectedIndex ? 'on' : ''}" aria-selected="${i === sel.selectedIndex}"
      ><span class="tick">${i === sel.selectedIndex ? '✓' : ''}</span>${esc(o.textContent)}</li>`).join('');
  };

  const highlight = (li) => {
    if (!li) return;
    $$('li', list).forEach((n) => n.classList.toggle('on', n === li));
    li.scrollIntoView({ block: 'nearest' });
  };

  const onOutside = (e) => { if (!wrap.contains(e.target)) close(); };

  const onKey = (e) => {
    const items = $$('li', list);
    const at = items.findIndex((n) => n.classList.contains('on'));
    if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); highlight(items[Math.min(at + 1, items.length - 1)]); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(items[Math.max(at - 1, 0)]); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(at < 0 ? sel.selectedIndex : at); }
  };

  const open = () => {
    draw();
    list.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onOutside, true);
  };

  const close = () => {
    list.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onOutside, true);
  };

  const pick = (i) => {
    close();
    if (i === sel.selectedIndex) return;
    sel.selectedIndex = i;
    label();
    sel.dispatchEvent(new Event('change'));
  };

  btn.onclick = () => (list.hidden ? open() : close());
  btn.onkeydown = (e) => {
    if (list.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); open(); }
  };
  list.onclick = (e) => {
    const li = e.target.closest('[data-i]');
    if (li) pick(Number(li.dataset.i));
  };
  list.onmouseover = (e) => highlight(e.target.closest('[data-i]'));

  sel.addEventListener('optionschange', () => { label(); if (!list.hidden) draw(); });

  label();
}

function enhanceSelects(root) {
  $$('select', root).forEach(enhanceSelect);
}

function askText({ title, label, value = '', confirmLabel = 'Guardar', placeholder = '' }) {
  return openModal((card, close) => {
    card.innerHTML = `
      <h2 class="modal-title">${esc(title)}</h2>
      <label>${esc(label)}<input type="text" id="ask" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>
      <div class="actions">
        <button class="btn" data-act="cancel">Cancelar</button>
        <button class="btn primary" data-act="ok">${esc(confirmLabel)}</button>
      </div>`;
    const input = $('#ask', card);
    const ok = () => close(input.value.trim() || null);
    $('[data-act=ok]', card).onclick = ok;
    $('[data-act=cancel]', card).onclick = () => close();
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } };
  });
}

function askConfirm({ title, message, confirmLabel = 'Eliminar' }) {
  return openModal((card, close) => {
    card.innerHTML = `
      <h2 class="modal-title">${esc(title)}</h2>
      <p class="muted" style="margin:0">${esc(message)}</p>
      <div class="actions">
        <button class="btn" data-act="cancel">Cancelar</button>
        <button class="btn primary" data-act="ok">${esc(confirmLabel)}</button>
      </div>`;
    $('[data-act=ok]', card).onclick = () => close(true);
    $('[data-act=cancel]', card).onclick = () => close(false);
  });
}

const COLLAPSED_KEY = 'unrsschiquito.collapsed';

const state = {
  folders: [],
  feeds: [],
  counts: {},              // feed_id -> no leídos
  view: { type: 'unread', id: null },
  items: [],
  offset: 0,
  exhausted: false,
  loading: false,
  reading: null,           // el artículo que estás leyendo, o null si estás en la lista
  listScroll: 0,           // dónde quedó la lista, para volver al mismo lugar
  cursor: -1,
  collapsed: new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')),
};

let collapsedByDefault = localStorage.getItem(COLLAPSED_KEY) === null;

function saveCollapsed() {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...state.collapsed]));
}

const feedById = (id) => state.feeds.find((f) => f.id === id);
const feedName = (f) => (f?.title || '').trim() || hostOf(f?.url || '');

/* Basicons */
const CARET = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5 12 15.5 18 9.5"/></svg>';

const moreDots = (kind, id) =>
  `<span class="more" data-menu="${kind}" data-id="${id}" role="button" tabindex="0"
    title="Editar" aria-label="Editar">···</span>`;

function renderSidebar() {
  const nav = $('#nav');
  const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
  const inFolder = (id) => state.feeds.filter((f) => f.folder_id === id);
  const folderCount = (id) => inFolder(id).reduce((n, f) => n + (state.counts[f.id] || 0), 0);

  const smart = [
    { type: 'unread', label: 'Sin leer', count: total },
    { type: 'all', label: 'Todo', count: null },
  ];

  const feedRow = (f) => {
    const n = state.counts[f.id] || 0;
    const active = state.view.type === 'feed' && state.view.id === f.id;
    const name = feedName(f);
    return `<button class="nav-item sub ${active ? 'active' : ''}" data-view="feed" data-id="${f.id}">
      <span class="label" title="${esc(name)}">${esc(name)}</span>
      ${f.last_error ? `<span class="err-dot" title="${esc(f.last_error)}">!</span>` : ''}
      <span class="count">${n || ''}</span>
      ${moreDots('feed', f.id)}
    </button>`;
  };

  const folderBlock = (folder) => {
    const feeds = inFolder(folder.id);
    const closed = state.collapsed.has(folder.id);
    const active = state.view.type === 'folder' && state.view.id === folder.id;
    const n = folderCount(folder.id);
    return `<div class="folder-row">
        <button class="twisty ${closed ? 'closed' : ''}" data-twisty="${folder.id}"
          aria-label="${closed ? 'Desplegar' : 'Plegar'}" aria-expanded="${closed ? 'false' : 'true'}">${CARET}</button>
        <button class="nav-item ${active ? 'active' : ''}" data-view="folder" data-id="${folder.id}">
          <span class="label">${esc(folder.name)}</span>
          <span class="count">${n || ''}</span>
          ${moreDots('folder', folder.id)}
        </button>
      </div>
      ${closed ? '' : feeds.map(feedRow).join('')}`;
  };

  const loose = inFolder(null);

  const allClosed = state.folders.every((f) => state.collapsed.has(f.id));
  const collapseAll = state.folders.length
    ? `<div class="side-tools"><button class="btn collapse-all" data-collapse-all="${
        allClosed ? 'open' : 'close'}">${allClosed ? 'Expandir todo' : 'Contraer todo'}</button></div>`
    : '';

  nav.innerHTML = `
    ${smart.map((s) => `
      <button class="nav-item ${state.view.type === s.type ? 'active' : ''}" data-view="${s.type}">
        <span class="label">${s.label}</span>
        <span class="count">${s.count || ''}</span>
      </button>`).join('')}

    ${collapseAll}
    <div class="side-group">
      <span>Carpetas</span><span class="grow"></span>
      <button class="btn" data-add-folder title="Nueva carpeta" aria-label="Nueva carpeta">+</button>
    </div>
    ${state.folders.map(folderBlock).join('')}

    ${loose.length ? `<div class="side-group"><span>${state.folders.length ? 'Sin carpeta' : 'Feeds'}</span></div>` : ''}
    ${loose.map(feedRow).join('')}

    ${state.feeds.length ? '' : `<p class="muted" style="padding:18px 12px;font-size:14px;line-height:1.6">
      No hay nada acá. Probá agregando un feed.</p>`}
  `;

  document.title = total ? `(${total}) unrsschiquito` : 'unrsschiquito';
}

function applySnapshot({ folders, feeds, counts }) {
  if (folders) state.folders = folders;
  if (feeds) state.feeds = feeds;
  if (counts) state.counts = counts;
  if (collapsedByDefault && state.folders.length) {
    state.folders.forEach((f) => state.collapsed.add(f.id));
    collapsedByDefault = false;
  }
  renderSidebar();
}

async function loadSidebar() {
  try {
    applySnapshot(await api.state());
  } catch (err) {
    toast(err.message);
  }
}

function feedIdsForView() {
  if (state.view.type === 'feed') return [state.view.id];
  if (state.view.type === 'folder') {
    return state.feeds.filter((f) => f.folder_id === state.view.id).map((f) => f.id);
  }
  return null; // todos
}

let loadSeq = 0;

async function loadItems({ reset = false } = {}) {
  if (state.loading && !reset) return;
  if (reset) {
    state.items = [];
    state.offset = 0;
    state.exhausted = false;
    state.cursor = -1;
  }
  if (state.exhausted) return;

  const seq = ++loadSeq;
  state.loading = true;
  renderList();

  const params = { view: state.view.type, offset: state.offset, limit: PAGE };
  if (state.view.id) params.id = state.view.id;

  let items;
  try {
    ({ items } = await api.items(params));
  } catch (err) {
    if (seq !== loadSeq) return;
    state.loading = false;
    toast(err.message);
    renderList();
    return;
  }
  if (seq !== loadSeq) return;
  state.loading = false;

  state.items.push(...items);
  state.offset += items.length;
  if (items.length < PAGE) state.exhausted = true;
  renderList();
}

const VIEW_TITLES = { unread: 'Sin leer', all: 'Todo' };

function viewTitle() {
  if (state.view.type === 'feed') return feedName(feedById(state.view.id));
  if (state.view.type === 'folder') {
    return state.folders.find((f) => f.id === state.view.id)?.name || 'Sin carpeta';
  }
  return VIEW_TITLES[state.view.type];
}

function itemHtml(item, index) {
  const feed = feedById(item.feed_id);
  const bits = [`<span>${esc(feedName(feed))}</span>`];
  if (item.published_at) bits.push('<span class="sep">·</span>', `<span>${esc(timeAgo(item.published_at))}</span>`);
  const mark = item.read ? 'Marcar no leído' : 'Marcar leído';
  bits.push(`<button class="item-mark" data-act="toggle-read" title="Atajo: m">${mark}</button>`);

  const classes = ['item', item.read && 'read', state.cursor === index && 'cursor'].filter(Boolean);

  return `<article class="${classes.join(' ')}" data-id="${item.id}" data-index="${index}">
    <div class="item-head" data-act="open" role="button" tabindex="0">
      <span class="item-body">
        <span class="item-title">${esc(item.title)}</span>
        <span class="item-meta">${bits.join('')}</span>
      </span>
    </div>
  </article>`;
}

function readerHtml(item) {
  const feed = feedById(item.feed_id);
  const bits = [esc(feedName(feed))];
  if (item.published_at) bits.push(esc(timeAgo(item.published_at)));

  const text = articleText.get(item.id);
  let body;
  if (text) {
    body = sanitize(text);
  } else if (text === undefined) {
    body = '<p class="muted">Cargando…</p>';   
  } else {
    body = `${item.summary ? `<p>${esc(item.summary)}</p>` : ''}
       <p class="muted">Este feed no trae el texto completo. Probá “Actualizar” acá
       arriba, o abrilo en el sitio.</p>`;
  }

  return `<div class="reader-inner">
    <h1 class="reader-title">${esc(item.title)}</h1>
    <p class="reader-meta">${bits.join(' · ')}</p>
    <div class="article-body">${body}</div>
    <div class="article-actions">
      ${item.link ? `<a class="btn primary" href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">Abrir original</a>
      <button class="btn" data-act="copy">Copiar link</button>` : ''}
      <button class="btn" data-act="unread">${item.read ? 'Marcar como no leído' : 'Marcar como leído'}</button>
    </div>
  </div>`;
}

function renderReader() {
  const item = state.reading;
  $('#topbar').hidden = Boolean(item);
  $('#list').hidden = Boolean(item);
  $('#reader-bar').hidden = !item;
  $('#reader').hidden = !item;
  if (!item) return;
  $('#reader').innerHTML = readerHtml(item);
}

function renderList() {
  $('#view-title').textContent = viewTitle();

  const add = $('#add-feed');
  add.hidden = state.view.type === 'feed';
  add.textContent = state.view.type === 'folder' ? 'Agregar feed acá' : 'Agregar feed';

  const list = $('#list');
  if (!state.items.length) {
    list.innerHTML = state.loading
      ? '<div class="loading-row">Cargando…</div>'
      : emptyHtml();
    return;
  }

  list.innerHTML =
    state.items.map(itemHtml).join('') +
    (state.exhausted
      ? ''
      : `<div class="loading-row" id="sentinel">${state.loading ? 'Cargando…' : '<button class="btn" data-act="more">Cargar más</button>'}</div>`);

  observeSentinel();
}

function emptyHtml() {
  const box = (text, extra = '') => `<div class="empty"><p>${text}</p>${extra}</div>`;
  if (!state.feeds.length) {
    return box('Todavía no hay feeds.', '<button class="btn primary" data-act="add">Agregar el primero</button>');
  }
  if (state.view.type === 'unread') return box('Leíste todo.');
  return box('Nada por acá.');
}

let observer;
function observeSentinel() {
  observer?.disconnect();
  const sentinel = $('#sentinel');
  if (!sentinel || state.loading) return;
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadItems();
  }, { root: $('#list'), rootMargin: '600px' });
  observer.observe(sentinel);
}

function selectView(type, id = null) {
  state.reading = null;
  state.listScroll = 0;
  renderReader();
  state.view = { type, id };
  $('#app').classList.remove('nav-open');
  $('.scrim')?.remove();
  renderSidebar();
  $('#list').scrollTop = 0;
  loadItems({ reset: true });
}

async function loadContent(item) {
  if (articleText.has(item.id)) return;
  try {
    const { content } = await api.content(item.id);
    cacheText(item.id, content);
  } catch {
    cacheText(item.id, '');
  }
}

async function openArticle(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;

  if (!state.reading) state.listScroll = $('#list').scrollTop;
  state.reading = item;
  state.cursor = state.items.indexOf(item);
  renderReader();
  $('#reader').scrollTop = 0;

  if (!articleText.has(item.id)) {
    await loadContent(item);
    if (state.reading?.id !== item.id) return;
    renderReader();
  }

  if (!item.read) await setRead(item, true);
}

function closeArticle() {
  if (!state.reading) return;
  state.reading = null;
  renderReader();
  renderList();
  $('#list').scrollTop = state.listScroll;
}

function stepArticle(delta) {
  const next = state.items[state.cursor + delta];
  if (next) openArticle(next.id);
}

async function setRead(item, read) {
  item.read = read;
  state.counts[item.feed_id] = Math.max(0, (state.counts[item.feed_id] || 0) + (read ? -1 : 1));
  renderSidebar();
  if (state.reading) renderReader(); else renderList();
  try {
    applySnapshot(await api.setRead(item.id, read));
  } catch (err) {
    toast(err.message);
  }
}

let refreshing = false;

async function refreshFeeds(feeds, { silent = false } = {}) {
  if (refreshing || !feeds.length) return;
  refreshing = true;
  $('#refresh-view').disabled = true;
  if (!silent) toast(`Actualizando ${feeds.length} feed${feeds.length > 1 ? 's' : ''}…`, 60000);

  try {
    const { results, folders, feeds: rows, counts } = await api.refresh(feeds.map((f) => f.id));
    applySnapshot({ folders, feeds: rows, counts });

    const failed = results.filter((r) => r.error).length;
    await loadItems({ reset: true });
    if (!silent) {
      toast(failed ? `Listo, con ${failed} feed${failed > 1 ? 's' : ''} con error` : 'Actualizado');
    }
  } catch (err) {
    toast(err.message || 'No se pudo actualizar');
  } finally {
    refreshing = false;
    $('#refresh-view').disabled = false;
  }
}

async function refreshArticle() {
  const item = state.reading;
  if (!item || refreshing) return;
  const feed = feedById(item.feed_id);
  if (!feed) return;

  const btn = $('#reader-refresh');
  btn.disabled = true;
  btn.textContent = 'Actualizando…';
  try {
    await refreshFeeds([feed], { silent: true });

    const fresh = state.items.find((i) => i.id === item.id)
      || state.items.find((i) => i.guid === item.guid);
    if (fresh) {
      state.reading = fresh;
      state.cursor = state.items.indexOf(fresh);
    }

    const target = state.reading;
    articleText.delete(target.id);
    await loadContent(target);
    renderReader();
    toast(articleText.get(target.id) ? 'Actualizado' : 'El feed no trae el texto completo de esta nota');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Actualizar';
  }
}

function feedsForView() {
  const ids = feedIdsForView();
  return ids ? state.feeds.filter((f) => ids.includes(f.id)) : state.feeds;
}

const ICON_SUN = ['M17.5 17.5L19 19M20 12H22M6.5 6.5L5 5M17.5 6.5L19 5M6.5 17.5L5 19M2 12H4M12 2V4M12 20V22M16 12C16 14.2091 14.2091 16 12 16C9.79086 16 8 14.2091 8 12C8 9.79086 9.79086 8 12 8C14.2091 8 16 9.79086 16 12Z'];
const ICON_MOON = ['M9.3812 2.04327C7.76937 2.50154 6.2485 3.36519 4.97948 4.63421C1.00684 8.60687 1.00684 15.0478 4.97948 19.0205C8.95213 22.9932 15.3931 22.9932 19.3657 19.0205C20.6429 17.7433 21.5095 16.211 21.9654 14.5876M9.5384 2C8.6321 5.39377 9.51018 9.16492 12.1726 11.8274C14.8351 14.4899 18.6063 15.368 22 14.4617'];
const ICON_EYE = [
  'M1 12C1 12 5 4 12 4C19 4 23 12 23 12',
  'M1 12C1 12 5 20 12 20C19 20 23 12 23 12',
  'M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z',
];
const ICON_EYE_OFF = ['M2 2L22 22M6.71277 6.7226C3.66479 8.79527 2 12 2 12C2 12 5.63636 19 12 19C14.0503 19 15.8174 18.2734 17.2711 17.2884M11 5.05822C11.3254 5.02013 11.6588 5 12 5C18.3636 5 22 12 22 12C22 12 21.3082 13.3317 20 14.8335M14 14.2361C13.4692 14.7111 12.7684 15 12 15C10.3431 15 9 13.6569 9 12C9 11.1763 9.33193 10.4302 9.86932 9.88808'];

function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${paths
    .map((d) => `<path d="${d}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('')}</svg>`;
}

/* El tema arranca en boot.js, que corre antes de pintar. Acá solo se cambia. */
const THEME_KEY = 'unrsschiquito.theme';
const GRAY_KEY = 'unrsschiquito.gray';

const browserTheme = () =>
  matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

function renderTheme() {
  const { theme, gray } = document.documentElement.dataset;
  const toggle = $('#theme-toggle');
  toggle.innerHTML = icon(theme === 'dark' ? ICON_MOON : ICON_SUN);
  toggle.title = localStorage.getItem(THEME_KEY)
    ? 'Cambiar tema'
    : 'Cambiar tema (ahora sigue al navegador)';
  $('#gray-toggle').innerHTML = icon(gray === 'on' ? ICON_EYE_OFF : ICON_EYE);
}

function folderOptions(selected) {
  return `<option value="">Sin carpeta</option>${state.folders
    .map((f) => `<option value="${f.id}" ${f.id === selected ? 'selected' : ''}>${esc(f.name)}</option>`)
    .join('')}<option value="__new" ${selected === '__new' ? 'selected' : ''}>＋ Nueva carpeta…</option>`;
}

function newFolderField(name = '') {
  return `<label id="new-folder-row">Nombre de la carpeta nueva
      <input type="text" id="new-folder" value="${esc(name)}" placeholder="Diseño  ·  Enter para crearla">
    </label>`;
}

async function openAddFeed(preselectFolder = null) {
  await openModal((card, close) => {
    let candidates = [];

    const paint = (status = '', focusId = null) => {
      const selected = card.dataset.folder || preselectFolder;
      const picked = Number(card.dataset.pick || 0);
      card.innerHTML = `
        <h2 class="modal-title">Agregar feed</h2>
        <label>Link del sitio o del feed
          <input type="text" id="feed-url" placeholder="ejemplo.com  ·  ejemplo.com/feed.xml" value="${esc(card.dataset.url || '')}">
        </label>
        <label>Carpeta
          <select id="feed-folder">${folderOptions(selected)}</select>
        </label>
        ${selected === '__new' ? newFolderField(card.dataset.newFolder || '') : ''}
        <p class="msg ${status.startsWith('!') ? 'error' : ''}" id="feed-msg">${esc(status.replace(/^!/, ''))}</p>
        ${candidates.length ? `<div class="stack">${candidates.map((c, i) => `
          <label class="candidate">
            <input type="radio" name="cand" value="${i}" ${i === picked ? 'checked' : ''}>
            <span>
              <span class="c-title">${esc(c.title)}</span>
              ${c.description ? `<br><span class="c-url">${esc(c.description.slice(0, 120))}</span>` : ''}
              <br><span class="c-url">${esc(c.url)} · ${c.itemCount} artículos</span>
            </span>
          </label>`).join('')}</div>` : ''}
        <div class="actions">
          <button class="btn" data-act="cancel">Cancelar</button>
          <button class="btn primary" data-act="go">${candidates.length ? 'Agregar' : 'Buscar feed'}</button>
        </div>`;

      const url = $('#feed-url', card);
      const folder = $('#feed-folder', card);
      url.oninput = () => { card.dataset.url = url.value; };
      url.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
      folder.onchange = () => {
        card.dataset.folder = folder.value;
        paint('', folder.value === '__new' ? 'new-folder' : null);
      };

      const nf = $('#new-folder', card);
      if (nf) {
        nf.oninput = () => { card.dataset.newFolder = nf.value; };
        nf.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commitNewFolder(); } };
      }

      $$('input[name=cand]', card).forEach((r) => {
        r.onchange = () => { card.dataset.pick = r.value; };
      });
      $('[data-act=cancel]', card).onclick = () => close();
      $('[data-act=go]', card).onclick = go;
      enhanceSelects(card);
      ((focusId && $('#' + focusId, card)) || url).focus();
    };

    const commitNewFolder = async () => {
      const name = (card.dataset.newFolder || '').trim();
      if (!name) { paint('!Ponele un nombre a la carpeta', 'new-folder'); return; }
      const created = await createFolder(name);
      if (!created) return;
      card.dataset.folder = created.id;
      delete card.dataset.newFolder;
      paint(`Carpeta “${created.name}” creada`);
      return created.id;
    };

    const resolveFolder = async () => {
      const value = $('#feed-folder', card).value;
      if (value !== '__new') return value || null;
      return await commitNewFolder();
    };

    const go = async () => {
      const folderId = await resolveFolder();
      if (folderId === undefined) return;
      const input = $('#feed-url', card);

      if (candidates.length) {
        const picked = candidates[Number($('input[name=cand]:checked', card)?.value || 0)];
        close();
        await addFeed(picked, folderId);
        return;
      }

      const value = input.value.trim();
      if (!value) return;
      card.dataset.url = value;
      $('#feed-msg', card).textContent = 'Buscando…';
      $('[data-act=go]', card).disabled = true;

      try {
        candidates = (await api.discover(value)).candidates || [];
        card.dataset.pick = '0';
        if (candidates.length === 1) {
          close();
          await addFeed(candidates[0], folderId);
          return;
        }
        paint(`${candidates.length} feeds encontrados, seleccioná uno.`);
      } catch (err) {
        candidates = [];
        paint('!' + (err.message || 'No se pudo conectar'));
      }
    };

    card.dataset.folder = preselectFolder || '';
    paint();
  });
}

async function addFeed(candidate, folderId) {
  const existing = state.feeds.find((f) => f.url === candidate.url);
  if (existing) {
    toast('Ese feed ya está');
    selectView('feed', existing.id);
    return;
  }

  let payload;
  try {
    payload = await api.addFeed({
      url: candidate.url,
      title: candidate.title || '',
      siteUrl: candidate.siteUrl || null,
      folderId: folderId || null,
    });
  } catch (err) {
    return toast(err.message);
  }

  state.feeds.push(payload.feed);
  state.feeds.sort((a, b) => feedName(a).localeCompare(feedName(b)));
  applySnapshot({ counts: payload.counts });
  toast(`Agregado: ${feedName(payload.feed)}`);
  selectView('feed', payload.feed.id);
}

async function newFolder() {
  const name = await askText({ title: 'Nueva carpeta', label: 'Nombre', confirmLabel: 'Crear' });
  if (name) await createFolder(name);
}

async function createFolder(name) {
  try {
    const { folder } = await api.createFolder(name);
    state.folders.push(folder);
    renderSidebar();
    return folder;
  } catch (err) {
    toast(err.message);
    return null;
  }
}

async function feedMenu(id) {
  const feed = feedById(id);
  if (!feed) return;

  const action = await openModal((card, close) => {
    card.innerHTML = `
      <h2 class="modal-title">${esc(feedName(feed))}</h2>
      <p class="c-url" style="margin:0">${esc(feed.url)}</p>
      ${feed.last_error ? `<p class="msg error" style="margin:0">${esc(feed.last_error)}</p>` : ''}
      <label>Carpeta<select id="mv">${folderOptions(feed.folder_id)}</select></label>
      <div id="mv-new" hidden>${newFolderField()}</div>
      <div class="stack">
        <button class="btn" data-act="rename">Renombrar</button>
        <button class="btn" data-act="refresh">Actualizar ahora</button>
        <button class="btn" data-act="delete">Eliminar feed</button>
      </div>
      <div class="actions"><button class="btn primary" data-act="close">Listo</button></div>`;

    const mv = $('#mv', card);
    const row = $('#mv-new', card);
    const nf = $('#new-folder', card);

    const commitNewFolder = async () => {
      const name = nf.value.trim();
      if (!name) return;
      const created = await createFolder(name);
      if (!created) return;
      mv.innerHTML = folderOptions(created.id);
      mv.dispatchEvent(new Event('optionschange'));
      nf.value = '';
      row.hidden = true;
      await moveFeed(feed, created.id);
    };

    mv.onchange = async (e) => {
      const value = e.target.value;
      if (value === '__new') { row.hidden = false; nf.focus(); return; }
      row.hidden = true;
      await moveFeed(feed, value || null);
    };
    nf.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commitNewFolder(); } };

    $$('[data-act]', card).forEach((b) => {
      b.onclick = async () => {
        if (b.dataset.act === 'close' && !row.hidden) await commitNewFolder();
        close(b.dataset.act);
      };
    });

    enhanceSelects(card);
  });

  if (action === 'rename') {
    const name = await askText({ title: 'Renombrar feed', label: 'Nombre', value: feedName(feed) });
    if (!name) return;
    try {
      await api.updateFeed(feed.id, { title: name });
    } catch (err) {
      return toast(err.message);
    }
    feed.title = name;
    renderSidebar();
    renderList();
  } else if (action === 'refresh') {
    await refreshFeeds([feed]);
  } else if (action === 'delete') {
    const ok = await askConfirm({
      title: `Eliminar ${feedName(feed)}`,
      message: 'Se borran también todos sus artículos guardados. No se puede deshacer.',
    });
    if (!ok) return;
    let counts;
    try {
      ({ counts } = await api.deleteFeed(feed.id));
    } catch (err) {
      return toast(err.message);
    }
    state.feeds = state.feeds.filter((f) => f.id !== feed.id);
    state.counts = counts || state.counts;
    if (state.view.type === 'feed' && state.view.id === feed.id) selectView('unread');
    else { renderSidebar(); loadItems({ reset: true }); }
    toast('Feed eliminado');
  }
}

async function moveFeed(feed, folderId) {
  try {
    await api.updateFeed(feed.id, { folder_id: folderId });
  } catch (err) {
    return toast(err.message);
  }
  feed.folder_id = folderId;
  renderSidebar();
}

async function folderMenu(id) {
  const folder = state.folders.find((f) => f.id === id);
  if (!folder) return;

  const action = await openModal((card, close) => {
    card.innerHTML = `
      <h2 class="modal-title">${esc(folder.name)}</h2>
      <div class="stack">
        <button class="btn" data-act="rename">Renombrar</button>
        <button class="btn" data-act="add">Agregar feed acá</button>
        <button class="btn" data-act="delete">Eliminar carpeta</button>
      </div>
      <div class="actions"><button class="btn primary" data-act="close">Listo</button></div>`;
    $$('[data-act]', card).forEach((b) => { b.onclick = () => close(b.dataset.act); });
  });

  if (action === 'rename') {
    const name = await askText({ title: 'Renombrar carpeta', label: 'Nombre', value: folder.name });
    if (!name) return;
    try {
      await api.renameFolder(folder.id, name);
    } catch (err) {
      return toast(err.message);
    }
    folder.name = name;
    renderSidebar();
  } else if (action === 'add') {
    await openAddFeed(folder.id);
  } else if (action === 'delete') {
    const inside = state.feeds.filter((f) => f.folder_id === folder.id).length;
    const ok = await askConfirm({
      title: `Eliminar ${folder.name}`,
      message: inside
        ? `Los ${inside} feeds que tiene adentro quedan sin carpeta. No se borra nada más.`
        : 'La carpeta está vacía.',
    });
    if (!ok) return;
    try {
      await api.deleteFolder(folder.id);
    } catch (err) {
      return toast(err.message);
    }
    state.folders = state.folders.filter((f) => f.id !== folder.id);
    state.feeds.forEach((f) => { if (f.folder_id === folder.id) f.folder_id = null; });
    if (state.view.type === 'folder' && state.view.id === folder.id) selectView('unread');
    else renderSidebar();
  }
}

async function importOpmlFile(file) {
  let xml;
  try {
    xml = await file.text();
  } catch {
    return toast('No se pudo leer el archivo');
  }
  if (!xml.trim()) return toast('Ese archivo está vacío');

  toast('Importando… esto baja los feeds nuevos, puede tardar', 120000);

  let payload;
  try {
    payload = await api.importOpml(xml);
  } catch (err) {
    return toast(err.message);
  }

  applySnapshot(payload);
  await loadItems({ reset: true });

  const { imported = 0, found = 0, failed = 0 } = payload;
  if (!imported) return toast(found ? 'Ya tenías todos esos feeds' : 'No encontré suscripciones ahí');
  const plural = imported > 1 ? 's' : '';
  toast(`${imported} feed${plural} importado${plural}${failed ? `, ${failed} con error` : ''}`);
}

function wireMoreMenu() {
  const btn = $('#more-toggle');
  const list = $('#more-list');
  const file = $('#opml-file');

  const onOutside = (e) => { if (!e.target.closest('#more-menu')) close(); };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
    btn.focus();
  };

  const open = () => {
    list.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    $('[data-act]', list)?.focus();
  };

  const close = () => {
    if (list.hidden) return;
    list.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };

  btn.onclick = () => (list.hidden ? open() : close());
  list.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    close();
    // El content-disposition del server hace la descarga, no hace falta un <a>.
    if (act === 'export') window.location.href = '/api/opml';
    if (act === 'import') file.click();
  };

  file.onchange = () => {
    const chosen = file.files?.[0];
    file.value = '';   // así se puede volver a elegir el mismo archivo
    if (chosen) importOpmlFile(chosen);
  };
}

function scrollItemIntoView(id) {
  $(`.item[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function moveCursor(delta) {
  if (!state.items.length) return;
  state.cursor = Math.max(0, Math.min(state.items.length - 1, state.cursor + delta));
  const item = state.items[state.cursor];
  renderList();
  scrollItemIntoView(item.id);
}

function wireEvents() {
  $('#nav').onclick = (e) => {
    if (e.target.closest('[data-add-folder]')) { e.stopPropagation(); return newFolder(); }

    const more = e.target.closest('[data-menu]');
    if (more) {
      e.stopPropagation();
      return more.dataset.menu === 'feed' ? feedMenu(more.dataset.id) : folderMenu(more.dataset.id);
    }
    const all = e.target.closest('[data-collapse-all]');
    if (all) {
      if (all.dataset.collapseAll === 'close') state.folders.forEach((f) => state.collapsed.add(f.id));
      else state.collapsed.clear();
      saveCollapsed();
      return renderSidebar();
    }

    const twisty = e.target.closest('[data-twisty]');
    if (twisty) {
      const id = twisty.dataset.twisty;
      state.collapsed.has(id) ? state.collapsed.delete(id) : state.collapsed.add(id);
      saveCollapsed();
      return renderSidebar();
    }
    const nav = e.target.closest('[data-view]');
    if (nav) selectView(nav.dataset.view, nav.dataset.id || null);
  };

  $('#add-feed').onclick = () => openAddFeed(state.view.type === 'folder' ? state.view.id : null);
  $('#refresh-view').onclick = () => refreshFeeds(feedsForView());

  $('#theme-toggle').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    // Si elegís lo mismo que ya dice el navegador, borramos la preferencia en
    // vez de guardarla: así el tema vuelve a seguir al sistema solo.
    if (next === browserTheme()) localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
    renderTheme();
  };

  $('#gray-toggle').onclick = () => {
    const next = document.documentElement.dataset.gray === 'on' ? 'off' : 'on';
    document.documentElement.dataset.gray = next;
    localStorage.setItem(GRAY_KEY, next);
    renderTheme();
  };

  window.addEventListener('themechange', renderTheme);

  wireMoreMenu();

  $('#menu-toggle').onclick = () => {
    const app = $('#app');
    app.classList.toggle('nav-open');
    $('.scrim')?.remove();
    if (app.classList.contains('nav-open')) {
      const scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.onclick = () => { app.classList.remove('nav-open'); scrim.remove(); };
      app.append(scrim);
    }
  };

  $('#list').onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add') return openAddFeed();
    if (act === 'more') return loadItems();

    const article = e.target.closest('.item');
    if (!article) return;
    const item = state.items.find((i) => i.id === article.dataset.id);
    if (!item) return;

    if (act === 'toggle-read') return setRead(item, !item.read);
    if (act === 'open') return openArticle(item.id);
  };

  $('#list').onkeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('.item-mark, .item-head');
    if (!target) return;
    e.stopPropagation();
    if (target.classList.contains('item-mark')) return;
    e.preventDefault();
    const id = target.closest('.item')?.dataset.id;
    if (state.items.some((i) => i.id === id)) openArticle(id);
  };

  $('#back').onclick = closeArticle;
  $('#reader-refresh').onclick = refreshArticle;
  $('#reader').onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!state.reading) return;
    if (act === 'unread') setRead(state.reading, !state.reading.read);
    if (act === 'copy') copyLink(state.reading.link);
  };

  document.addEventListener('keydown', (e) => {
    if (!$('#modal').hidden) return;
    if (!$('#more-list').hidden) return;
    const typing =/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === 'Escape' && typing) return e.target.blur();
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    if (state.reading) {
      switch (e.key) {
        case 'Escape': e.preventDefault(); return closeArticle();
        case 'j': case 'ArrowDown': e.preventDefault(); return stepArticle(1);
        case 'k': case 'ArrowUp': e.preventDefault(); return stepArticle(-1);
        case 'o': if (state.reading.link) window.open(state.reading.link, '_blank', 'noopener'); return;
        case 'm': return setRead(state.reading, !state.reading.read);
        case 'r': return refreshArticle();
      }
      return;
    }

    const item = state.items[state.cursor];
    switch (e.key) {
      case 'j': case 'ArrowDown': e.preventDefault(); return moveCursor(1);
      case 'k': case 'ArrowUp': e.preventDefault(); return moveCursor(-1);
      case 'Enter': case ' ': if (item) { e.preventDefault(); openArticle(item.id); } return;
      case 'o': if (item?.link) window.open(item.link, '_blank', 'noopener'); return;
      case 'm': if (item) setRead(item, !item.read); return;
      case 'r': refreshFeeds(feedsForView()); return;
    }
  });
}


async function main() {
  renderTheme();
  wireEvents();

  await loadSidebar();
  await loadItems({ reset: true });

  const stale = state.feeds.filter(
    (f) => !f.last_fetched_at || Date.now() - new Date(f.last_fetched_at) > AUTO_REFRESH_MS
  );
  if (stale.length) refreshFeeds(stale, { silent: true });
}

main();
