import sqlite3
from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple
from app.schemas.energy import EnergyData, TotalData, TelemetrySyncPayload
from app.core.config import settings


class EnergyService:
    """Service handling telemetry ingestion, database storage, and retrieval."""

    @staticmethod
    def record_house_energy(
        db: sqlite3.Connection,
        house_id: int,
        data: EnergyData
    ) -> Tuple[int, str]:
        """Inserts a new telemetry reading for a specific house."""
        timestamp = datetime.now().isoformat()
        cursor = db.cursor()
        cursor.execute("""
            INSERT INTO energy_data (
                house_id, voltage, current, power, energy, frequency, pf, cost, timestamp
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            house_id,
            data.voltage,
            data.current,
            data.power,
            data.energy,
            data.frequency,
            data.pf,
            data.cost,
            timestamp
        ))
        db.commit()
        record_id = cursor.lastrowid
        return record_id, timestamp

    @staticmethod
    def record_total_energy(
        db: sqlite3.Connection,
        data: TotalData
    ) -> Tuple[int, str]:
        """Inserts an aggregate telemetry snapshot for the entire system."""
        timestamp = datetime.now().isoformat()
        cursor = db.cursor()
        cursor.execute("""
            INSERT INTO total_data (
                power, energy, cost, timestamp
            )
            VALUES (?, ?, ?, ?)
        """, (
            data.power,
            data.energy,
            data.cost,
            timestamp
        ))
        db.commit()
        record_id = cursor.lastrowid
        return record_id, timestamp

    @staticmethod
    def get_latest_house_energy(
        db: sqlite3.Connection,
        house_id: int
    ) -> Optional[Dict[str, Any]]:
        """Fetches the most recent telemetry record for a house."""
        cursor = db.cursor()
        cursor.execute("""
            SELECT *
            FROM energy_data
            WHERE house_id = ?
            ORDER BY id DESC
            LIMIT 1
        """, (house_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    @staticmethod
    def get_dashboard_summary(
        db: sqlite3.Connection
    ) -> Dict[str, Any]:
        """Fetches latest telemetry for each house and the overall system total."""
        houses: List[Dict[str, Any]] = []
        cursor = db.cursor()

        for house_id in settings.VALID_HOUSE_IDS:
            cursor.execute("""
                SELECT *
                FROM energy_data
                WHERE house_id = ?
                ORDER BY id DESC
                LIMIT 1
            """, (house_id,))
            row = cursor.fetchone()
            if row:
                houses.append(dict(row))

        cursor.execute("""
            SELECT *
            FROM total_data
            ORDER BY id DESC
            LIMIT 1
        """)
        total_row = cursor.fetchone()
        total = dict(total_row) if total_row else None

        return {
            "houses": houses,
            "total": total
        }

    @staticmethod
    def get_house_history(
        db: sqlite3.Connection,
        house_id: int,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Retrieves history for a specific house with bounded limit."""
        bounded_limit = max(1, min(limit, 1000))
        cursor = db.cursor()
        cursor.execute("""
            SELECT *
            FROM energy_data
            WHERE house_id = ?
            ORDER BY id DESC
            LIMIT ?
        """, (house_id, bounded_limit))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def get_latest_total(
        db: sqlite3.Connection
    ) -> Optional[Dict[str, Any]]:
        """Retrieves the latest total system data."""
        cursor = db.cursor()
        cursor.execute("""
            SELECT *
            FROM total_data
            ORDER BY id DESC
            LIMIT 1
        """)
        row = cursor.fetchone()
        return dict(row) if row else None

    @staticmethod
    def get_all_records(
        db: sqlite3.Connection
    ) -> List[Dict[str, Any]]:
        """Retrieves all stored energy data records."""
        cursor = db.cursor()
        cursor.execute("""
            SELECT *
            FROM energy_data
            ORDER BY id DESC
        """)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def sync_telemetry_batch(
        db: sqlite3.Connection,
        payload: TelemetrySyncPayload
    ) -> Tuple[List[int], str]:
        """Atomically inserts batch telemetry for multiple houses and total summary."""
        timestamp = datetime.now().isoformat()
        cursor = db.cursor()
        saved_houses: List[int] = []

        for house_item in payload.houses:
            cursor.execute("""
                INSERT INTO energy_data (
                    house_id, voltage, current, power, energy, frequency, pf, cost, timestamp
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                house_item.house_id,
                house_item.voltage,
                house_item.current,
                house_item.power,
                house_item.energy,
                house_item.frequency,
                house_item.pf,
                house_item.cost,
                timestamp
            ))
            saved_houses.append(house_item.house_id)

        if payload.total:
            cursor.execute("""
                INSERT INTO total_data (
                    power, energy, cost, timestamp
                )
                VALUES (?, ?, ?, ?)
            """, (
                payload.total.power,
                payload.total.energy,
                payload.total.cost,
                timestamp
            ))

        db.commit()
        return saved_houses, timestamp
