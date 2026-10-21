from fastapi import APIRouter
from app.api.v1.endpoints import health, energy, reports

api_router = APIRouter()

# Register sub-routers
api_router.include_router(health.router)
api_router.include_router(energy.router)
api_router.include_router(reports.router)
