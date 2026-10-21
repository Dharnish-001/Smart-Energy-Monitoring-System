"""
Top-level entry point for the Smart Energy Monitoring System backend.

Allows running either:
    uvicorn main:app --reload
    uvicorn app.main:app --reload
    python main.py
"""

import uvicorn
from app.main import app
from app.schemas.energy import (
    EnergyData,
    TotalData,
    TelemetrySyncHouseItem,
    TelemetrySyncPayload,
)
from app.schemas.report import (
    EmailReportPayload,
    SeparateEmailsPayload,
)
from app.schemas.scheduler import (
    SchedulerConfigModel,
)
from app.api.deps import get_db

__all__ = [
    "app",
    "EnergyData",
    "TotalData",
    "TelemetrySyncHouseItem",
    "TelemetrySyncPayload",
    "EmailReportPayload",
    "SeparateEmailsPayload",
    "SchedulerConfigModel",
    "get_db",
]

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)