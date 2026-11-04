"""Settings from the environment and agent/.env (07 §3)."""

from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    api_base: str
    # Only its SHA-256 lives in the Worker; never logged.
    agent_token: SecretStr
    agent_id: str = "home"
    tz: str = "America/Mexico_City"
    data_dir: Path = Path("/data")
    log_level: str = "INFO"

    poll_interval_s: int = 60
    scrape_tick_s: int = 30
    max_http_concurrency: int = 2
    max_browser_concurrency: int = 1
    playwright_enabled: bool = True
    browser_restart_every: int = 50
    reference_postal_code: str = "72750"
    # A recent stable Chrome, the version of the image's Chromium (07 §8.1).
    chrome_ua: str = (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/153.0.0.0 Safari/537.36"
    )
    http_timeout_s: float = 20
    browser_timeout_s: float = 40

    backup_enabled: bool = True
    backup_hour: int = 3
    backup_weekday: int = 6
    backup_keep_weekly: int = 8
    # D1's migrations, copied into the image (07 §12); the mirror is built from them.
    migrations_dir: Path = Path("/app/migrations")
    r2_endpoint: str = ""
    r2_bucket: str = "maunedas-images"
    r2_access_key_id: str = ""
    r2_secret_access_key: SecretStr = SecretStr("")

    images_enabled: bool = False
    # Provisional until D5 closes (spike A: isnet-general-use went past 1.8 GB on the A8-7410).
    rembg_model: str = "u2netp"
    images_idle_s: int = 60

    @property
    def db_path(self) -> Path:
        return self.data_dir / "agent.sqlite"
