from pydantic import BaseModel, Field


class SchedulerConfigModel(BaseModel):
    """Configuration for automated periodic energy reporting."""
    enabled: bool = Field(default=True, description="Whether automated reports are scheduled")
    delivery_mode: str = Field(default="separate", description="Delivery mode: 'separate' or 'combined'")
    recipient_email: str = Field(default="manager@voltguard.org", description="Default recipient email")
    delivery_day: str = Field(default="1", description="Day of month or weekday for schedule")
    delivery_time: str = Field(default="09:00", description="Dispatch time in 24hr format HH:MM")
    reporting_period: str = Field(default="prev_calendar_month", description="Billing reporting interval")
    format: str = Field(default="pdf", description="Report file format")
    timezone: str = Field(default="Asia/Kolkata", description="Timezone name")
