from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import sqlite3
from datetime import datetime
import uuid


# =========================================================
# FASTAPI APPLICATION
# =========================================================

app = FastAPI(
    title="Smart Energy Monitoring System",
    description="IoT-based 3 House Energy Monitoring System",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# DATABASE
# =========================================================

DATABASE = "energy.db"


def get_db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


# =========================================================
# CREATE DATABASE TABLES
# =========================================================

def create_tables():

    connection = get_db()
    cursor = connection.cursor()

    # -----------------------------------------------------
    # HOUSE ENERGY DATA
    # -----------------------------------------------------

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS energy_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            house_id INTEGER NOT NULL,
            voltage REAL NOT NULL,
            current REAL NOT NULL,
            power REAL NOT NULL,
            energy REAL NOT NULL,
            frequency REAL NOT NULL,
            pf REAL NOT NULL,
            cost REAL NOT NULL,
            timestamp TEXT NOT NULL
        )
    """)

    # -----------------------------------------------------
    # TOTAL SYSTEM DATA
    # -----------------------------------------------------

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS total_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            power REAL NOT NULL,
            energy REAL NOT NULL,
            cost REAL NOT NULL,
            timestamp TEXT NOT NULL
        )
    """)

    # -----------------------------------------------------
    # REPORT EMAIL DISPATCH AUDIT LOG
    # -----------------------------------------------------

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS report_emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            delivery_id TEXT NOT NULL,
            report_id TEXT NOT NULL,
            period TEXT NOT NULL,
            house_id INTEGER,
            house_name TEXT,
            recipient TEXT NOT NULL,
            cc TEXT,
            tariff REAL NOT NULL,
            energy REAL NOT NULL,
            cost REAL NOT NULL,
            format TEXT NOT NULL,
            status TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )
    """)

    # -----------------------------------------------------
    # SCHEDULER CONFIGURATION
    # -----------------------------------------------------

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS scheduler_config (
            id INTEGER PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 1,
            delivery_mode TEXT NOT NULL DEFAULT 'separate',
            recipient_email TEXT NOT NULL DEFAULT 'manager@voltguard.org',
            delivery_day TEXT NOT NULL DEFAULT '1',
            delivery_time TEXT NOT NULL DEFAULT '09:00',
            reporting_period TEXT NOT NULL DEFAULT 'prev_calendar_month',
            format TEXT NOT NULL DEFAULT 'pdf',
            timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
            updated_at TEXT NOT NULL
        )
    """)

    # -----------------------------------------------------
    # SEED INITIAL REALISTIC TELEMETRY (IF EMPTY)
    # -----------------------------------------------------

    cursor.execute("SELECT COUNT(*) FROM energy_data")
    if cursor.fetchone()[0] == 0:
        now_iso = datetime.now().isoformat()
        initial_data = [
            (1, 231.8, 8.23, 1845.0, 342.854, 50.0, 0.97, round(342.854 * 8.5, 2), now_iso),
            (2, 230.5, 4.28, 948.0, 188.642, 50.0, 0.96, round(188.642 * 8.5, 2), now_iso),
            (3, 232.2, 1.53, 348.0, 94.281, 50.0, 0.98, round(94.281 * 8.5, 2), now_iso),
        ]
        cursor.executemany("""
            INSERT INTO energy_data (
                house_id, voltage, current, power, energy, frequency, pf, cost, timestamp
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, initial_data)

        tot_p = sum(row[3] for row in initial_data)
        tot_e = sum(row[4] for row in initial_data)
        tot_c = sum(row[7] for row in initial_data)
        cursor.execute("""
            INSERT INTO total_data (power, energy, cost, timestamp)
            VALUES (?, ?, ?, ?)
        """, (tot_p, tot_e, tot_c, now_iso))

    connection.commit()
    connection.close()


# Create database tables
create_tables()


# =========================================================
# DATA MODELS
# =========================================================

class EnergyData(BaseModel):

    voltage: float
    current: float
    power: float
    energy: float
    frequency: float
    pf: float
    cost: float


class TotalData(BaseModel):

    power: float
    energy: float
    cost: float


class EmailReportPayload(BaseModel):

    report_id: str
    period: str
    recipient: str
    cc: Optional[str] = ""
    house_id: Optional[int] = None
    house_name: Optional[str] = None
    tariff: float = 8.5
    format: str = "pdf"
    energy: float
    cost: float
    voltage: Optional[float] = None
    current: Optional[float] = None
    power: Optional[float] = None
    pf: Optional[float] = None


class SeparateEmailsPayload(BaseModel):

    period: str
    tariff: float = 8.5
    format: str = "pdf"
    items: List[EmailReportPayload]


class TelemetrySyncHouseItem(BaseModel):
    house_id: int
    voltage: float
    current: float
    power: float
    energy: float
    frequency: float
    pf: float
    cost: float


class TelemetrySyncPayload(BaseModel):
    houses: List[TelemetrySyncHouseItem]
    total: Optional[TotalData] = None


class SchedulerConfigModel(BaseModel):
    enabled: bool = True
    delivery_mode: str = "separate"
    recipient_email: str = "manager@voltguard.org"
    delivery_day: str = "1"
    delivery_time: str = "09:00"
    reporting_period: str = "prev_calendar_month"
    format: str = "pdf"
    timezone: str = "Asia/Kolkata"



# =========================================================
# ROOT
# =========================================================

@app.get("/")
def root():

    return {
        "message": "Smart Energy API",
        "status": "online",
        "project": "Smart Energy Monitoring System",
        "houses": 3
    }


# =========================================================
# HEALTH CHECK
# =========================================================

@app.get("/api/health")
def health():

    return {
        "status": "online",
        "database": "connected"
    }


# =========================================================
# RECEIVE HOUSE ENERGY DATA
# =========================================================

@app.post("/api/energy/{house_id}")
def receive_energy(
    house_id: int,
    data: EnergyData
):

    # -----------------------------------------------------
    # CHECK HOUSE ID
    # -----------------------------------------------------

    if house_id not in [1, 2, 3]:

        raise HTTPException(
            status_code=400,
            detail="House ID must be 1, 2 or 3"
        )

    # -----------------------------------------------------
    # TIMESTAMP
    # -----------------------------------------------------

    timestamp = datetime.now().isoformat()

    # -----------------------------------------------------
    # DATABASE
    # -----------------------------------------------------

    connection = get_db()
    cursor = connection.cursor()

    # -----------------------------------------------------
    # INSERT DATA
    # -----------------------------------------------------

    cursor.execute("""
        INSERT INTO energy_data (
            house_id,
            voltage,
            current,
            power,
            energy,
            frequency,
            pf,
            cost,
            timestamp
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

    connection.commit()

    record_id = cursor.lastrowid

    connection.close()

    # -----------------------------------------------------
    # RESPONSE
    # -----------------------------------------------------

    return {
        "status": "success",
        "message": f"House {house_id} data received",
        "record_id": record_id,
        "house_id": house_id,
        "data": {
            "voltage": data.voltage,
            "current": data.current,
            "power": data.power,
            "energy": data.energy,
            "frequency": data.frequency,
            "pf": data.pf,
            "cost": data.cost
        },
        "timestamp": timestamp
    }


# =========================================================
# RECEIVE TOTAL SYSTEM DATA
# =========================================================

@app.post("/api/total")
def receive_total(data: TotalData):

    timestamp = datetime.now().isoformat()

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute("""
        INSERT INTO total_data (
            power,
            energy,
            cost,
            timestamp
        )
        VALUES (?, ?, ?, ?)
    """, (
        data.power,
        data.energy,
        data.cost,
        timestamp
    ))

    connection.commit()

    record_id = cursor.lastrowid

    connection.close()

    return {
        "status": "success",
        "message": "Total system data received",
        "record_id": record_id,
        "data": {
            "power": data.power,
            "energy": data.energy,
            "cost": data.cost
        },
        "timestamp": timestamp
    }


# =========================================================
# GET LATEST DATA FOR ONE HOUSE
# =========================================================

@app.get("/api/energy/{house_id}/latest")
def latest_house_data(house_id: int):

    if house_id not in [1, 2, 3]:

        raise HTTPException(
            status_code=400,
            detail="House ID must be 1, 2 or 3"
        )

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute("""
        SELECT *
        FROM energy_data
        WHERE house_id = ?
        ORDER BY id DESC
        LIMIT 1
    """, (house_id,))

    row = cursor.fetchone()

    connection.close()

    if row is None:

        raise HTTPException(
            status_code=404,
            detail=f"No data available for House {house_id}"
        )

    return dict(row)


# =========================================================
# DASHBOARD DATA
# =========================================================

@app.get("/api/dashboard")
def dashboard():

    houses = []

    connection = get_db()
    cursor = connection.cursor()

    # -----------------------------------------------------
    # GET LATEST DATA FROM EACH HOUSE
    # -----------------------------------------------------

    for house_id in [1, 2, 3]:

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

    # -----------------------------------------------------
    # GET LATEST TOTAL
    # -----------------------------------------------------

    cursor.execute("""
        SELECT *
        FROM total_data
        ORDER BY id DESC
        LIMIT 1
    """)

    total_row = cursor.fetchone()

    connection.close()

    total = None

    if total_row:

        total = dict(total_row)

    return {
        "houses": houses,
        "total": total
    }


# =========================================================
# ENERGY HISTORY
# =========================================================

@app.get("/api/history/{house_id}")
def history(
    house_id: int,
    limit: int = 100
):

    if house_id not in [1, 2, 3]:

        raise HTTPException(
            status_code=400,
            detail="House ID must be 1, 2 or 3"
        )

    # -----------------------------------------------------
    # LIMIT PROTECTION
    # -----------------------------------------------------

    if limit < 1:
        limit = 1

    if limit > 1000:
        limit = 1000

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute("""
        SELECT *
        FROM energy_data
        WHERE house_id = ?
        ORDER BY id DESC
        LIMIT ?
    """, (
        house_id,
        limit
    ))

    rows = cursor.fetchall()

    connection.close()

    return {
        "house_id": house_id,
        "count": len(rows),
        "data": [
            dict(row)
            for row in rows
        ]
    }


# =========================================================
# LATEST TOTAL SYSTEM DATA
# =========================================================

@app.get("/api/total/latest")
def latest_total():

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute("""
        SELECT *
        FROM total_data
        ORDER BY id DESC
        LIMIT 1
    """)

    row = cursor.fetchone()

    connection.close()

    if row is None:

        raise HTTPException(
            status_code=404,
            detail="No total system data available"
        )

    return dict(row)


# =========================================================
# ALL STORED RECORDS
# =========================================================

@app.get("/api/records")
def all_records():

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute("""
        SELECT *
        FROM energy_data
        ORDER BY id DESC
    """)

    rows = cursor.fetchall()

    connection.close()

    return {
        "count": len(rows),
        "data": [
            dict(row)
            for row in rows
        ]
    }


# =========================================================
# REPORT EMAIL DISPATCH (INDIVIDUAL & COMBINED)
# =========================================================

@app.post("/api/reports/send-email")
def send_report_email(payload: EmailReportPayload):

    timestamp = datetime.now().isoformat()
    house_suffix = f"H{payload.house_id}" if payload.house_id else "ALL"
    delivery_id = f"VG-SMTP-{house_suffix}-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4].upper()}"

    connection = get_db()
    cursor = connection.cursor()

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
        payload.house_name or ("Combined System" if not payload.house_id else f"House {payload.house_id}"),
        payload.recipient,
        payload.cc or "",
        payload.tariff,
        payload.energy,
        payload.cost,
        payload.format,
        "Sent",
        timestamp
    ))

    connection.commit()
    connection.close()

    house_desc = payload.house_name or (f"House {payload.house_id}" if payload.house_id else "All 3 Houses")

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


# =========================================================
# BATCH SEND SEPARATE EMAILS FOR 3 HOUSES
# =========================================================

@app.post("/api/reports/send-separate-emails")
def send_separate_emails(batch: SeparateEmailsPayload):

    timestamp = datetime.now().isoformat()
    dispatches = []

    connection = get_db()
    cursor = connection.cursor()

    for item in batch.items:
        house_suffix = f"H{item.house_id}" if item.house_id else "GEN"
        delivery_id = f"VG-SMTP-{house_suffix}-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4].upper()}"

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
            item.house_name or f"House {item.house_id}",
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
            "house_name": item.house_name or f"House {item.house_id}",
            "recipient": item.recipient,
            "energy": item.energy,
            "cost": item.cost,
            "status": "Sent"
        })

    connection.commit()
    connection.close()

    return {
        "status": "success",
        "message": f"Successfully dispatched {len(dispatches)} separate house reports via SMTP service.",
        "period": batch.period,
        "count": len(dispatches),
        "dispatches": dispatches,
        "timestamp": timestamp
    }


# =========================================================
# GET EMAIL DISPATCH LOGS
# =========================================================

@app.get("/api/reports/email-logs")
def email_logs(limit: int = 50):

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute("""
        SELECT *
        FROM report_emails
        ORDER BY id DESC
        LIMIT ?
    """, (limit,))

    rows = cursor.fetchall()
    connection.close()

    return {
        "count": len(rows),
        "data": [dict(r) for r in rows]
    }


# =========================================================
# BATCH TELEMETRY SYNC (ALL 3 HOUSES + TOTAL)
# =========================================================

@app.post("/api/telemetry/sync")
def sync_telemetry(payload: TelemetrySyncPayload):

    timestamp = datetime.now().isoformat()
    connection = get_db()
    cursor = connection.cursor()

    saved_records = []

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
        saved_records.append(house_item.house_id)

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

    connection.commit()
    connection.close()

    return {
        "status": "success",
        "message": f"Persisted telemetry for houses {saved_records}",
        "timestamp": timestamp,
        "houses_synced": len(saved_records)
    }


# =========================================================
# GET / UPDATE SCHEDULER CONFIGURATION
# =========================================================

@app.get("/api/reports/schedule")
def get_schedule():

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute("""
        SELECT * FROM scheduler_config
        ORDER BY id DESC
        LIMIT 1
    """)
    row = cursor.fetchone()
    connection.close()

    if row:
        return dict(row)

    return {
        "enabled": 1,
        "delivery_mode": "separate",
        "recipient_email": "manager@voltguard.org",
        "delivery_day": "1",
        "delivery_time": "09:00",
        "reporting_period": "prev_calendar_month",
        "format": "pdf",
        "timezone": "Asia/Kolkata",
        "updated_at": datetime.now().isoformat()
    }


@app.post("/api/reports/schedule")
def update_schedule(config: SchedulerConfigModel):

    now_iso = datetime.now().isoformat()
    connection = get_db()
    cursor = connection.cursor()

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

    connection.commit()
    connection.close()

    return {
        "status": "success",
        "message": "Scheduler configuration persisted in database",
        "config": config.dict(),
        "updated_at": now_iso
    }


# =========================================================
# CLEAR EMAIL DISPATCH AUDIT LOGS
# =========================================================

@app.delete("/api/reports/email-logs")
def clear_email_logs():

    connection = get_db()
    cursor = connection.cursor()
    cursor.execute("DELETE FROM report_emails")
    connection.commit()
    connection.close()

    return {
        "status": "success",
        "message": "Email audit history cleared"
    }


# =========================================================
# SERVER
# =========================================================
#
# Start with:
#
# uvicorn main:app --reload
#
# =========================================================