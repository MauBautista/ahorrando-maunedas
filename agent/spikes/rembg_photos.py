"""Spike A (T-010, the part without Mauricio): public product photos from Open Food Facts.

They time rembg on the A8-7410. One product request per barcode, one at a time with a pause (rule 10
spirit). The photos are CC BY-SA and stay in `out/` (not versioned); only timings and memory go to
docs/spikes/spike-a-rembg.md.
"""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

UA = "Maunedas-spike/0.1 (uso personal; https://github.com/MauBautista/ahorrando-maunedas)"
PRODUCT = "https://world.openfoodfacts.org/api/v2/product/{code}?fields=image_front_url"


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def main(out: Path, codes: list[str]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    kept = 0
    for code in codes:
        try:
            product = json.loads(get(PRODUCT.format(code=code))).get("product") or {}
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            product = {}
        url = product.get("image_front_url")
        time.sleep(2)
        if not url:
            print(code, "sin foto")
            continue
        kept += 1
        (out / f"{kept:02d}.jpg").write_bytes(get(url.replace(".400.", ".full.")))
        print(f"{kept:02d}.jpg", code, url)
        time.sleep(2)


if __name__ == "__main__":
    main(Path(sys.argv[1]), sys.argv[2:])
