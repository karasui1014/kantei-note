/* AI鑑定ノート - 保存
   記録（文字）は localStorage、写真は IndexedDB に置く。どちらも端末の中だけ。外へは送らない */

'use strict';

/* ========== 記録 ========== */

function blankState() {
  return { v: 1, items: [], settings: { theme: 'auto', installClosed: false, firstDone: false } };
}

function loadState() {
  try {
    const raw = localStorage.getItem(APP.storeKey);
    if (!raw) return blankState();
    return cleanState(JSON.parse(raw));
  } catch (_) {
    return blankState();
  }
}

/* 読み込んだデータの形を整える（古い版や、書き出したファイルからの読み込みにも使う） */
function cleanState(o) {
  const st = blankState();
  if (!o || typeof o !== 'object') return st;
  if (o.settings && typeof o.settings === 'object') Object.assign(st.settings, o.settings);
  if (!['auto', 'light', 'dark'].includes(st.settings.theme)) st.settings.theme = 'auto';
  st.items = (Array.isArray(o.items) ? o.items : []).filter(it => it && typeof it === 'object' && it.id).map(cleanItem);
  return st;
}

function cleanItem(it) {
  const num = v => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : 0);
  return {
    id: String(it.id),
    createdAt: it.createdAt || Date.now(),
    updatedAt: it.updatedAt || it.createdAt || Date.now(),
    status: STATUS[it.status] ? it.status : 'waiting',
    memo: typeof it.memo === 'string' ? it.memo : '',
    condition: CONDITIONS.includes(it.condition) ? it.condition : '',
    cost: num(it.cost),
    photos: Array.isArray(it.photos) ? it.photos.filter(x => typeof x === 'string').slice(0, APP.maxPhotos) : [],
    sentAt: it.sentAt || 0,
    answeredAt: it.answeredAt || 0,
    ai: it.ai && typeof it.ai === 'object' ? it.ai : null,
    aiRaw: typeof it.aiRaw === 'string' ? it.aiRaw : '',
    listPrice: num(it.listPrice),
    ship: SHIP_MAP[it.ship] ? it.ship : '',
    checks: Array.isArray(it.checks) ? it.checks.map(num).filter(Boolean).slice(0, 30) : [],
    soldPrice: num(it.soldPrice),
    soldPlatform: PLATFORM_MAP[it.soldPlatform] ? it.soldPlatform : 'mercari',
    soldShip: SHIP_MAP[it.soldShip] ? it.soldShip : '',
    soldAt: it.soldAt || 0,
    note: typeof it.note === 'string' ? it.note : '',
  };
}

function newItem() {
  return cleanItem({ id: newId(), createdAt: Date.now(), status: 'waiting' });
}

/* 保存に失敗しても画面は止めない（容量いっぱい・プライベートモードなど）。
   容量がいっぱいのときは、新しい20件を残して、古い記録の「AIの答えの全文」だけを手放して保存し直す
   （金額・品名・出品文などの読み取った中身は残る） */
function saveState(st) {
  const write = () => { localStorage.setItem(APP.storeKey, JSON.stringify(st)); return true; };
  try {
    return write();
  } catch (_) {
    const recent = new Set(st.items.slice(0, 20).map(it => it.id));
    let trimmed = false;
    for (const it of st.items) if (!recent.has(it.id) && it.aiRaw) { it.aiRaw = ''; trimmed = true; }
    if (!trimmed) return false;
    try { return write(); } catch (__) { return false; }
  }
}

/* ========== 写真（IndexedDB） ========== */

const PhotoDB = (() => {
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open('kantei-note', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    return dbp;
  }
  async function run(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('photos', mode);
      const store = tx.objectStore('photos');
      let result;
      const req = fn(store);
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  return {
    put: rec => run('readwrite', s => s.put(rec)),
    get: id => run('readonly', s => s.get(id)),
    del: id => run('readwrite', s => s.delete(id)),
    all: () => run('readonly', s => s.getAll()),
    clear: () => run('readwrite', s => s.clear()),
  };
})();

/* 表示用の object URL を使い回す */
const PhotoURL = new Map();
async function photoUrl(id, kind = 'thumb') {
  const key = id + ':' + kind;
  if (PhotoURL.has(key)) return PhotoURL.get(key);
  const rec = await PhotoDB.get(id).catch(() => null);
  if (!rec) return '';
  const blob = kind === 'full' ? rec.blob : (rec.thumb || rec.blob);
  const url = URL.createObjectURL(blob);
  PhotoURL.set(key, url);
  return url;
}
function forgetPhotoUrls(id) {
  for (const kind of ['thumb', 'full']) {
    const key = id + ':' + kind;
    if (PhotoURL.has(key)) { URL.revokeObjectURL(PhotoURL.get(key)); PhotoURL.delete(key); }
  }
}

/* ========== 写真の縮小 ==========
   AIに送る用（長辺1400px）と、一覧用の小さな画像（長辺360px）を作る。
   iPhoneのHEICは、選んだ時点でJPEGに変換されて渡ってくる */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

function drawJpeg(img, maxSide, quality) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';            /* 透過PNGの背景が黒くならないように */
  g.fillRect(0, 0, w, h);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    c.toBlob(b => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality));
}

async function makePhoto(file) {
  const img = await loadImage(file);
  const [blob, thumb] = await Promise.all([drawJpeg(img, 1400, 0.82), drawJpeg(img, 360, 0.78)]);
  const rec = { id: 'p' + newId(), blob, thumb, at: Date.now() };
  await PhotoDB.put(rec);
  return rec.id;
}

async function deletePhotos(ids) {
  for (const id of ids || []) {
    forgetPhotoUrls(id);
    await PhotoDB.del(id).catch(() => {});
  }
}

/* AIアプリへ渡すファイル */
async function photoFiles(ids) {
  const files = [];
  for (const [i, id] of (ids || []).entries()) {
    const rec = await PhotoDB.get(id).catch(() => null);
    if (rec && rec.blob) files.push(new File([rec.blob], `photo-${i + 1}.jpg`, { type: 'image/jpeg' }));
  }
  return files;
}

/* ========== 書き出し・読み込み ========== */

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
/* fetch(data:) はCSPの connect-src に引っかかるので、自前で戻す */
function dataUrlToBlob(u) {
  const i = u.indexOf(',');
  const mime = (u.slice(0, i).match(/data:([^;,]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(u.slice(i + 1));
  const arr = new Uint8Array(bin.length);
  for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
  return new Blob([arr], { type: mime });
}

async function exportData(st) {
  const photos = {};
  const used = new Set(st.items.flatMap(it => it.photos));
  for (const rec of await PhotoDB.all().catch(() => [])) {
    if (!used.has(rec.id)) continue;
    photos[rec.id] = { blob: await blobToDataUrl(rec.blob), thumb: rec.thumb ? await blobToDataUrl(rec.thumb) : '' };
  }
  return JSON.stringify({ app: 'kantei-note', v: 1, exportedAt: new Date().toISOString(), state: st, photos });
}

/* 同じIDの記録は上書き、ない記録は足す */
async function importData(text, st) {
  const o = JSON.parse(text);
  if (!o || o.app !== 'kantei-note' || !o.state) throw new Error('format');
  const incoming = cleanState(o.state);
  for (const [id, p] of Object.entries(o.photos || {})) {
    if (!p || !p.blob) continue;
    const blob = dataUrlToBlob(p.blob);
    const thumb = p.thumb ? dataUrlToBlob(p.thumb) : blob;
    forgetPhotoUrls(id);
    await PhotoDB.put({ id, blob, thumb, at: Date.now() });
  }
  const map = new Map(st.items.map(it => [it.id, it]));
  for (const it of incoming.items) map.set(it.id, it);
  st.items = [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
  return incoming.items.length;
}
