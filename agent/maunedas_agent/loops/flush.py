"""Sends the outbox to the Worker, up to 20 per request (07 §5.2); a result leaves only once accepted."""

import httpx

from maunedas_agent import log
from maunedas_agent.api import ApiError
from maunedas_agent.context import AgentContext

BATCH = 20
# The Worker will never accept these; one alone is dropped so it does not hold the rest forever.
REJECTED = frozenset({400, 413, 422})

logger = log.get("flush")


async def flush_once(ctx: AgentContext) -> int:
    """Sends until the outbox is empty or the Worker cannot be reached; returns how many were accepted."""
    accepted = 0
    size = BATCH
    while batch := ctx.store.outbox_batch(size):
        try:
            await ctx.api.observations([p.payload for p in batch])
        except ApiError as e:
            if e.status not in REJECTED:
                return _failed(ctx, e, accepted)
            if len(batch) > 1:
                # One bad result rejects the whole request: send one by one to find it.
                size = 1
                continue
            ctx.store.outbox_delete([batch[0].seq])
            ctx.last_error = f"observations: result rejected ({e})"
            logger.error("result_rejected", listing_id=batch[0].listing_id, status=e.status, code=e.code)
            continue
        except httpx.HTTPError as e:
            return _failed(ctx, e, accepted)
        ctx.store.outbox_delete([p.seq for p in batch])
        accepted += len(batch)
    if accepted:
        logger.info("flushed", accepted=accepted)
    return accepted


def _failed(ctx: AgentContext, e: Exception, accepted: int) -> int:
    ctx.last_error = f"observations: {e}"
    logger.warning("flush_failed", error=str(e), pending=ctx.store.outbox_size())
    return accepted
