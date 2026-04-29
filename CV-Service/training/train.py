"""
BuildSphere — YOLO Glass Panel Training Script.

Train a YOLOv8m model on a custom dataset of glass panels with
aggressive augmentation tuned for transparent/reflective surfaces.

Usage:
    python training/train.py
    python training/train.py --epochs 200 --batch 8 --resume
    python training/train.py --model yolov8l.pt --imgsz 1280

The script will:
    1. Load a pre-trained YOLOv8m base model
    2. Apply glass-specific augmentation strategy
    3. Train on your annotated dataset
    4. Save the best weights to ../models/best.pt
"""

import argparse
import sys
from pathlib import Path
from datetime import datetime

from ultralytics import YOLO


def parse_args():
    parser = argparse.ArgumentParser(
        description="Train YOLOv8 for glass panel detection"
    )
    parser.add_argument(
        "--task",
        type=str,
        choices=["detect", "segment"],
        default="detect",
        help="Training task: 'detect' for bounding boxes or 'segment' for polygons.",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="",
        help="Base model to fine-tune (defaults to yolov8m.pt or yolov8m-seg.pt based on task)",
    )
    parser.add_argument(
        "--data",
        type=str,
        default="training/data.yaml",
        help="Path to dataset config YAML",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=150,
        help="Number of training epochs (default: 150)",
    )
    parser.add_argument(
        "--batch",
        type=int,
        default=16,
        help="Batch size (default: 16, reduce for limited VRAM)",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Training image size in pixels (default: 640)",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="",
        help="Device: '0' for GPU 0, 'cpu' for CPU, '' for auto",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume training from last checkpoint",
    )
    parser.add_argument(
        "--patience",
        type=int,
        default=30,
        help="Early stopping patience (epochs without improvement)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=8,
        help="Number of data loader workers",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    print("=" * 65)
    print("  BuildSphere — Glass Panel YOLO Training")
    print("=" * 65)
    print(f"  Base Model   : {args.model}")
    print(f"  Dataset      : {args.data}")
    print(f"  Epochs       : {args.epochs}")
    print(f"  Batch Size   : {args.batch}")
    print(f"  Image Size   : {args.imgsz}px")
    print(f"  Device       : {args.device or 'auto'}")
    print(f"  Patience     : {args.patience}")
    print(f"  Resume       : {args.resume}")
    print("=" * 65)

    # ── Set base model if not provided ────────────────────────────
    base_model = args.model
    if not base_model:
        base_model = "yolov8m.pt" if args.task == "detect" else "yolov8m-seg.pt"

    # ── Validate dataset config exists ────────────────────────────
    data_path = Path(args.data)
    if not data_path.exists():
        print(f"\n❌ Dataset config not found: {data_path}")
        print("   Make sure you have created your dataset in the expected structure.")
        print("   See training/data.yaml for the required directory layout.")
        sys.exit(1)

    # ── Load the base model ───────────────────────────────────────
    print(f"\n📦 Loading base model: {base_model}")
    model = YOLO(base_model)

    # ── Configure training run name ───────────────────────────────
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_name = f"glass_panel_{timestamp}"

    # ── Train with glass-specific augmentation ────────────────────
    print(f"\n🚀 Starting training run: {run_name}\n")

    results = model.train(
        # ── Dataset ───────────────────────────────────────────────
        data=str(data_path),
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        device=args.device if args.device else None,
        workers=args.workers,
        resume=args.resume,

        # ── Training hyperparameters ──────────────────────────────
        patience=args.patience,          # Early stopping
        lr0=0.01,                        # Initial learning rate
        lrf=0.01,                        # Final learning rate factor
        momentum=0.937,                  # SGD momentum
        weight_decay=0.0005,             # L2 regularization
        warmup_epochs=3.0,               # Learning rate warmup
        warmup_momentum=0.8,
        warmup_bias_lr=0.1,

        # ── Loss function weights ─────────────────────────────────
        box=7.5,                         # Box loss weight
        cls=0.5,                         # Classification loss (low — single class)
        dfl=1.5,                         # Distribution focal loss

        # ══════════════════════════════════════════════════════════
        #  GLASS-SPECIFIC AUGMENTATION STRATEGY
        # ══════════════════════════════════════════════════════════
        #
        #  These settings are specifically tuned for detecting
        #  transparent and reflective glass panels on construction
        #  sites. They address three key challenges:
        #
        #  1. REFLECTIONS: High HSV variance teaches the model to
        #     ignore color shifts caused by sky/cloud reflections.
        #
        #  2. TRANSPARENCY: Mixup blends images together, forcing
        #     the model to detect edges rather than interior content.
        #
        #  3. OCCLUSION: Mosaic, erasing, and copy-paste simulate
        #     scaffolding, cranes, and workers blocking panels.
        # ══════════════════════════════════════════════════════════

        # Photometric augmentation (reflection/glare handling)
        hsv_h=0.015,                     # Hue shift — color cast from reflections
        hsv_s=0.7,                       # Saturation — washed-out glass in sunlight
        hsv_v=0.4,                       # Brightness — critical for glare simulation

        # Geometric augmentation (camera angle variance)
        degrees=15.0,                    # Rotation — workers shoot at angles
        translate=0.2,                   # Translation — panels at image edges
        scale=0.5,                       # Scale — panels at different distances
        shear=5.0,                       # Shear — perspective from below
        perspective=0.001,               # Perspective warp
        flipud=0.1,                      # Vertical flip (rare, helps generalize)
        fliplr=0.5,                      # Horizontal flip

        # Advanced augmentation (occlusion + confusion)
        mosaic=1.0,                      # 4-image mosaic — learn partial panels
        mixup=0.15,                      # Image blending — simulates transparency
        copy_paste=0.3,                  # Instance copy-paste — varied contexts
        erasing=0.4,                     # Random erasing — simulates scaffolding

        # ── Output ────────────────────────────────────────────────
        project="runs/train",
        name=run_name,
        exist_ok=False,
        save=True,                       # Save checkpoints
        save_period=10,                  # Save every 10 epochs
        plots=True,                      # Generate training plots
        verbose=True,
    )

    # ── Copy best weights to models/ directory ────────────────────
    best_weights = Path(f"runs/train/{run_name}/weights/best.pt")
    target_filename = "best_detect.pt" if args.task == "detect" else "best_seg.pt"
    target_path = Path(__file__).parent.parent / "models" / target_filename
    target_path.parent.mkdir(parents=True, exist_ok=True)

    if best_weights.exists():
        import shutil
        shutil.copy2(best_weights, target_path)
        print(f"\n✅ Best weights saved to: {target_path}")
    else:
        print(f"\n⚠️  Best weights not found at {best_weights}")
        print("   Check the training output for errors.")

    # ── Validation on test set ────────────────────────────────────
    print("\n📊 Running validation on test set...")
    try:
        metrics = model.val(
            data=str(data_path),
            split="test",
            imgsz=args.imgsz,
            batch=args.batch,
            verbose=True,
        )
        print(f"\n📈 Test Results:")
        print(f"   mAP@0.5      : {metrics.box.map50:.4f}")
        print(f"   mAP@0.5:0.95 : {metrics.box.map:.4f}")
        print(f"   Precision     : {metrics.box.mp:.4f}")
        print(f"   Recall        : {metrics.box.mr:.4f}")
    except Exception as e:
        print(f"\n⚠️  Test validation skipped: {e}")
        print("   This usually means the test split is empty or missing.")

    print("\n" + "=" * 65)
    print("  ✅ Training complete!")
    print(f"  Best weights: {target_path}")
    print(f"  Training logs: runs/train/{run_name}/")
    print("=" * 65)

    # ── Print next steps ──────────────────────────────────────────
    print("\n📋 Next Steps:")
    print(f"   1. Update MODEL_PATH in .env to point to 'models/{target_filename}'")
    print("   2. Set USE_PRETRAINED_COCO=false in .env")
    print("   3. Restart the CV service: uvicorn app.main:app --reload")
    print("   4. Test with: curl -X POST http://localhost:8000/detect-panels -F 'file=@test.jpg'\n")


if __name__ == "__main__":
    main()
