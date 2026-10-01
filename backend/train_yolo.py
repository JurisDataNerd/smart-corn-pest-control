import os
import shutil
from pathlib import Path
from ultralytics import YOLO

def train_corn_and_rat_model(epochs=5, batch=32, imgsz=384):
    dataset_yaml = Path("/home/fauzan/Projects/prof-dudi/dataset/data.yaml")
    assert dataset_yaml.exists(), f"Dataset config not found at {dataset_yaml}"
    
    print("====================================================================")
    print(" PELATIHAN MODEL YOLOv8 HAMA JAGUNG & TIKUS (4 KELAS LENGKAP)")
    print(f" Dataset: {dataset_yaml}")
    print(f" Epochs: {epochs} | Batch: {batch} | Image Size: {imgsz}")
    print(" Target Classes: [0: Asian-Corn-Borer, 1: Bollworm, 2: Fall-Armyworm, 3: Rat]")
    print("====================================================================")
    
    model = YOLO("yolov8n.pt")
    
    results = model.train(
        data=str(dataset_yaml),
        epochs=epochs,
        batch=batch,
        imgsz=imgsz,
        project="/home/fauzan/Projects/prof-dudi/backend/weights",
        name="corn_and_rat_yolo_4cls",
        exist_ok=True,
        workers=4,
        save=True,
        plots=True
    )
    
    best_pt = Path("/home/fauzan/Projects/prof-dudi/backend/weights/corn_and_rat_yolo_4cls/weights/best.pt")
    target_pt = Path("/home/fauzan/Projects/prof-dudi/backend/weights/corn_pest_yolo.pt")
    if best_pt.exists():
        shutil.copy(best_pt, target_pt)
        print(f"\nModel 4 kelas (Hama Jagung & Tikus) berhasil disimpan di {target_pt}!")
    
    return results

if __name__ == "__main__":
    train_corn_and_rat_model(epochs=4, batch=32, imgsz=384)
