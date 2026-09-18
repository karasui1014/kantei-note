/* AI鑑定ノート - データと文言
   手数料・送料・検索リンク・AIへの指示文は、このファイルだけで直せるようにしてある。

   ⚠️ 手数料と送料は変わることがある。直したら：
      1. FEES_AS_OF を更新する
      2. sw.js の CACHE の版を上げる（上げないと、古い料金のまま表示され続ける）
      3. node tests/run.js を走らせる

   言葉づかいの約束（画面の文言を足すときに守ること）
   - 使う人や品物を否定しない。「売れない」「価値がない」「赤字」などは使わず、
     「利益は小さめ」「まとめ売りにすると動きやすい」のように、次の一手が見える言い方にする
   - 機能は、そのままの名前で呼ぶ（鑑定する・記録・設定）。世界観の比喩は被せない
   - 入口の負担を増やさない。必須は「写真か、品物のメモのどちらか」だけ。ほかは全部任意
   tests/run.js が、禁止語の混入を機械的に調べている */

'use strict';

const APP = {
  name: 'AI鑑定ノート',
  version: '1.0.0',
  storeKey: 'kantei-note-v1',
  maxPhotos: 4,
};

/* 料金を確かめた時期（画面の注記に出る） */
const FEES_AS_OF = '2026年9月';

/* ---------- 発送方法（メルカリ便） ----------
   fee = 送料、material = 専用資材の目安（送料とあわせて手取りから引く）
   60〜200サイズは、らくらくメルカリ便（宅急便）と ゆうゆうメルカリ便（ゆうパック）の安いほう */
const SHIP = [
  { code: 'mini',    group: 'small', name: 'ゆうパケットポストmini', fee: 160, material: 20, via: 'ゆうゆうメルカリ便', spec: '専用封筒（21×17cm）・2kgまで', matNote: '専用封筒20円' },
  { code: 'neko',    group: 'small', name: 'ネコポス',               fee: 210, material: 0,  via: 'らくらくメルカリ便', spec: 'A4サイズ・厚さ3cm・1kgまで' },
  { code: 'post',    group: 'small', name: 'ゆうパケットポスト',     fee: 215, material: 5,  via: 'ゆうゆうメルカリ便', spec: '3辺60cm・長辺34cm・郵便ポストに入る厚さ・2kgまで', matNote: '発送用シール約5円' },
  { code: 'packet',  group: 'small', name: 'ゆうパケット',           fee: 230, material: 0,  via: 'ゆうゆうメルカリ便', spec: '3辺60cm・長辺34cm・厚さ3cm・1kgまで' },
  { code: 'compact', group: 'box',   name: '宅急便コンパクト',       fee: 450, material: 70, via: 'らくらくメルカリ便', spec: '専用BOX（25×20×5cm ほか）', matNote: '専用BOX70円' },
  { code: 'plus',    group: 'box',   name: 'ゆうパケットプラス',     fee: 455, material: 65, via: 'ゆうゆうメルカリ便', spec: '専用箱（24×17×7cm）・2kgまで', matNote: '専用箱65円' },
  { code: '60',  group: 'size', name: '60サイズ',  fee: 750,  material: 0, via: '宅急便・ゆうパック',             spec: '3辺合計60cmまで' },
  { code: '80',  group: 'size', name: '80サイズ',  fee: 850,  material: 0, via: 'らくらくメルカリ便（宅急便）',   spec: '3辺合計80cmまで' },
  { code: '100', group: 'size', name: '100サイズ', fee: 1050, material: 0, via: 'らくらくメルカリ便（宅急便）',   spec: '3辺合計100cmまで' },
  { code: '120', group: 'size', name: '120サイズ', fee: 1200, material: 0, via: '宅急便・ゆうパック',             spec: '3辺合計120cmまで' },
  { code: '140', group: 'size', name: '140サイズ', fee: 1450, material: 0, via: '宅急便・ゆうパック',             spec: '3辺合計140cmまで' },
  { code: '160', group: 'size', name: '160サイズ', fee: 1700, material: 0, via: '宅急便・ゆうパック',             spec: '3辺合計160cmまで' },
  { code: '170', group: 'size', name: '170サイズ', fee: 1900, material: 0, via: 'ゆうゆうメルカリ便（ゆうパック）', spec: '3辺合計170cmまで' },
  { code: '180', group: 'size', name: '180サイズ', fee: 2100, material: 0, via: 'らくらくメルカリ便（宅急便）',   spec: '3辺合計180cmまで' },
  { code: '200', group: 'size', name: '200サイズ', fee: 2500, material: 0, via: 'らくらくメルカリ便（宅急便）',   spec: '3辺合計200cmまで' },
  { code: 't80',  group: 'large', name: 'たのメル便 80サイズ',  fee: 1700,  material: 0, via: '梱包・発送たのメル便', spec: '梱包と集荷もおまかせ' },
  { code: 't120', group: 'large', name: 'たのメル便 120サイズ', fee: 2400,  material: 0, via: '梱包・発送たのメル便', spec: '梱包と集荷もおまかせ' },
  { code: 't160', group: 'large', name: 'たのメル便 160サイズ', fee: 3400,  material: 0, via: '梱包・発送たのメル便', spec: '梱包と集荷もおまかせ' },
  { code: 't200', group: 'large', name: 'たのメル便 200サイズ', fee: 5000,  material: 0, via: '梱包・発送たのメル便', spec: '梱包と集荷もおまかせ' },
  { code: 't250', group: 'large', name: 'たのメル便 250サイズ', fee: 8600,  material: 0, via: '梱包・発送たのメル便', spec: '梱包と集荷もおまかせ' },
  { code: 't300', group: 'large', name: 'たのメル便 300サイズ', fee: 12000, material: 0, via: '梱包・発送たのメル便', spec: '梱包と集荷もおまかせ' },
  { code: 't350', group: 'large', name: 'たのメル便 350サイズ', fee: 18500, material: 0, via: '梱包・発送たのメル便', spec: '梱包と集荷もおまかせ' },
  { code: 't400', group: 'large', name: 'たのメル便 400サイズ', fee: 25400, material: 0, via: '梱包・発送たのメル便', spec: '梱包と集荷もおまかせ' },
  { code: 't450', group: 'large', name: 'たのメル便 450サイズ', fee: 33000, material: 0, via: '梱包・発送たのメル便', spec: '梱包と集荷もおまかせ' },
];
const SHIP_GROUPS = [
  { id: 'small', name: '薄いもの・小さいもの' },
  { id: 'box',   name: '小さめの箱' },
  { id: 'size',  name: '箱（3辺の合計）' },
  { id: 'large', name: '大型の家具・家電' },
];
const SHIP_DEFAULT = '60';
const SHIP_NOTE = '宅急便は、サイズごとに重さの上限があります（60:2kg／80:5kg／100:10kg／120:15kg／140:20kg／160:25kg／180・200:30kg）。重いものは、ゆうパック（25kgまで）が向いています。';

/* ---------- 売る場所 ----------
   bp = 手数料率（1万分率。1000 = 10%）。1円未満は切り捨て */
const PLATFORMS = [
  { id: 'mercari', name: 'メルカリ',           bp: 1000, fee: '販売手数料10%' },
  { id: 'yfm',     name: 'Yahoo!フリマ',       bp: 500,  fee: '販売手数料5%' },
  { id: 'rakuma',  name: 'ラクマ',             bp: 1000, fee: '販売手数料10%（月の販売実績で最大4.5%まで下がる）' },
  { id: 'yauc',    name: 'Yahoo!オークション', bp: 1000, fee: '落札システム利用料10%（LYPプレミアム会員は8.8%）' },
];
const MERCARI_MIN = 300;
const MERCARI_TITLE_MAX = 40;

/* ---------- 実際に売れた値段を確かめるリンク ----------
   k は encodeURIComponent 済みのキーワード。en: true は英語のキーワードを優先する */
const MARKETS = [
  { id: 'mercari', name: 'メルカリ',           sub: '売り切れ',   url: k => `https://jp.mercari.com/search?keyword=${k}&status=sold_out` },
  { id: 'yauc',    name: 'Yahoo!オークション', sub: '落札相場',   url: k => `https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=${k}` },
  { id: 'rakuma',  name: 'ラクマ',             sub: '売り切れ',   url: k => `https://fril.jp/s?query=${k}&transaction=soldout` },
  { id: 'yfm',     name: 'Yahoo!フリマ',       sub: '売り切れ',   url: k => `https://paypayfleamarket.yahoo.co.jp/search/${k}?sold=1`, path: true },
  { id: 'ebay',    name: 'eBay',               sub: '海外の落札', url: k => `https://www.ebay.com/sch/i.html?_nkw=${k}&LH_Sold=1&LH_Complete=1`, en: true },
  { id: 'google',  name: 'Google',             sub: '相場を検索', url: k => `https://www.google.com/search?q=${k}%20%E7%9B%B8%E5%A0%B4` },
];

/* ---------- AIアプリ（パソコンなど、共有ボタンが使えないとき用） ---------- */
const AI_APPS = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'gemini',  name: 'Gemini',  url: 'https://gemini.google.com/app' },
  { id: 'claude',  name: 'Claude',  url: 'https://claude.ai/new' },
];

/* ---------- 品物の状態（メルカリの6段階） ----------
   並び順は「読み取りで長い言葉から照合する」ために、この順を崩さないこと */
const CONDITIONS = ['新品、未使用', '未使用に近い', '目立った傷や汚れなし', 'やや傷や汚れあり', '傷や汚れあり', '全体的に状態が悪い'];

/* ---------- 記録の状態 ---------- */
const STATUS = {
  waiting: '答え待ち',
  have:    '手元にある',
  listed:  '出品中',
  sold:    '売れた',
  gone:    '手放した',
};
const STATUS_ORDER = ['have', 'listed', 'sold', 'gone'];

/* ---------- 見立ての確かさ・売れやすさ ---------- */
const CONFIDENCE = { high: 'かなり確か', medium: 'おおむね確か', low: '参考程度' };
const SELL_SPEED = { high: 'よく売れている', medium: 'ふつうに売れている', low: 'じっくり待つ品' };

/* ---------- 仕入れの見立て ---------- */
const VERDICT = {
  good:  '利益が見込めます',
  thin:  '利益は小さめです',
  under: 'この仕入れ値だと、利益が出にくい見込みです',
};

/* ---------- AIへの指示文 ----------
   {{…}} は core.js の buildPrompt が差し込む。
   JSONのひな形の説明文は「読み取り側で、指示文を貼ってしまったか」の判定にも使う（PROMPT_MARKS）。
   キーの名前を変えたら core.js の normalizeAi と tests も直すこと */
const PROMPT_JSON = `{
  "kantei": 1,
  "name": "品名（ブランド・シリーズ・型番まで）",
  "category": "カテゴリ（例: 家電、ブランドバッグ、陶磁器）",
  "brand": "ブランド・メーカー・作家",
  "model": "型番・シリーズ名",
  "era": "年代・発売時期",
  "features": ["見分けに使った特徴"],
  "confidence": "特定の確かさ",
  "unsure": "特定しきれない点",
  "alternatives": ["ほかに考えられる候補"],
  "condition": "状態（新品、未使用 / 未使用に近い / 目立った傷や汚れなし / やや傷や汚れあり / 傷や汚れあり / 全体的に状態が悪い）",
  "condition_note": "写真から見た状態と付属品",
  "price_new": "定価・新品の価格",
  "price_low": "中古相場の下限",
  "price_high": "中古相場の上限",
  "price_typical": "いちばん多い価格帯",
  "mercari_price": "メルカリの出品価格の目安",
  "mercari_quick": "早く売りたいときの価格",
  "buyback": "買取店での買取価格の目安",
  "evidence": ["根拠（例: メルカリ売り切れ8件 4000〜5500円）"],
  "searched": "ウェブ検索で確かめたなら true、知識からの推定なら false",
  "sell_speed": "売れやすさ",
  "sell_note": "売れやすさと需要のひとこと",
  "buy_note": "仕入れ値が書かれていれば、仕入れとしての見立て",
  "ship": "発送方法のコード",
  "size_cm": "梱包したときのおおよその3辺（例: 30×20×10）",
  "weight_kg": "梱包したときのおおよその重さ(kg)",
  "keywords": ["メルカリで検索する言葉（2〜4個）"],
  "keywords_en": ["海外で検索する英語の言葉"],
  "title": "メルカリの商品名（40文字以内）",
  "description": "メルカリの商品説明（状態・付属品・サイズ・注意点。400字くらい）",
  "tips": ["値段が上がるポイント"],
  "cautions": ["気をつけること"],
  "art_maker": "作家・窯元・工房",
  "art_period": "年代の見立て",
  "art_technique": "技法・素材",
  "art_origin": "産地",
  "art_marks": "銘・落款・刻印など",
  "art_check": "確かめるべき点（共箱・鑑定書・来歴など）",
  "art_pro": "専門家に見せる価値があるか"
}`;

const PROMPT_TEMPLATE = `この品物を鑑定してください。
{{PHOTOS}}
今日は{{DATE}}です。

■ わかっていること
{{KNOWN}}

■ お願いしたいこと
1. 写真のロゴ・刻印・型番・タグ・ラベル・銘・落款・箱書きなどを手がかりに、品物を特定してください。特定しきれない点は、候補と確かさを正直に書いてください。
2. ウェブ検索で、最近実際に売れた価格を調べてください（メルカリの売り切れ、Yahoo!オークションの落札相場、ラクマ・Yahoo!フリマの売り切れ、買取店の買取価格）。出品中の価格より、売れた価格を重く見てください。検索できないときは、知識からの推定だとわかるようにしてください。
3. 状態と付属品を踏まえて、中古相場と、メルカリでの出品価格の目安を出してください。
4. 骨董・工芸・美術品・作家ものなら、作家・年代・技法・産地の見立てと、確かめるべき点も書いてください。写真だけで真贋を断定しないでください。
5. メルカリに出品するときの商品名と説明文のたたき台も作ってください。

■ 答え方
はじめに、人が読むための短いまとめを5行以内で書いてください。
そのあと、下の形のJSONを「\`\`\`json」で始まるコードブロック1つにまとめてください。
・金額は円の整数（カンマや「円」は付けない）。わからない項目は null
・confidence と sell_speed は high / medium / low のどれか
・art_ で始まる項目は、骨董・工芸・美術品・作家ものの場合だけ。それ以外は null
・ship は次のコードから1つ：{{SHIP_CODES}}

\`\`\`json
{{JSON}}
\`\`\``;

/* 指示文そのものを貼ってしまったときの目印 */
const PROMPT_MARKS = ['■ 答え方', '中古相場の下限'];

/* 指示文に載せる、発送方法コードの説明 */
const PROMPT_SHIP_CODES = 'mini（ゆうパケットポストmini）、neko（ネコポス：A4・厚さ3cm）、post（ゆうパケットポスト）、packet（ゆうパケット）、compact（宅急便コンパクト）、plus（ゆうパケットプラス）、60〜200（箱の3辺合計：60/80/100/120/140/160/170/180/200）、t80〜t450（大型の家具・家電向けの梱包・発送たのメル便：t80/t120/t160/t200/t250/t300/t350/t400/t450）';

/* ---------- ホーム画面に追加の案内 ---------- */
const INSTALL = {
  title: 'ホーム画面に追加しておくと便利です',
  lead: '次からアプリのようにすぐ開けて、記録も消えにくくなります。',
  ios: ['共有ボタン（□に↑のマーク）を押す。見当たらないときは、画面下の「…」の中にあります', '「ホーム画面に追加」を選ぶ', '右上の「追加」を押す'],
  other: 'ボタンを押すと、ホーム画面に追加できます。',
  cta: 'ホーム画面に追加する',
  later: 'いまはいい',
};

/* ---------- AIアプリの使い方のコツ ---------- */
const AI_TIPS = [
  '指示文が入っていないときは、入力欄を長押しして「ペースト」を選んでください。',
  'Claudeは、ウェブ検索をオンにすると相場を調べてくれます。',
  '答えの最後にある「json」の枠の右上のボタンで、枠の中だけをコピーできます。答え全体をコピーしても大丈夫です。',
];
