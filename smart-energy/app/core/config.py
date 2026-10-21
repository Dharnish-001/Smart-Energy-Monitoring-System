import os
from pathlib import Path
from typing import List

# Path to the backend root directory (where energy.db resides)
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


class Settings:
    """Application configuration and environment settings."""

    PROJECT_NAME: str = os.getenv("PROJECT_NAME", "Smart Energy Monitoring System")
    PROJECT_DESCRIPTION: str = os.getenv(
        "PROJECT_DESCRIPTION",
        "IoT-based 3 House Energy Monitoring System with Real-Time Telemetry and Analytics"
    )
    VERSION: str = "1.0.0"

    # API Configuration
    API_PREFIX: str = "/api"

    # Database Configuration
    DATABASE_PATH: Path = Path(os.getenv("DATABASE_PATH", str(BACKEND_DIR / "energy.db")))

    # Static Directory for Frontend Assets (HTML, CSS, JS)
    STATIC_DIR: Path = Path(os.getenv("STATIC_DIR", str(BACKEND_DIR / "static")))

    # CORS settings
    CORS_ORIGINS: List[str] = ["*"]
    CORS_ALLOW_CREDENTIALS: bool = True
    CORS_ALLOW_METHODS: List[str] = ["*"]
    CORS_ALLOW_HEADERS: List[str] = ["*"]

    # System Constants
    VALID_HOUSE_IDS: List[int] = [1, 2, 3]
    DEFAULT_TARIFF: float = 8.5
    DEFAULT_RECIPIENT_EMAIL: str = "manager@voltguard.org"
    DEFAULT_TIMEZONE: str = "Asia/Kolkata"


settings = Settings()
