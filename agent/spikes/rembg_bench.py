"""Spike A (T-010, 11 §7): seconds per photo and peak memory of each rembg model on this server.

Run once per model in its own process (`python rembg_bench.py <model> <photos> <out> [max_px]`), so
`ru_maxrss` is that model's peak. Photos are reduced to ≤ max_px first: 2048 as the app keeps them (10 §4.2),
or 1024, the size of the processed rendition (10 §5).
"""

import json
import resource
import sys
import time
from pathlib import Path

from PIL import Image
from rembg import new_session, remove


def main(model: str, photos: Path, out: Path, max_px: int = 2048) -> None:
    out.mkdir(parents=True, exist_ok=True)
    start = time.perf_counter()
    session = new_session(model)
    load_s = time.perf_counter() - start
    rows = []
    for path in sorted(photos.glob("*.jpg")):
        img = Image.open(path).convert("RGB")
        img.thumbnail((max_px, max_px))
        t = time.perf_counter()
        cut = remove(img, session=session)
        rows.append({"photo": path.name, "size": img.size, "s": round(time.perf_counter() - t, 2)})
        cut.save(out / f"{path.stem}-{model}-{max_px}.png")
    peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    print(
        json.dumps(
            {
                "model": model,
                "max_px": max_px,
                "load_s": round(load_s, 2),
                "peak_mb": round(peak_mb),
                "photos": rows,
            }
        )
    )


if __name__ == "__main__":
    main(sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 2048)
