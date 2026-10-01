# 🌽 Smart Trap AI - Corn Pest & Rat Control Backend

[![FastAPI](https://img.shields.io/badge/FastAPI-0.110.0-009688.svg?style=flat&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB.svg?style=flat&logo=python)](https://www.python.org/)
[![PyTorch](https://img.shields.io/badge/PyTorch-YOLOv8-EE4C2C.svg?style=flat&logo=pytorch)](https://pytorch.org/)
[![OpenCV](https://img.shields.io/badge/OpenCV-Computer%20Vision-5C3EE8.svg?style=flat&logo=opencv)](https://opencv.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

High-performance, async FastAPI backend engine for real-time agricultural sticky trap monitoring, multi-class corn pest & rodent detection, OCR trap identification, physical quadrant mapping, and Integrated Pest Management (IPM) decision support.

---

## 🌟 Key Features

- **🎯 Multi-Class AI Pest & Rodent Detection**:
  Powered by fine-tuned YOLO object detection targeting key economic corn threats:
  1. `Asian-Corn-Borer` (*Ostrinia furnacalis*)
  2. `Bollworm` (*Helicoverpa zea*)
  3. `Fall-Armyworm` (*Spodoptera frugiperda*)
  4. `Rat` (*Rattus argiventer / Rattus spp.*)

- **📐 Physical Grid Quadrant Mapping**:
  Automatically partitions sticky trap surfaces into grid matrix coordinates (`A1` through `D4`), mapping pest bounding box centroids to precise spatial positions for density heatmaps.

- **🔍 Smart Trap OCR & Barcode Scanner**:
  Decodes QR codes, physical grid lines, and alphanumeric text on trap labels to extract Trap IDs (`TRAP-GH-01`), Zone Names (`ZONE-2`), and installation timestamps.

- **⚡ Dual-Mode Stream & Upload Ingestion**:
  - **High-Res Upload (`POST /api/v1/detect`)**: Batch/single field camera image analysis with bounding box overlay rendering and cloud storage.
  - **Live Camera Stream (`POST /api/v1/stream/frame` & `WebSocket /api/v1/stream/ws`)**: Sub-40ms latency stream frame processing for edge-connected smart camera traps.

- **📊 Integrated Pest Management (IPM) Advisor**:
  Evaluates total pest counts and population ratios against Economic Injury Level (EIL) thresholds:
  - 🟢 **LOW**: Safe baseline; routine observation.
  - 🟡 **MEDIUM**: Alert state; inspect surrounding crop canopy.
  - 🟠 **HIGH**: Threshold reached; deploy biopesticides or biological controls.
  - 🔴 **CRITICAL**: Outbreak level; immediate targeted chemical / mechanical intervention recommended.

- **🗄️ Trap Registry & Historical Analytics**:
  Full CRUD and async database persistence (SQLite / PostgreSQL with SQLAlchemy 2.0) tracking trap locations, inspection timestamps, pest trends, and field zone statistics.

---

## 📁 Repository Structure

```text
backend/
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── api.py           # API Router entrypoint
│   │       └── endpoints/
│   │           ├── detect.py    # Image upload & detection endpoint
│   │           ├── ocr.py       # Trap label OCR & QR scanner
│   │           ├── stream.py    # Live video stream & WebSocket handler
│   │           └── traps.py     # Trap registry & IPM analytics
│   ├── core/
│   │   ├── config.py            # Pydantic environment & app settings
│   │   └── ipm_rules.py         # IPM threshold algorithms & recommendations
│   ├── db/
│   │   └── session.py           # Async SQLAlchemy database engine & session
│   ├── models/
│   │   └── trap.py              # Database ORM models (Traps, Inspections)
│   ├── schemas/
│   │   ├── detection.py         # Pydantic models for vision outputs
│   │   └── trap.py              # Pydantic models for trap CRUD & analytics
│   └── services/
│       ├── ocr_service.py       # OpenCV & Tesseract OCR parsing engine
│       ├── pest_classifier.py   # Fallback heuristic / ResNet classifier
│       └── pest_detector.py     # YOLO inference wrapper & grid mapper
├── weights/                     # Pre-trained YOLO model weights (.pt)
├── tests/                       # Automated Pytest suite & benchmarking
├── main.py                      # FastAPI application bootstrap
├── requirements.txt             # Python dependencies
├── train_balanced_4class.py     # YOLOv8 fine-tuning script
├── merge_rat_dataset.py         # Dataset builder & merger
└── fix_dataset_labels.py        # Dataset annotation validator
```

---

## 🚀 Quick Start

### 1. Prerequisites

- Python 3.10 or higher
- `pip` & `virtualenv`
- (Optional) CUDA-enabled GPU for accelerated YOLO inference

### 2. Installation & Setup

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/JurisDataNerd/backend-smart-corn-pest-control.git
   cd backend-smart-corn-pest-control
   ```

2. **Create & Activate Virtual Environment**:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install Dependencies**:
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

4. **Configure Environment Variables** *(Optional)*:
   Create a `.env` file in the root directory:
   ```env
   PROJECT_NAME="Smart Trap AI - Corn Pest & Rat Detection Engine"
   DEBUG=True
   CONFIDENCE_THRESHOLD=0.40
   DATABASE_URL="sqlite+aiosqlite:///./smart_trap.db"
   ```

### 3. Running the Backend Server

Start the Uvicorn ASGI server with live reloading:

```bash
PYTHONPATH=. uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Server output confirmation:
```text
[SmartTrap AI] Database initialized & ready.
[SmartTrap AI] Supported classes (4): ['Asian-Corn-Borer', 'Bollworm', 'Fall-Armyworm', 'Rat']
INFO:     Started server process
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

---

## 📖 API Documentation & Endpoints

Once the application is running, interactive API docs are available at:
- **Swagger UI**: `http://localhost:8000/api/v1/docs`
- **ReDoc**: `http://localhost:8000/api/v1/redoc`
- **OpenAPI Schema**: `http://localhost:8000/api/v1/openapi.json`

### Key API Endpoints Summary

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Root status, active model classes & API version |
| `GET` | `/health` | System health check (DB, Storage) |
| `POST` | `/api/v1/detect` | Upload trap photo for AI detection & quadrant mapping |
| `POST` | `/api/v1/ocr/scan` | Scan trap label OCR for Trap ID & Zone |
| `POST` | `/api/v1/stream/frame` | Ingest live camera stream frame |
| `WS` | `/api/v1/stream/ws` | Real-time WebSocket connection for stream telemetry |
| `GET` | `/api/v1/traps/` | List registered smart sticky traps |
| `POST` | `/api/v1/traps/` | Register a new smart trap |
| `GET` | `/api/v1/traps/{trap_id}/analytics` | Retrieve IPM risk level, trends, and recommendations |

---

## 🧪 Testing & Verification

Run the test suite to verify model loading, detection pipeline, database sessions, and API endpoints:

```bash
PYTHONPATH=. python3 tests/test_backend.py
```

To run all class benchmarks:
```bash
PYTHONPATH=. python3 tests/test_all_15_classes.py
```

---

## 🏋️ Model Training & Custom Datasets

To retrain or fine-tune the 4-class YOLO detection model (`Asian-Corn-Borer`, `Bollworm`, `Fall-Armyworm`, `Rat`):

1. Prepare your raw dataset layout or merge custom datasets:
   ```bash
   python3 merge_rat_dataset.py
   python3 fix_dataset_labels.py
   ```
2. Execute model fine-tuning:
   ```bash
   python3 train_balanced_4class.py
   ```
   Trained weights will be stored automatically in `weights/balanced_4class_yolo/weights/best.pt`.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

Developed with ❤️ for Precision Agriculture & Smart Farming Systems.
