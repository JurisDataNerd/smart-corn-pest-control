import os
import shutil
import random
from pathlib import Path
import yaml
from ultralytics import YOLO

def train_balanced_model():
    ds = Path("/home/fauzan/Projects/prof-dudi/dataset")
    balanced_dir = Path("/home/fauzan/Projects/prof-dudi/dataset_balanced")
    
    if balanced_dir.exists():
        shutil.rmtree(balanced_dir)
        
    for split in ['train', 'valid']:
        (balanced_dir / split / 'images').mkdir(parents=True, exist_ok=True)
        (balanced_dir / split / 'labels').mkdir(parents=True, exist_ok=True)
        
    print("====================================================================")
    print(" MENYIAPKAN DATASET SEIMBANG 4 KELAS (ANTI-BIAS ULAT TONGKOL)")
    print("====================================================================")
    
    # Collect images by class
    class_images = {0: [], 1: [], 2: [], 3: []}
    
    for split in ['train', 'valid', 'test']:
        for lbl_p in (ds / split / 'labels').glob('*.txt'):
            img_p = ds / split / 'images' / (lbl_p.stem + '.jpg')
            if not img_p.exists():
                img_p = ds / split / 'images' / (lbl_p.stem + '.png')
            if not img_p.exists() or lbl_p.stat().st_size == 0:
                continue
                
            classes_in_file = set()
            with open(lbl_p) as f:
                for line in f:
                    parts = line.strip().split()
                    if parts:
                        classes_in_file.add(int(parts[0]))
                        
            for c in classes_in_file:
                if c in class_images:
                    class_images[c].append((img_p, lbl_p))

    # Balance each class to ~150-180 samples
    target_samples = 150
    random.seed(42)
    
    train_count = {0: 0, 1: 0, 2: 0, 3: 0}
    val_count = {0: 0, 1: 0, 2: 0, 3: 0}
    
    for c, items in class_images.items():
        # Remove duplicates
        unique_items = list({str(p[0]): p for p in items}.values())
        random.shuffle(unique_items)
        selected = unique_items[:target_samples]
        
        n_train = int(len(selected) * 0.85)
        train_items = selected[:n_train]
        val_items = selected[n_train:]
        
        for img_p, lbl_p in train_items:
            shutil.copy2(img_p, balanced_dir / 'train' / 'images' / img_p.name)
            shutil.copy2(lbl_p, balanced_dir / 'train' / 'labels' / lbl_p.name)
            train_count[c] += 1
            
        for img_p, lbl_p in val_items:
            shutil.copy2(img_p, balanced_dir / 'valid' / 'images' / img_p.name)
            shutil.copy2(lbl_p, balanced_dir / 'valid' / 'labels' / lbl_p.name)
            val_count[c] += 1
            
    print("Sampel Latih per Kelas:")
    names = ['Asian-Corn-Borer', 'Bollworm', 'Fall-Armyworm', 'Rat']
    for c in range(4):
        print(f"  {names[c]:<20} -> Train: {train_count[c]}, Valid: {val_count[c]}")
        
    # Write balanced yaml
    data_yaml = {
        "path": str(balanced_dir),
        "train": "train/images",
        "val": "valid/images",
        "nc": 4,
        "names": names
    }
    yaml_p = balanced_dir / "data.yaml"
    with open(yaml_p, "w") as f:
        yaml.dump(data_yaml, f)
        
    print("\nMemulai pelatihan cepat dan presisi model YOLOv8 4 Kelas...")
    model = YOLO("yolov8n.pt")
    
    results = model.train(
        data=str(yaml_p),
        epochs=6,
        batch=32,
        imgsz=320,
        project="/home/fauzan/Projects/prof-dudi/backend/weights",
        name="balanced_4class_yolo",
        exist_ok=True,
        workers=4,
        save=True,
        plots=True
    )
    
    best_pt = Path("/home/fauzan/Projects/prof-dudi/backend/weights/balanced_4class_yolo/weights/best.pt")
    target_pt = Path("/home/fauzan/Projects/prof-dudi/backend/weights/corn_pest_yolo.pt")
    
    if best_pt.exists():
        shutil.copy(best_pt, target_pt)
        print(f"\nModel 4 Kelas Seimbang BERHASIL diperbarui di: {target_pt}")
        
    return results

if __name__ == "__main__":
    train_balanced_model()
