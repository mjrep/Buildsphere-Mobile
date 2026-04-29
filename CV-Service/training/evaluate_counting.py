import argparse
import os
import json
import csv
from pathlib import Path
from ultralytics import YOLO

def parse_args():
    parser = argparse.ArgumentParser(description="Evaluate YOLO counting accuracy for glass panels.")
    parser.add_argument("--model", type=str, required=True, help="Path to the trained YOLO model (e.g., best_detect.pt)")
    parser.add_argument("--dataset", type=str, required=True, help="Path to the dataset directory (e.g., datasets/)")
    parser.add_argument("--split", type=str, default="valid", help="Dataset split to evaluate: 'train', 'valid', or 'test'")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold for predictions")
    parser.add_argument("--class-id", type=int, default=0, help="Class ID to count (default 0 for glass panel)")
    parser.add_argument("--output-csv", type=str, default="counting_evaluation.csv", help="Output CSV file path")
    parser.add_argument("--output-json", type=str, default="counting_summary.json", help="Output JSON file path")
    return parser.parse_args()

def get_actual_count(label_path, target_class_id):
    """Read YOLO label file and count instances of the target class."""
    if not os.path.exists(label_path):
        return 0
    count = 0
    with open(label_path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) > 0 and int(parts[0]) == target_class_id:
                count += 1
    return count

def evaluate():
    args = parse_args()
    
    print(f"Loading model: {args.model}")
    try:
        model = YOLO(args.model)
    except Exception as e:
        print(f"Failed to load model: {e}")
        return

    images_dir = Path(args.dataset) / args.split / "images"
    labels_dir = Path(args.dataset) / args.split / "labels"

    if not images_dir.exists():
        print(f"Error: Images directory not found at {images_dir}")
        return

    image_files = [f for f in os.listdir(images_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
    if not image_files:
        print(f"No images found in {images_dir}")
        return

    print(f"Found {len(image_files)} images in the '{args.split}' split. Starting evaluation...")

    results = []
    total_actual = 0
    total_predicted = 0
    total_abs_error = 0
    
    exact_matches = 0
    overcounts = 0
    undercounts = 0

    for img_file in image_files:
        img_path = str(images_dir / img_file)
        # Label files have the same name but .txt extension
        base_name = os.path.splitext(img_file)[0]
        label_path = str(labels_dir / f"{base_name}.txt")

        # 1. Get Actual Count
        actual_count = get_actual_count(label_path, args.class_id)
        
        # 2. Get Predicted Count
        # Run inference (suppress verbose output per image)
        prediction = model.predict(source=img_path, conf=args.conf, verbose=False)[0]
        
        # Count detections matching the target class
        predicted_count = 0
        if prediction.boxes is not None:
            # For both detect and seg models, boxes are available.
            # Masks might be available for seg, but count is the same.
            classes = prediction.boxes.cls.cpu().numpy()
            predicted_count = sum(1 for c in classes if int(c) == args.class_id)

        # 3. Calculate Error and Accuracy
        abs_error = abs(actual_count - predicted_count)
        
        if actual_count == 0 and predicted_count == 0:
            accuracy = 1.0
        elif actual_count == 0 and predicted_count > 0:
            accuracy = 0.0
        else:
            accuracy = max(0.0, 1.0 - (abs_error / actual_count))

        # Accumulate metrics
        total_actual += actual_count
        total_predicted += predicted_count
        total_abs_error += abs_error
        
        if predicted_count == actual_count:
            exact_matches += 1
        elif predicted_count > actual_count:
            overcounts += 1
        else:
            undercounts += 1

        results.append({
            "image": img_file,
            "actual_count": actual_count,
            "predicted_count": predicted_count,
            "absolute_error": abs_error,
            "counting_accuracy": round(accuracy, 4)
        })

    # Summary calculations
    num_images = len(results)
    mae = total_abs_error / num_images if num_images > 0 else 0
    avg_accuracy = sum(r["counting_accuracy"] for r in results) / num_images if num_images > 0 else 0

    summary = {
        "total_images_evaluated": num_images,
        "total_actual_panels": total_actual,
        "total_predicted_panels": total_predicted,
        "total_absolute_error": total_abs_error,
        "mean_absolute_error_per_image": round(mae, 4),
        "average_counting_accuracy": round(avg_accuracy, 4),
        "exact_match_images": exact_matches,
        "overcount_images": overcounts,
        "undercount_images": undercounts
    }

    # Export to CSV
    with open(args.output_csv, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=["image", "actual_count", "predicted_count", "absolute_error", "counting_accuracy"])
        writer.writeheader()
        writer.writerows(results)
    print(f"\n✅ Detailed per-image results saved to {args.output_csv}")

    # Export to JSON
    with open(args.output_json, 'w') as f:
        json.dump(summary, f, indent=4)
    print(f"✅ Summary metrics saved to {args.output_json}")

    # Print Summary to terminal
    print("\n" + "="*50)
    print(" 📊 Counting Evaluation Summary")
    print("="*50)
    print(f" Images Evaluated     : {summary['total_images_evaluated']}")
    print(f" Actual Panels        : {summary['total_actual_panels']}")
    print(f" Predicted Panels     : {summary['total_predicted_panels']}")
    print("-" * 50)
    print(f" Mean Absolute Error  : {summary['mean_absolute_error_per_image']:.4f} panels/image")
    print(f" Average Accuracy     : {summary['average_counting_accuracy'] * 100:.2f}%")
    print("-" * 50)
    print(f" Exact Matches        : {summary['exact_match_images']}")
    print(f" Overcounts           : {summary['overcount_images']}")
    print(f" Undercounts          : {summary['undercount_images']}")
    print("="*50 + "\n")

if __name__ == "__main__":
    evaluate()
