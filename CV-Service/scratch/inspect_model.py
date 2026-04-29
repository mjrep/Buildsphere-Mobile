from ultralytics import YOLO
import sys

try:
    model = YOLO('models/best_detect.pt')
    print(f"Model Classes: {model.names}")
except Exception as e:
    print(f"Error: {e}")
