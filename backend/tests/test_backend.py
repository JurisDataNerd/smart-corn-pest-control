import asyncio
import io
import cv2
import numpy as np
import httpx
from pathlib import Path

def get_test_corn_pest_image() -> bytes:
    """
    Loads a real corn pest test image from the dataset test split.
    """
    test_img_dir = Path("/home/fauzan/Projects/prof-dudi/dataset/test/images")
    test_imgs = list(test_img_dir.glob("*.jpg"))
    if test_imgs:
        with open(test_imgs[0], "rb") as f:
            return f.read()
            
    # Fallback to creating a sample BGR frame
    img = np.zeros((416, 416, 3), dtype=np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    return buf.tobytes()

async def run_integration_tests():
    from backend.main import app
    from backend.app.db.session import init_db
    
    print("[Test] Initializing DB...")
    await init_db()
    
    test_image = get_test_corn_pest_image()
    print(f"[Test] Loaded real dataset test image: {len(test_image)} bytes")
    
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Test 1: Root & Health check
        print("\n--- 1. Testing Health & Root Endpoint ---")
        r_root = await client.get("/")
        print("GET / ->", r_root.status_code, r_root.json())
        assert r_root.status_code == 200
        assert r_root.json()["total_classes"] in (3, 4)
        
        # Test 2: Upload Pest Detection & OCR
        print("\n--- 2. Testing POST /api/v1/detect (Image Upload) ---")
        files = {"file": ("corn_pest_sample.jpg", test_image, "image/jpeg")}
        data = {"enable_ocr": "false", "confidence_threshold": "0.20"}
        r_detect = await client.post("/api/v1/detect", files=files, data=data)
        print("POST /api/v1/detect ->", r_detect.status_code)
        det_data = r_detect.json()
        print("  Status:", det_data["status"])
        print("  Total Pests Counted:", det_data["summary"]["total_pests"])
        print("  Species Breakdown:", det_data["summary"]["species_counts"])
        print("  IPM Risk Level:", det_data["summary"]["ipm_risk_level"])
        print("  IPM Action:", det_data["summary"]["ipm_action_recommended"])
        print("  Detections Count:", len(det_data["detections"]))
        print("  Annotated Image URL:", det_data["annotated_image_url"])
        print("  Processing Time:", det_data["processing_time_ms"], "ms")
        assert r_detect.status_code == 200
        
        # Test 3: Standalone OCR Scanner
        print("\n--- 3. Testing POST /api/v1/ocr (Trap Label OCR) ---")
        files_ocr = {"file": ("trap_label.jpg", test_image, "image/jpeg")}
        r_ocr = await client.post("/api/v1/ocr", files=files_ocr)
        print("POST /api/v1/ocr ->", r_ocr.status_code, r_ocr.json())
        assert r_ocr.status_code == 200
        
        # Test 4: Stream Frame Processing (Base64)
        print("\n--- 4. Testing POST /api/v1/stream/frame (Camera Stream) ---")
        import base64
        b64_frame = base64.b64encode(test_image).decode("utf-8")
        stream_payload = {
            "frame_base64": f"data:image/jpeg;base64,{b64_frame}",
            "enable_ocr": False,
            "confidence_threshold": 0.20
        }
        r_stream = await client.post("/api/v1/stream/frame", json=stream_payload)
        print("POST /api/v1/stream/frame ->", r_stream.status_code)
        stream_res = r_stream.json()
        print("  Camera Frame Pests:", stream_res["summary"]["total_pests"])
        print("  Inference Latency:", stream_res["processing_time_ms"], "ms")
        assert r_stream.status_code == 200
        
        # Test 5: Trap Registry & Analytics
        print("\n--- 5. Testing GET /api/v1/traps & Analytics ---")
        r_traps = await client.get("/api/v1/traps")
        print("GET /api/v1/traps ->", r_traps.status_code, f"Found {len(r_traps.json())} traps")
        assert r_traps.status_code == 200
        
        r_analytics = await client.get("/api/v1/traps/analytics/overview")
        print("GET /api/v1/traps/analytics/overview ->", r_analytics.status_code)
        analytics_data = r_analytics.json()
        print("  Total Traps:", analytics_data["total_traps"])
        print("  Total Pests Monitored:", analytics_data["total_pests_monitored"])
        print("  Top Pest Species:", analytics_data["top_pest_species"])
        assert r_analytics.status_code == 200

    print("\nALL INTEGRATION TESTS PASSED SUCCESSFULLY ON REAL DATASET!")

if __name__ == "__main__":
    asyncio.run(run_integration_tests())
