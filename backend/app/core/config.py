from typing import List, Dict
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

class Settings(BaseSettings):
    PROJECT_NAME: str = "Smart Trap AI - Corn Pest & Rat Detection Engine"
    API_V1_STR: str = "/api/v1"
    DEBUG: bool = True
    
    # ==========================================
    # CORS Origins — TANPA "*" karena allow_credentials=True
    # ==========================================
    CORS_ORIGINS: List[str] = [
        # Local dev
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        
        # LAN dev (akses dari HP / device lain)
        "http://192.168.10.68:5173",
        "http://192.168.11.186:5173",   # IP ESP32 network
        "http://192.168.4.1:5173",      # hotspot ESP32
        
        # Vite network (kadang muncul dengan IP berbeda)
        "http://100.96.246.81:5173",    # Tailscale — dari log Anda
    ]
    
    # Database
    DATABASE_URL: str = f"sqlite+aiosqlite:///{BASE_DIR}/smart_trap.db"
    
    # Storage paths
    UPLOAD_DIR: Path = BASE_DIR / "uploads"
    WEIGHTS_DIR: Path = BASE_DIR / "weights"
    DATASET_DIR: Path = BASE_DIR / "dataset"
    STATIC_DIR: Path = BASE_DIR / "app" / "static"
    REFERENCES_DIR: Path = BASE_DIR / "app" / "static" / "references"
    
    # AI Vision Settings
    CONFIDENCE_THRESHOLD: float = 0.40
    IOU_THRESHOLD: float = 0.45
    MAX_IMAGE_DIMENSION: int = 1920
    
    # 4 Target Classes (3 Corn Pests + Rat)
    TARGET_CLASSES: List[str] = [
        "Asian-Corn-Borer",
        "Bollworm",
        "Fall-Armyworm",
        "Rat"
    ]
    
    model_config = SettingsConfigDict(case_sensitive=True, env_file=".env", extra="ignore")

settings = Settings()

# Ensure required directories exist
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)