from ultralytics import YOLO
import os

def evaluate():
    v1_path = "models/best_detect.pt"
    v2_path = "models/best_v2.pt"
    data_path = "datasets/data.yaml" # Use the original data.yaml for fair comparison

    print("📊 Side-by-Side Evaluation Starting...")
    
    # 1. Evaluate V1
    print("\n--- Model V1 (Original) ---")
    model_v1 = YOLO(v1_path)
    metrics_v1 = model_v1.val(data=data_path, split='test', verbose=False)
    mAP50_v1 = metrics_v1.results_dict['metrics/mAP50(B)']
    
    # 2. Evaluate V2
    print("\n--- Model V2 (New) ---")
    model_v2 = YOLO(v2_path)
    metrics_v2 = model_v2.val(data=data_path, split='test', verbose=False)
    mAP50_v2 = metrics_v2.results_dict['metrics/mAP50(B)']

    print("\n" + "="*40)
    print(f"🏆 EVALUATION RESULTS (mAP50)")
    print(f"V1 (Original): {mAP50_v1:.4f}")
    print(f"V2 (New):      {mAP50_v2:.4f}")
    print("="*40)

    if mAP50_v2 > mAP50_v1:
        print("\n🚀 SUCCESS: The new model (V2) is more accurate!")
    else:
        print("\n⚠️ NOTE: The original model (V1) is still performing better.")

if __name__ == "__main__":
    evaluate()
