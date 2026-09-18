/* AI鑑定ノート - 計算と読み取り
   画面に依存しない部分だけを置く。tests/run.js がここの関数を直接呼ぶので、DOMには触らないこと */

'use strict';

const SHIP_MAP = Object.fromEntries(SHIP.map(s => [s.code, s]));
const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map(p => [p.id, p]));
const TEMPLATE_OBJ = JSON.parse(PROMPT_JSON);
const KNOWN_KEYS = Object.keys(TEMPLATE_OBJ).filter(k => k !== 'kantei');

/* ========== 文字の整え ========== */

/* 全角の英数字・記号を半角に（金額やコードの読み取り用。日本語の本文には使わない） */
function toHalf(s) {
  return String(s ?? '')
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ');
}

/* AIが「わからない」の意味で書きがちな言葉。空欄として扱う */
const EMPTY_WORDS = ['null', 'none', 'nil', 'undefined', 'n/a', 'na', 'なし', '無し', '不明', 'わからない', '特になし', '-', '—', '–', 'ー', '－'];

function cleanStr(v, keepLines) {
  if (v == null || typeof v === 'object' && !Array.isArray(v)) return '';
  if (Array.isArray(v)) v = v.map(x => cleanStr(x)).filter(Boolean).join('、');
  let s = String(v).replace(/\r\n?/g, '\n');
  s = keepLines
    ? s.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim()
    : s.replace(/\s+/g, ' ').trim();
  return EMPTY_WORDS.includes(s.toLowerCase()) ? '' : s;
}

/* 配列でも、改行区切りの文字列でも受け取る */
function strList(v, max = 12) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : String(v).split(/\n|；|;/);
  return arr
    .map(x => cleanStr(typeof x === 'string' ? x.replace(/^\s*(?:[-*•・]|\d+[.)．])\s*/, '') : x))
    .filter(Boolean)
    .slice(0, max);
}

/* ========== 金額 ========== */

/* 文字列から金額をすべて拾う。「1万2000」「1.2万」「3千」「4,500円」「3000〜5000」に対応 */
function yenValues(v) {
  if (v == null || typeof v === 'boolean') return [];
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? [Math.round(v)] : [];
  if (Array.isArray(v)) return v.flatMap(yenValues);
  if (typeof v === 'object') return [];
  /* 桁区切りのカンマ（4,500）だけを消す。空白や「、」は、いくつかの金額の区切りとして残す */
  let s = toHalf(v), prev;
  do { prev = s; s = s.replace(/(\d)[,，](\d{3})(?!\d)/g, '$1$2'); } while (s !== prev);
  s = s.replace(/[,，、]/g, ' ')
    .replace(/(\d)\s+(?=[万千])/g, '$1')
    .replace(/(\d+(?:\.\d+)?)万(\d+(?:\.\d+)?)千/g, (_, a, b) => ` ${+a * 10000 + +b * 1000} `)
    .replace(/(\d+(?:\.\d+)?)万(\d{1,4})(?![\d.千])/g, (_, a, b) => ` ${+a * 10000 + +b} `)
    .replace(/(\d+(?:\.\d+)?)万/g, (_, a) => ` ${+a * 10000} `)
    .replace(/(\d+(?:\.\d+)?)千/g, (_, a) => ` ${+a * 1000} `);
  return (s.match(/\d+(?:\.\d+)?/g) || [])
    .map(Number)
    .filter(n => Number.isFinite(n) && n >= 0 && n <= 1e9)
    .map(Math.round);
}

/* 1つの金額にする。範囲が書かれていたら pick で選ぶ（first / last / mid） */
function yenOf(v, pick = 'first') {
  const a = yenValues(v);
  if (!a.length) return null;
  if (pick === 'last') return a[a.length - 1];
  if (pick === 'mid' && a.length >= 2) return niceYen((a[0] + a[a.length - 1]) / 2);
  return a[0];
}

/* 計算で出した金額を、値札らしい単位に丸める */
function niceYen(v) {
  if (!Number.isFinite(v)) return null;
  const u = v < 10000 ? 10 : v < 100000 ? 100 : 1000;
  return Math.round(v / u) * u;
}

function median(nums) {
  const a = (nums || []).filter(n => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

/* ========== 手数料・送料・利益 ========== */

/* 手数料は1円未満切り捨て。bp は1万分率（1000 = 10%）。整数で計算して小数の誤差を避ける */
function feeOf(price, bp) {
  return Math.floor(Math.max(0, Math.round(price || 0)) * bp / 10000);
}
function shipCost(code) {
  const s = SHIP_MAP[code];
  return s ? s.fee + s.material : 0;
}
function netOf(price, bp, code) {
  return Math.round(price || 0) - feeOf(price, bp) - shipCost(code);
}
function mercariNet(price, code) {
  return netOf(price, PLATFORM_MAP.mercari.bp, code);
}
/* 同じ値段で売れたとき、場所ごとに手元に残る額 */
function compareAll(price, code) {
  return PLATFORMS.map(p => ({ id: p.id, name: p.name, note: p.fee, fee: feeOf(price, p.bp), ship: shipCost(code), net: netOf(price, p.bp, code) }));
}
function profitOf(net, cost) { return net - (cost || 0); }
function marginOf(profit, price) { return price > 0 ? Math.round(profit / price * 100) : 0; }
function verdictOf(profit, price) {
  if (profit <= 0) return 'under';
  if (profit >= 500 && profit / price >= 0.2) return 'good';
  return 'thin';
}

/* ========== AIの答えの項目を整える ========== */

function levelOf(v) {
  const s = toHalf(cleanStr(v)).toLowerCase();
  if (!s) return '';
  if (/high|高|◎|確実|かなり/.test(s)) return 'high';
  if (/medium|mid|中|普通|ふつう|○|〇|まあまあ|おおむね/.test(s)) return 'medium';
  if (/low|低|△|×|参考/.test(s)) return 'low';
  return '';
}

function boolOf(v) {
  if (v === true || v === false) return v;
  const s = toHalf(cleanStr(v)).toLowerCase();
  if (!s) return null;
  if (/^(true|yes|y|はい|済|した|確認済)/.test(s)) return true;
  if (/^(false|no|n|いいえ|していない|未確認|推定)/.test(s)) return false;
  return null;
}

/* 長い言葉から先に照合する（「未使用に近い」を「未使用」と取り違えないため） */
const COND_MATCH = [
  ['未使用に近い', '未使用に近い'], ['新品', '新品、未使用'], ['未使用', '新品、未使用'],
  ['目立った傷や汚れなし', '目立った傷や汚れなし'], ['やや傷や汚れあり', 'やや傷や汚れあり'],
  ['全体的に状態が悪い', '全体的に状態が悪い'], ['傷や汚れあり', '傷や汚れあり'],
];
function condOf(v) {
  const s = cleanStr(v);
  if (!s) return '';
  /* 選択肢を並べたまま返ってきたときは、選ばれていない扱い */
  if (CONDITIONS.filter(c => s.includes(c)).length >= 3) return '';
  for (const [k, c] of COND_MATCH) if (s.includes(k)) return c;
  return '';
}

const SHIP_NAME_MATCH = [
  ['ゆうパケットポストmini', 'mini'], ['ポストmini', 'mini'], ['ゆうパケットポスト', 'post'],
  ['ゆうパケットプラス', 'plus'], ['ゆうパケット', 'packet'], ['ネコポス', 'neko'],
  ['宅急便コンパクト', 'compact'], ['コンパクト', 'compact'],
];
const BOX_SIZES = [60, 80, 100, 120, 140, 160, 170, 180, 200];
const LARGE_SIZES = [80, 120, 160, 200, 250, 300, 350, 400, 450];
function shipCodeOf(v) {
  let s = toHalf(cleanStr(v)).toLowerCase().replace(/\s+/g, '');
  if (!s) return '';
  if (SHIP_MAP[s]) return s;
  s = s.replace(/サイズ|size/g, '');
  if (SHIP_MAP[s]) return s;
  for (const [k, c] of SHIP_NAME_MATCH) if (s.includes(k.toLowerCase())) return c;
  const n = (s.match(/\d+/) || [])[0];
  if (!n) return '';
  const num = +n;
  const large = /たのメル|大型|^t/.test(s) || num > 200;
  const hit = (large ? LARGE_SIZES : BOX_SIZES).find(x => x >= num);
  if (hit) return (large ? 't' : '') + hit;
  return large ? 't450' : '';
}

function artOf(o) {
  const src = o.art && typeof o.art === 'object' ? o.art
    : o.provenance && typeof o.provenance === 'object' ? o.provenance : null;
  const pick = k => cleanStr(o['art_' + k]) || (src ? cleanStr(src[k]) : '');
  const a = {
    maker: pick('maker'), period: pick('period'), technique: pick('technique'), origin: pick('origin'),
    marks: pick('marks'), check: pick('check'), pro: pick('pro'),
  };
  return Object.values(a).some(Boolean) ? a : null;
}

/* 金額のすき間を埋める。AIが一部しか書かなかったときも、画面が成り立つように */
function fillPrices(ai) {
  if (ai.low != null && ai.high != null && ai.low > ai.high) [ai.low, ai.high] = [ai.high, ai.low];
  if (ai.typical == null && ai.low != null && ai.high != null) ai.typical = niceYen((ai.low + ai.high) / 2);
  if (ai.typical == null) ai.typical = ai.mercari ?? ai.low ?? ai.high ?? null;
  if (ai.low == null) ai.low = ai.typical;
  if (ai.high == null) ai.high = ai.typical;
  if (ai.mercari == null) ai.mercari = ai.typical;
  if (ai.quick == null && ai.mercari != null) ai.quick = Math.max(MERCARI_MIN, niceYen(ai.mercari * 0.85));
  return ai;
}

function normalizeAi(o, partial = false) {
  const lowVals = yenValues(o.price_low);
  const ai = {
    name: cleanStr(o.name) || cleanStr(o.title).slice(0, 40),
    category: cleanStr(o.category),
    brand: cleanStr(o.brand),
    model: cleanStr(o.model),
    era: cleanStr(o.era),
    features: strList(o.features),
    confidence: levelOf(o.confidence),
    unsure: cleanStr(o.unsure),
    alternatives: strList(o.alternatives, 5),
    condition: condOf(o.condition),
    conditionNote: cleanStr(o.condition_note),
    priceNew: yenOf(o.price_new, 'mid'),
    low: lowVals.length ? lowVals[0] : null,
    high: yenOf(o.price_high, 'last') ?? (lowVals.length >= 2 ? lowVals[lowVals.length - 1] : null),
    typical: yenOf(o.price_typical, 'mid'),
    mercari: yenOf(o.mercari_price, 'mid'),
    quick: yenOf(o.mercari_quick, 'mid'),
    buyback: yenOf(o.buyback, 'mid'),
    evidence: strList(o.evidence, 8),
    searched: boolOf(o.searched),
    sellSpeed: levelOf(o.sell_speed),
    sellNote: cleanStr(o.sell_note),
    buyNote: cleanStr(o.buy_note),
    ship: shipCodeOf(o.ship),
    sizeCm: cleanStr(o.size_cm),
    weightKg: cleanStr(o.weight_kg),
    keywords: strList(o.keywords, 6),
    keywordsEn: strList(o.keywords_en, 4),
    title: cleanStr(o.title),
    description: cleanStr(o.description, true),
    tips: strList(o.tips, 8),
    cautions: strList(o.cautions, 8),
    art: artOf(o),
    partial: !!partial,
  };
  return fillPrices(ai);
}

/* ========== AIの答えを読み取る ========== */

/* 文字列の外側だけに fn をかける（文字列の中身は壊さない） */
function mapOutsideStrings(s, fn) {
  let out = '', last = 0, m;
  const re = /"(?:[^"\\]|\\.)*"/g;
  while ((m = re.exec(s))) { out += fn(s.slice(last, m.index)) + m[0]; last = re.lastIndex; }
  return out + fn(s.slice(last));
}

/* AIが書いた「ほぼJSON」を、読める形に直す
   - 文字列の中の生の改行・タブ、囲みの中の " を逃がす
   - 閉じ忘れたカンマ（改行をはさんで次のキーが始まる）を補う
   - // や /* *\/ のコメント、末尾のカンマ、3,000 のような桁区切り、「円」を取り除く */
function repairJson(src) {
  const s = String(src)
    .replace(/^﻿/, '')
    .replace(/[​-‍⁠]/g, '')
    .replace(/[“”„‟″＂]/g, '"');
  let out = '', inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') { out += c + (s[i + 1] ?? ''); i++; continue; }
      if (c === '"') {
        let j = i + 1, nl = false;
        while (j < s.length && /\s/.test(s[j])) { if (s[j] === '\n') nl = true; j++; }
        const nx = s[j];
        if (nx === undefined || ',}]:'.includes(nx)) { inStr = false; out += c; continue; }
        if (nl && nx === '"') { inStr = false; out += '",'; continue; }
        out += '\\"';
        continue;
      }
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') continue;
      if (c === '\t') { out += '\\t'; continue; }
      out += c;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 1; continue; }
    out += c;
  }
  return mapOutsideStrings(out, seg => {
    let t = seg
      .replace(/[：]/g, ':').replace(/[，、]/g, ',')
      .replace(/[｛]/g, '{').replace(/[｝]/g, '}').replace(/[［]/g, '[').replace(/[］]/g, ']')
      .replace(/\bNone\b|\bundefined\b|\bNaN\b/g, 'null').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false')
      .replace(/(\d)\s*円/g, '$1')
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    let prev;
    do { prev = t; t = t.replace(/(\d),(\d{3})(?!\d)/g, '$1$2'); } while (t !== prev);
    return t.replace(/,(\s*[}\]])/g, '$1');
  });
}

function tryParseJson(c) {
  const src = String(c || '');
  const a = src.indexOf('{'), b = src.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  const body = src.slice(a, b + 1);
  for (const s of [body, repairJson(body)]) {
    try { const o = JSON.parse(s); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch (_) { /* 次の方法へ */ }
  }
  return null;
}

/* コードブロックの中身、文中の { … } のかたまり、文章全体を、候補として全部拾う。
   文字列の中の " が逃がされていないと { } の対応が数えられないことがあるので、
   最後に文章全体（最初の { から最後の } まで）も候補に入れておく */
function jsonCandidates(t) {
  const out = [];
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(t))) out.push(m[1]);
  let depth = 0, start = -1, inStr = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}' && depth > 0) { depth--; if (depth === 0) out.push(t.slice(start, i + 1)); }
  }
  out.push(t);
  return out;
}

/* {"result": {…}} のように、1段包まれて返ってきたときは中身を使う */
function unwrap(o) {
  if (scoreObj(o) >= 2) return o;
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && scoreObj(v) >= 2) return v;
  }
  return o;
}

function scoreObj(o) {
  if (!o || typeof o !== 'object') return 0;
  return KNOWN_KEYS.filter(k => o[k] != null && o[k] !== '').length;
}

/* 指示文に入れたひな形のままの項目が多ければ、答えではなく指示文を貼っている */
function isTemplate(o) {
  if (!o) return false;
  return KNOWN_KEYS.filter(k => JSON.stringify(o[k]) === JSON.stringify(TEMPLATE_OBJ[k])).length >= 3;
}

function unescapeJsonStr(s) {
  try { return JSON.parse('"' + s + '"'); }
  catch (_) { return s.replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
}

/* JSONとして読めなかったときの予備。キーごとに拾う（後ろにあるほうを採用＝指示文より答えを優先） */
function regexExtract(text) {
  const t = String(text).replace(/[“”]/g, '"');
  const o = {};
  for (const k of KNOWN_KEYS) {
    const re = new RegExp(`"${k}"\\s*[:：]\\s*(\\[[\\s\\S]*?\\]|"(?:[^"\\\\\\n]|\\\\.)*"|[^,\\n}]+)`, 'g');
    const all = [...t.matchAll(re)];
    if (!all.length) continue;
    const raw = all[all.length - 1][1].trim();
    if (raw.startsWith('[')) o[k] = [...raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(x => unescapeJsonStr(x[1]));
    else if (raw.startsWith('"')) o[k] = unescapeJsonStr(raw.slice(1, -1));
    else o[k] = raw.replace(/[,\s]+$/, '');
  }
  return o;
}

/* JSONが無く、文章だけのときの予備。相場・出品価格・買取・品名を拾う */
function proseExtract(text) {
  const lines = toHalf(text).split('\n');
  const grab = re => { for (const l of lines) { const m = l.match(re); if (m) return m[1]; } return null; };
  const o = {};
  const range = grab(/相場[^0-9\n]{0,15}([0-9][0-9,.万千円〜~\-ー－ ]*[0-9万千])/);
  if (range) {
    const v = yenValues(range);
    if (v.length) { o.price_low = v[0]; o.price_high = v[v.length - 1]; }
  }
  const list = grab(/出品(?:価格)?[^0-9\n]{0,15}([0-9][0-9,.万千]*)/);
  if (list) o.mercari_price = list;
  const buy = grab(/買取[^0-9\n]{0,15}([0-9][0-9,.万千]*)/);
  if (buy) o.buyback = buy;
  const name = grab(/(?:品名|商品名)\s*[:：]\s*(.+)/);
  if (name) o.name = name.replace(/^[\s*「【]+|[」】*\s]+$/g, '');
  return (o.price_low != null || o.mercari_price != null) ? o : null;
}

/* 貼り付けられた文章を読む。
   kind: ok（読めた）/ prompt（指示文のほうを貼った）/ none（見つからない）/ empty（空） */
function parseAnswer(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n').slice(0, 300000);
  if (!t.trim()) return { kind: 'empty' };
  let best = null, bestScore = 0;
  for (const c of jsonCandidates(t)) {
    const parsed = tryParseJson(c);
    if (!parsed) continue;
    const o = unwrap(parsed);
    if (isTemplate(o)) continue;
    const s = scoreObj(o);
    if (s >= 2 && s >= bestScore) { best = o; bestScore = s; }
  }
  if (best) return { kind: 'ok', ai: normalizeAi(best, false) };
  const rx = regexExtract(t);
  if (scoreObj(rx) >= 2 && !isTemplate(rx)) return { kind: 'ok', ai: normalizeAi(rx, true) };
  if (PROMPT_MARKS.every(m => t.includes(m))) return { kind: 'prompt' };
  const pr = proseExtract(t);
  if (pr) return { kind: 'ok', ai: normalizeAi(pr, true) };
  return { kind: 'none' };
}

/* ========== AIへの指示文 ========== */

function dateJa(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}年${x.getMonth() + 1}月${x.getDate()}日`;
}

/* input: { memo, condition, cost, photoCount } */
function buildPrompt(input, date) {
  const n = input.photoCount | 0;
  const photos = n > 0 ? `写真を${n}枚添付しています。` : '写真はありません。「わかっていること」から鑑定してください。';
  const known = [];
  const memo = cleanStr(input.memo, true);
  if (memo) known.push(memo);
  if (input.condition) known.push(`・持ち主が見た状態：${input.condition}`);
  if (input.cost > 0) known.push(`・仕入れ値：${fmtNum(input.cost)}円（買うかどうか検討中です。仕入れとしての見立てを buy_note に書いてください）`);
  return PROMPT_TEMPLATE
    .replace('{{PHOTOS}}', () => photos)
    .replace('{{DATE}}', () => dateJa(date || new Date()))
    .replace('{{KNOWN}}', () => known.length ? known.join('\n') : '特になし（写真から判断してください）')
    .replace('{{SHIP_CODES}}', () => PROMPT_SHIP_CODES)
    .replace('{{JSON}}', () => PROMPT_JSON);
}

/* ========== 相場を確かめるリンク ========== */

function marketUrl(m, keyword) {
  let k = cleanStr(keyword);
  if (m.path) k = k.replace(/[/?#%\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return m.url(encodeURIComponent(k));
}

/* ========== 記録の集計 ========== */

function itemValue(it) {
  const a = it && it.ai;
  return a ? (a.typical ?? a.mercari ?? 0) : 0;
}
function itemListPrice(it) {
  if (it.listPrice > 0) return it.listPrice;
  const a = it.ai || {};
  return a.mercari ?? a.typical ?? 0;
}
function itemShip(it) {
  return (it.ship && SHIP_MAP[it.ship]) ? it.ship : (it.ai && SHIP_MAP[it.ai.ship]) ? it.ai.ship : SHIP_DEFAULT;
}
/* 売れた記録の手取り */
function soldNetOf(it) {
  if (!(it.soldPrice > 0)) return null;
  const p = PLATFORM_MAP[it.soldPlatform] || PLATFORM_MAP.mercari;
  const code = it.soldShip && SHIP_MAP[it.soldShip] ? it.soldShip : itemShip(it);
  return netOf(it.soldPrice, p.bp, code);
}

function totals(items) {
  const r = { haveCount: 0, haveValue: 0, listedCount: 0, soldCount: 0, soldNet: 0, soldProfit: 0, profitCount: 0, waitingCount: 0 };
  for (const it of items || []) {
    if (it.status === 'waiting') { r.waitingCount++; continue; }
    if (it.status === 'have' || it.status === 'listed') {
      r.haveCount++;
      r.haveValue += itemValue(it);
      if (it.status === 'listed') r.listedCount++;
    }
    if (it.status === 'sold') {
      r.soldCount++;
      const net = soldNetOf(it);
      if (net != null) {
        r.soldNet += net;
        if (it.cost > 0) { r.soldProfit += net - it.cost; r.profitCount++; }
      }
    }
  }
  return r;
}

/* ========== 表示用 ========== */

function fmtNum(n) { return Math.round(n).toLocaleString('ja-JP'); }
function fmtYen(n) { return n == null || !Number.isFinite(n) ? '—' : `${fmtNum(n)}円`; }
function fmtRange(lo, hi) {
  if (lo == null && hi == null) return '—';
  if (lo == null || hi == null || lo === hi) return fmtYen(lo ?? hi);
  return `${fmtNum(lo)}〜${fmtNum(hi)}円`;
}
function shipLabel(code) {
  const s = SHIP_MAP[code];
  if (!s) return '';
  return `${s.name}　${fmtYen(s.fee + s.material)}`;
}

/* 結果をまとめた文章（コピーしてLINEなどに送る用） */
function summaryText(it) {
  const a = it.ai || {};
  const price = itemListPrice(it);
  const code = itemShip(it);
  const lines = [`【${APP.name}】${a.name || cleanStr(it.memo).slice(0, 30) || '鑑定した品物'}`];
  lines.push(`相場：${fmtRange(a.low, a.high)}（多いのは${fmtYen(a.typical)}）`);
  if (price > 0) lines.push(`メルカリ：${fmtYen(price)}で出品 → 手元に残る額 ${fmtYen(mercariNet(price, code))}（${SHIP_MAP[code].name}）`);
  if (it.cost > 0 && price > 0) {
    const pr = profitOf(mercariNet(price, code), it.cost);
    lines.push(`仕入れ ${fmtYen(it.cost)} → 利益 ${fmtYen(pr)}`);
  }
  if (a.buyback) lines.push(`買取の目安：${fmtYen(a.buyback)}`);
  return lines.join('\n');
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
