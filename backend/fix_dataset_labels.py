import cv2
import numpy as np
from pathlib import Path
import yaml

def auto_label_faw_and_update_dataset():
    ds = Path("/home/fauzan/Projects/prof-dudi/dataset")
    
    print("====================================================================")
    print(" MEMPERBAIKI LABEL DATASET: MENAMBAHKAN KELAS 2 (FALL-ARMYWORM)")
    print("====================================================================")
    
    faw_labeled_count = 0
    
    for split in ['train', 'valid', 'test']:
        img_dir = ds / split / 'images'
        lbl_dir = ds / split / 'labels'
        lbl_dir.mkdir(parents=True, exist_ok=True)
        
        for img_p in img_dir.glob('*'):
            name_lower = img_p.name.lower()
            if any(k in name_lower for k in ['faw', 'armyworm', 'frugiperda', 'spodoptera']):
                lbl_p = lbl_dir / (img_p.stem + '.txt')
                
                # If empty or not exists, compute bounding box
                if not lbl_p.exists() or lbl_p.stat().st_size == 0:
                    img = cv2.imread(str(img_p))
                    if img is None:
                        continue
                    h, w = img.shape[:2]
                    
                    # Extract caterpillar contour bounding box
                    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                    blurred = cv2.GaussianBlur(gray, (9, 9), 0)
                    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
                    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    
                    boxes = []
                    for c in contours:
                        area = cv2.contourArea(c)
                        if area > (w * h * 0.03):
                            x, y, bw, bh = cv2.boundingRect(c)
                            # Convert to YOLO format (class x_center y_center width height)
                            xc = (x + bw / 2.0) / w
                            yc = (y + bh / 2.0) / h
                            norm_w = bw / float(w)
                            norm_h = bh / float(h)
                            boxes.append(f"2 {xc:.6f} {yc:.6f} {norm_w:.6f} {norm_h:.6f}")
                    
                    if not boxes:
                        # Default center box if Otsu failed
                        boxes.append("2 0.500000 0.500000 0.700000 0.700000")
                    
                    with open(lbl_p, "w") as fp:
                        fp.write("\n".join(boxes) + "\n")
                    
                    faw_labeled_count += 1

    print(f"Berhasil memberi label untuk {faw_labeled_count} citra Fall-Armyworm (Ulat Grayak) sebagai Kelas 2!")

    # Update data.yaml to 3 classes
    yaml_path = ds / "data.yaml"
    data_yaml = {
        "path": "/home/fauzan/Projects/prof-dudi/dataset",
        "train": "train/images",
        "val": "valid/images",
        "test": "test/images",
        "nc": 3,
        "names": ["Asian-Corn-Borer", "Bollworm", "Fall-Armyworm"]
    }
    
    with open(yaml_path, "w") as fp:
        yaml.dump(data_yaml, fp, sort_keys=False)
        
    print("Berhasil memperbarui data.yaml ke 3 kelas: ['Asian-Corn-Borer', 'Bollworm', 'Fall-Armyworm']")

if __name__ == "__main__":
    auto_label_faw_and_update_dataset()
