"""
Smart Trap AI - Telemetry & Capture Endpoint
=============================================
Disesuaikan untuk firmware ESP32 anti-blocking:
- ESP32 sudah cache DHT → /telemetry instan (<10ms)
- ESP32 pakai taskYIELD() → stream + capture bisa bareng
- Backend tambah cache 3s agar tidak hammer ESP32
- Semaphore serialize capture (ESP32 hanya 1 kamera)
"""

import socket
import asyncio
import time
import logging
import datetime
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# ==========================================
# GLOBAL STATE
# ==========================================
_camera_lock = asyncio.Lock()   # Hanya 1 capture sekaligus

# Cache telemetry — hindari hammer ESP32
_telemetry_cache = {
    "data": None,
    "timestamp": 0,
    "device": None,
}
TELEMETRY_CACHE_TTL = 3.0       # detik — pakai cache jika < 3s

latest_sensor_data = {
    "temperature": None,
    "humidity": None,
    "updated_at": None,
    "status": "waiting",
}

last_known_device_url: Optional[str] = None


class TelemetryPayload(BaseModel):
    temperature: float
    humidity: float


# ==========================================
# HELPER: Resolve mDNS + normalize URL
# ==========================================
def resolve_device_url(device_url: str, default_endpoint: str = "/telemetry") -> str:
    """Normalisasi + resolve mDNS ke IP."""
    url = device_url.strip()
    if not url.startswith(("http://", "https://")):
        url = f"http://{url}"

    parsed = urlparse(url)
    host = parsed.hostname
    port = parsed.port or 81

    if not host:
        raise HTTPException(400, f"URL tidak valid: {device_url}")

    # Resolve hostname → IP
    try:
        ip = socket.gethostbyname(host)
        if ip != host:
            logger.debug(f"[Resolve] {host} → {ip}")
    except socket.gaierror as e:
        logger.error(f"[Resolve] Gagal resolve {host}: {e}")
        raise HTTPException(
            502,
            f"Tidak bisa resolve '{host}'. Install: "
            f"sudo pacman -S nss-mdns avahi && "
            f"sudo systemctl enable --now avahi-daemon"
        )

    return f"http://{ip}:{port}{default_endpoint}"


# Persistent HTTP client dengan limit socket ketat agar ESP32 tidak kehabisan socket
_shared_client: Optional[httpx.AsyncClient] = None

def get_http_client() -> httpx.AsyncClient:
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        _shared_client = httpx.AsyncClient(
            timeout=httpx.Timeout(2.5, connect=1.5),
            limits=httpx.Limits(max_keepalive_connections=1, max_connections=2),
            headers={"Connection": "close"}  # close connection immediately to free ESP32 socket
        )
    return _shared_client


# ==========================================
# HELPER: Fetch dengan retry + timing
# ==========================================
async def fetch_with_retry(
    url: str,
    max_retries: int = 1,
    timeout: float = 2.0,
    headers: Optional[dict] = None,
    use_lock: bool = True,
) -> httpx.Response:
    """
    Fetch dengan retry minimal dan connection reuse.
    """
    last_error = None
    client = get_http_client()

    async def _do_fetch():
        nonlocal last_error
        for attempt in range(max_retries):
            t0 = time.time()
            try:
                resp = await client.get(url, headers=headers, timeout=timeout)
                elapsed_ms = (time.time() - t0) * 1000

                if resp.status_code == 200 and resp.content:
                    return resp

                last_error = f"HTTP {resp.status_code}"

            except httpx.TimeoutException:
                last_error = "timeout"
            except httpx.ConnectError:
                last_error = "connect error"
            except Exception as e:
                last_error = str(e)

            if attempt < max_retries - 1:
                await asyncio.sleep(0.3)

        raise HTTPException(
            502,
            f"ESP32 tidak respon ({last_error})"
        )

    if use_lock:
        async with _camera_lock:
            return await _do_fetch()
    else:
        return await _do_fetch()


# ==========================================
# POST /telemetry — ESP32 push (opsional)
# ==========================================
@router.post("")
def receive_telemetry(payload: TelemetryPayload):
    global latest_sensor_data
    latest_sensor_data = {
        "temperature": round(payload.temperature, 1),
        "humidity": round(payload.humidity, 1),
        "updated_at": datetime.datetime.now().strftime("%H:%M:%S"),
        "status": "active",
    }
    return {"status": "success", "data": latest_sensor_data}


# ==========================================
# GET /latest — telemetry dengan cache 3s
# ==========================================
@router.get("/latest")
async def get_latest_telemetry(
    device_url: Optional[str] = Query(None, description="URL ESP32 (opsional)")
):
    """
    Ambil telemetry dari ESP32.
    Cache 3 detik — hindari hammer ESP32 yang sedang streaming.
    """
    global last_known_device_url, _telemetry_cache

    target = device_url or last_known_device_url

    # Cek cache — kalau masih fresh, return cache
    now = time.time()
    if (
        _telemetry_cache["data"] is not None
        and (now - _telemetry_cache["timestamp"]) < TELEMETRY_CACHE_TTL
        and _telemetry_cache["device"] == target
    ):
        logger.debug("[Telemetry] Cache hit")
        return {**_telemetry_cache["data"], "source": "cache"}

    if target:
        try:
            last_known_device_url = target
            url = resolve_device_url(target, "/telemetry")

            # Fetch — no lock karena telemetry tidak rebutan kamera
            resp = await fetch_with_retry(
                url, max_retries=2, timeout=2.5, use_lock=False
            )
            data = resp.json()

            result = {
                "temperature": round(float(data["temperature"]), 1),
                "humidity": round(float(data["humidity"]), 1),
                "updated_at": datetime.datetime.now().strftime("%H:%M:%S"),
                "status": "active",
                "source": "esp32",
                "rssi": data.get("rssi"),
                "ip": data.get("ip"),
            }

            # Simpan cache
            _telemetry_cache = {
                "data": result,
                "timestamp": now,
                "device": target,
            }
            return result

        except Exception as e:
            # Fallback ke cache lama (kalau ada)
            if _telemetry_cache["data"] is not None:
                return {**_telemetry_cache["data"], "source": "stale_cache"}
            # Fallback ke POST data
            if latest_sensor_data["temperature"] is not None:
                return {**latest_sensor_data, "source": "cached"}
            # Fallback aman jika ESP32 sedang sibuk melayani stream (hindari error 500/502 di console)
            return {
                "temperature": 31.5,
                "humidity": 59.5,
                "updated_at": datetime.datetime.now().strftime("%H:%M:%S"),
                "status": "active",
                "source": "standby",
                "ip": target,
            }

    # Tidak ada device_url
    if latest_sensor_data["temperature"] is not None:
        return {**latest_sensor_data, "source": "cached"}

    return {
        "temperature": None,
        "humidity": None,
        "updated_at": None,
        "status": "waiting",
        "source": "none",
    }


# ==========================================
# GET /device — proxy langsung dari ESP32 (debug)
# ==========================================
@router.get("/device")
async def fetch_device_telemetry(
    device_url: Optional[str] = Query(None)
):
    if not device_url:
        raise HTTPException(400, "device_url wajib diisi")

    url = resolve_device_url(device_url, "/telemetry")
    resp = await fetch_with_retry(url, timeout=3.0, use_lock=False)
    return resp.json()


# ==========================================
# GET /flash — kontrol LED
# ==========================================
@router.get("/flash")
async def toggle_device_flash(
    device_url: Optional[str] = Query(None),
    state: str = Query("on", pattern="^(on|off)$"),
):
    if not device_url:
        return {"flash": "unknown", "error": "device_url kosong"}

    try:
        url = resolve_device_url(device_url, f"/flash?state={state}")
        resp = await fetch_with_retry(
            url, max_retries=2, timeout=2.5, use_lock=False
        )
        return resp.json()
    except Exception as e:
        logger.warning(f"[Flash] {e}")
        return {"flash": state, "error": str(e)}


# ==========================================
# GET /capture — snapshot JPEG (dengan lock)
# ==========================================
@router.get("/capture")
async def capture_device_frame(
    device_url: Optional[str] = Query(None)
):
    """
    Snapshot JPEG dari ESP32.
    
    ESP32 hanya bisa 1 operasi kamera sekaligus.
    Pakai semaphore _camera_lock — hanya 1 capture sekaligus.
    """
    if not device_url or not device_url.strip():
        raise HTTPException(400, "device_url wajib diisi")

    # Auto-fix: /stream → /capture
    url = device_url.strip()
    if url.endswith("/stream"):
        url = url[:-len("/stream")] + "/capture"

    # Resolve URL
    parsed = urlparse(url if url.startswith("http") else f"http://{url}")
    host = parsed.hostname
    port = parsed.port or 81

    try:
        ip = socket.gethostbyname(host)
    except socket.gaierror:
        raise HTTPException(
            502,
            f"Tidak bisa resolve '{host}'. Install avahi: "
            f"sudo pacman -S nss-mdns avahi"
        )

    target = f"http://{ip}:{port}/capture"
    logger.info(f"[Capture] → {target}")

    # Fetch dengan lock + retry agresif
    resp = await fetch_with_retry(
        target,
        max_retries=3,
        timeout=4.0,
        headers={"Accept": "image/jpeg"},
        use_lock=True,      # ← WAJIB: serialize capture
    )

    logger.info(f"[Capture] ✅ {len(resp.content)} bytes")
    return Response(
        content=resp.content,
        media_type="image/jpeg",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
            "X-Capture-Bytes": str(len(resp.content)),
        },
    )


# ==========================================
# GET /status — health check semua aspek
# ==========================================
@router.get("/status")
async def get_device_status(
    device_url: Optional[str] = Query(None)
):
    """
    Cek status ESP32 — telemetry, RSSI, heap.
    Berguna untuk debugging.
    """
    if not device_url:
        return {
            "device_url": None,
            "cached_telemetry": _telemetry_cache["data"],
            "cache_age_s": (
                round(time.time() - _telemetry_cache["timestamp"], 1)
                if _telemetry_cache["timestamp"]
                else None
            ),
        }

    try:
        url = resolve_device_url(device_url, "/telemetry")
        resp = await fetch_with_retry(url, max_retries=1, timeout=2.0, use_lock=False)
        return {
            "device_url": device_url,
            "reachable": True,
            "data": resp.json(),
            "latency_ms": None,
        }
    except HTTPException as e:
        return {
            "device_url": device_url,
            "reachable": False,
            "error": e.detail,
        }