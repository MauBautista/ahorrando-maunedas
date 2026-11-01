"""Adapters by name (07 §9). Walmart has none: it answers with a captcha from the first request (T34)."""

from maunedas_agent.adapters.amazon_mx import AmazonMx
from maunedas_agent.adapters.base import Adapter
from maunedas_agent.adapters.costco_mx import CostcoMx
from maunedas_agent.adapters.sams_mx import SamsMx

ADAPTERS: dict[str, Adapter] = {a.name: a for a in (AmazonMx(), SamsMx(), CostcoMx())}
