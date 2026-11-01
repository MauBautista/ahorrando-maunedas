from typing import Any

L1 = "0192a000-0000-7000-8000-000000000001"
L2 = "0192a000-0000-7000-8000-000000000002"
L3 = "0192a000-0000-7000-8000-000000000003"
STORE = "0192a000-0000-7000-8000-0000000000aa"


def listing(id: str, version: int, **over: Any) -> dict[str, Any]:
    return {
        "id": id,
        "adapter": "amazon_mx",
        "url": f"https://www.amazon.com.mx/Leche/dp/B0{version:08d}?ref=sr_1_1",
        "canonical_url": f"https://www.amazon.com.mx/dp/B0{version:08d}",
        "external_id": f"B0{version:08d}",
        "store_id": STORE,
        "interval_min": None,
        "active": 1,
        "version": version,
        **over,
    }


def work(
    upserts: list[dict[str, Any]] | None = None,
    removed: list[str] | None = None,
    cursor: list[Any] | None = None,
    has_more: bool = False,
    check_now: list[str] | None = None,
) -> dict[str, Any]:
    ups = upserts or []
    return {
        "server_time": 1,
        "listings": {
            "upserts": ups,
            "removed": removed or [],
            "cursor": cursor or ([ups[-1]["version"], ups[-1]["id"]] if ups else [0, ""]),
            "has_more": has_more,
        },
        "store_defaults": {STORE: 480},
        "check_now": check_now or [],
        "image_jobs_queued": 0,
        "config": {"min_spacing_s": {"amazon_mx": 45, "default": 20}},
    }
