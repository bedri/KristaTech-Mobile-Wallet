#!/usr/bin/env python3
"""Render anti-aliased KRISTA PWA, Android mipmap, and iOS icon/splash PNG assets."""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_ICONS = os.path.join(ROOT, "public", "icons")
RESOURCES_DIR = os.path.join(ROOT, "resources")

os.makedirs(PUBLIC_ICONS, exist_ok=True)
os.makedirs(RESOURCES_DIR, exist_ok=True)

BG_DARK = (11, 16, 29, 255)    # #0b101d
COBALT = (118, 149, 205, 255)  # #7695CD
CORAL = (245, 137, 124, 255)   # #F5897C

# Vector geometry from public/logo.svg (viewBox="179.765625 143.0078125 58 58")
VX, VY, VW = 179.765625, 143.0078125, 58.0

K_POLY = [
    (225.105469, 194.265625),
    (209.386719, 172.542969),
    (209.386719, 194.265625),
    (199.753906, 194.265625),
    (199.753906, 170.3125),
    (209.386719, 170.3125),
    (223.976562, 149.75),
    (235.203125, 149.75),
    (220.058594, 171.078125),
    (236.859375, 194.265625),
]

SQUARES = [
    (190.210938, 160.769531, 199.753906, 170.3125),
    (199.753906, 151.226562, 209.292969, 160.769531),
    (180.671875, 151.226562, 190.210938, 160.769531),
]


def draw_mark(draw: ImageDraw.ImageDraw, origin_x: float, origin_y: float, span: float) -> None:
    def tx(pt):
        return (
            origin_x + ((pt[0] - VX) / VW) * span,
            origin_y + ((pt[1] - VY) / VW) * span,
        )

    for sq in SQUARES:
        x0, y0 = tx((sq[0], sq[1]))
        x1, y1 = tx((sq[2], sq[3]))
        draw.rectangle([x0, y0, x1, y1], fill=COBALT)

    draw.polygon([tx(p) for p in K_POLY], fill=CORAL)


def render_square_icon(size: int, out_path: str, rounded: bool = True, inner_ratio: float = 0.14, transparent_bg: bool = False) -> None:
    scale = 4
    hi = size * scale
    img = Image.new("RGBA", (hi, hi), (0, 0, 0, 0) if (rounded or transparent_bg) else BG_DARK)
    draw = ImageDraw.Draw(img)

    if not transparent_bg:
        if rounded:
            pad = max(2, hi // 28)
            radius = hi // 5
            draw.rounded_rectangle([pad, pad, hi - pad, hi - pad], radius=radius, fill=BG_DARK)
        else:
            draw.rectangle([0, 0, hi, hi], fill=BG_DARK)

    inner_pad = hi * inner_ratio
    span = hi - 2 * inner_pad
    draw_mark(draw, inner_pad, inner_pad, span)

    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    final_img.save(out_path, format="PNG")
    print(f"Generated {os.path.relpath(out_path, ROOT)} ({size}x{size})")


def render_round_icon(size: int, out_path: str, inner_ratio: float = 0.18) -> None:
    scale = 4
    hi = size * scale
    img = Image.new("RGBA", (hi, hi), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = max(2, hi // 24)
    draw.ellipse([pad, pad, hi - pad, hi - pad], fill=BG_DARK)

    inner_pad = hi * inner_ratio
    span = hi - 2 * inner_pad
    draw_mark(draw, inner_pad, inner_pad, span)

    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    final_img.save(out_path, format="PNG")
    print(f"Generated {os.path.relpath(out_path, ROOT)} ({size}x{size})")


def render_splash(size: int, out_path: str) -> None:
    img = Image.new("RGBA", (size, size), BG_DARK)
    draw = ImageDraw.Draw(img)
    mark_span = size * 0.24
    offset = (size - mark_span) / 2.0
    draw_mark(draw, offset, offset, mark_span)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.convert("RGB").save(out_path, format="PNG")
    print(f"Generated {os.path.relpath(out_path, ROOT)} ({size}x{size})")


def main() -> None:
    # PWA & Store Icons
    render_square_icon(192, os.path.join(PUBLIC_ICONS, "icon-192.png"), rounded=True, inner_ratio=0.14)
    render_square_icon(512, os.path.join(PUBLIC_ICONS, "icon-512.png"), rounded=True, inner_ratio=0.14)
    render_square_icon(512, os.path.join(PUBLIC_ICONS, "icon-maskable-512.png"), rounded=False, inner_ratio=0.22)
    render_square_icon(180, os.path.join(PUBLIC_ICONS, "apple-touch-icon-180.png"), rounded=False, inner_ratio=0.16)

    render_square_icon(1024, os.path.join(RESOURCES_DIR, "icon-1024.png"), rounded=False, inner_ratio=0.16)
    render_splash(2732, os.path.join(RESOURCES_DIR, "splash-2732.png"))

    # Android Native Mipmaps (if `android` platform was already added)
    android_res = os.path.join(ROOT, "android", "app", "src", "main", "res")
    if os.path.isdir(android_res):
        densities = {
            "mdpi": (48, 108),
            "hdpi": (72, 162),
            "xhdpi": (96, 216),
            "xxhdpi": (144, 324),
            "xxxhdpi": (192, 432),
        }
        for d, (launcher_px, fg_px) in densities.items():
            mdir = os.path.join(android_res, f"mipmap-{d}")
            if os.path.isdir(mdir):
                render_square_icon(launcher_px, os.path.join(mdir, "ic_launcher.png"), rounded=True, inner_ratio=0.16)
                render_round_icon(launcher_px, os.path.join(mdir, "ic_launcher_round.png"), inner_ratio=0.18)
                render_square_icon(
                    fg_px,
                    os.path.join(mdir, "ic_launcher_foreground.png"),
                    rounded=False,
                    inner_ratio=0.26,
                    transparent_bg=True,
                )

    # iOS Native AppIcon (if `ios` platform was already added)
    ios_appicon = os.path.join(ROOT, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset")
    if os.path.isdir(ios_appicon):
        render_square_icon(1024, os.path.join(ios_appicon, "AppIcon-512@2x.png"), rounded=False, inner_ratio=0.16)


if __name__ == "__main__":
    main()
