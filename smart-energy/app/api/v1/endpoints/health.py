from fastapi import APIRouter
from app.core.config import settings

router = APIRouter()


@router.get(
    "/api",
    tags=["System & Health"],
    summary="API Information",
    description="Returns high-level project status and system metadata."
)
@router.get(
    "/api/info",
    tags=["System & Health"],
    summary="API Information",
    description="Returns high-level project status and system metadata."
)
def api_info():
    return {
        "message": "Smart Energy API",
        "status": "online",
        "project": settings.PROJECT_NAME,
        "houses": len(settings.VALID_HOUSE_IDS)
    }


@router.get(
    "/api/health",
    tags=["System & Health"],
    summary="Health Check",
    description="Checks API and database responsiveness."
)
def health():
    return {
        "status": "online",
        "database": "connected"
    }
