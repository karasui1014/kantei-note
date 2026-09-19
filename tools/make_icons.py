#!/usr/bin/env python3
"""AI鑑定ノートの、SNSで共有されたときの画像（OGP・assets/og.jpg）を作る。

アプリのアイコンとファビコンは tools/make_chara_icons.py（ローファイ探偵の絵）で作る。
OGP画像の左には、そのアイコン（assets/icons/icon-512.png）を置く。先に make_chara_icons.py を実行すること。

使い方（プロジェクト直下で）:
    python3 tools/make_icons.py

朱色の角印に「鑑」の一字。フォントは macOS に入っているヒラギノ明朝を使う。
色を変えたいときは VERMILION / PAPER / INK を直して、もう一度実行する。
"""
import os
import random
import unicodedata

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "assets", "icons")
FONTS = "/System/Library/Fonts"

VERMILION = (166, 59, 38)
PAPER = (251, 247, 238)
BG = (243, 240, 233)
INK = (31, 28, 24)
DIM = (105, 98, 90)
SS = 4  # 縁をなめらかにするため、4倍で描いてから縮める


def font_path(name):
    """macOS のフォント名は濁点が分かれた形（NFD）で保存されているので、照合してから探す"""
    want = unicodedata.normalize("NFC", name)
    for f in os.listdir(FONTS):
        if unicodedata.normalize("NFC", f) == want:
            return os.path.join(FONTS, f)
    raise FileNotFoundError(name)


MINCHO = font_path("ヒラギノ明朝 ProN.ttc")
GOTHIC_W6 = font_path("ヒラギノ角ゴシック W6.ttc")
GOTHIC_W3 = font_path("ヒラギノ角ゴシック W3.ttc")


def mincho(size):
    # ヒラギノ明朝 ProN.ttc は 0=ProN W3, 1=Pro W3, 2=ProN W6, 3=Pro W6。小さく表示しても読めるよう W6 を使う
    return ImageFont.truetype(MINCHO, size, index=2)


def draw_centered(d, box, text, font, fill):
    x0, y0, x1, y1 = box
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    x = x0 + (x1 - x0 - (r - l)) / 2 - l
    y = y0 + (y1 - y0 - (b - t)) / 2 - t
    d.text((x, y), text, font=font, fill=fill)


def seal(size, full_bleed=False, safe=1.0, frame=True, glyph=0.6):
    """角印。full_bleed=True は四隅まで朱色（iPhone・maskable 用）。
    safe は、枠と文字を内側にどれだけ寄せるか（maskable は 0.72 くらい）。
    frame=False は内枠なし（ファビコンのように小さく出すとき、線がつぶれてうるさくなるため）"""
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = 0 if full_bleed else int(S * 0.2)
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=radius, fill=VERMILION + (255,))

    inner = S * safe
    off = (S - inner) / 2
    pad = inner * 0.1
    if frame:
        # 印の内枠（細い紙色の線）
        lw = max(SS, int(inner * 0.028))
        r_in = int(inner * 0.11)
        d.rounded_rectangle((off + pad, off + pad, off + inner - pad, off + inner - pad),
                            radius=r_in, outline=PAPER + (255,), width=lw)
    # 文字
    f = mincho(int(inner * glyph))
    box = (off + pad, off + pad, off + inner - pad, off + inner - pad)
    draw_centered(d, box, "鑑", f, PAPER + (255,))
    return img.resize((size, size), Image.LANCZOS)


def save(img, name, rgb=False):
    path = os.path.join(ICONS, name) if not name.startswith("/") else name
    if rgb:
        bg = Image.new("RGB", img.size, VERMILION)
        bg.paste(img, mask=img.split()[3])
        img = bg
    img.save(path, optimize=True)
    print("wrote", os.path.relpath(path, ROOT), img.size)


def grain(img, amount=9, seed=7):
    """紙のようなごく薄いざらつき"""
    random.seed(seed)
    w, h = img.size
    noise = Image.new("L", (w, h))
    noise.putdata([128 + random.randint(-amount, amount) for _ in range(w * h)])
    noise = noise.filter(ImageFilter.GaussianBlur(0.6))
    base = img.convert("RGB")
    return Image.blend(base, Image.merge("RGB", (noise, noise, noise)), 0.06)


def og_image():
    W, H = 1200, 630
    img = Image.new("RGB", (W * 2, H * 2), BG)
    d = ImageDraw.Draw(img)
    # 左にアプリのアイコン（tools/make_chara_icons.py で作ったキャラの絵）
    mark = Image.open(os.path.join(ICONS, "icon-512.png")).convert("RGBA").resize((340 * 2, 340 * 2), Image.LANCZOS)
    img.paste(mark, (84 * 2, (H - 340)), mark)
    x = 470 * 2
    title = mincho(54 * 2)
    d.text((x, 168 * 2), "写真から、相場と", font=title, fill=INK)
    d.text((x, 248 * 2), "メルカリの手取りがわかる", font=title, fill=INK)
    d.line((x, 352 * 2, x + 64 * 2, 352 * 2), fill=VERMILION, width=3 * 2)
    d.text((x, 378 * 2), "AI鑑定ノート", font=ImageFont.truetype(GOTHIC_W6, 32 * 2), fill=VERMILION)
    d.text((x, 432 * 2), "無料・登録なし｜ChatGPT・Gemini・Claudeで使える",
           font=ImageFont.truetype(GOTHIC_W3, 22 * 2), fill=DIM)
    img = img.resize((W, H), Image.LANCZOS)
    img = grain(img)
    # 紙のざらつきはPNGだと重くなるので、JPEGで書き出す
    path = os.path.join(ROOT, "assets", "og.jpg")
    img.save(path, quality=86, optimize=True, progressive=True)
    print("wrote", os.path.relpath(path, ROOT), img.size)


def main():
    og_image()


if __name__ == "__main__":
    main()
