import io
import json
from pathlib import Path

import httpx
import pytest
import respx
from PIL import Image

from maunedas_agent.api import AgentApi
from maunedas_agent.config import Settings
from maunedas_agent.images.health import healthy
from maunedas_agent.images.remove_bg import Rendered, render
from maunedas_agent.images.worker import ImageWorker
from tests.conftest import API

JOB = "0192a5e9-0000-7000-8000-00000000f001"
IMAGE = "0192a5e9-0000-7000-8000-00000000f002"


def jpeg(w: int, h: int, orientation: int | None = None) -> bytes:
    buf = io.BytesIO()
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    Image.new("RGB", (w, h), (120, 120, 120)).save(buf, "JPEG", exif=exif)
    return buf.getvalue()


class MiddleCutter:
    """Keeps the middle half of the photo, as if it were the product; remembers the sizes it got."""

    def __init__(self, finds: bool = True) -> None:
        self.finds = finds
        self.seen: list[tuple[int, int]] = []

    def __call__(self, img: Image.Image) -> Image.Image:
        self.seen.append(img.size)
        out = Image.new("RGBA", img.size, (0, 0, 0, 0))
        if self.finds:
            w, h = img.size
            out.paste(Image.new("RGBA", (w // 2, h // 2), (255, 0, 0, 255)), (w // 4, h // 4))
        return out


def opened(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


def test_render_keeps_the_subject_centered_on_a_square_with_its_margin() -> None:
    cut = MiddleCutter()
    r = render(jpeg(3000, 2000), cut)
    assert isinstance(r, Rendered)
    # Reduced to 2048 first, as the app keeps photos; the subject is 1024 × 683, with 82 px on each side.
    assert cut.seen == [(2048, 1365)]
    processed = opened(r.processed.data)
    assert (processed.format, processed.mode, processed.size) == ("WEBP", "RGBA", (1024, 1024))
    assert (r.processed.width, r.processed.height) == (1024, 1024)
    assert processed.getpixel((0, 0))[3] == 0
    # Lossy WebP: red within a few levels.
    red, green, blue, _ = processed.getpixel((512, 512))
    assert red > 245 and green < 10 and blue < 10
    thumb = opened(r.thumb.data)
    assert (thumb.format, thumb.size, thumb.getpixel((2, 2))) == ("WEBP", (256, 256), (255, 255, 255))
    # The mask covers the whole photo (2048 × 1365 → 1024 × 683), where the cutter kept the middle half.
    mask = opened(r.mask.data)
    assert (mask.format, mask.mode, mask.size) == ("PNG", "L", (1024, 683))
    assert (r.mask.width, r.mask.height) == (1024, 683)
    assert (mask.getpixel((10, 10)), mask.getpixel((512, 341)), mask.getpixel((1000, 670))) == (0, 255, 0)


def test_render_a_small_subject_keeps_its_size_and_the_photo_upright() -> None:
    cut = MiddleCutter()
    # EXIF 6: the camera held sideways; the photo is turned before cutting.
    r = render(jpeg(400, 200, orientation=6), cut, background=(0, 0, 255))
    assert cut.seen == [(200, 400)]
    assert r is not None
    # 100 × 200 with 16 px on each side.
    assert (r.processed.width, r.processed.height) == (232, 232)
    assert opened(r.thumb.data).getpixel((1, 1)) == (0, 0, 255)


def test_render_without_a_product_is_none() -> None:
    assert render(jpeg(100, 100), MiddleCutter(finds=False)) is None


@pytest.fixture
async def api(settings: Settings):
    async def sleep(_s: float) -> None:
        return None

    a = AgentApi(settings, sleep=sleep)
    yield a
    await a.aclose()


def claim_route(job: dict | None):
    if job is None:
        return respx.post(f"{API}/agent/v1/jobs/claim").respond(204)
    return respx.post(f"{API}/agent/v1/jobs/claim").respond(200, json={"job": job})


JOB_BODY = {
    "id": JOB,
    "image_id": IMAGE,
    "op": "remove_bg",
    "original_url": f"/agent/v1/images/{IMAGE}/original",
    "attempts": 1,
}


@respx.mock
async def test_a_job_is_cut_uploaded_and_completed(api: AgentApi, tmp_path: Path) -> None:
    claim_route(JOB_BODY)
    respx.get(f"{API}/agent/v1/images/{IMAGE}/original").respond(200, content=jpeg(800, 600))
    puts = respx.put(url__regex=rf"{API}/agent/v1/jobs/{JOB}/result/(mask|processed|thumb).*").respond(
        201, json={"rendition_id": "r"}
    )
    done = respx.post(f"{API}/agent/v1/jobs/{JOB}/complete").respond(204)
    loads = []
    worker = ImageWorker(api, lambda: loads.append(1) or MiddleCutter(), tmp_path / "alive")
    assert await worker.run_once() is True
    sent = [
        (c.request.url.path.rsplit("/", 1)[1], c.request.headers["Content-Type"], dict(c.request.url.params))
        for c in puts.calls
    ]
    assert sent == [
        ("mask", "image/png", {"width": "800", "height": "600"}),
        ("processed", "image/webp", {"width": "464", "height": "464"}),
        ("thumb", "image/webp", {"width": "256", "height": "256"}),
    ]
    assert done.called
    # The model loads once, on the first job.
    assert await worker.run_once() is True
    assert loads == [1]


@respx.mock
async def test_nothing_to_do_and_a_photo_without_a_product(api: AgentApi, tmp_path: Path) -> None:
    claim_route(None)
    worker = ImageWorker(api, lambda: MiddleCutter(finds=False), tmp_path / "alive")
    assert await worker.run_once() is False
    respx.reset()
    claim_route(JOB_BODY)
    respx.get(f"{API}/agent/v1/images/{IMAGE}/original").respond(200, content=jpeg(100, 100))
    failed = respx.post(f"{API}/agent/v1/jobs/{JOB}/fail").respond(204)
    assert await worker.run_once() is True
    assert json.loads(failed.calls.last.request.content) == {
        "error": "ValueError: no se encontró el producto en la foto"
    }


@respx.mock
async def test_a_lost_lease_stops_without_failing_the_job(api: AgentApi, tmp_path: Path) -> None:
    claim_route(JOB_BODY)
    respx.get(f"{API}/agent/v1/images/{IMAGE}/original").respond(200, content=jpeg(400, 400))
    respx.put(url__regex=rf"{API}/agent/v1/jobs/{JOB}/result/.*").respond(
        404, json={"error": {"code": "NOT_FOUND"}}
    )
    failed = respx.post(f"{API}/agent/v1/jobs/{JOB}/fail").respond(204)
    worker = ImageWorker(api, MiddleCutter, tmp_path / "alive")
    assert await worker.run_once() is True
    assert not failed.called


@respx.mock
async def test_the_loop_beats_waits_when_idle_and_survives_a_down_worker(
    api: AgentApi, tmp_path: Path
) -> None:
    # Down (three tries), then a job, then nothing: it waits after the first and the last, not after the job.
    claims = respx.post(f"{API}/agent/v1/jobs/claim").mock(
        side_effect=[httpx.ConnectError("down")] * 3
        + [httpx.Response(200, json={"job": JOB_BODY}), httpx.Response(204)]
    )
    respx.get(f"{API}/agent/v1/images/{IMAGE}/original").respond(200, content=jpeg(400, 400))
    respx.put(url__regex=rf"{API}/agent/v1/jobs/{JOB}/result/.*").respond(201, json={"rendition_id": "r"})
    done = respx.post(f"{API}/agent/v1/jobs/{JOB}/complete").respond(204)
    slept: list[float] = []

    async def sleep(s: float) -> None:
        slept.append(s)
        if len(slept) == 2:
            raise KeyboardInterrupt

    beat = tmp_path / "alive"
    worker = ImageWorker(api, MiddleCutter, beat, idle_s=60, sleep=sleep)
    with pytest.raises(KeyboardInterrupt):
        await worker.run()
    assert (slept, claims.call_count, done.called) == ([60, 60], 5, True)
    assert healthy(beat, beat.stat().st_mtime + 299) and not healthy(beat, beat.stat().st_mtime + 300)
    assert not healthy(tmp_path / "missing", 0)
