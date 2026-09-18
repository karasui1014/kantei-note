/* AI鑑定ノート テスト
   実行: node tests/run.js   （プロジェクト直下から）
   文言や料金、読み取りを直したら、必ず走らせること */

'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ---------- ブラウザの最小スタブ ---------- */
function makeEl() {
  return {
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, hidden: false, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, focus() {}, click() {},
    setAttribute() {}, removeAttribute() {}, scrollIntoView() {}, closest() { return null; }, select() {},
  };
}
const els = {};
const store = {};
const ctx = {
  console, Date, Math, JSON, Map, Set, Promise, Blob: function () {}, File: function () {},
  setTimeout: () => 0, clearTimeout() {},
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  document: {
    documentElement: { dataset: {} },
    querySelector: sel => (els[sel] = els[sel] || makeEl()),
    querySelectorAll: () => [],
    addEventListener() {}, createElement: makeEl, body: makeEl(),
  },
  navigator: { userAgent: 'node', platform: 'node', maxTouchPoints: 0 },
  location: { hash: '', hostname: 'localhost', replace(h) { this.hash = h; }, reload() {} },
  history: { replaceState(_, __, h) { ctx.location.hash = h; } },
  addEventListener() {}, scrollTo() {}, confirm: () => true, indexedDB: undefined,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
const FILES = ['assets/data.js', 'assets/core.js', 'assets/store.js', 'assets/app.js'];
vm.runInContext(FILES.map(read).join('\n;\n') + `
;globalThis.API = { APP, SHIP, SHIP_MAP, PLATFORMS, MARKETS, CONDITIONS, STATUS, PROMPT_JSON, PROMPT_TEMPLATE, PROMPT_MARKS,
  toHalf, cleanStr, strList, yenValues, yenOf, niceYen, median, feeOf, shipCost, netOf, mercariNet, compareAll,
  profitOf, marginOf, verdictOf, levelOf, boolOf, condOf, shipCodeOf, normalizeAi, fillPrices, repairJson, parseAnswer,
  buildPrompt, marketUrl, totals, itemListPrice, itemShip, soldNetOf, summaryText, fmtYen, fmtRange, dateJa, isTemplate,
  cleanState, cleanItem, newItem, saveState, ACT, BIND, render, vHome, vResult, vAsk, vSettings, vHelp, aiOf,
  getS: () => S, setS: v => { S = v; } };`, ctx, { filename: 'bundle.js' });
const A = ctx.API;

/* ---------- 極小テストランナー ---------- */
let pass = 0, fail = 0;
const fails = [];
const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
function group(name) { console.log(`\n${C.b}${name}${C.x}`); }
function t(name, fn) {
  try {
    const msg = fn();
    pass++;
    console.log(`  ${C.g}PASS${C.x} ${name}${msg ? C.d + '  ' + msg + C.x : ''}`);
  } catch (e) {
    fail++;
    fails.push(name);
    console.log(`  ${C.r}FAIL${C.x} ${name}\n       ${C.r}${e.message}${C.x}`);
  }
}
const eq = (a, b, m) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} 期待:${JSON.stringify(b)} 実際:${JSON.stringify(a)}`);
};
const ok = (c, m) => { if (!c) throw new Error(m || '条件が満たされていません'); };
const parse = s => A.parseAnswer(s);

/* ---------- AIの答えの見本 ---------- */
const GOOD = `ルンバ643（iRobot）と思われます。中古相場は4,000〜7,000円ほど、メルカリなら5,500円前後の出品が目安です。

\`\`\`json
{
  "kantei": 1,
  "name": "iRobot ルンバ 643",
  "category": "家電",
  "brand": "iRobot",
  "model": "R643060",
  "era": "2017年ごろ",
  "features": ["天面のCLEANボタン", "底面の型番ラベル"],
  "confidence": "high",
  "unsure": null,
  "alternatives": ["ルンバ 641"],
  "condition": "目立った傷や汚れなし",
  "condition_note": "天面に小傷。充電台あり",
  "price_new": 39800,
  "price_low": 4000,
  "price_high": 7000,
  "price_typical": 5500,
  "mercari_price": 5800,
  "mercari_quick": 4800,
  "buyback": 1500,
  "evidence": ["メルカリ売り切れ12件 4000〜7500円", "Yahoo!オークション落札 3800〜6500円"],
  "searched": true,
  "sell_speed": "high",
  "sell_note": "型落ちでも需要がある",
  "buy_note": null,
  "ship": "120",
  "size_cm": "40×40×15",
  "weight_kg": "4",
  "keywords": ["ルンバ 643", "ルンバ 600シリーズ"],
  "keywords_en": ["Roomba 643"],
  "title": "iRobot ルンバ643 ロボット掃除機 充電台付き 動作確認済み",
  "description": "iRobotのルンバ643です。\\n動作確認済み。",
  "tips": ["フィルターを新品にする"],
  "cautions": ["バッテリーの劣化を書いておく"],
  "art_maker": null, "art_period": null, "art_technique": null, "art_origin": null,
  "art_marks": null, "art_check": null, "art_pro": null
}
\`\`\``;

/* ================================================================ */
group('金額の読み取り');
t('ふつうの数字', () => eq(A.yenValues('4500'), [4500]));
t('カンマと円', () => eq(A.yenValues('12,000円'), [12000]));
t('¥つき', () => eq(A.yenValues('¥12,000'), [12000]));
t('全角数字', () => eq(A.yenValues('約３,０００円'), [3000]));
t('1万2000', () => eq(A.yenValues('1万2000円'), [12000]));
t('1.2万', () => eq(A.yenValues('1.2万円'), [12000]));
t('1万2千', () => eq(A.yenValues('1万2千円'), [12000]));
t('3千', () => eq(A.yenValues('3千円'), [3000]));
t('範囲（〜）', () => eq(A.yenValues('3000〜5000円'), [3000, 5000]));
t('範囲（-）', () => eq(A.yenValues('4500-6000'), [4500, 6000]));
t('範囲（万）', () => eq(A.yenValues('1.2万〜1.5万円'), [12000, 15000]));
t('数値そのまま', () => eq(A.yenValues(4500.4), [4500]));
t('いくつかの金額を空白・読点で区切って入れる', () => eq(A.yenValues('5,200　4800、6100円'), [5200, 4800, 6100]));
t('空白区切り', () => eq(A.yenValues('3000 5000'), [3000, 5000]));
t('百万の桁区切り', () => eq(A.yenValues('1,234,567円'), [1234567]));
t('カンマ＋空白で区切った金額', () => eq(A.yenValues('300, 400'), [300, 400]));
t('数字と「万」の間の空白', () => eq(A.yenValues('1 万円'), [10000]));
t('null・真偽値・負の数は拾わない', () => { eq(A.yenValues(null), []); eq(A.yenValues(true), []); eq(A.yenValues(-5), []); });
t('yenOf mid は中間を丸める', () => eq(A.yenOf('3000〜5100', 'mid'), 4050));
t('yenOf last', () => eq(A.yenOf('3000〜5000', 'last'), 5000));
t('niceYen', () => { eq(A.niceYen(4455), 4460); eq(A.niceYen(12345), 12300); eq(A.niceYen(123456), 123000); });
t('中央値', () => { eq(A.median([4800, 5200, 3800]), 4800); eq(A.median([1000, 2000, 3000, 4000]), 2500); eq(A.median([]), null); });

group('手数料・送料・利益');
t('メルカリ手数料は1円未満切り捨て（999円→99円）', () => eq(A.feeOf(999, 1000), 99));
t('1000円→100円', () => eq(A.feeOf(1000, 1000), 100));
t('305円→30円', () => eq(A.feeOf(305, 1000), 30));
t('8.8%（2500円→220円）小数の誤差で219円にならない', () => eq(A.feeOf(2500, 880), 220));
t('4.5%（1234円→55円）', () => eq(A.feeOf(1234, 450), 55));
t('大きな金額でも整数で計算', () => eq(A.feeOf(9999999, 1000), 999999));
t('送料＋資材（宅急便コンパクト 450+70）', () => eq(A.shipCost('compact'), 520));
t('ゆうパケットポストはシール代込み', () => eq(A.shipCost('post'), 220));
t('知らないコードは0円', () => eq(A.shipCost('zzz'), 0));
t('手取り 5200円・コンパクト → 4160円', () => eq(A.mercariNet(5200, 'compact'), 4160));
t('売る場所の比較（1000円・ネコポス）', () => {
  const r = A.compareAll(1000, 'neko');
  eq(r.map(x => x.net), [690, 740, 690, 690]);
});
t('利益と利益率', () => {
  const pr = A.profitOf(4160, 1000);
  eq(pr, 3160); eq(A.marginOf(pr, 5200), 61); eq(A.verdictOf(pr, 5200), 'good');
});
t('利益の見立て：小さめ・出にくい', () => {
  eq(A.verdictOf(300, 2000), 'thin');
  eq(A.verdictOf(0, 2000), 'under');
  eq(A.verdictOf(-50, 2000), 'under');
  eq(A.verdictOf(600, 2000), 'good');
});
t('送料表：コードの重複なし・すべて正の整数', () => {
  const codes = A.SHIP.map(s => s.code);
  eq(new Set(codes).size, codes.length);
  ok(A.SHIP.every(s => Number.isInteger(s.fee) && s.fee > 0 && Number.isInteger(s.material) && s.material >= 0));
});
t('指示文のコード説明に、送料表のコードが全部のっている', () => {
  const p = A.buildPrompt({ photoCount: 1 }, new Date(2026, 8, 18));
  const missing = A.SHIP.map(s => s.code).filter(c => !new RegExp(`(^|[^a-z0-9])${c}([^0-9]|$)`).test(p.split('ship は次のコードから1つ：')[1] || ''));
  ok(!missing.length, '載っていないコード: ' + missing.join(','));
});

group('項目の読み替え');
t('確かさ：日本語でも読む', () => { eq(A.levelOf('高'), 'high'); eq(A.levelOf('中'), 'medium'); eq(A.levelOf('低い'), 'low'); eq(A.levelOf('HIGH'), 'high'); eq(A.levelOf(''), ''); });
t('真偽', () => { eq(A.boolOf('true'), true); eq(A.boolOf('はい'), true); eq(A.boolOf(false), false); eq(A.boolOf('推定'), false); eq(A.boolOf(null), null); });
t('状態：長い言葉を優先', () => { eq(A.condOf('未使用に近い'), '未使用に近い'); eq(A.condOf('新品'), '新品、未使用'); eq(A.condOf('やや傷や汚れあり'), 'やや傷や汚れあり'); eq(A.condOf('傷や汚れあり'), '傷や汚れあり'); });
t('状態：選択肢を並べたままなら空', () => eq(A.condOf('新品、未使用 / 未使用に近い / 目立った傷や汚れなし / やや傷や汚れあり'), ''));
t('発送コード：いろいろな書き方', () => {
  eq(A.shipCodeOf('80'), '80'); eq(A.shipCodeOf('80サイズ'), '80'); eq(A.shipCodeOf('ネコポス'), 'neko');
  eq(A.shipCodeOf('宅急便コンパクト'), 'compact'); eq(A.shipCodeOf('t160'), 't160'); eq(A.shipCodeOf('たのメル便 200サイズ'), 't200');
  eq(A.shipCodeOf('250'), 't250'); eq(A.shipCodeOf('ゆうパケットポストmini'), 'mini'); eq(A.shipCodeOf('ゆうパケットポスト'), 'post');
  eq(A.shipCodeOf('ゆうパケット'), 'packet'); eq(A.shipCodeOf('ゆうパケットプラス'), 'plus'); eq(A.shipCodeOf('75'), '80');
  eq(A.shipCodeOf('ＮＥＫＯ'), 'neko'); eq(A.shipCodeOf(null), ''); eq(A.shipCodeOf('発送方法のコード'), '');
});
t('空欄とみなす言葉', () => { eq(A.cleanStr('不明'), ''); eq(A.cleanStr('null'), ''); eq(A.cleanStr('  ルンバ  '), 'ルンバ'); });
t('リスト：改行区切りの文字列も配列にする', () => eq(A.strList('・箱あり\n・説明書あり'), ['箱あり', '説明書あり']));

group('AIの答えを読む');
t('ChatGPTふうの答え（まとめ＋jsonの枠）', () => {
  const r = parse(GOOD);
  eq(r.kind, 'ok');
  const a = r.ai;
  eq([a.name, a.low, a.high, a.typical, a.mercari, a.quick, a.buyback, a.priceNew], ['iRobot ルンバ 643', 4000, 7000, 5500, 5800, 4800, 1500, 39800]);
  eq([a.confidence, a.searched, a.sellSpeed, a.ship, a.condition], ['high', true, 'high', '120', '目立った傷や汚れなし']);
  eq(a.keywords, ['ルンバ 643', 'ルンバ 600シリーズ']);
  eq(a.description, 'iRobotのルンバ643です。\n動作確認済み。');
  eq(a.art, null); eq(a.partial, false); eq(a.unsure, '');
});
t('jsonの枠の中だけを貼った', () => {
  const inner = GOOD.split('```json')[1].split('```')[0];
  eq(parse(inner).ai.mercari, 5800);
});
t('末尾カンマ・コメント・「円」・桁区切り', () => {
  const r = parse('```json\n{\n "name": "テスト", // 品名\n "price_low": 3,000円,\n "price_high": 12,500,\n "mercari_price": 1,234,567,\n "tips": ["a",],\n}\n```');
  eq(r.kind, 'ok'); eq([r.ai.low, r.ai.high, r.ai.mercari], [3000, 12500, 1234567]); eq(r.ai.tips, ['a']);
});
t('文字列の中の生の改行', () => {
  const r = parse('{"name": "壺", "price_low": 1000, "description": "一行目\n二行目"}');
  eq(r.ai.description, '一行目\n二行目');
});
t('文字列の中の " （エスケープ忘れ）', () => {
  const r = parse('{"name": "13"インチのモニター", "price_low": 1000, "price_high": 2000}');
  eq(r.kind, 'ok'); eq(r.ai.name, '13"インチのモニター');
});
t('行末のカンマ忘れ', () => {
  const r = parse('{\n"name": "花瓶"\n"price_low": 1000,\n"price_high": 3000\n}');
  eq(r.kind, 'ok'); eq([r.ai.name, r.ai.low, r.ai.high], ['花瓶', 1000, 3000]);
});
t('スマートクォート（“ ”）', () => {
  const r = parse('{“name”: “鉄瓶”, “price_low”: 5000, “price_high”: 9000}');
  eq(r.kind, 'ok'); eq(r.ai.name, '鉄瓶');
});
t('キーに " が無い・Python式の None/True', () => {
  const r = parse('{name: "茶碗", price_low: 800, price_high: None, searched: True}');
  eq(r.kind, 'ok'); eq([r.ai.name, r.ai.low, r.ai.searched], ['茶碗', 800, true]);
});
t('金額が文字列（範囲）で返ってきた', () => {
  const r = parse('{"name": "時計", "price_low": "3,000〜5,000円", "price_typical": "約4,000円", "mercari_price": "1.2万円"}');
  eq([r.ai.low, r.ai.high, r.ai.typical, r.ai.mercari], [3000, 5000, 4000, 12000]);
});
t('大文字の ```JSON', () => eq(parse('```JSON\n{"name":"皿","price_low":500,"price_high":900}\n```').kind, 'ok'));
t('1段包まれた答え {"result": {…}}', () => {
  const r = parse('{"result": {"name": "急須", "price_low": 2000, "price_high": 4000}}');
  eq(r.kind, 'ok'); eq(r.ai.name, '急須');
});
t('指示文だけを貼った → prompt', () => eq(parse(A.buildPrompt({ photoCount: 1 }, new Date())).kind, 'prompt'));
t('会話まるごと（指示文＋答え）→ 答えのほうを読む', () => {
  const r = parse(A.buildPrompt({ photoCount: 1 }, new Date()) + '\n\nChatGPT:\n' + GOOD);
  eq(r.kind, 'ok'); eq(r.ai.name, 'iRobot ルンバ 643');
});
t('ひな形の説明を「答え」と取り違えない', () => ok(A.isTemplate(JSON.parse(A.PROMPT_JSON))));
t('JSONが壊れすぎているときはキーごとに拾う', () => {
  const r = parse('"name": "掛け軸", "price_low": 20000, "price_high": 80000, "art_maker": "不詳" {{{');
  eq(r.kind, 'ok'); eq([r.ai.name, r.ai.low, r.ai.high, r.ai.partial], ['掛け軸', 20000, 80000, true]);
});
t('文章だけの答え（JSONなし）', () => {
  const r = parse('品名：ルンバ 643\n相場は3,000円〜6,000円くらいです。\n出品価格の目安：4,800円\n買取なら1,000円前後。');
  eq(r.kind, 'ok');
  eq([r.ai.name, r.ai.low, r.ai.high, r.ai.mercari, r.ai.buyback, r.ai.partial], ['ルンバ 643', 3000, 6000, 4800, 1000, true]);
});
t('関係のない文章 → none', () => eq(parse('こんにちは。今日はいい天気ですね。').kind, 'none'));
t('空 → empty', () => { eq(parse('').kind, 'empty'); eq(parse('   \n ').kind, 'empty'); });
t('骨董の見立て（art_）', () => {
  const r = parse('{"name":"九谷焼 色絵皿","price_low":8000,"price_high":30000,"art_maker":"三代 徳田八十吉","art_period":"昭和中期","art_marks":"高台内に「九谷」銘"}');
  eq(r.ai.art.maker, '三代 徳田八十吉'); eq(r.ai.art.period, '昭和中期'); eq(r.ai.art.origin, '');
});
t('金額のすき間を埋める（中心だけ・出品だけ）', () => {
  const a = parse('{"name":"x","price_typical":5000,"keywords":["x"]}').ai;
  eq([a.low, a.high, a.mercari, a.quick], [5000, 5000, 5000, 4250]);
  const b = parse('{"name":"y","price_low":6000,"price_high":2000}').ai;
  eq([b.low, b.high, b.typical], [2000, 6000, 4000]);
});
t('HTMLが混ざっていても、そのまま文字として扱う', () => {
  const r = parse('{"name":"<img src=x onerror=alert(1)>","price_low":100,"price_high":200}');
  eq(r.ai.name, '<img src=x onerror=alert(1)>');
});

group('AIへの指示文');
t('入れた情報が全部入る', () => {
  const p = A.buildPrompt({ memo: 'ルンバ 643\n充電台あり', condition: '未使用に近い', cost: 1000, photoCount: 2 }, new Date(2026, 8, 18));
  ['写真を2枚添付', 'ルンバ 643\n充電台あり', '・持ち主が見た状態：未使用に近い', '・仕入れ値：1,000円', '2026年9月18日', '"price_low"', 'ship は次のコードから1つ'].forEach(s => ok(p.includes(s), '入っていない: ' + s));
  ok(!p.includes('{{'), '差し込み忘れがある');
});
t('何も無いとき', () => {
  const p = A.buildPrompt({ photoCount: 0 }, new Date(2026, 0, 1));
  ok(p.includes('写真はありません')); ok(p.includes('特になし')); ok(!p.includes('・仕入れ値：'));
});
t('メモに $& などが入っても壊れない', () => ok(A.buildPrompt({ memo: '$& $1 $$', photoCount: 0 }, new Date()).includes('$& $1 $$')));
t('指示文の目印が指示文の中にある', () => { const p = A.buildPrompt({ photoCount: 1 }, new Date()); ok(A.PROMPT_MARKS.every(m => p.includes(m))); });

group('相場を確かめるリンク');
t('メルカリは売り切れで絞る', () => {
  const u = A.marketUrl(A.MARKETS.find(m => m.id === 'mercari'), 'ルンバ 643');
  eq(u, 'https://jp.mercari.com/search?keyword=%E3%83%AB%E3%83%B3%E3%83%90%20643&status=sold_out');
});
t('Yahoo!フリマはパスに入るので / を空白にする', () => {
  const u = A.marketUrl(A.MARKETS.find(m => m.id === 'yfm'), 'A/B テスト');
  ok(u.startsWith('https://paypayfleamarket.yahoo.co.jp/search/A%20B%20%E3%83%86') && u.endsWith('?sold=1'), u);
});
t('記号が混ざってもURLが壊れない', () => {
  A.MARKETS.forEach(m => { const u = A.marketUrl(m, 'a&b=c#d?e'); ok(!/[#]|&b=|=c/.test(u.split('?').slice(1).join('?').replace(/&(status|transaction|LH_Sold|LH_Complete)=/g, '')), m.id + ' ' + u); });
});

group('記録と集計');
const mk = o => A.cleanItem(Object.assign({ id: 'i' + Math.random(), createdAt: 1 }, o));
t('データの形を整える（おかしな値は捨てる）', () => {
  const it = A.cleanItem({ id: 7, status: 'nope', cost: '-3', photos: ['a', 3, 'b'], ship: 'x', soldPlatform: 'zzz', condition: 'ボロ' });
  eq([it.id, it.status, it.cost, it.photos, it.ship, it.soldPlatform, it.condition], ['7', 'waiting', 0, ['a', 'b'], '', 'mercari', '']);
});
t('壊れたデータでも空の状態で起動する', () => { eq(A.cleanState(null).items, []); eq(A.cleanState({ items: 'x', settings: { theme: 'pink' } }).settings.theme, 'auto'); });
t('容量いっぱいのときは、古い記録の答えの全文だけ手放して保存できる', () => {
  const st = A.cleanState({ items: Array.from({ length: 30 }, (_, i) => ({ id: 'q' + i, status: 'have', aiRaw: 'x'.repeat(1000), ai: { name: 'n' + i } })) });
  const orig = ctx.localStorage.setItem;
  ctx.localStorage.setItem = (k, v) => { if (v.length > 33000) throw new Error('QuotaExceededError'); store[k] = v; };
  try {
    ok(A.saveState(st), '保存できなかった');
    eq(st.items.filter(it => it.aiRaw).length, 20);
    eq(st.items[0].aiRaw.length, 1000);
    eq(st.items[29].ai.name, 'n29');
  } finally { ctx.localStorage.setItem = orig; }
});
t('合計：手元・出品中・売れた・利益', () => {
  const ai = A.normalizeAi({ name: 'x', price_low: 1000, price_high: 3000, price_typical: 2000 });
  const items = [
    mk({ status: 'have', ai }), mk({ status: 'listed', ai }),
    mk({ status: 'sold', ai, soldPrice: 3000, soldPlatform: 'mercari', soldShip: 'neko', cost: 500 }),
    mk({ status: 'gone', ai }), mk({ status: 'waiting' }),
  ];
  const r = A.totals(items);
  eq([r.haveCount, r.haveValue, r.listedCount, r.soldCount, r.soldNet, r.soldProfit, r.waitingCount], [2, 4000, 1, 1, 2490, 1990, 1]);
});
t('出品価格：自分で決めた値段が優先', () => {
  const ai = A.normalizeAi({ name: 'x', price_low: 1000, price_high: 3000, mercari_price: 2800 });
  eq(A.itemListPrice(mk({ ai })), 2800); eq(A.itemListPrice(mk({ ai, listPrice: 2500 })), 2500);
});
t('発送方法：自分で選んだ > AIのおすすめ > 60サイズ', () => {
  const ai = A.normalizeAi({ name: 'x', price_low: 1, ship: 'neko' });
  eq(A.itemShip(mk({ ai })), 'neko'); eq(A.itemShip(mk({ ai, ship: '80' })), '80'); eq(A.itemShip(mk({})), '60');
});
t('まとめの文章', () => {
  const s = A.summaryText(mk({ ai: parse(GOOD).ai, cost: 1000 }));
  ok(s.includes('iRobot ルンバ 643') && s.includes('4,000〜7,000円') && s.includes('仕入れ 1,000円'), s);
});

group('画面（HTMLの組み立て）');
function renderAt(hash, items) {
  const st = A.cleanState({ items, settings: { firstDone: true } });
  A.setS(st);
  ctx.location.hash = hash;
  A.render();
  return els['#view'].innerHTML;
}
const leaks = html => (html.match(/undefined|NaN|\[object Object\]|null円/g) || []);
t('はじめての人のホーム = 説明ページ', () => { const h = renderAt('#/', []); ok(typeof h === 'string'); });
t('鑑定する（新規）', () => {
  const h = renderAt('#/new', []);
  ok(h.includes('写真を選ぶ') && h.includes('AIアプリに送る') && h.includes('答えを貼り付ける'));
  eq(leaks(h), []);
});
const full = () => mk({ id: 'r1', status: 'have', ai: parse(GOOD).ai, cost: 1000, checks: [5200, 4800, 6100], photos: [] });
t('結果の画面：主要な数字がそろう', () => {
  const h = renderAt('#/item/r1', [full()]);
  ['iRobot ルンバ 643', '4,000〜7,000円', '5,800円', '手元に残る額', '仕入れの計算', '利益', 'メルカリ', 'status=sold_out', '出品文のたたき台', '中央値'].forEach(s => ok(h.includes(s), '無い: ' + s));
  eq(leaks(h), []);
});
t('結果の画面：AIのHTMLは無害化される', () => {
  const it = full(); it.ai.name = '<script>alert(1)</script>'; it.ai.tips = ['<b>x</b>'];
  const h = renderAt('#/item/r1', [it]);
  ok(!h.includes('<script>alert') && h.includes('&lt;script&gt;') && h.includes('&lt;b&gt;x'));
});
t('結果の画面：答えが一部しかなくても崩れない', () => {
  const it = mk({ id: 'p1', status: 'have', ai: { name: '謎の壺' } });
  const h = renderAt('#/item/p1', [it]);
  ok(h.includes('謎の壺')); eq(leaks(h), []);
});
t('売れた記録', () => {
  const it = full(); it.status = 'sold'; it.soldPrice = 6000;
  const h = renderAt('#/item/r1', [it]);
  ok(h.includes('売れた記録') && h.includes('手取り')); eq(leaks(h), []);
});
t('ホーム（記録あり）', () => {
  const h = renderAt('#/', [full(), mk({ status: 'waiting', memo: '古い茶碗' })]);
  ok(h.includes('鑑定のつづき') && h.includes('古い茶碗') && h.includes('相場の合計')); eq(leaks(h), []);
});
t('設定', () => { const h = renderAt('#/settings', []); ok(h.includes('手数料と送料') && h.includes('たのメル便')); eq(leaks(h), []); });
t('画面の data-act には、すべて処理がある', () => {
  const src = read('assets/app.js') + read('index.html');
  const acts = [...new Set([...src.matchAll(/data-act="(\w+)"/g)].map(m => m[1]))];
  const missing = acts.filter(a => typeof A.ACT[a] !== 'function');
  ok(!missing.length, '処理が無い: ' + missing.join(', '));
  return acts.length + '種類';
});
t('画面の data-bind には、すべて処理がある', () => {
  const binds = [...new Set([...read('assets/app.js').matchAll(/data-bind="(\w+)"/g)].map(m => m[1]))];
  const missing = binds.filter(b => typeof A.BIND[b] !== 'function');
  ok(!missing.length, '処理が無い: ' + missing.join(', '));
});

group('言葉づかい');
const NG = ['価値がない', '価値はない', '無価値', '売れない', 'ゴミ', 'ガラクタ', '二束三文', '赤字', '失敗', 'ダメ', '残念', '損する', '動けない', '原因'];
t('禁止語が画面の文言に無い', () => {
  const hits = [];
  for (const f of ['index.html', 'assets/data.js', 'assets/app.js', 'assets/core.js']) {
    const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
    NG.forEach(w => { if (text.includes(w)) hits.push(`${f}: ${w}`); });
  }
  ok(!hits.length, hits.join(' / '));
});

group('色のコントラスト（4.5:1 以上）');
function tokens(css, selector) {
  const i = css.indexOf(selector + ' {');
  const body = css.slice(i, css.indexOf('}', i));
  const o = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) o[m[1]] = m[2].trim();
  return o;
}
function rgba(v) {
  if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
  const n = v.match(/[\d.]+/g).map(Number);
  return [n[0], n[1], n[2], n[3] ?? 1];
}
const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const CSS = read('assets/style.css');
for (const [label, sel] of [['ライト', ':root'], ['ダーク', ':root[data-theme="dark"]']]) {
  const T = tokens(CSS, sel);
  const c = k => rgba(T[k]);
  const pairs = [
    ['本文 / 地', c('fg'), c('bg')], ['補助の文字 / 地', c('fg2'), c('bg')], ['薄い文字 / 地', c('dim'), c('bg')],
    ['薄い文字 / カード', c('dim'), c('card')], ['薄い文字 / 淡い面', c('dim'), c('soft')],
    ['ボタンの文字 / 朱', c('acc-ink'), c('acc')], ['朱の文字 / カード', c('acc'), c('card')],
    ['手取り（朱） / 朱の淡い面', c('acc'), over(c('acc-tint'), c('card'))],
    ['緑の文字 / 緑の淡い面', c('ok'), over(c('ok-tint'), c('card'))], ['緑の文字 / 地', c('ok'), over(c('ok-tint'), c('bg'))],
    ['注意の文字 / 注意の淡い面', c('warn'), over(c('warn-tint'), c('bg'))],
  ];
  for (const [name, f, b] of pairs) {
    t(`${label}：${name}`, () => { const r = ratio(f, b); ok(r >= 4.5, r.toFixed(2) + ':1'); return r.toFixed(2) + ':1'; });
  }
}

group('ほかのツールと同じオリジン（karasui1014.github.io）');
t('sw.js が消すのは自分のキャッシュ（kantei-note-）だけ', () => {
  const sw = read('sw.js');
  ok(/const PREFIX = 'kantei-note-'/.test(sw) && /CACHE = PREFIX \+ 'v\d+'/.test(sw), '接頭辞とCACHEの形');
  ok(/ks\.filter\(k => k\.startsWith\(PREFIX\) && k !== CACHE\)/.test(sw), 'activate で接頭辞を確かめていない');
});
t('画面側も、自分のキャッシュとService Workerだけを扱う', () => {
  const src = read('assets/app.js');
  ok(!/caches\.keys\(\)\.then\(ks => ks\.forEach/.test(src), 'すべてのキャッシュを消している');
  ok(!/getRegistrations\(\)\.then\(rs => rs\.forEach/.test(src), 'すべてのService Workerを解除している');
  ok(/r\.scope === scope/.test(src), 'スコープで絞っていない');
});

group('ファイルのそろい');
t('sw.js がキャッシュするファイルが全部ある', () => {
  const list = [...read('sw.js').matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);
  const missing = list.filter(f => !fs.existsSync(path.join(ROOT, f)));
  ok(!missing.length, '無い: ' + missing.join(', '));
});
t('manifest のアイコンが全部ある', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  const missing = m.icons.map(i => i.src.replace('./', '')).filter(f => !fs.existsSync(path.join(ROOT, f)));
  ok(!missing.length, '無い: ' + missing.join(', '));
  ok(m.icons.some(i => i.purpose === 'maskable') && m.icons.some(i => i.purpose === 'any'), 'any と maskable を別々に');
});
t('index.html が読む JS・CSS・アイコンが全部ある', () => {
  const refs = [...read('index.html').matchAll(/(?:src|href)="\.\/([^"#]+)"/g)].map(m => m[1]);
  const missing = refs.filter(f => !fs.existsSync(path.join(ROOT, f)));
  ok(!missing.length, '無い: ' + missing.join(', '));
});

/* ---------- 結果 ---------- */
console.log(`\n${fail ? C.r : C.g}${C.b}${pass} passed, ${fail} failed${C.x}`);
if (fail) { console.log(C.r + fails.map(f => '  - ' + f).join('\n') + C.x); process.exit(1); }
