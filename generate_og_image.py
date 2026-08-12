"""OGP画像(public/og-image.png)を生成する。

X・LINE・Facebook等でURLを共有した際のプレビューカードに使う1200x630の画像。
サイトの3D散布図を模した背景の上にサイト名・説明を載せる。
配置は乱数シード固定なので、実行するたびに同じ画像が生成される。

    python generate_og_image.py
"""

import math
import random

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1200, 630
OUTPUT = "public/og-image.png"

# サイト本体(js/data.js の SECTOR_COLORS)から抜粋した業種カラー。
# 散布図の球と同じ色味にすることでサイトの見た目と印象を揃える。
BUBBLE_COLORS = [
    "#4C8DF6", "#EA4335", "#34A853", "#9B6BDE", "#F5A623",
    "#4FC3F7", "#F06292", "#16A085", "#27AE60", "#E67E22",
    "#5C6BC0", "#26A69A", "#8E44AD", "#00838F",
]

FONT_BOLD = r"C:\Windows\Fonts\YuGothB.ttc"
FONT_MEDIUM = r"C:\Windows\Fonts\YuGothM.ttc"


def lerp_color(c1, c2, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(c1, c2))


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def draw_background(img):
    """左上から右下へ向かう斜めグラデーション(濃紺→ブランド色寄りの藍)。"""
    top_left = hex_to_rgb("#0b1220")
    bottom_right = hex_to_rgb("#1e3a6d")
    draw = ImageDraw.Draw(img)
    for y in range(HEIGHT):
        for_x_t = y / (HEIGHT - 1)
        # 行ごとに単色を引き、行内は左右で微妙に変える代わりに斜め感を係数で調整する。
        t = min(1.0, for_x_t * 0.85 + 0.15)
        draw.line([(0, y), (WIDTH, y)], fill=lerp_color(top_left, bottom_right, t))


# 球を描く領域。左側のテキスト（タイトル右端は約753px）と重ならないよう左端を制限する。
BUBBLE_AREA_LEFT = 790
AXIS_ORIGIN = (836, 520)


def draw_axes(overlay):
    """散布図のO点から伸びる3軸を思わせる線を右側に配置する。"""
    draw = ImageDraw.Draw(overlay)
    # X（右奥）・Y（上）・Z（右手前）の3方向。サイト本体の黒い基準軸に対応する。
    for end in [(1164, 442), (836, 142), (1052, 606)]:
        draw.line([AXIS_ORIGIN, end], fill=(255, 255, 255, 70), width=3)


def draw_bubbles(overlay):
    """時価総額の大小を模した半透明の球をランダムに散らす。"""
    rnd = random.Random(20260813)  # 実行のたびに同じ配置になるよう固定
    draw = ImageDraw.Draw(overlay)
    # 中心付近に密集し外側へ疎になるよう、極座標で半径に偏りを持たせる。
    center_x, center_y = 990, 315
    for _ in range(48):
        angle = rnd.uniform(0, math.tau)
        dist = rnd.random() ** 1.6 * 230
        x = center_x + math.cos(angle) * dist * 1.1
        y = center_y + math.sin(angle) * dist * 0.95
        r = rnd.choice([8, 11, 14, 18, 24, 30])
        if x - r < BUBBLE_AREA_LEFT:
            continue  # テキスト側にはみ出す球は描かない
        color = hex_to_rgb(rnd.choice(BUBBLE_COLORS))
        alpha = rnd.randint(120, 215)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color + (alpha,))


def main():
    img = Image.new("RGB", (WIDTH, HEIGHT))
    draw_background(img)

    # 軸と球はアルファ合成したいので、いったんRGBAのレイヤーへ描いてから合成する。
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw_axes(overlay)
    draw_bubbles(overlay)
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    draw = ImageDraw.Draw(img)
    title_font = ImageFont.truetype(FONT_BOLD, 72)
    subtitle_font = ImageFont.truetype(FONT_MEDIUM, 31)
    footer_font = ImageFont.truetype(FONT_MEDIUM, 26)

    title = "株式3Dスクリーナー"

    # 左側にテキストを縦に積む。右側は散布図のビジュアルに譲る。
    draw.text((80, 222), title, font=title_font, fill=(255, 255, 255))
    draw.text((84, 328), "3つの財務指標で", font=subtitle_font, fill=(186, 205, 240))
    draw.text((84, 374), "日本株の分布を3D可視化", font=subtitle_font, fill=(186, 205, 240))

    # ブランドカラーのアクセントライン
    draw.rectangle([80, 190, 176, 196], fill=hex_to_rgb("#4C8DF6"))

    draw.text((84, 470), "kabu3d.xyz", font=footer_font, fill=(120, 158, 235))
    draw.text((84, 508), "データ提供: EDINET DB", font=footer_font, fill=(130, 148, 178))

    img.save(OUTPUT, "PNG", optimize=True)
    title_right = draw.textbbox((80, 222), title, font=title_font)[2]
    print(f"generated: {OUTPUT} ({WIDTH}x{HEIGHT})")
    print(f"title right edge: {title_right}px (bubble area starts at {BUBBLE_AREA_LEFT}px)")


if __name__ == "__main__":
    main()
