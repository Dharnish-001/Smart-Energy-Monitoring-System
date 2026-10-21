import sqlite3
from fastapi import APIRouter, Depends, HTTPException, Query
from app.api.deps import get_db
from app.core.config import settings
from app.schemas.energy import EnergyData, TotalData, TelemetrySyncPayload
from app.services.energy_service import EnergyService

router = APIRouter(prefix="/api", tags=["Energy Telemetry"])


@router.post(
    "/energy/{house_id}",
    summary="Ingest Single House Telemetry",
    description="Receives real-time PZEM-004T metrics from ESP32 for a specific house."
)
def receive_energy(
    house_id: int,
    data: EnergyData,
    db: sqlite3.Connection = Depends(get_db)
):
    if house_id not in settings.VALID_HOUSE_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"House ID must be {', '.join(map(str, settings.VALID_HOUSE_IDS[:-1]))} or {settings.VALID_HOUSE_IDS[-1]}"
        )

    record_id, timestamp = EnergyService.record_house_energy(db, house_id, data)

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


@router.post(
    "/total",
    summary="Ingest Total System Energy",
    description="Receives aggregated system-wide active power, energy, and cost telemetry."
)
def receive_total(
    data: TotalData,
    db: sqlite3.Connection = Depends(get_db)
):
    record_id, timestamp = EnergyService.record_total_energy(db, data)

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


@router.get(
    "/energy/{house_id}/latest",
    summary="Get Latest House Telemetry",
    description="Fetches the most recent electrical metrics recorded for the specified house."
)
def latest_house_data(
    house_id: int,
    db: sqlite3.Connection = Depends(get_db)
):
    if house_id not in settings.VALID_HOUSE_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"House ID must be {', '.join(map(str, settings.VALID_HOUSE_IDS[:-1]))} or {settings.VALID_HOUSE_IDS[-1]}"
        )

    data = EnergyService.get_latest_house_energy(db, house_id)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"No data available for House {house_id}"
        )

    return data


@router.get(
    "/dashboard",
    summary="Get Live Dashboard Telemetry",
    description="Returns the latest telemetry for all houses and total aggregated metrics."
)
def dashboard(
    db: sqlite3.Connection = Depends(get_db)
):
    return EnergyService.get_dashboard_summary(db)


@router.get(
    "/history/{house_id}",
    summary="Get House Historical Records",
    description="Retrieves historical energy telemetry for the given house, ordered newest first."
)
def history(
    house_id: int,
    limit: int = Query(default=100, ge=1, le=1000, description="Max rows to retrieve"),
    db: sqlite3.Connection = Depends(get_db)
):
    if house_id not in settings.VALID_HOUSE_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"House ID must be {', '.join(map(str, settings.VALID_HOUSE_IDS[:-1]))} or {settings.VALID_HOUSE_IDS[-1]}"
        )

    rows = EnergyService.get_house_history(db, house_id, limit)
    return {
        "house_id": house_id,
        "count": len(rows),
        "data": rows
    }


@router.get(
    "/total/latest",
    summary="Get Latest Aggregated Total",
    description="Fetches the most recent total system reading across all houses."
)
def latest_total(
    db: sqlite3.Connection = Depends(get_db)
):
    data = EnergyService.get_latest_total(db)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail="No total system data available"
        )
    return data


@router.get(
    "/records",
    summary="Get All Energy Records",
    description="Retrieves all recorded energy telemetry rows from the database."
)
def all_records(
    db: sqlite3.Connection = Depends(get_db)
):
    rows = EnergyService.get_all_records(db)
    return {
        "count": len(rows),
        "data": rows
    }


@router.post(
    "/telemetry/sync",
    summary="Batch Telemetry Synchronization",
    description="Synchronizes telemetry across multiple houses and updates total system readings in a single request."
)
def sync_telemetry(
    payload: TelemetrySyncPayload,
    db: sqlite3.Connection = Depends(get_db)
):
    saved_records, timestamp = EnergyService.sync_telemetry_batch(db, payload)
    return {
        "status": "success",
        "message": f"Persisted telemetry for houses {saved_records}",
        "timestamp": timestamp,
        "houses_synced": len(saved_records)
    }
