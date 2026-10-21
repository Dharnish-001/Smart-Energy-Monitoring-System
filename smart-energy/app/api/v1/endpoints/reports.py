import sqlite3
from fastapi import APIRouter, Depends, Query
from app.api.deps import get_db
from app.schemas.report import EmailReportPayload, SeparateEmailsPayload
from app.schemas.scheduler import SchedulerConfigModel
from app.services.report_service import ReportService

router = APIRouter(prefix="/api/reports", tags=["Reports & Scheduling"])


@router.post(
    "/send-email",
    summary="Dispatch Single Energy Statement Email",
    description="Simulates sending a PDF/CSV energy statement to a designated recipient and logs the dispatch."
)
def send_report_email(
    payload: EmailReportPayload,
    db: sqlite3.Connection = Depends(get_db)
):
    return ReportService.send_report_email(db, payload)


@router.post(
    "/send-separate-emails",
    summary="Dispatch Separate House Statement Emails",
    description="Batch sends individualized energy statement emails for all 3 houses."
)
def send_separate_emails(
    batch: SeparateEmailsPayload,
    db: sqlite3.Connection = Depends(get_db)
):
    return ReportService.send_separate_emails(db, batch)


@router.get(
    "/email-logs",
    summary="Get Report Email Dispatch Logs",
    description="Fetches recent email dispatch audit logs with delivery IDs and statuses."
)
def email_logs(
    limit: int = Query(default=50, ge=1, le=500, description="Max audit entries to retrieve"),
    db: sqlite3.Connection = Depends(get_db)
):
    rows = ReportService.get_email_logs(db, limit)
    return {
        "count": len(rows),
        "data": rows
    }


@router.delete(
    "/email-logs",
    summary="Clear Report Email Audit Logs",
    description="Deletes all historical email delivery records from the database."
)
def clear_email_logs(
    db: sqlite3.Connection = Depends(get_db)
):
    ReportService.clear_email_logs(db)
    return {
        "status": "success",
        "message": "Email audit history cleared"
    }


@router.get(
    "/schedule",
    summary="Get Automated Scheduler Configuration",
    description="Retrieves the current periodic statement dispatch schedule."
)
def get_schedule(
    db: sqlite3.Connection = Depends(get_db)
):
    return ReportService.get_scheduler_config(db)


@router.post(
    "/schedule",
    summary="Update Automated Scheduler Configuration",
    description="Persists updated scheduling preferences and delivery mode."
)
def update_schedule(
    config: SchedulerConfigModel,
    db: sqlite3.Connection = Depends(get_db)
):
    config_data, now_iso = ReportService.update_scheduler_config(db, config)
    return {
        "status": "success",
        "message": "Scheduler configuration persisted in database",
        "config": config_data,
        "updated_at": now_iso
    }
