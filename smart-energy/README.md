# ⚡ Smart Energy Monitoring System - Full-Stack FastAPI Application

A single, unified **FastAPI** application combining the **VoltGuard IoT** real-time web dashboard and backend REST APIs into a single clean architecture.

---

## 🏛️ Project Structure

The entire application runs from a single folder (`smart-energy/`) without separate frontend and backend servers:

```
smart-energy/
├── app/
│   ├── __init__.py                 # Application package metadata
│   ├── main.py                     # FastAPI app factory, CORS, static mounting & HTML serving
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py               # Central settings, paths (DATABASE_PATH, STATIC_DIR)
│   │   └── database.py             # SQLite connection management & table initialization
│   ├── schemas/                    # Pydantic validation models (DTOs)
│   │   ├── __init__.py
│   │   ├── energy.py               # EnergyData, TotalData, TelemetrySyncPayload
│   │   ├── report.py               # EmailReportPayload, SeparateEmailsPayload
│   │   └── scheduler.py            # SchedulerConfigModel
│   ├── services/                   # Business and data access layer (CRUD & queries)
│   │   ├── __init__.py
│   │   ├── energy_service.py       # Telemetry ingestion, metrics queries, dashboard, history
│   │   └── report_service.py       # Statement dispatch simulation, audit logs, scheduler
│   └── api/                        # API route layer
│       ├── __init__.py
│       ├── deps.py                 # Dependency injection (get_db connection generator)
│       └── v1/
│           ├── __init__.py
│           ├── api_router.py       # Master router aggregating sub-routers
│           └── endpoints/
│               ├── __init__.py
│               ├── health.py       # /api, /api/health
│               ├── energy.py       # /api/energy, /api/total, /api/dashboard, /api/history, /api/telemetry
│               └── reports.py      # /api/reports/send-email, send-separate-emails, email-logs, schedule
├── static/                         # Frontend Web Dashboard Assets
│   ├── index.html                  # VoltGuard IoT Single-Page Application (HTML)
│   ├── style.css                   # Custom responsive CSS design system
│   └── script.js                   # Interactive dashboard engine & dynamic telemetry charts
├── energy.db                       # SQLite database for persistent time-series & audit logs
├── main.py                         # Top-level entrypoint supporting `uvicorn main:app --reload`
├── requirements.txt                # Python dependencies (fastapi, uvicorn, pydantic)
└── README.md                       # Application documentation
```

---

## 🚀 Quickstart: Running the Application

### 1. Install Dependencies

```bash
cd smart-energy
pip install -r requirements.txt
```

### 2. Launch the Server

Run Uvicorn with auto-reload:

```bash
uvicorn main:app --reload
```

Or run directly with Python:

```bash
python main.py
```

### 3. Open in Browser

- **Web Dashboard**: Open [http://localhost:8000](http://localhost:8000)
- **Interactive Swagger Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc Interactive Docs**: [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

## 🔌 API Endpoints Catalog

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Serves the VoltGuard IoT web dashboard (`index.html`) |
| `GET` | `/api/health` | Health check & SQLite database connectivity |
| `GET` | `/api/dashboard` | Live telemetry for all 3 houses + total system metrics |
| `POST` | `/api/energy/{house_id}` | Ingest real-time PZEM-004T telemetry for a house (1, 2, or 3) |
| `POST` | `/api/total` | Ingest aggregate facility telemetry |
| `GET` | `/api/energy/{house_id}/latest` | Fetch the latest metrics recorded for a house |
| `GET` | `/api/history/{house_id}` | Fetch historical telemetry readings |
| `GET` | `/api/total/latest` | Fetch latest aggregated facility total |
| `GET` | `/api/records` | Fetch all historical energy rows |
| `POST` | `/api/telemetry/sync` | Batch synchronize telemetry for all 3 houses + total |
| `POST` | `/api/reports/send-email` | Dispatch statement email (individual/combined) |
| `POST` | `/api/reports/send-separate-emails` | Dispatch separate statement emails for all 3 houses |
| `GET` | `/api/reports/email-logs` | Retrieve email dispatch audit logs |
| `DELETE` | `/api/reports/email-logs` | Clear email dispatch audit logs |
| `GET` | `/api/reports/schedule` | Retrieve automated report schedule configuration |
| `POST` | `/api/reports/schedule` | Save updated scheduler configuration |
