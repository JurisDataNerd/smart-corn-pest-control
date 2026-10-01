import os
import shutil
import random
from pathlib import Path
import yaml

def merge_rat_dataset():
    rat_dir = Path("/home/fauzan/Projects/prof-dudi/rat_detection.v4i.yolov5pytorch")
    ds = Path("/home/fauzan/Projects/prof-dudi/dataset")
    
    assert rat_dir.exists(), f"Directory {rat_dir} not found!"
    assert ds.exists(), f"Dataset directory {ds} not found!"
    
    print("====================================================================")
    print(" MENGGABUNGKAN DATASET TIKUS (RAT DETECTION) KE DATASET UTAMA")
    print("====================================================================")
    
    rat_images = list((rat_dir / "images").glob("*.jpg")) + list((rat_dir / "images").glob("*.png"))
    print(f"Ditemukan {len(rat_images)} gambar tikus.")
    
    # Shuffle with fixed seed for deterministic split
    random.seed(42)
    random.shuffle(rat_images)
    
    total = len(rat_images)
    train_end = int(total * 0.80)
    val_end = int(total * 0.90)
    
    splits = {
        'train': rat_images[:train_end],
        'valid': rat_images[train_end:val_end],
        'test': rat_images[val_end:]
    }
    
    for split_name, imgs in splits.items():
        target_img_dir = ds / split_name / "images"
        target_lbl_dir = ds / split_name / "labels"
        target_img_dir.mkdir(parents=True, exist_ok=True)
        target_lbl_dir.mkdir(parents=True, exist_ok=True)
        
        copied_count = 0
        for img_p in imgs:
            lbl_p = rat_dir / "labels" / (img_p.stem + ".txt")
            if not lbl_p.exists():
                continue
                
            # Read label and remap class 0 (Rat) -> class 3
            new_lines = []
            with open(lbl_p, "r") as f:
                for line in f:
                    parts = line.strip().split()
                    if parts:
                        # Map class 0 to class 3
                        parts[0] = "3"
                        new_lines.append(" ".join(parts))
                        
            if new_lines:
                # Copy image with prefix rat_
                dest_img_p = target_img_dir / f"rat_{img_p.name}"
                dest_lbl_p = target_lbl_dir / f"rat_{img_p.stem}.txt"
                
                shutil.copy2(img_p, dest_img_p)
                with open(dest_lbl_p, "w") as f:
                    f.write("\n".join(new_lines) + "\n")
                    
                copied_count += 1
                
        print(f"Split {split_name:<6}: Berhasil menambahkan {copied_count} citra tikus.")

    # Update data.yaml
    yaml_path = ds / "data.yaml"
    data_yaml = {
        "path": "/home/fauzan/Projects/prof-dudi/dataset",
        "train": "train/images",
        "val": "valid/images",
        "test": "test/images",
        "nc": 4,
        "names": ["Asian-Corn-Borer", "Bollworm", "Fall-Armyworm", "Rat"]
    }
    
    with open(yaml_path, "w") as fp:
        yaml.dump(data_yaml, fp, sort_keys=False)
        
    print("\nBerhasil memperbarui data.yaml ke 4 kelas:")
    print(" ['Asian-Corn-Borer', 'Bollworm', 'Fall-Armyworm', 'Rat']")

if __name__ == "__main__":
    merge_rat_dataset()
