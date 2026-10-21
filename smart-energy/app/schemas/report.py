from pydantic import BaseModel, Field
from typing import Optional, List


class EmailReportPayload(BaseModel):
    """Payload for individual or combined PDF/CSV energy statement dispatch."""
    report_id: str = Field(..., description="Unique generated report identifier")
    period: str = Field(..., description="Billing/reporting period, e.g. Oct 2026")
    recipient: str = Field(..., description="Target email address")
    cc: Optional[str] = Field(default="", description="Optional CC recipient(s)")
    house_id: Optional[int] = Field(default=None, description="House ID or null for combined")
    house_name: Optional[str] = Field(default=None, description="Descriptive house name")
    tariff: float = Field(default=8.5, description="Tariff rate (₹/kWh)")
    format: str = Field(default="pdf", description="Attachment document format (pdf/csv)")
    energy: float = Field(..., description="Total Energy Consumed (kWh)")
    cost: float = Field(..., description="Total Calculated Cost (₹)")
    voltage: Optional[float] = None
    current: Optional[float] = None
    power: Optional[float] = None
    pf: Optional[float] = None


class SeparateEmailsPayload(BaseModel):
    """Batch payload to dispatch separate statements for each individual house."""
    period: str = Field(..., description="Billing/reporting period")
    tariff: float = Field(default=8.5, description="Tariff rate (₹/kWh)")
    format: str = Field(default="pdf", description="Attachment document format")
    items: List[EmailReportPayload]
