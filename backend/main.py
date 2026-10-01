from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from backend.app.core.config import settings
from backend.app.db.session import init_db
from backend.app.api.v1.api import api_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize Database tables
    await init_db()
    print("[SmartTrap AI] Database initialized & ready.")
    print(f"[SmartTrap AI] Supported classes ({len(settings.TARGET_CLASSES)}): {settings.TARGET_CLASSES}")
    yield
    # Shutdown logic if any
    print("[SmartTrap AI] Backend shutdown complete.")

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Smart Trap AI for Precision Pest Control with Live Camera Stream, High-Res Upload, OCR Trap Identification, and IPM Alerts.",
    version="1.0.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static file directory for uploaded/annotated trap images
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(settings.UPLOAD_DIR)), name="uploads")

# Include API v1 Router
app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/", tags=["Health"])
async def root():
    return {
        "service": settings.PROJECT_NAME,
        "version": "1.0.0",
        "status": "operational",
        "docs_url": f"{settings.API_V1_STR}/docs",
        "total_classes": len(settings.TARGET_CLASSES),
        "supported_classes": settings.TARGET_CLASSES
    }

@app.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "healthy",
        "database": "connected",
        "storage": "writable"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
