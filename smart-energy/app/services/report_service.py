import sqlite3
import uuid
from datetime import datetime
from typing import List, Dict, Any, Tuple
from app.schemas.report import EmailReportPayload, SeparateEmailsPayload
from app.schemas.scheduler import SchedulerConfigModel
from app.core.config import settings


class ReportService:
    """Service handling report email dispatches, audit logging, and schedule configuration."""

    @staticmethod
    def send_report_email(
        db: sqlite3.Connection,
        payload: EmailReportPayload
    ) -> Dict[str, Any]:
        """Dispatches an energy report statement email and records an audit log entry."""
        timestamp = datetime.now().isoformat()
        house_suffix = f"H{payload.house_id}" if payload.house_id else "ALL"
        delivery_id = f"VG-SMTP-{house_suffix}-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4].upper()}"

        house_desc = payload.house_name or (f"House {payload.house_id}" if payload.house_id else "All 3 Houses")
        db_house_name = payload.house_name or ("Combined System" if not payload.house_id else f"House {payload.house_id}")

        cursor = db.cursor()
        cursor.execute("""
            INSERT INTO report_emails (
                delivery_id,
                report_id,
                period,
                house_id,
                house_name,
                recipient,
                cc,
                tariff,
                energy,
                cost,
                format,
                status,
                timestamp
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            delivery_id,
            payload.report_id,
            payload.period,
            payload.house_id,
            db_house_name,
            payload.recipient,
            payload.cc or "",
            payload.tariff,
            payload.energy,
            payload.cost,
            payload.format,
            "Sent",
            timestamp
        ))
        db.commit()

        return {
            "status": "success",
            "delivery_id": delivery_id,
            "report_id": payload.report_id,
            "recipient": payload.recipient,
            "house_id": payload.house_id,
            "house_name": house_desc,
            "energy": payload.energy,
            "cost": payload.cost,
            "message": f"Energy report successfully transmitted to {payload.recipient} for {house_desc}.",
            "timestamp": timestamp
        }

    @staticmethod
    def send_separate_emails(
        db: sqlite3.Connection,
        batch: SeparateEmailsPayload
    ) -> Dict[str, Any]:
        """Dispatches separate reports for multiple houses and records audit logs."""
        timestamp = datetime.now().isoformat()
        dispatches = []
        cursor = db.cursor()

        for item in batch.items:
            house_suffix = f"H{item.house_id}" if item.house_id else "GEN"
            delivery_id = f"VG-SMTP-{house_suffix}-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4].upper()}"
            house_name = item.house_name or f"House {item.house_id}"

            cursor.execute("""
                INSERT INTO report_emails (
                    delivery_id,
                    report_id,
                    period,
                    house_id,
                    house_name,
                    recipient,
                    cc,
                    tariff,
                    energy,
                    cost,
                    format,
                    status,
                    timestamp
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                delivery_id,
                item.report_id,
                item.period,
                item.house_id,
                house_name,
                item.recipient,
                item.cc or "",
                item.tariff,
                item.energy,
                item.cost,
                item.format,
                "Sent",
                timestamp
            ))

            dispatches.append({
                "delivery_id": delivery_id,
                "report_id": item.report_id,
                "house_id": item.house_id,
                "house_name": house_name,
                "recipient": item.recipient,
                "energy": item.energy,
                "cost": item.cost,
                "status": "Sent"
            })

        db.commit()

        return {
            "status": "success",
            "message": f"Successfully dispatched {len(dispatches)} separate house reports via SMTP service.",
            "period": batch.period,
            "count": len(dispatches),
            "dispatches": dispatches,
            "timestamp": timestamp
        }

    @staticmethod
    def get_email_logs(
        db: sqlite3.Connection,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Retrieves past email audit logs ordered by newest first."""
        cursor = db.cursor()
        cursor.execute("""
            SELECT *
            FROM report_emails
            ORDER BY id DESC
            LIMIT ?
        """, (limit,))
        rows = cursor.fetchall()
        return [dict(r) for r in rows]

    @staticmethod
    def clear_email_logs(
        db: sqlite3.Connection
    ) -> None:
        """Deletes all report email audit logs from the database."""
        cursor = db.cursor()
        cursor.execute("DELETE FROM report_emails")
        db.commit()

    @staticmethod
    def get_scheduler_config(
        db: sqlite3.Connection
    ) -> Dict[str, Any]:
        """Fetches current automated reporting scheduler configuration."""
        cursor = db.cursor()
        cursor.execute("""
            SELECT * FROM scheduler_config
            ORDER BY id DESC
            LIMIT 1
        """)
        row = cursor.fetchone()
        if row:
            return dict(row)

        return {
            "enabled": 1,
            "delivery_mode": "separate",
            "recipient_email": settings.DEFAULT_RECIPIENT_EMAIL,
            "delivery_day": "1",
            "delivery_time": "09:00",
            "reporting_period": "prev_calendar_month",
            "format": "pdf",
            "timezone": settings.DEFAULT_TIMEZONE,
            "updated_at": datetime.now().isoformat()
        }

    @staticmethod
    def update_scheduler_config(
        db: sqlite3.Connection,
        config: SchedulerConfigModel
    ) -> Tuple[Dict[str, Any], str]:
        """Persists updated scheduler configuration in SQLite."""
        now_iso = datetime.now().isoformat()
        cursor = db.cursor()
        cursor.execute("""
            INSERT INTO scheduler_config (
                enabled, delivery_mode, recipient_email, delivery_day, delivery_time,
                reporting_period, format, timezone, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            1 if config.enabled else 0,
            config.delivery_mode,
            config.recipient_email,
            config.delivery_day,
            config.delivery_time,
            config.reporting_period,
            config.format,
            config.timezone,
            now_iso
        ))
        db.commit()

        config_data = config.model_dump() if hasattr(config, "model_dump") else config.dict()
        return config_data, now_iso
