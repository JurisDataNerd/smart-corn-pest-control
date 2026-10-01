import cv2
import numpy as np

def analyze_image(path):
    img = cv2.imread(path)
    h, w = img.shape[:2]
    print(f"=== {path} ===")
    print(f"Resolution: {w}x{h}")
    
    # Check background homogeneity (sticky trap vs field)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    std_h = np.std(hsv[:, :, 0])
    std_s = np.std(hsv[:, :, 1])
    std_v = np.std(hsv[:, :, 2])
    print(f"HSV Standard Deviations: H={std_h:.2f}, S={std_s:.2f}, V={std_v:.2f}")
    
    # High variance across image indicates complex natural field scene
    is_field_photo = (std_h > 20 or std_s > 40 or std_v > 40)
    print(f"Detected Scene Type: {'Field / Macro Photo' if is_field_photo else 'Flat Sticky Card Trap'}")

if __name__ == "__main__":
    analyze_image("corn-earworm.jpeg")
    analyze_image("corn.webp")
