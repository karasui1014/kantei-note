/* AI鑑定ノート - 画面
   画面の文字列は、かならず esc() を通してから差し込む（AIの答えにHTMLが混ざっていても安全なように） */

'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

let S = loadState();
/* index.html に書いてある説明（検索エンジン向けと共通）。はじめての人のホームと「使い方」で使い回す */
const INTRO_HTML = ($('#view') || {}).innerHTML || '';

const UI = {
  draft: null,        /* まだ保存していない、新しい鑑定 */
  filter: 'all',
  pasteMsg: '',
  flash: null,        /* 結果が出た直後の一言 { id, kind } */
  files: null, filesKey: '',
  busy: false,
  manual: false,
  editing: false,
  sendFallback: false,
  kw: {},             /* 相場リンクで使うキーワード（品物ごと） */
  open: {},           /* 開いている折りたたみ */
  lastRoute: '',
};

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (!saveState(S)) toast('保存できませんでした。端末の空き容量をご確認ください');
}
/* 文字を打っている間は、まとめて保存する（1文字ごとに全部を書き直さない） */
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
/* AIアプリに切り替える直前など、待っている保存があればすぐ書く */
function flushSave() {
  if (saveTimer) save();
}

/* ========== 小さな部品 ========== */

const ICON = {
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h3.2L8.8 6h6.4l1.6 2.5H20V19H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>',
  ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 5.5H18.5V10.5M18.5 5.5l-7.5 7.5M17 13.5V18.5H5.5V7H10.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="10" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-6a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h1"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11M8 7.5l4-4 4 4M6.5 11H5v9.5h14V11h-1.5"/></svg>',
  paste: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="12" height="15.5" rx="2"/><path d="M9.5 5V3.8h5V5M9 11h6M9 14.5h6"/></svg>',
};

function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('in');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('in'), 2600);
}

function copyText(text, quiet) {
  const done = () => { if (!quiet) toast('コピーしました'); };
  const legacy = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (_) { if (!quiet) toast('コピーできませんでした'); }
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(done, legacy);
  }
  legacy();
  return Promise.resolve();
}

function fmtDate(t) {
  const d = new Date(t);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

function itemName(it) {
  const a = it.ai;
  if (a && a.name) return a.name;
  const first = cleanStr((it.memo || '').split('\n')[0]);
  return first || '名前のない品物';
}

/* 保存してある答えに、足りない項目があっても画面が崩れないように、ひな形で埋めて返す */
function aiOf(it) {
  return Object.assign(normalizeAi({}), it.ai || {});
}

/* AIに送ったあと、まだ答えを貼っていない状態か */
function awaitingAnswer(it) {
  return !!it.sentAt && it.sentAt > (it.answeredAt || 0);
}

/* 写真の枠。実際の画像は hydratePhotos() があとから入れる。zoom を付けると押して拡大できる */
function photoBox(it, cls, zoom) {
  const id = it.photos[0];
  if (!id) return `<span class="${cls} glyph" aria-hidden="true">${esc(itemName(it).slice(0, 1))}</span>`;
  const img = `<img data-photo="${esc(id)}" alt="">`;
  return zoom
    ? `<button class="${cls}" data-act="zoom" data-id="${esc(id)}" aria-label="写真を大きく見る">${img}</button>`
    : `<span class="${cls}">${img}</span>`;
}

function hydratePhotos() {
  $$('img[data-photo]').forEach(async img => {
    const url = await photoUrl(img.dataset.photo, img.dataset.kind || 'thumb');
    if (url) img.src = url;
    else img.parentElement && img.parentElement.classList.add('missing');
  });
}

function keep(key) { return UI.open[key] ? ' open' : ''; }

/* ========== 画面の切り替え ========== */

function parseRoute() {
  const parts = (location.hash || '#/').slice(1).split('/').filter(Boolean);
  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'new') return { name: 'new' };
  if (parts[0] === 'item' && parts[1]) return { name: 'item', id: decodeURIComponent(parts[1]), mode: parts[2] || '' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'help') return { name: 'help' };
  return { name: 'home' };
}

function curItem() {
  const r = parseRoute();
  if (r.name === 'new') return UI.draft;
  if (r.name === 'item') return S.items.find(i => i.id === r.id) || null;
  return null;
}

function render() {
  const r = parseRoute();
  const routeKey = location.hash;
  if (routeKey !== UI.lastRoute) {
    UI.pasteMsg = ''; UI.manual = false; UI.editing = false; UI.sendFallback = false;
  }
  let html;
  if (r.name === 'new') {
    if (!UI.draft) UI.draft = newItem();
    html = vAsk(UI.draft, false);
  } else if (r.name === 'item') {
    const it = curItem();
    if (!it) { location.replace('#/'); return; }
    html = (it.status === 'waiting' || r.mode === 'ask') ? vAsk(it, it.status !== 'waiting') : vResult(it);
  } else if (r.name === 'settings') {
    html = vSettings();
  } else if (r.name === 'help') {
    html = vHelp();
  } else {
    html = vHome();
  }
  $('#view').innerHTML = html;
  $$('details[data-keep]').forEach(d => d.addEventListener('toggle', () => { UI.open[d.dataset.keep] = d.open; }));
  hydratePhotos();
  afterRender(r);
  if (routeKey !== UI.lastRoute) {
    UI.lastRoute = routeKey;
    window.scrollTo(0, 0);
  }
}

function afterRender(r) {
  if (r.name === 'settings') showCacheName();
  const it = curItem();
  if (it && (it.status === 'waiting' || r.mode === 'ask')) prepareFiles(it);
  /* 「結果ができました」は、その結果の画面にいる間だけ出す */
  if (UI.flash && !(r.name === 'item' && r.id === UI.flash.id && !r.mode)) UI.flash = null;
}

/* 答えを読み取れたら、結果の画面の先頭から見せる */
function showResult(it) {
  location.hash = '#/item/' + encodeURIComponent(it.id);
  render();
  window.scrollTo(0, 0);
}

/* ========== ホーム ========== */

function vHome() {
  const items = S.items;
  if (!items.length) return INTRO_HTML;
  const t = totals(items);
  const waiting = items.filter(i => i.status === 'waiting');
  const done = items.filter(i => i.status !== 'waiting');
  const count = s => done.filter(i => i.status === s).length;
  const f = UI.filter;
  const list = done.filter(i => f === 'all' || i.status === f);
  const filters = [['all', 'すべて', done.length], ...STATUS_ORDER.map(s => [s, STATUS[s], count(s)])]
    .filter(([id, , n]) => id === 'all' || n > 0);

  return `<section class="home">
    <h1 class="vh">AI鑑定ノート</h1>
    <a class="btn primary xl" href="#/new">${ICON.camera}<span>写真から鑑定する</span></a>
    ${waiting.length ? `<h2 class="sec">鑑定のつづき</h2>
      <div class="list">${waiting.map(cardWaiting).join('')}</div>` : ''}
    ${done.length ? `<div class="stats">
      <div class="stat"><div class="k">手元にあるもの</div><div class="v">${fmtYen(t.haveValue)}</div><div class="s">${t.haveCount}点・相場の合計</div></div>
      <div class="stat"><div class="k">売れたもの</div><div class="v">${fmtYen(t.soldNet)}</div><div class="s">${t.soldCount}点・手取りの合計${t.profitCount ? `<br>利益 ${fmtYen(t.soldProfit)}` : ''}</div></div>
    </div>` : ''}
    ${installCard()}
    ${done.length ? `<div class="filters" role="group" aria-label="しぼり込み">${filters.map(([id, label, n]) =>
      `<button class="chip${f === id ? ' on' : ''}" data-act="filter" data-v="${id}" aria-pressed="${f === id}">${esc(label)}<span class="n">${n}</span></button>`).join('')}</div>
    <div class="list">${list.map(cardItem).join('') || '<p class="empty">この状態の記録はまだありません。</p>'}</div>` : ''}
    <p class="center"><a class="textlink" href="#/help">使い方・よくある質問</a></p>
  </section>`;
}

function cardItem(it) {
  const a = it.ai || {};
  let amt, sub;
  if (it.status === 'sold' && it.soldPrice > 0) { amt = fmtYen(it.soldPrice); sub = '売れた値段'; }
  else { amt = fmtYen(a.typical); sub = '相場'; }
  return `<a class="item" href="#/item/${encodeURIComponent(it.id)}">
    ${photoBox(it, 'thumb')}
    <span class="body">
      <span class="name">${esc(itemName(it))}</span>
      <span class="meta"><span class="st st-${it.status}">${esc(STATUS[it.status])}</span>${a.low != null ? `<span>${esc(fmtRange(a.low, a.high))}</span>` : ''}</span>
    </span>
    <span class="amt"><span class="amt-s">${sub}</span>${esc(amt)}</span>
  </a>`;
}

function cardWaiting(it) {
  const sub = it.sentAt ? 'AIの答えを貼り付けると、結果になります' : (it.photos.length ? `写真${it.photos.length}枚を選びました` : 'メモを入れました');
  return `<a class="item waiting" href="#/item/${encodeURIComponent(it.id)}">
    ${photoBox(it, 'thumb')}
    <span class="body">
      <span class="name">${esc(itemName(it))}</span>
      <span class="meta"><span>${esc(sub)}</span></span>
    </span>
    <span class="go">つづける</span>
  </a>`;
}

function vHelp() {
  return `<div class="head-row"><a class="back" href="#/">${ICON.back}もどる</a></div>${INTRO_HTML}`;
}

/* ========== 鑑定する（写真 → AIに送る → 答えを貼る） ========== */

function isMobileShare() {
  const touch = matchMedia('(pointer: coarse)').matches || /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
  return touch && !!navigator.share;
}

function vAsk(it, again) {
  const hasInput = it.photos.length > 0 || cleanStr(it.memo) !== '';
  const prompt = buildPrompt({ memo: it.memo, condition: it.condition, cost: it.cost, photoCount: it.photos.length }, new Date());
  const shareMode = isMobileShare() && !UI.sendFallback;
  const backHref = again ? `#/item/${encodeURIComponent(it.id)}` : '#/';
  const sent = awaitingAnswer(it);

  const photos = it.photos.map(id => `<div class="ph">
      <img data-photo="${esc(id)}" alt="">
      <button class="ph-x" data-act="delPhoto" data-id="${esc(id)}" aria-label="この写真を外す">×</button>
    </div>`).join('');
  const addBox = it.photos.length < APP.maxPhotos
    ? `<label class="ph add${UI.busy ? ' busy' : ''}">
        <input type="file" accept="image/*" multiple data-change="addPhotos" class="vh">
        ${UI.busy ? '<span>読み込み中…</span>' : `${it.photos.length ? ICON.plus : ICON.camera}<span>${it.photos.length ? '写真を足す' : '写真を選ぶ・撮る'}</span>`}
      </label>` : '';

  const sendBlock = shareMode
    ? `<button class="btn primary xl" data-act="send"${hasInput ? '' : ' disabled'}>${ICON.share}<span>写真と指示文をAIに送る</span></button>
       <p class="fine">共有の画面で、ChatGPT・Gemini・Claudeなどのアプリを選んでください。押すと、指示文もコピーされます。</p>
       <details class="more" data-keep="alt"${keep('alt')}><summary>共有がうまくいかないとき</summary>
         <div class="more-body">${manualSendHtml(hasInput)}</div></details>`
    : manualSendHtml(hasInput);

  return `<section class="ask">
    <div class="head-row"><a class="back" href="${backHref}">${ICON.back}${again ? '結果にもどる' : 'もどる'}</a></div>
    <h1 class="page">${again ? 'もう一度AIに聞く' : '鑑定する'}</h1>
    ${again ? '<p class="lead">写真や「わかっていること」を直して、もう一度送れます。新しい答えを貼ると、結果が入れ替わります。</p>' : ''}

    <ol class="flow">
      <li class="step${hasInput ? ' done' : ''}">
        <div class="st-h"><span class="no">1</span><span>写真を選ぶ</span></div>
        <p class="hint">全体の写真と、ラベル・型番・刻印・サインのアップがあると、見立てが正確になります（${APP.maxPhotos}枚まで）。</p>
        <div class="photos${it.photos.length ? '' : ' empty'}">${photos}${addBox}</div>
        <label class="field">
          <span class="lab">わかっていること<em>任意</em></span>
          <textarea data-bind="memo" rows="3" placeholder="例：ルンバ 643。5年前に購入。充電台あり、箱なし">${esc(it.memo)}</textarea>
        </label>
        <details class="more" data-keep="extra"${(UI.open.extra ?? (it.condition || it.cost)) ? ' open' : ''}>
          <summary>状態と仕入れ値も入れる<em>任意</em></summary>
          <div class="more-body">
            <div class="lab">状態</div>
            <div class="chips">${CONDITIONS.map(c => `<button class="chip${it.condition === c ? ' on' : ''}" data-act="cond" data-v="${esc(c)}" aria-pressed="${it.condition === c}">${esc(c)}</button>`).join('')}</div>
            <label class="field">
              <span class="lab">仕入れ値（買う前なら、値札の金額）</span>
              <span class="yen"><input type="text" inputmode="numeric" data-bind="cost" value="${it.cost || ''}" placeholder="例：1000"><span>円</span></span>
            </label>
          </div>
        </details>
      </li>

      <li class="step${sent ? ' done' : ''}">
        <div class="st-h"><span class="no">2</span><span>AIアプリに送る</span></div>
        <p class="hint">写真と、鑑定用の指示文をまとめて渡します。ChatGPT・Gemini・Claudeの無料プランで使えます。</p>
        <p class="need" id="need"${hasInput ? ' hidden' : ''}>写真か「わかっていること」を入れると、送れるようになります。</p>
        ${sendBlock}
        <details class="more" data-keep="tips"${keep('tips')}><summary>送るときのコツ</summary>
          <ul class="dots more-body">${AI_TIPS.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>
        <details class="more" data-keep="prompt"${keep('prompt')}><summary>指示文を見る</summary>
          <pre class="prompt more-body" id="prompt-pre">${esc(prompt)}</pre></details>
      </li>

      <li class="step${sent ? ' ready' : ''}" id="st-paste">
        <div class="st-h"><span class="no">3</span><span>答えを貼り付ける</span></div>
        <p class="hint">AIの答えをコピーして戻ってきたら、ここに貼り付けます。答え全体でも、最後の「json」の枠だけでも大丈夫です。</p>
        <button class="btn ${sent ? 'primary' : 'ghost'} xl" data-act="pasteClip">${ICON.paste}<span>コピーした答えを貼り付ける</span></button>
        <textarea class="answer" data-input="answer" rows="3" placeholder="ここに直接貼り付けてもOKです" aria-label="AIの答え"></textarea>
        <p class="msg" id="paste-msg" role="status">${esc(UI.pasteMsg)}</p>
        ${UI.manual ? manualFormHtml(it) : `<button class="btn link" data-act="manual">AIを使わずに、自分で金額を入れる</button>`}
      </li>
    </ol>
    ${again ? '' : `<button class="btn link danger" data-act="discard">この鑑定をやめる</button>`}
  </section>`;
}

function manualSendHtml(enabled = true) {
  return `<button class="btn ${isMobileShare() ? 'ghost' : 'primary'} xl" data-act="copyPrompt"${enabled ? '' : ' disabled'}>${ICON.copy}<span>指示文をコピー</span></button>
    <div class="ai-links">${AI_APPS.map(a => `<a class="btn ghost" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(a.name)}を開く">${esc(a.name)}${ICON.ext}</a>`).join('')}</div>
    <p class="fine">AIの入力欄に指示文を貼り付けて、写真を添えて送ってください。パソコンなら、写真はドラッグ＆ドロップで添えられます。</p>`;
}

function manualFormHtml(it, a) {
  a = a || {};
  const v = n => (n > 0 ? n : '');
  const name = a.name || (it.memo ? itemName(it) : '');
  return `<div class="manual" id="manual">
    <label class="field"><span class="lab">品名</span>
      <input type="text" data-m="name" value="${esc(name)}" placeholder="例：ルンバ 643"></label>
    <div class="grid2">
      <label class="field"><span class="lab">相場の下限</span><span class="yen"><input type="text" inputmode="numeric" data-m="low" value="${v(a.low)}"><span>円</span></span></label>
      <label class="field"><span class="lab">相場の上限</span><span class="yen"><input type="text" inputmode="numeric" data-m="high" value="${v(a.high)}"><span>円</span></span></label>
    </div>
    <div class="grid2">
      <label class="field"><span class="lab">いちばん多い値段<em>任意</em></span><span class="yen"><input type="text" inputmode="numeric" data-m="typical" value="${v(a.typical)}"><span>円</span></span></label>
      <label class="field"><span class="lab">メルカリの出品価格<em>任意</em></span><span class="yen"><input type="text" inputmode="numeric" data-m="mercari" value="${v(a.mercari)}"><span>円</span></span></label>
    </div>
    <label class="field"><span class="lab">買取店の買取価格<em>任意</em></span><span class="yen"><input type="text" inputmode="numeric" data-m="buyback" value="${v(a.buyback)}"><span>円</span></span></label>
    <button class="btn primary" data-act="manualSave">この金額で記録する</button>
    <p class="fine">「実際に売れた値段を確かめる」のリンクで、売り切れの値段を見てから入れると確かです。</p>
  </div>`;
}

/* 共有に使う写真ファイルを先に用意しておく（ボタンを押した瞬間に渡すため） */
async function prepareFiles(it) {
  const key = it.id + ':' + it.photos.join(',');
  if (UI.filesKey === key) return;
  UI.filesKey = key;
  UI.files = null;
  const files = await photoFiles(it.photos).catch(() => []);
  if (UI.filesKey === key) UI.files = files;
}

function ensureSaved(it) {
  if (S.items.some(x => x.id === it.id)) return;
  S.items.unshift(it);
  UI.draft = null;
  save();
  history.replaceState(null, '', '#/item/' + encodeURIComponent(it.id));
  UI.lastRoute = location.hash;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

function touch(it, soon) {
  it.updatedAt = Date.now();
  ensureSaved(it);
  if (soon) saveSoon(); else save();
}

function currentPrompt(it) {
  return buildPrompt({ memo: it.memo, condition: it.condition, cost: it.cost, photoCount: it.photos.length }, new Date());
}

function doSend(it) {
  const prompt = currentPrompt(it);
  copyText(prompt, true);
  it.sentAt = Date.now();
  touch(it);
  const files = UI.filesKey === it.id + ':' + it.photos.join(',') ? UI.files : null;
  const data = it.photos.length ? (files && files.length ? { files, text: prompt } : null) : { text: prompt };
  if (data && (!data.files || (navigator.canShare && navigator.canShare({ files: data.files })))) {
    navigator.share(data)
      .then(() => { render(); scrollToPaste(); })
      .catch(e => {
        if (e && e.name === 'AbortError') { render(); return; }
        sendFallback();
      });
  } else {
    sendFallback();
  }
}

function sendFallback() {
  UI.sendFallback = true;
  render();
  toast('指示文をコピーしました。AIアプリに貼り付けて、写真を添えて送ってください');
}

function scrollToPaste() {
  const el = $('#st-paste');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setPasteMsg(msg) {
  UI.pasteMsg = msg;
  const el = $('#paste-msg');
  if (el) el.textContent = msg;
}

function applyAnswer(it, text) {
  const r = parseAnswer(text);
  if (r.kind === 'ok') {
    it.ai = r.ai;
    it.aiRaw = String(text).slice(0, 20000);
    if (it.status === 'waiting') it.status = 'have';
    it.listPrice = 0;
    it.ship = '';
    it.answeredAt = Date.now();
    UI.flash = { id: it.id, kind: r.ai.partial ? 'partial' : 'ok' };
    S.settings.firstDone = true;
    touch(it);
    showResult(it);
    return;
  }
  if (r.kind === 'prompt') setPasteMsg('これはAIに渡す指示文でした。AIの答えのほうをコピーしてから、もう一度どうぞ。');
  else if (r.kind === 'empty') setPasteMsg('貼り付ける文章が空でした。AIの答えをコピーしてから、もう一度どうぞ。');
  else setPasteMsg('金額の部分を見つけられませんでした。答えの最後にある「json」の枠をコピーして、貼り付けてみてください。');
}

function readManual(root) {
  const g = k => { const el = $(`[data-m="${k}"]`, root); return el ? el.value : ''; };
  return {
    name: cleanStr(g('name')),
    low: yenOf(g('low')), high: yenOf(g('high')), typical: yenOf(g('typical')),
    mercari: yenOf(g('mercari')), buyback: yenOf(g('buyback')),
  };
}

/* ========== 結果 ========== */

function vResult(it) {
  const a = aiOf(it);
  const price = itemListPrice(it);
  const code = itemShip(it);
  const flash = UI.flash && UI.flash.id === it.id ? UI.flash.kind : '';
  const meta = [a.category, a.brand, a.model && a.model !== a.name ? a.model : '', a.era].filter(Boolean);

  return `<section class="result">
    <div class="head-row"><a class="back" href="#/">${ICON.back}一覧へ</a><span class="date">${esc(fmtDate(it.createdAt))}</span></div>
    ${flash === 'ok' ? '<p class="flash">鑑定結果ができました。下に、売るときの手取りや出品文もあります。</p>' : ''}
    ${flash === 'partial' ? '<p class="flash warn">一部だけ読み取りました。金額を確かめて、必要なら「金額を直す」から直してください。</p>' : ''}

    <article class="card sheet">
      <div class="id-row">
        ${photoBox(it, 'ph-main', true)}
        <div class="id-txt">
          <h1 class="item-name">${esc(itemName(it))}</h1>
          ${meta.length ? `<p class="item-meta">${esc(meta.join('・'))}</p>` : ''}
          <p class="badges">${a.confidence ? `<span class="badge c-${a.confidence}">見立て：${esc(CONFIDENCE[a.confidence])}</span>` : ''}${a.searched === true ? '<span class="badge">ネット検索で確認</span>' : a.searched === false ? '<span class="badge soft">知識からの推定</span>' : ''}${a.manual ? '<span class="badge soft">自分で入力</span>' : ''}</p>
        </div>
      </div>
      ${it.photos.length > 1 ? `<div class="thumbs">${it.photos.map(id => `<button class="tb" data-act="zoom" data-id="${esc(id)}" aria-label="写真を大きく見る"><img data-photo="${esc(id)}" alt=""></button>`).join('')}</div>` : ''}
      ${a.unsure ? `<p class="note">${esc(a.unsure)}</p>` : ''}
      ${a.alternatives && a.alternatives.length ? `<p class="alt">ほかの候補：${esc(a.alternatives.join('／'))}</p>` : ''}

      <div class="price-block">
        <div class="lbl">相場</div>
        <div class="big">${esc(fmtRange(a.low, a.high))}</div>
        ${a.typical != null && a.low !== a.high ? `<div class="sub">いちばん多いのは <strong>${esc(fmtYen(a.typical))}</strong></div>` : ''}
        <div id="rbar">${rangeBar(a, price)}</div>
        ${a.priceNew || a.buyback ? `<div class="facts-row">${a.priceNew ? `<span>新品 ${esc(fmtYen(a.priceNew))}</span>` : ''}${a.buyback ? `<span>買取の目安 ${esc(fmtYen(a.buyback))}</span>` : ''}</div>` : ''}
      </div>
      <div class="net-block" id="net-summary">${netSummary(price, code)}</div>
    </article>

    ${UI.editing ? `<section class="card"><h2 class="sec">金額を直す</h2>${manualFormHtml(it, a)}</section>` : ''}

    <div class="status-row" role="group" aria-label="記録の状態">${STATUS_ORDER.map(s =>
      `<button class="pill${it.status === s ? ' on' : ''}" data-act="status" data-v="${s}" aria-pressed="${it.status === s}">${esc(STATUS[s])}</button>`).join('')}</div>
    ${it.status === 'sold' ? soldCard(it) : ''}

    <section class="card">
      <h2 class="sec">メルカリで売るなら</h2>
      <label class="field"><span class="lab">出品価格</span>
        <span class="yen big-in"><input type="text" inputmode="numeric" data-bind="listPrice" value="${price || ''}" aria-label="出品価格"><span>円</span></span></label>
      <div class="chips" id="presets">${presetChips(it, a, price)}</div>
      <label class="field"><span class="lab">発送方法</span>
        <select data-bind="ship">${shipOptions(code)}</select></label>
      <p class="fine" id="ship-note">${shipNote(code, a)}</p>
      <dl class="calc" id="calc-mercari">${calcRows(price, code)}</dl>
      ${a.sellSpeed || a.sellNote ? `<p class="speed">${a.sellSpeed ? `<span class="tag s-${a.sellSpeed}">${esc(SELL_SPEED[a.sellSpeed])}</span>` : ''}${esc(a.sellNote)}</p>` : ''}
    </section>

    <section class="card">
      <h2 class="sec">仕入れの計算</h2>
      <label class="field"><span class="lab">仕入れ値</span>
        <span class="yen"><input type="text" inputmode="numeric" data-bind="cost" value="${it.cost || ''}" placeholder="例：1000"><span>円</span></span></label>
      <div id="profit-out">${profitHtml(it)}</div>
      ${a.buyNote ? `<p class="note">${esc(a.buyNote)}</p>` : ''}
    </section>

    <section class="card">
      <h2 class="sec">実際に売れた値段を確かめる</h2>
      <p class="hint">AIの見立ては目安です。売り切れの値段を見て、見つけた値段を入れると、相場を補正できます。</p>
      ${keywordHtml(it, a)}
      <div class="markets" id="markets">${marketsHtml(it, a)}</div>
      <div class="checks">
        <div class="lab">見つけた売り切れの値段</div>
        <div class="row">
          <span class="yen"><input type="text" inputmode="numeric" id="check-in" placeholder="例：4800" aria-label="見つけた値段"><span>円</span></span>
          <button class="btn ghost" data-act="addCheck">追加</button>
        </div>
        <div id="checks-out">${checksHtml(it)}</div>
      </div>
    </section>

    <section class="card">
      <h2 class="sec">ほかの売り方と比べる</h2>
      <p class="hint" id="cmp-hint">${cmpHint(price)}</p>
      <div id="cmp">${compareHtml(price, code, a)}</div>
    </section>

    ${a.art ? artHtml(a.art) : ''}

    ${a.features.length || a.evidence.length || a.conditionNote ? `<section class="card">
      <h2 class="sec">見立ての根拠</h2>
      ${a.features.length ? `<div class="lab">見分けに使った特徴</div><ul class="dots">${a.features.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${a.evidence.length ? `<div class="lab">相場の根拠</div><ul class="dots">${a.evidence.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${a.conditionNote ? `<div class="lab">状態</div><p>${esc(a.conditionNote)}</p>` : ''}
    </section>` : ''}

    ${a.tips.length ? `<section class="card"><h2 class="sec">値段が上がるポイント</h2><ul class="dots">${a.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
    ${a.cautions.length ? `<section class="card"><h2 class="sec">気をつけること</h2><ul class="dots">${a.cautions.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}

    ${a.title || a.description ? `<section class="card">
      <h2 class="sec">出品文のたたき台</h2>
      ${a.title ? `<div class="copy-block">
        <div class="cb-h"><span>商品名</span><span class="count${[...a.title].length > MERCARI_TITLE_MAX ? ' over' : ''}">${[...a.title].length}/${MERCARI_TITLE_MAX}文字</span>
          <button class="btn mini" data-act="copy" data-what="title">${ICON.copy}コピー</button></div>
        <p class="cb-body">${esc(a.title)}</p></div>` : ''}
      ${a.description ? `<div class="copy-block">
        <div class="cb-h"><span>商品の説明</span><button class="btn mini" data-act="copy" data-what="desc">${ICON.copy}コピー</button></div>
        <p class="cb-body pre">${esc(a.description)}</p></div>` : ''}
      ${a.condition ? `<p class="fine">商品の状態：${esc(a.condition)}</p>` : ''}
    </section>` : ''}

    <section class="card">
      <h2 class="sec">記録</h2>
      <label class="field"><span class="lab">メモ</span>
        <textarea data-bind="note" rows="2" placeholder="例：押し入れの上の段">${esc(it.note)}</textarea></label>
      <div class="actions">
        <button class="btn ghost" data-act="copySummary">${ICON.copy}<span>結果をコピー</span></button>
        <a class="btn ghost" href="#/item/${encodeURIComponent(it.id)}/ask">写真や品名を直して、もう一度聞く</a>
        <button class="btn ghost" data-act="editPrices">${UI.editing ? '金額の修正を閉じる' : '金額を直す'}</button>
      </div>
      ${it.aiRaw ? `<details class="more" data-keep="raw"${keep('raw')}><summary>AIの答えを全部見る</summary><pre class="prompt more-body">${esc(it.aiRaw)}</pre></details>` : ''}
      <button class="btn link danger" data-act="deleteItem">この記録を消す</button>
    </section>
    ${installCard()}
  </section>`;
}

function netSummary(price, code) {
  if (!(price > 0)) return '<div class="lbl">メルカリで売ると、手元に残る額</div><div class="big">—</div>';
  const fee = feeOf(price, PLATFORM_MAP.mercari.bp), ship = shipCost(code), net = price - fee - ship;
  return `<div class="lbl">メルカリで売ると、手元に残る額</div>
    <div class="big acc">${esc(fmtYen(net))}</div>
    <div class="sub">${esc(fmtYen(price))}で出品 − 手数料 ${esc(fmtYen(fee))} − 送料 ${esc(fmtYen(ship))}</div>`;
}

function rangeBar(a, price) {
  const lo = a.low, hi = a.high;
  if (lo == null || hi == null || hi <= lo) return '';
  const pad = (hi - lo) * 0.18;
  const min = Math.max(0, lo - pad), max = hi + pad;
  const pos = v => Math.min(100, Math.max(0, (v - min) / (max - min) * 100)).toFixed(2);
  return `<div class="rbar" aria-hidden="true">
      <div class="rb-track"></div>
      <div class="rb-fill" style="left:${pos(lo)}%;right:${(100 - pos(hi)).toFixed(2)}%"></div>
      ${a.typical != null ? `<div class="rb-dot" style="left:${pos(a.typical)}%"></div>` : ''}
      ${price > 0 ? `<div class="rb-mark" style="left:${pos(price)}%"><span>出品</span></div>` : ''}
    </div>`;
}

function presetChips(it, a, price) {
  const med = median(it.checks);
  const opts = [
    ['出品の目安', a.mercari], ['早く売るなら', a.quick], ['相場の中心', a.typical], ['売り切れの中央値', med],
  ].filter(([, v], i, arr) => v > 0 && arr.findIndex(x => x[1] === v) === i);
  return opts.map(([label, v]) =>
    `<button class="chip${v === price ? ' on' : ''}" data-act="setPrice" data-v="${v}">${esc(label)} ${esc(fmtYen(v))}</button>`).join('');
}

function shipOptions(code) {
  return SHIP_GROUPS.map(g => `<optgroup label="${esc(g.name)}">${SHIP.filter(s => s.group === g.id).map(s =>
    `<option value="${s.code}"${s.code === code ? ' selected' : ''}>${esc(s.name)}　${esc(fmtYen(s.fee + s.material))}</option>`).join('')}</optgroup>`).join('');
}

function shipNote(code, a) {
  const s = SHIP_MAP[code];
  const parts = [`${s.via}・${s.spec}`];
  if (s.matNote) parts.push(`送料${fmtYen(s.fee)}＋${s.matNote}`);
  if (a && (a.sizeCm || a.weightKg)) parts.push(`梱包の目安：${[a.sizeCm, a.weightKg ? `${a.weightKg.replace(/kg$/i, '')}kg` : ''].filter(Boolean).join('・')}`);
  return esc(parts.join('。'));
}

function calcRows(price, code) {
  if (!(price > 0)) return '<div><dt>出品価格を入れると計算します</dt><dd></dd></div>';
  const fee = feeOf(price, PLATFORM_MAP.mercari.bp), ship = shipCost(code);
  const low = price < MERCARI_MIN ? `<p class="fine">メルカリは${MERCARI_MIN}円から出品できます。安いものは、まとめ売りにすると動きやすくなります。</p>` : '';
  return `<div><dt>出品価格</dt><dd>${esc(fmtYen(price))}</dd></div>
    <div><dt>販売手数料（10%）</dt><dd>−${esc(fmtYen(fee))}</dd></div>
    <div><dt>送料${SHIP_MAP[code].material ? '・資材' : ''}</dt><dd>−${esc(fmtYen(ship))}</dd></div>
    <div class="total"><dt>手元に残る額</dt><dd>${esc(fmtYen(price - fee - ship))}</dd></div>${low}`;
}

function profitHtml(it) {
  const price = itemListPrice(it), code = itemShip(it);
  if (!(it.cost > 0)) return '<p class="hint">仕入れ値を入れると、利益と利益率を計算します。買う前に値札の金額を入れれば、仕入れるかどうかの判断に使えます。</p>';
  if (!(price > 0)) return '<p class="hint">出品価格を入れると計算します。</p>';
  const net = mercariNet(price, code);
  const pr = profitOf(net, it.cost);
  const v = verdictOf(pr, price);
  const quick = it.ai && it.ai.quick > 0 && it.ai.quick !== price ? profitOf(mercariNet(it.ai.quick, code), it.cost) : null;
  return `<dl class="calc">
      <div><dt>手元に残る額</dt><dd>${esc(fmtYen(net))}</dd></div>
      <div><dt>仕入れ値</dt><dd>−${esc(fmtYen(it.cost))}</dd></div>
      <div class="total"><dt>利益</dt><dd class="${pr > 0 ? 'plus' : 'minus'}">${esc(fmtYen(pr))}<small>利益率 ${marginOf(pr, price)}%</small></dd></div>
    </dl>
    <p class="verdict v-${v}">${esc(VERDICT[v])}</p>
    ${quick != null ? `<p class="fine">早く売る値段（${esc(fmtYen(it.ai.quick))}）にした場合の利益：${esc(fmtYen(quick))}</p>` : ''}
    <p class="fine">${esc(fmtYen(net))}より安く仕入れられれば、利益が出ます。</p>`;
}

function soldCard(it) {
  return `<section class="card sold">
    <h2 class="sec">売れた記録</h2>
    <div class="grid2">
      <label class="field"><span class="lab">売れた値段</span>
        <span class="yen"><input type="text" inputmode="numeric" data-bind="soldPrice" value="${it.soldPrice || ''}"><span>円</span></span></label>
      <label class="field"><span class="lab">売った場所</span>
        <select data-bind="soldPlatform">${PLATFORMS.map(p => `<option value="${p.id}"${p.id === it.soldPlatform ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    </div>
    <div id="sold-out">${soldHtml(it)}</div>
  </section>`;
}

function soldHtml(it) {
  const net = soldNetOf(it);
  if (net == null) return '<p class="hint">売れた値段を入れると、手取りを記録します。</p>';
  const guide = it.ai && it.ai.mercari;
  const diff = guide ? it.soldPrice - guide : null;
  return `<dl class="calc">
      <div class="total"><dt>手取り</dt><dd>${esc(fmtYen(net))}</dd></div>
      ${it.cost > 0 ? `<div><dt>利益</dt><dd class="${net - it.cost > 0 ? 'plus' : 'minus'}">${esc(fmtYen(net - it.cost))}</dd></div>` : ''}
    </dl>
    ${diff != null ? `<p class="fine">${esc(diff === 0 ? `鑑定の出品目安（${fmtYen(guide)}）どおりの値段で売れました。`
      : `鑑定の出品目安（${fmtYen(guide)}）より${fmtYen(Math.abs(diff))}${diff > 0 ? '高く売れました。' : '安い値段で売れました。'}`)}</p>` : ''}`;
}

function kwOf(it, a) {
  return UI.kw[it.id] || (a.keywords && a.keywords[0]) || a.name || cleanStr((it.memo || '').split('\n')[0]);
}

function keywordHtml(it, a) {
  const cur = kwOf(it, a);
  const cands = [...new Set([...(a.keywords || []), a.name].filter(Boolean))].slice(0, 5);
  return `<label class="field"><span class="lab">検索する言葉</span>
      <input type="text" data-bind="keyword" value="${esc(cur)}" enterkeyhint="search"></label>
    ${cands.length > 1 ? `<div class="chips" id="kw-chips">${cands.map(k => `<button class="chip${k === cur ? ' on' : ''}" data-act="kw" data-v="${esc(k)}">${esc(k)}</button>`).join('')}</div>` : ''}`;
}

function marketsHtml(it, a) {
  const kw = kwOf(it, a);
  const en = a.keywordsEn && a.keywordsEn[0];
  if (!kw) return '<p class="hint">検索する言葉を入れると、リンクができます。</p>';
  return MARKETS.map(m => `<a class="mk" href="${esc(marketUrl(m, m.en && en ? en : kw))}" target="_blank" rel="noopener noreferrer">
      <span class="mk-n">${esc(m.name)}</span><span class="mk-s">${esc(m.sub)}${ICON.ext}</span></a>`).join('');
}

function checksHtml(it) {
  if (!it.checks.length) return '';
  const med = median(it.checks);
  return `<div class="chips">${it.checks.map((v, i) => `<button class="chip x" data-act="delCheck" data-i="${i}" aria-label="${esc(fmtYen(v))}を外す">${esc(fmtYen(v))}<span aria-hidden="true">×</span></button>`).join('')}</div>
    <p class="median">中央値 <strong>${esc(fmtYen(med))}</strong>（${it.checks.length}件）
      <button class="btn link inline" data-act="setPrice" data-v="${med}">この値段で出品する</button></p>`;
}

function cmpHint(price) {
  return price > 0 ? esc(`${fmtYen(price)}で売れた場合に、手元に残る額です。送料は、メルカリ便の料金でそろえて比べています。`) : '出品価格を入れると比べられます。';
}

function compareHtml(price, code, a) {
  if (!(price > 0)) return '';
  const rows = compareAll(price, code);
  const best = Math.max(...rows.map(r => r.net));
  return `<table class="cmp">
    <thead><tr><th>売る場所</th><th>手数料</th><th>手取り</th></tr></thead>
    <tbody>${rows.map(r => `<tr${r.net === best ? ' class="best"' : ''}><th>${esc(r.name)}<small>${esc(r.note)}</small></th><td>−${esc(fmtYen(r.fee))}</td><td>${esc(fmtYen(r.net))}</td></tr>`).join('')}
    ${a && a.buyback ? `<tr><th>買取店<small>送料・手数料なし。すぐ現金になる</small></th><td>—</td><td>${esc(fmtYen(a.buyback))}</td></tr>` : ''}</tbody>
  </table>`;
}

function artHtml(art) {
  const rows = [['作家・窯元・工房', art.maker], ['年代', art.period], ['技法・素材', art.technique], ['産地', art.origin],
    ['銘・落款・刻印', art.marks], ['確かめること', art.check], ['専門家に見せるなら', art.pro]].filter(([, v]) => v);
  return `<section class="card">
    <h2 class="sec">素性の見立て</h2>
    <dl class="facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <p class="fine">写真だけでは、本物かどうか（真贋）は決められません。高額の可能性があるときは、専門の鑑定・買取店で実物を見てもらうのが確実です。</p>
  </section>`;
}

/* 値段・発送方法を変えたとき、入力欄を作り直さずに計算だけ差し替える（入力中のフォーカスを保つため） */
function refreshCalc(it) {
  const a = it.ai || {};
  const price = itemListPrice(it), code = itemShip(it);
  const set = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };
  set('#net-summary', netSummary(price, code));
  set('#calc-mercari', calcRows(price, code));
  set('#profit-out', profitHtml(it));
  set('#cmp', compareHtml(price, code, a));
  set('#cmp-hint', cmpHint(price));
  set('#rbar', rangeBar(a, price));
  set('#presets', presetChips(it, a, price));
  set('#ship-note', shipNote(code, a));
  if (it.status === 'sold') set('#sold-out', soldHtml(it));
}

/* ========== 設定 ========== */

function vSettings() {
  const th = S.settings.theme;
  return `<section class="settings">
    <div class="head-row"><a class="back" href="#/">${ICON.back}もどる</a></div>
    <h1 class="page">設定</h1>

    <section class="card">
      <h2 class="sec">表示</h2>
      <div class="seg" role="group" aria-label="表示の明るさ">${[['auto', '端末に合わせる'], ['light', 'ライト'], ['dark', 'ダーク']].map(([v, l]) =>
        `<button class="${th === v ? 'on' : ''}" data-act="theme" data-v="${v}" aria-pressed="${th === v}">${l}</button>`).join('')}</div>
    </section>

    <section class="card">
      <h2 class="sec">記録の保存</h2>
      <p class="hint">記録と写真は、この端末のブラウザの中にだけ保存されています（いまは${S.items.length}件）。機種変更などに備えて、ときどき書き出しておくと安心です。</p>
      <div class="actions">
        <button class="btn ghost" data-act="export">記録を書き出す</button>
        <label class="btn ghost">記録を読み込む<input type="file" accept="application/json,.json" data-change="import" class="vh"></label>
      </div>
      <button class="btn link danger" data-act="wipe">すべての記録を消す</button>
    </section>

    <section class="card">
      <h2 class="sec">手数料と送料（${esc(FEES_AS_OF)}時点）</h2>
      <table class="cmp plain fees"><tbody>${PLATFORMS.map(p => `<tr><th>${esc(p.name)}</th><td class="l">${esc(p.fee)}</td></tr>`).join('')}</tbody></table>
      ${SHIP_GROUPS.map(g => `<div class="lab">${esc(g.name)}</div>
        <table class="cmp plain"><tbody>${SHIP.filter(s => s.group === g.id).map(s =>
          `<tr><th>${esc(s.name)}<small>${esc(s.spec)}</small></th><td>${esc(fmtYen(s.fee))}${s.material ? `<small>＋資材${esc(fmtYen(s.material))}</small>` : ''}</td></tr>`).join('')}</tbody></table>`).join('')}
      <p class="fine">${esc(SHIP_NOTE)} 料金は変わることがあります。出品の前に、各サービスの画面でご確認ください。メルカリの売上金を振り込むときは、別に振込手数料（200円）がかかります。</p>
    </section>

    <section class="card">
      <h2 class="sec">このアプリについて</h2>
      <p>バージョン ${esc(APP.version)}<span class="dim" id="cache-name"></span></p>
      <button class="btn ghost" data-act="refreshApp">最新版に入れ直す</button>
      <p class="fine">表示がおかしいときに押してください。記録と写真は消えません。</p>
      <p class="fine">このツールは、写真も記録もどこにも送信しません。写真は、あなたが選んだAIアプリにだけ、あなたの操作で渡されます。</p>
    </section>
  </section>`;
}

/* karasui1014.github.io は、ほかのツールと同じオリジン。キャッシュもService Workerも、
   このツールのもの（名前の接頭辞・スコープが一致するもの）だけを見て、だけを消す */
const CACHE_PREFIX = 'kantei-note-';
async function ownCaches() {
  return window.caches ? (await caches.keys()).filter(k => k.startsWith(CACHE_PREFIX)) : [];
}
async function ownRegistrations() {
  if (!('serviceWorker' in navigator)) return [];
  const scope = new URL('./', location.href).href;
  return (await navigator.serviceWorker.getRegistrations()).filter(r => r.scope === scope);
}

function showCacheName() {
  const el = $('#cache-name');
  if (!el) return;
  ownCaches().then(ks => { el.textContent = ks.length ? `・${ks.join(', ')}` : '・キャッシュなし'; }).catch(() => {});
}

function applyTheme() {
  const th = S.settings.theme;
  document.documentElement.dataset.theme = th;
  const dark = th === 'dark' || (th === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $$('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#151412' : '#F4F1EA'));
}

/* ========== ホーム画面に追加 ========== */

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => !/Android/.test(navigator.userAgent) &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
let installPrompt = null;

/* 鑑定を一度やり終えた人にだけ出す。入れた人・断った人には出さない */
function canInstall() {
  if (!S.settings.firstDone || S.settings.installClosed || isStandalone()) return false;
  return !!installPrompt || isIOS();
}

function installCard() {
  if (!canInstall()) return '';
  return `<aside class="card install">
    <div class="lab">${esc(INSTALL.title)}</div>
    <p>${esc(INSTALL.lead)}</p>
    ${isIOS()
      ? `<ol class="steps">${INSTALL.ios.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`
      : `<p class="hint">${esc(INSTALL.other)}</p><button class="btn primary" data-act="install">${esc(INSTALL.cta)}</button>`}
    <button class="btn link" data-act="noInstall">${esc(INSTALL.later)}</button>
  </aside>`;
}

/* ========== 操作 ========== */

const ACT = {
  filter(el) { UI.filter = el.dataset.v; render(); },

  cond(el) {
    const it = curItem(); if (!it) return;
    it.condition = it.condition === el.dataset.v ? '' : el.dataset.v;
    touch(it); render();
  },

  delPhoto(el) {
    const it = curItem(); if (!it) return;
    const id = el.dataset.id;
    it.photos = it.photos.filter(x => x !== id);
    deletePhotos([id]);
    touch(it); render();
  },

  send() {
    const it = curItem(); if (!it) return;
    doSend(it);
  },

  copyPrompt() {
    const it = curItem(); if (!it) return;
    copyText(currentPrompt(it), true).then(() => toast('指示文をコピーしました。AIの入力欄に貼り付けてください'));
    it.sentAt = Date.now();
    touch(it); render();
  },

  async pasteClip() {
    const it = curItem(); if (!it) return;
    const ta = $('textarea[data-input="answer"]');
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      if (ta) ta.focus();
      setPasteMsg('入力欄を長押しして「ペースト」を選んでください。');
      return;
    }
    try {
      applyAnswer(it, await navigator.clipboard.readText());
    } catch (_) {
      if (ta) ta.focus();
      setPasteMsg('入力欄を長押しして「ペースト」を選んでください。');
    }
  },

  manual() { UI.manual = true; render(); const m = $('#manual'); if (m) m.scrollIntoView({ behavior: 'smooth', block: 'center' }); },

  manualSave() {
    const it = curItem(); if (!it) return;
    const m = readManual($('#manual'));
    if ([m.low, m.high, m.typical, m.mercari].every(v => v == null)) {
      toast('相場の下限か上限を入れてください'); return;
    }
    const fresh = normalizeAi({
      name: m.name || (it.memo ? itemName(it) : ''), price_low: m.low, price_high: m.high, price_typical: m.typical,
      mercari_price: m.mercari, buyback: m.buyback, keywords: [m.name].filter(Boolean),
    }, true);
    /* 金額を直すときは、AIの答えにあった金額以外の中身（出品文・根拠など）を残す */
    const base = it.ai ? aiOf(it) : fresh;
    it.ai = fillPrices(Object.assign({}, base, {
      name: fresh.name || base.name,
      low: m.low, high: m.high, typical: m.typical, mercari: m.mercari, quick: null, buyback: m.buyback,
      keywords: base.keywords.length ? base.keywords : fresh.keywords,
      partial: false, manual: !it.ai || !!it.ai.manual,
    }));
    if (it.status === 'waiting') it.status = 'have';
    it.listPrice = 0;
    it.answeredAt = Date.now();
    UI.editing = false; UI.manual = false;
    S.settings.firstDone = true;
    touch(it);
    showResult(it);
  },

  editPrices() { UI.editing = !UI.editing; render(); },

  discard() {
    const it = curItem(); if (!it) return;
    if (!confirm('この鑑定をやめますか？ 選んだ写真も消えます。')) return;
    removeItem(it);
    location.hash = '#/';
  },

  deleteItem() {
    const it = curItem(); if (!it) return;
    if (!confirm('この記録を消しますか？ 写真も消えます。')) return;
    removeItem(it);
    location.hash = '#/';
  },

  status(el) {
    const it = curItem(); if (!it) return;
    const s = el.dataset.v;
    if (s === 'sold' && it.status !== 'sold') {
      if (!(it.soldPrice > 0)) it.soldPrice = itemListPrice(it);
      it.soldAt = Date.now();
    }
    it.status = s;
    touch(it); render();
  },

  setPrice(el) {
    const it = curItem(); if (!it) return;
    it.listPrice = +el.dataset.v || 0;
    touch(it);
    const inp = $('input[data-bind="listPrice"]');
    if (inp) inp.value = it.listPrice || '';
    refreshCalc(it);
  },

  kw(el) {
    const it = curItem(); if (!it) return;
    UI.kw[it.id] = el.dataset.v;
    const inp = $('input[data-bind="keyword"]');
    if (inp) inp.value = el.dataset.v;
    $$('#kw-chips .chip').forEach(c => c.classList.toggle('on', c.dataset.v === el.dataset.v));
    $('#markets').innerHTML = marketsHtml(it, it.ai || {});
  },

  addCheck() {
    const it = curItem(); if (!it) return;
    const inp = $('#check-in');
    const vals = yenValues(inp ? inp.value : '').filter(v => v > 0);
    if (!vals.length) { toast('見つけた値段を入れてください'); return; }
    it.checks = [...it.checks, ...vals].slice(-30);
    inp.value = '';
    touch(it);
    $('#checks-out').innerHTML = checksHtml(it);
    refreshCalc(it);
    inp.focus();
  },

  delCheck(el) {
    const it = curItem(); if (!it) return;
    it.checks.splice(+el.dataset.i, 1);
    touch(it);
    $('#checks-out').innerHTML = checksHtml(it);
    refreshCalc(it);
  },

  copy(el) {
    const it = curItem(); if (!it || !it.ai) return;
    copyText(el.dataset.what === 'title' ? it.ai.title : it.ai.description);
  },

  copySummary() {
    const it = curItem(); if (!it) return;
    copyText(summaryText(it));
  },

  zoom(el) { openZoom(el.dataset.id); },

  theme(el) { S.settings.theme = el.dataset.v; save(); applyTheme(); render(); },

  async export() {
    try {
      const json = await exportData(S);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const d = new Date();
      const a = document.createElement('a');
      a.href = url;
      a.download = `kantei-note-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('記録を書き出しました');
    } catch (_) {
      toast('書き出せませんでした');
    }
  },

  async wipe() {
    if (!confirm('すべての記録と写真を消します。元に戻せません。よろしいですか？')) return;
    S.items = [];
    UI.draft = null;
    await PhotoDB.clear().catch(() => {});
    PhotoURL.forEach(u => URL.revokeObjectURL(u));
    PhotoURL.clear();
    save(); render();
    toast('すべての記録を消しました');
  },

  async refreshApp() {
    try {
      for (const r of await ownRegistrations()) await r.unregister();
      for (const k of await ownCaches()) await caches.delete(k);
    } catch (_) { /* そのまま読み込み直す */ }
    location.reload();
  },

  async install() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    render();
  },

  noInstall() { S.settings.installClosed = true; save(); render(); },

  closeZoom() { const z = $('#zoom'); if (z) z.remove(); },
};

function removeItem(it) {
  deletePhotos(it.photos);
  S.items = S.items.filter(x => x.id !== it.id);
  if (UI.draft && UI.draft.id === it.id) UI.draft = null;
  save();
}

async function openZoom(id) {
  const url = await photoUrl(id, 'full');
  if (!url) return;
  const z = document.createElement('div');
  z.id = 'zoom';
  z.className = 'zoom';
  z.dataset.act = 'closeZoom';
  z.innerHTML = `<img src="${esc(url)}" alt=""><button class="zoom-x" data-act="closeZoom" aria-label="閉じる">×</button>`;
  document.body.appendChild(z);
}

/* 入力欄の変更。フォーカスを保つため、画面全体は作り直さない */
const BIND = {
  memo(it, v) { it.memo = v; touch(it, true); refreshAsk(it); },
  cost(it, v) {
    it.cost = yenOf(v) || 0; touch(it, true);
    if ($('#profit-out')) {
      $('#profit-out').innerHTML = profitHtml(it);
      if ($('#sold-out')) $('#sold-out').innerHTML = soldHtml(it);
    } else {
      refreshAsk(it);
    }
  },
  listPrice(it, v) { it.listPrice = yenOf(v) || 0; touch(it, true); refreshCalc(it); },
  ship(it, v) { it.ship = SHIP_MAP[v] ? v : ''; touch(it); refreshCalc(it); },
  soldPrice(it, v) { it.soldPrice = yenOf(v) || 0; touch(it, true); $('#sold-out').innerHTML = soldHtml(it); },
  soldPlatform(it, v) { it.soldPlatform = PLATFORM_MAP[v] ? v : 'mercari'; touch(it); $('#sold-out').innerHTML = soldHtml(it); },
  note(it, v) { it.note = v; touch(it, true); },
  keyword(it, v) {
    UI.kw[it.id] = cleanStr(v);
    $$('#kw-chips .chip').forEach(c => c.classList.toggle('on', c.dataset.v === UI.kw[it.id]));
    $('#markets').innerHTML = marketsHtml(it, it.ai || {});
  },
};

/* 鑑定する画面で文字を打ったとき、「送れるかどうか」と指示文の見本だけを差し替える */
function refreshAsk(it) {
  const hasInput = it.photos.length > 0 || cleanStr(it.memo) !== '';
  $$('[data-act="send"], [data-act="copyPrompt"]').forEach(b => { b.disabled = !hasInput; });
  const need = $('#need');
  if (need) need.hidden = hasInput;
  const pre = $('#prompt-pre');
  if (pre) pre.textContent = currentPrompt(it);
}

async function addPhotos(input) {
  const it = curItem(); if (!it) return;
  const room = APP.maxPhotos - it.photos.length;
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length) return;
  if (files.length > room) toast(`写真は${APP.maxPhotos}枚までです。先頭の${room}枚を使います`);
  ensureSaved(it);
  UI.busy = true; render();
  let failed = 0;
  for (const f of files.slice(0, room)) {
    try { it.photos.push(await makePhoto(f)); } catch (_) { failed++; }
  }
  UI.busy = false;
  touch(it);
  render();
  if (failed) toast('読み込めない写真がありました。JPEGやPNGの写真でお試しください');
}

async function importFile(input) {
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return;
  try {
    const n = await importData(await f.text(), S);
    save(); render();
    toast(`${n}件の記録を読み込みました`);
  } catch (_) {
    toast('読み込めませんでした。このアプリで書き出したファイルを選んでください');
  }
}

/* ========== イベント ========== */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'BUTTON' || el.classList.contains('zoom')) e.preventDefault();
  fn(el, e);
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.tagName === 'SELECT') return;   /* select は change で受ける（二重に走らせない） */
  if (el.dataset.bind && BIND[el.dataset.bind]) {
    const it = curItem();
    if (it) BIND[el.dataset.bind](it, el.value);
  } else if (el.dataset.input === 'answer') {
    clearTimeout(ACT.t);
    ACT.t = setTimeout(() => {
      const it = curItem();
      if (it && el.value.trim().length > 10) applyAnswer(it, el.value);
    }, 350);
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.change === 'addPhotos') addPhotos(el);
  else if (el.dataset.change === 'import') importFile(el);
  else if (el.tagName === 'SELECT' && el.dataset.bind && BIND[el.dataset.bind]) {
    const it = curItem();
    if (it) BIND[el.dataset.bind](it, el.value);
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'check-in') { e.preventDefault(); ACT.addCheck(); }
  if (e.key === 'Escape') ACT.closeZoom();
});

/* AIアプリへ切り替えるときは保存を済ませておき、戻ってきたら貼り付けの場所を見せる */
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { flushSave(); return; }
  const it = curItem();
  if (it && awaitingAnswer(it) && Date.now() - it.sentAt < 3 * 3600e3) {
    const el = $('#st-paste');
    if (el) { el.classList.add('ready'); el.scrollIntoView({ block: 'start' }); }
  }
});

window.addEventListener('hashchange', render);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; render(); });
window.addEventListener('appinstalled', () => { installPrompt = null; render(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.settings.theme === 'auto') applyTheme(); });
/* 別のタブで記録が変わったら読み直す */
window.addEventListener('storage', e => { if (e.key === APP.storeKey) { S = loadState(); render(); } });

/* ========== 起動 ========== */

applyTheme();
render();

/* ローカル開発中はSWを登録しない（古いキャッシュが配信される事故を防ぐため） */
const isLocal = ['localhost', '127.0.0.1', ''].includes(location.hostname);
if ('serviceWorker' in navigator) {
  if (isLocal) {
    ownRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    ownCaches().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {});
  } else {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').then(r => r.update().catch(() => {})).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
  }
}
