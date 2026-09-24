"""Derived textures for the arena build (system Python + Pillow, run before build_arena.py).

    python tools/blender/prep_textures.py

Reads the Poly Haven sources in blender/tex/ and writes blender/tex/derived/:
  kawara_diff.jpg   roof_tiles recoloured to dark ibushi (smoked) clay
  paper_diff.png    lantern paper with ribs and a painted kanji
  lattice_diff.png  lit / unlit shoji lattice for the castle windows
  wood_dark_diff.jpg weathered_planks stained black
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "blender" / "tex"
OUT = SRC / "derived"
OUT.mkdir(parents=True, exist_ok=True)


def kawara() -> None:
    im = Image.open(SRC / "roof_tiles_diff_2k.jpg").convert("RGB")
    lum = ImageOps.autocontrast(im.convert("L"), cutoff=1)
    # Smoked clay: blue-grey, dark, keep the grime and lichen variation from the photo.
    # Slightly blue so the low orange sun lands on it as grey clay, not terracotta.
    dark = (12, 13, 19)
    light = (48, 53, 66)
    ImageOps.colorize(lum, dark, light).save(OUT / "kawara_diff.jpg", quality=92)


def font(size: int) -> ImageFont.FreeTypeFont:
    for f in ("C:/Windows/Fonts/YuMincho.ttc", "C:/Windows/Fonts/msmincho.ttc", "C:/Windows/Fonts/YuGothB.ttc", "C:/Windows/Fonts/msgothic.ttc"):
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def paper() -> None:
    w, h = 256, 512
    im = Image.new("RGB", (w, h), (255, 207, 138))
    d = ImageDraw.Draw(im)
    for y in range(24, h, 44):
        d.rectangle([0, y, w, y + 6], fill=(196, 128, 72))
    d.text((w / 2, h * 0.55), "祭", font=font(170), fill=(150, 30, 10), anchor="mm")
    im.save(OUT / "paper_diff.png")


def lattice() -> None:
    # Left half lit (warm paper behind a wooden grid), right half unlit.
    w, h = 256, 128
    im = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w // 2 - 1, h], fill=(255, 179, 90))
    d.rectangle([w // 2, 0, w, h], fill=(26, 23, 22))
    for x0, c in ((0, (106, 58, 24)), (w // 2, (58, 48, 42))):
        for k in range(0, 6):
            x = x0 + k * (w // 2) // 5
            d.rectangle([x, 0, x + 4, h], fill=c)
        for y in (0, h // 2 - 2, h - 5):
            d.rectangle([x0, y, x0 + w // 2 - 1, y + 4], fill=c)
    im.save(OUT / "lattice_diff.png")


def wood_dark() -> None:
    # Black-stained clapboard (shitami-bari) and lacquered beams.
    im = Image.open(SRC / "weathered_planks_diff_1k.jpg").convert("RGB")
    ImageOps.colorize(ImageOps.autocontrast(im.convert("L"), cutoff=1), (12, 11, 11), (70, 62, 56)).save(OUT / "wood_dark_diff.jpg", quality=92)


if __name__ == "__main__":
    wood_dark()
    kawara()
    paper()
    lattice()
    print("derived textures ->", OUT)
