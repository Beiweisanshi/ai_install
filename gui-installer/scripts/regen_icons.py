"""Regenerate Tauri app icons from a source PNG.

- Detect the sesame (foreground) bbox by measuring distance from the estimated
  background colour, take a square crop centred on that bbox with a small
  margin, and resample to a 1024x1024 master image.
- From the master, write all PNG sizes in src-tauri/icons and a multi-size
  icon.ico.  icon.icns is regenerated via Pillow's ICNS writer.
"""

from pathlib import Path
from PIL import Image, ImageFilter

SRC = Path(r"D:\own\企划\图标\zhima1.png")
ICON_DIR = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"

# Threshold for "this pixel differs from background" in the per-channel max
# absolute-difference image.  Chosen empirically; 32 reliably picks up the
# sesame body (lightest midtones ~215) on a ~247 background while ignoring
# JPEG-style noise speckle.
FG_THRESHOLD = 32

# Fraction of the sesame's longest side added as padding on each side of the
# square crop.  0.125 = 12.5% margin top/bottom/left/right => crop side is
# longest_bbox_side * 1.25.
MARGIN = 0.125


def estimate_background(rgb: Image.Image) -> tuple[int, int, int]:
    w, h = rgb.size
    samples = [rgb.getpixel((x, y))
               for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]]
    r = sum(s[0] for s in samples) // len(samples)
    g = sum(s[1] for s in samples) // len(samples)
    b = sum(s[2] for s in samples) // len(samples)
    return (r, g, b)


def foreground_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    rgb = img.convert("RGB")
    bg = estimate_background(rgb)
    # Build a single-channel mask where each pixel is max(|r-bg.r|, |g-bg.g|, |b-bg.b|).
    # Pillow has no direct op for this, so do it in numpy-free pure Pillow:
    r, g, b = rgb.split()
    # per-channel |pixel - bg| via point()
    r = r.point(lambda v, c=bg[0]: abs(v - c))
    g = g.point(lambda v, c=bg[1]: abs(v - c))
    b = b.point(lambda v, c=bg[2]: abs(v - c))
    # max of the three channels
    from PIL import ImageChops
    diff = ImageChops.lighter(ImageChops.lighter(r, g), b)
    # Median (size 5) then erosion (MinFilter size 5) kills JPEG speckle and
    # isolated sensor noise near the image edges — without erosion, a
    # handful of stray pixels near corners inflate the bbox to the full
    # image width.
    diff = diff.filter(ImageFilter.MedianFilter(size=5))
    mask = diff.point(lambda v: 255 if v >= FG_THRESHOLD else 0)
    mask = mask.filter(ImageFilter.MinFilter(size=5))
    bbox = mask.getbbox()
    if bbox is None:
        raise RuntimeError("No foreground detected — adjust FG_THRESHOLD.")
    return bbox


def square_crop_centred(img: Image.Image, bbox: tuple[int, int, int, int]) -> Image.Image:
    left, top, right, bottom = bbox
    cx = (left + right) / 2
    cy = (top + bottom) / 2
    longest = max(right - left, bottom - top)
    side = int(longest * (1 + 2 * MARGIN))

    img_w, img_h = img.size

    # Clamp the centre so the square stays inside the image.  If side is
    # larger than the image in any dimension, shrink it to the minimum
    # dimension — the foreground will still be centred, just with less
    # margin than requested.
    side = min(side, img_w, img_h)
    half = side / 2

    cx = max(half, min(img_w - half, cx))
    cy = max(half, min(img_h - half, cy))

    left_i = int(round(cx - half))
    top_i = int(round(cy - half))
    right_i = left_i + side
    bottom_i = top_i + side

    # Keep the original mode (RGBA preserves any alpha the source had).
    return img.crop((left_i, top_i, right_i, bottom_i))


def build_master(src: Path, master_size: int = 1024) -> Image.Image:
    img = Image.open(src)
    bbox = foreground_bbox(img)
    print(f"Foreground bbox: {bbox}  (image size: {img.size})")
    squared = square_crop_centred(img, bbox)
    print(f"Square crop size: {squared.size}")
    return squared.resize((master_size, master_size), Image.LANCZOS)


PNG_SIZES = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}

ICO_SIZES = [16, 32, 48, 64, 128, 256]
ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024]


def write_all(master: Image.Image, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    for name, size in PNG_SIZES.items():
        img = master.resize((size, size), Image.LANCZOS)
        path = out_dir / name
        img.save(path, format="PNG")
        print(f"wrote {path.name} ({size}x{size})")

    # Windows .ico — multi-resolution
    ico_path = out_dir / "icon.ico"
    master.save(ico_path, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"wrote {ico_path.name} (sizes: {ICO_SIZES})")

    # macOS .icns — Pillow supports a set of canonical sizes
    icns_path = out_dir / "icon.icns"
    try:
        master.save(icns_path, format="ICNS", sizes=[(s, s) for s in ICNS_SIZES])
        print(f"wrote {icns_path.name} (sizes: {ICNS_SIZES})")
    except Exception as e:
        print(f"WARNING: failed to write icon.icns — {e}. "
              f"Previous file kept intact.")


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"source not found: {SRC}")
    master = build_master(SRC)
    write_all(master, ICON_DIR)


if __name__ == "__main__":
    main()
