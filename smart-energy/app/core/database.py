import sqlite3
from datetime import datetime
from app.core.config import settings


def get_db_connection() -> sqlite3.Connection:
    """Creates and returns a new SQLite connection with Row factory."""
    connection = sqlite3.connect(str(settings.DATABASE_PATH), check_same_thread=False)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    """Initializes SQLite database tables and seeds sample telemetry if empty."""
    connection = get_db_connection()
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
            (1, 231.8, 8.23, 1845.0, 342.854, 50.0, 0.97, round(342.854 * settings.DEFAULT_TARIFF, 2), now_iso),
            (2, 230.5, 4.28, 948.0, 188.642, 50.0, 0.96, round(188.642 * settings.DEFAULT_TARIFF, 2), now_iso),
            (3, 232.2, 1.53, 348.0, 94.281, 50.0, 0.98, round(94.281 * settings.DEFAULT_TARIFF, 2), now_iso),
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
