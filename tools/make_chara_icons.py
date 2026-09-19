#!/usr/bin/env python3
"""AI鑑定ノートのアイコン（ファビコン・スマホ用）を、ローファイ探偵の絵から作る。

使い方（プロジェクト直下で）:
    python3 tools/make_chara_icons.py

元絵は .source/chara_src.png（2048px。口を開けて「わぁ！」と驚く表情の、ちびキャラの絵）。
そこから、キャラと、同じ絵の中の虫眼鏡を切り抜き、
「ペンの代わりに虫眼鏡を握って、顔の横に掲げて鑑定している」絵に組み直す（顔は隠さない）。
背景と角丸は StrengthPath など、ほかのツールのアイコンと同じベージュのグラデーション。

座標はすべて「キャラの切り抜き画像」の座標（元絵の (545,169) が原点）。
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as nd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, ".source")
ICONS = os.path.join(ROOT, "assets", "icons")

PAPER = np.array([253, 243, 233])                 # 元絵の背景色
CUT = (545, 169, 1465, 1426)                      # 元絵からキャラを切り出す範囲
MAG_BOX = (226, 294, 515, 668)                    # 元絵の虫眼鏡の範囲
TOP, BOTTOM = (232, 220, 201), (196, 164, 124)   # StrengthPath と同じベージュ
M = 1024                                          # 作業用の大きさ
OFFSET = (70, 70)                                 # 切り抜き座標 → 作業用キャンバスへのずらし
LENS = (80, 698)                                  # レンズの中心（顔の左横。顔と眼鏡にかからない位置）
GRIP = (255, 850)                                 # 握るところ（こぶし）
GLASS_R = 100                                     # レンズのガラス部分の半径
ZOOM = 1.3                                        # レンズで大きく見える倍率

# 髪と服のすき間など、元絵で背景が見えている穴（塗りつぶさずに透明へ戻す）
GAPS = [(56, 654), (254, 779), (317, 798), (335, 791), (806, 750)]

# こぶしの輪郭（指がペンの手前にある絵なので、柄の上にかぶせると握って見える）
FIST = [(242, 786), (260, 785), (277, 796), (285, 809), (290, 818), (304, 815), (312, 822), (311, 836),
        (301, 853), (288, 866), (273, 885), (265, 900), (260, 911), (235, 921), (190, 921), (181, 910),
        (184, 885), (194, 855), (204, 835), (215, 816), (227, 800)]


def cut_sources():
    """元絵から、キャラ（chara.png）と虫眼鏡（mag.png）を切り抜く"""
    src = Image.open(os.path.join(SRC, "chara_src.png")).convert("RGB")
    a = np.asarray(src).astype(int)
    near_paper = np.sqrt(((a - PAPER) ** 2).sum(2)) < 20
    lab, _ = nd.label(near_paper)
    outside = lab == lab[205, 1365]                # パネルの内側の、何もない所
    fg = ~outside
    fg[1427:, :] = False                           # 下の文字ラベルは使わない
    fg = nd.binary_opening(fg, iterations=1)
    lab2, _ = nd.label(fg)
    chara = nd.binary_fill_holes(lab2 == lab2[683, 956])
    # すき間の穴を透明に戻す
    holes = near_paper & chara
    hl, _ = nd.label(holes)
    for x, y in GAPS:
        fx, fy = x + CUT[0], y + CUT[1]
        ys, xs = np.nonzero(hl[fy - 12:fy + 13, fx - 12:fx + 13])
        for yy, xx in zip(ys, xs):
            chara[hl == hl[fy - 12 + yy, fx - 12 + xx]] = False
            break
    rgba = np.dstack([np.asarray(src), (chara * 255).astype(np.uint8)])
    Image.fromarray(rgba, "RGBA").crop(CUT).save(os.path.join(SRC, "chara.png"))

    # 虫眼鏡：まわりの白いふち（シール風の縁取り）を落とす
    mag = lab2 == lab2[389, 293]
    mag |= lab2 == lab2[614, 253]
    mag = nd.binary_fill_holes(mag)
    luma = a[..., :3].mean(2)
    sat = a[..., :3].max(2) - a[..., :3].min(2)
    whitish = (luma > 165) & (sat < 40)
    outer = ~mag | whitish
    ol, _ = nd.label(outer)
    border = ol == ol[MAG_BOX[1] + 2, MAG_BOX[0] + 2]
    mag &= ~border
    mag = nd.binary_erosion(mag, iterations=1)
    alpha = Image.fromarray((mag * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
    rgba = Image.fromarray(np.asarray(src)).convert("RGBA")
    rgba.putalpha(alpha)
    rgba.crop(MAG_BOX).save(os.path.join(SRC, "mag.png"))


def gradient(size):
    w, h = size
    t = np.linspace(0, 1, h)[:, None]
    rgb = (np.array(TOP) * (1 - t) + np.array(BOTTOM) * t)[:, None, :].repeat(w, 1)
    return Image.fromarray(np.dstack([rgb, np.full((h, w), 255)]).astype(np.uint8), "RGBA")


def remove_pen(chara):
    """ペンを消して、絵の構造どおりに描き直す（あごの線より上は肌、線、下は右どなりの髪・服の色を延ばす）"""
    a = np.asarray(chara).copy()
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]

    def capsule(p0, p1, r):
        p0, p1 = np.array(p0, float), np.array(p1, float)
        d = p1 - p0
        t = np.clip(((xx - p0[0]) * d[0] + (yy - p0[1]) * d[1]) / (d @ d), 0, 1)
        return np.hypot(xx - (p0[0] + t * d[0]), yy - (p0[1] + t * d[1])) < r

    mask = capsule((284, 808), (326, 735), 17) | capsule((285, 770), (304, 745), 5)
    fm = Image.new("L", (w, h), 0)
    ImageDraw.Draw(fm).polygon(FIST, fill=1)
    mask &= ~(np.asarray(fm) > 0)
    jaw = lambda x: 742 + (x - 298) * (10 / 38)      # ペンの裏を通るあごの線
    skin = a[722, 300].copy()
    line = np.array([48, 34, 32, 255], np.uint8)
    hair = np.array([38, 62, 84, 255], np.uint8)
    b = a.copy()
    for y, x in zip(*np.nonzero(mask)):
        j = jaw(x)
        if y < j - 2.2:
            b[y, x] = skin
        elif y < j + 2.2:
            b[y, x] = line
        else:
            xr = x
            while xr < w - 1 and mask[y, xr]:
                xr += 1
            c = a[y, min(xr + 3, w - 1)]
            b[y, x] = hair if (y < 808 and c[:3].mean() > 175) else c
    sm = np.asarray(Image.fromarray(b, "RGBA").filter(ImageFilter.GaussianBlur(0.7)))
    zone = nd.binary_dilation(mask, iterations=1)
    b[zone] = sm[zone]
    return Image.fromarray(b, "RGBA")


def fist_layer(chara):
    """こぶしだけを、なめらかな縁で切り出す"""
    ss = 4
    mask = Image.new("L", (chara.width * ss, chara.height * ss), 0)
    ImageDraw.Draw(mask).polygon([(x * ss, y * ss) for x, y in FIST], fill=255)
    mask = mask.filter(ImageFilter.MaxFilter(9)).resize(chara.size, Image.LANCZOS)
    out = chara.copy()
    out.putalpha(Image.fromarray(np.minimum(np.asarray(mask), np.asarray(chara.getchannel("A")))))
    return out


def lens_geometry(mag):
    a = np.asarray(mag).astype(int)
    luma = a[..., :3].mean(2)
    light = (luma > 200) & (a[..., 3] > 200)
    lab, _ = nd.label(light)
    h, w = light.shape
    glass = nd.binary_fill_holes(lab == lab[int(h * 0.34), int(w * 0.6)])
    cy, cx = nd.center_of_mass(glass)
    r = math.sqrt(glass.sum() / math.pi)
    ys, xs = np.nonzero(a[..., 3] > 128)
    far = np.argmax(np.hypot(xs - cx, ys - cy))
    return (cx, cy), r, (xs[far], ys[far]), glass


def place_magnifier(mag, canvas_size, lens_at, grip_at):
    """虫眼鏡を、レンズの中心と握る位置に合わせて拡大・回転して置く（ガラスは抜いて枠と柄だけ）"""
    (cx, cy), r, tip, glass = lens_geometry(mag)
    s = GLASS_R / r
    rot = math.degrees(math.atan2(grip_at[1] - lens_at[1], grip_at[0] - lens_at[0])
                       - math.atan2(tip[1] - cy, tip[0] - cx))
    arr = np.asarray(mag).copy()
    arr[..., 3][nd.binary_dilation(glass, iterations=2)] = 0
    rim = Image.fromarray(arr, "RGBA")
    big = rim.resize((round(rim.width * s), round(rim.height * s)), Image.LANCZOS)
    pad = int(max(big.size) * 1.6)
    stage = Image.new("RGBA", (pad * 2, pad * 2), (0, 0, 0, 0))
    stage.alpha_composite(big, (round(pad - cx * s), round(pad - cy * s)))
    stage = stage.rotate(-rot, resample=Image.BICUBIC, center=(pad, pad))
    layer = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    layer.paste(stage, (round(lens_at[0] - pad), round(lens_at[1] - pad)), stage)   # 空の層なので paste で足りる
    return layer


def compose():
    chara = Image.open(os.path.join(SRC, "chara.png")).convert("RGBA")
    mag = Image.open(os.path.join(SRC, "mag.png")).convert("RGBA")
    body = remove_pen(chara)
    fist = fist_layer(chara)

    ox, oy = OFFSET
    lens = (LENS[0] + ox, LENS[1] + oy)
    grip = (GRIP[0] + ox, GRIP[1] + oy)

    # 背景は透明で組み立てる（大きさを変えて置くときに、背景の継ぎ目が出ないように）
    canvas = Image.new("RGBA", (M, M), (0, 0, 0, 0))
    canvas.alpha_composite(body, (ox, oy))

    # レンズの中：後ろの絵を拡大して映す
    zoomed = canvas.resize((round(M * ZOOM), round(M * ZOOM)), Image.LANCZOS)
    zx, zy = round(lens[0] * ZOOM - lens[0]), round(lens[1] * ZOOM - lens[1])
    zoomed = zoomed.crop((zx, zy, zx + M, zy + M))
    circle = Image.new("L", (M * 4, M * 4), 0)
    ImageDraw.Draw(circle).ellipse(((lens[0] - GLASS_R) * 4, (lens[1] - GLASS_R) * 4,
                                    (lens[0] + GLASS_R) * 4, (lens[1] + GLASS_R) * 4), fill=255)
    circle = circle.resize((M, M), Image.LANCZOS)
    inside = canvas.copy()
    inside.paste(zoomed, (0, 0))
    canvas = Image.composite(inside, canvas, circle)

    # ガラスらしさ：ほんのり白く、左上に光、ふちに影
    box = (lens[0] - GLASS_R, lens[1] - GLASS_R, lens[0] + GLASS_R, lens[1] + GLASS_R)
    tint = Image.new("RGBA", (M, M), (0, 0, 0, 0))
    ImageDraw.Draw(tint).ellipse(box, fill=(255, 252, 245, 26))
    edge = Image.new("RGBA", (M, M), (0, 0, 0, 0))
    ImageDraw.Draw(edge).ellipse(tuple(v + (4 if i < 2 else -4) for i, v in enumerate(box)), outline=(70, 45, 25, 60), width=9)
    edge = edge.filter(ImageFilter.GaussianBlur(5))
    edge.putalpha(Image.fromarray((np.asarray(edge)[..., 3] * (np.asarray(circle) / 255)).astype(np.uint8)))
    hl = Image.new("RGBA", (M, M), (0, 0, 0, 0))
    ImageDraw.Draw(hl).arc(tuple(v + (22 if i < 2 else -22) for i, v in enumerate(box)), start=200, end=262,
                           fill=(255, 255, 255, 190), width=13)
    ImageDraw.Draw(hl).ellipse((lens[0] + 36, lens[1] + 44, lens[0] + 52, lens[1] + 60), fill=(255, 255, 255, 120))
    hl = hl.filter(ImageFilter.GaussianBlur(2.2))
    for lay in (tint, edge, hl):
        canvas.alpha_composite(lay)

    # 枠と柄。うっすら影を落としてから重ね、最後にこぶしを手前に戻す
    rim = place_magnifier(mag, (M, M), lens, grip)
    shadow = Image.new("RGBA", (M, M), (60, 38, 20, 0))
    shadow.putalpha(rim.getchannel("A").point(lambda v: int(v * 0.22)))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(7)), (7, 10))
    canvas.alpha_composite(rim)
    canvas.alpha_composite(fist, (ox, oy))
    return canvas


def rounded(img, radius_ratio=0.2):
    mask = Image.new("L", (img.width * 4, img.height * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, mask.width - 1, mask.height - 1), radius=int(mask.width * radius_ratio), fill=255)
    out = img.copy()
    out.putalpha(mask.resize(img.size, Image.LANCZOS))
    return out


def save(img, name, size, rgb=False):
    im = img.resize((size, size), Image.LANCZOS)
    if rgb:
        im = im.convert("RGB")
    path = os.path.join(ICONS, name)
    im.save(path, optimize=True)
    print("wrote", os.path.relpath(path, ROOT), im.size)


def main():
    os.makedirs(ICONS, exist_ok=True)
    cut_sources()
    figure = compose()                                  # 背景なしの絵
    master = gradient((M, M))
    master.alpha_composite(figure)
    master.save(os.path.join(SRC, "icon_master.png"))

    save(rounded(master), "icon-512.png", 512)
    save(rounded(master), "icon-192.png", 192)
    save(master, "apple-touch-icon.png", 180, rgb=True)        # iPhone は自分で角を丸めるので四角のまま

    # maskable：丸や角丸で切られても顔と虫眼鏡が欠けないよう、内側 80% に収める
    mk = gradient((M, M))
    inner = figure.resize((int(M * 0.8), int(M * 0.8)), Image.LANCZOS)
    mk.alpha_composite(inner, (int(M * 0.1), M - inner.height))
    save(mk, "icon-maskable-512.png", 512, rgb=True)

    # ファビコン：小さくても分かるよう、顔と虫眼鏡まわりを大きく切り出す
    fav = master.crop((30, 150, 904, 1024))
    for s in (32, 48, 192):
        save(rounded(fav, 0.22), f"favicon-{s}.png", s)


if __name__ == "__main__":
    main()
