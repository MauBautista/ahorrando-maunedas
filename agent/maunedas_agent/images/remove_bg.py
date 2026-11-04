"""A product photo without its background, as the three renditions of 10 §5 (the phone's same steps).

1. The subject: what the model leaves with alpha > 0, cropped to it.
2. A square canvas with a margin of 8 % of the subject's longer side on each side.
3. `processed`: WebP with alpha, side ≤ 1024. `thumb`: 256 px over the background (white by default), WebP.
   `mask`: the alpha channel as a grayscale PNG.
"""

import io
from collections.abc import Callable
from dataclasses import dataclass

from PIL import Image, ImageOps

INPUT_MAX = 2048
PROCESSED_MAX = 1024
THUMB_SIDE = 256
MARGIN = 0.08
QUALITY = 85

# A photo in, the same photo with a transparent background out.
Cutter = Callable[[Image.Image], Image.Image]


@dataclass(frozen=True)
class Rendition:
    data: bytes
    width: int
    height: int


@dataclass(frozen=True)
class Rendered:
    mask: Rendition
    processed: Rendition
    thumb: Rendition


def rembg_cutter(model: str) -> Cutter:
    """rembg with [model], loaded once (07 §11); imported here because only the images container has it."""
    from rembg import new_session, remove

    session = new_session(model)
    return lambda img: remove(img, session=session)


def _encode(img: Image.Image, fmt: str, **options: object) -> Rendition:
    buf = io.BytesIO()
    img.save(buf, fmt, **options)
    return Rendition(buf.getvalue(), img.width, img.height)


def render(
    original: bytes, cut: Cutter, background: tuple[int, int, int] = (255, 255, 255)
) -> Rendered | None:
    """None when the model leaves nothing: there is no product to keep."""
    photo = ImageOps.exif_transpose(Image.open(io.BytesIO(original))).convert("RGB")
    photo.thumbnail((INPUT_MAX, INPUT_MAX))
    out = cut(photo).convert("RGBA")
    box = out.getchannel("A").getbbox()
    if box is None:
        return None
    subject = out.crop(box)
    longer = max(subject.size)
    margin = round(longer * MARGIN)
    side = longer + 2 * margin
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(subject, (margin + (longer - subject.width) // 2, margin + (longer - subject.height) // 2))
    if side > PROCESSED_MAX:
        square = square.resize((PROCESSED_MAX, PROCESSED_MAX), Image.Resampling.LANCZOS)
    small = square.resize((THUMB_SIDE, THUMB_SIDE), Image.Resampling.LANCZOS)
    thumb = Image.new("RGB", (THUMB_SIDE, THUMB_SIDE), background)
    thumb.paste(small, mask=small.getchannel("A"))
    return Rendered(
        mask=_encode(square.getchannel("A"), "PNG"),
        processed=_encode(square, "WEBP", quality=QUALITY),
        thumb=_encode(thumb, "WEBP", quality=QUALITY),
    )
