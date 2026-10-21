from pydantic import BaseModel, Field
from typing import Optional, List


class EnergyData(BaseModel):
    """Telemetry payload received from an individual PZEM-004T energy meter."""
    voltage: float = Field(..., description="AC Voltage (V)")
    current: float = Field(..., description="AC Current (A)")
    power: float = Field(..., description="Active Power (W)")
    energy: float = Field(..., description="Accumulated Energy (kWh)")
    frequency: float = Field(..., description="Grid Frequency (Hz)")
    pf: float = Field(..., description="Power Factor (0.00 - 1.00)")
    cost: float = Field(..., description="Computed Energy Cost (₹)")


class TotalData(BaseModel):
    """Aggregate total consumption across all monitored houses."""
    power: float = Field(..., description="Aggregate Real-Time Active Power (W)")
    energy: float = Field(..., description="Aggregate Energy (kWh)")
    cost: float = Field(..., description="Aggregate Cost (₹)")


class TelemetrySyncHouseItem(BaseModel):
    """Individual house telemetry item in batch sync."""
    house_id: int
    voltage: float
    current: float
    power: float
    energy: float
    frequency: float
    pf: float
    cost: float


class TelemetrySyncPayload(BaseModel):
    """Batch payload synchronizing telemetry for all 3 houses and total."""
    houses: List[TelemetrySyncHouseItem]
    total: Optional[TotalData] = None
