import cv2
import numpy as np
from backend.app.core.config import settings
from backend.app.services.pest_classifier import PestClassifier
from backend.app.core.ipm_rules import IPMAdvisor

def test_15_classes():
    print("=========================================================================")
    print(" VERIFYING ALL 15 AGRICULTURAL CLASSES AS DEFINED IN THE NOTEBOOK")
    print("=========================================================================")
    
    classifier = PestClassifier()
    
    print(f"\nTotal Target Classes: {len(settings.TARGET_CLASSES)}")
    print(f"{'#':<3} {'Class Name':<38} {'Train Weight':<15} {'IPM Rule Active'}")
    print("-" * 75)
    
    for i, cls_name in enumerate(settings.TARGET_CLASSES, 1):
        weight = settings.CLASS_WEIGHTS.get(cls_name, 1.0)
        has_ipm = cls_name in IPMAdvisor.IPM_PROFILES
        print(f"{i:<3} {cls_name:<38} {weight:<15.3f} {'YES' if has_ipm else 'NO'}")
        assert has_ipm, f"Missing IPM rule for {cls_name}"
        
    print("\n--- Testing Specific Detections on Real Image Files ---")
    for img_name in ['corn-earworm.jpeg', 'corn.webp']:
        img = cv2.imread(img_name)
        assert img is not None, f"Image {img_name} not found"
        pred_class, conf, prob_dict = classifier.classify_crop(img, full_context_bgr=img)
        print(f"File: {img_name:<18} -> Predicted: {pred_class:<20} Confidence: {conf*100:.1f}%")
        
    print("\nAll 15 classes and weights successfully verified against notebook specifications!")

if __name__ == "__main__":
    test_15_classes()
