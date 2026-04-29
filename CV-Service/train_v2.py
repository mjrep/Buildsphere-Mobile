from ultralytics import YOLO
import torch
import os
import shutil

def train_v2():
    # 1. Detect device
    device = 0 if torch.cuda.is_available() else "cpu"
    print(f"🚀 Training v2 on: {device}")

    # 2. Load model (starting from the current best model for fine-tuning)
    current_best = "models/best_detect.pt"
    if os.path.exists(current_best):
        print(f"📍 Fine-tuning from existing model: {current_best}")
        model = YOLO(current_best)
    else:
        print("📍 Starting from base YOLOv8m weights")
        model = YOLO("yolov8m.pt")

    # 3. Start Training (Fine-tuning on the new 16 images)
    # Since it's a small dataset, we use fewer epochs and high augmentation
    model.train(
        data="datasets/v2/data.yaml", 
        epochs=50,             # Fine-tuning needs fewer epochs
        imgsz=640,
        batch=8,
        device=device,
        project="glass_counting_v2",
        name="v2_run",
        plots=True
    )

    # 4. Save the new model
    best_path = "glass_counting_v2/v2_run/weights/best.pt"
    if os.path.exists(best_path):
        target_path = "models/best_v2.pt"
        shutil.copy(best_path, target_path)
        print(f"\n✅ Training Complete! New model saved at: {target_path}")
    else:
        print("\n❌ Training failed or best.pt not found.")

if __name__ == "__main__":
    train_v2()
