import asyncio
from dataclasses import dataclass, field

from maunedas_agent.adapters.base import FetchContext, ScrapeResult


@dataclass
class FakeAdapter:
    """Answers its queued results (or raises them) in order, then ok at $1.00."""

    name: str = "amazon_mx"
    gate_key: str = ""
    min_spacing_s: int = 0
    needs_browser: bool = False
    domains: tuple[str, ...] = ("example.test",)
    results: list[ScrapeResult | Exception] = field(default_factory=list)
    calls: list[str] = field(default_factory=list)
    # When set, fetch waits for it; `running` counts fetches in progress.
    hold: asyncio.Event | None = None
    running: list[int] = field(default_factory=lambda: [0, 0])

    def __post_init__(self) -> None:
        self.gate_key = self.gate_key or self.name

    async def fetch(self, url: str, ctx: FetchContext) -> ScrapeResult:
        self.calls.append(url)
        self.running[0] += 1
        self.running[1] = max(self.running[1], self.running[0])
        try:
            if self.hold is not None:
                await self.hold.wait()
            r = (
                self.results.pop(0)
                if self.results
                else ScrapeResult("ok", price_cents=100, extra={"method": "fake"})
            )
        finally:
            self.running[0] -= 1
        if isinstance(r, Exception):
            raise r
        return r
