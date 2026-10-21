from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.database import init_db
from app.api.v1.api_router import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handles startup and shutdown events for the FastAPI application."""
    # Ensure database tables exist and seed initial data if empty
    init_db()
    yield


def create_application() -> FastAPI:
    """FastAPI Application Factory combining Backend API and Frontend Web UI."""
    app = FastAPI(
        title=settings.PROJECT_NAME,
        description=settings.PROJECT_DESCRIPTION,
        version=settings.VERSION,
        lifespan=lifespan,
    )

    # Configure CORS Middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=settings.CORS_ALLOW_CREDENTIALS,
        allow_methods=settings.CORS_ALLOW_METHODS,
        allow_headers=settings.CORS_ALLOW_HEADERS,
    )

    # Register API Endpoints (/api/...)
    app.include_router(api_router)

    # Static Directory for Frontend Assets
    static_path = settings.STATIC_DIR

    # -----------------------------------------------------
    # FRONTEND HTML SERVING & REDIRECT ROUTES
    # -----------------------------------------------------
    @app.get("/", response_class=FileResponse, include_in_schema=False)
    async def serve_index():
        """Serves the primary Single-Page Application (SPA) dashboard."""
        index_file = static_path / "index.html"
        return FileResponse(index_file)

    @app.get("/index.html", response_class=FileResponse, include_in_schema=False)
    async def serve_index_html():
        """Direct file route for index.html."""
        return FileResponse(static_path / "index.html")

    @app.get("/ui", include_in_schema=False)
    @app.get("/dashboard-ui", include_in_schema=False)
    @app.get("/home", include_in_schema=False)
    async def redirect_to_ui():
        """Redirect helper aliases to root web application."""
        return RedirectResponse(url="/")

    # -----------------------------------------------------
    # STATIC ASSET MOUNTING (CSS, JS, Images)
    # -----------------------------------------------------
    if static_path.exists() and static_path.is_dir():
        # Mount /static for explicit /static/<file> requests
        app.mount("/static", StaticFiles(directory=str(static_path)), name="static_assets")
        # Mount / for direct root assets like /style.css and /script.js
        app.mount("/", StaticFiles(directory=str(static_path), html=True), name="frontend_app")

    return app


# Application Instance
app = create_application()
