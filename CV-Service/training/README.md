# BuildSphere Glass Panel YOLO Training Guide

This guide explains how to prepare your dataset, train the YOLO model, and evaluate its counting accuracy for the BuildSphere CV-Service.

## The Golden Rule of Annotation

**ONE VISIBLE GLASS PANEL = ONE ANNOTATION = ONE COUNT.**

*   **DO:** Draw a tight bounding box (or polygon for segmentation) around *every individual installed glass panel* visible in the image.
*   **DO NOT:** Draw a single massive bounding box around an entire glass facade or curtain wall. The system counts the number of annotations to track physical items installed.
*   **DO NOT:** Annotate stacked, uninstalled panels sitting on the ground (unless you explicitly want the system to count inventory). Only annotate panels installed on the building structure.

## Dataset Structure

Your dataset should follow the standard YOLOv8 format:

```text
CV-Service/datasets/
├── data.yaml              # Dataset configuration file
├── images/
│   ├── train/             # Training images (.jpg, .png)
│   ├── valid/             # Validation images
│   └── test/              # Test images (optional)
└── labels/
    ├── train/             # YOLO format text files (.txt)
    ├── valid/             
    └── test/              
```

*For standard detection (boxes), the `.txt` files contain: `class_id center_x center_y width height`*
*For segmentation (polygons), the `.txt` files contain: `class_id x1 y1 x2 y2 x3 y3 ...`*

## Training the Model

The `train.py` script automatically applies heavy augmentation optimized for transparent and reflective glass panels on construction sites (handling glare, scaffolding occlusion, and varied camera angles).

### Option A: Standard Bounding Box Detection
To train a standard YOLOv8 box detection model:
```bash
python training/train.py --task detect --epochs 150 --batch 16
```
*This saves the best weights to `CV-Service/models/best_detect.pt`.*

### Option B: Instance Segmentation (Polygons)
If your dataset contains polygon masks, you can train a segmentation model. This is more accurate for counting tightly packed panels.
```bash
python training/train.py --task segment --epochs 150 --batch 16
```
*This saves the best weights to `CV-Service/models/best_seg.pt`.*

## Evaluating Counting Accuracy

Standard YOLO metrics (like mAP) don't tell the full story when your primary goal is *counting*. A model might have a high mAP but constantly overcount reflections as panels. 

We provide a custom script, `evaluate_counting.py`, to calculate exact counting accuracy.

### Running the Evaluation

To evaluate your trained model against the validation split:

```bash
python training/evaluate_counting.py \
    --model models/best_detect.pt \
    --dataset datasets \
    --split valid \
    --conf 0.25
```

### What it does:
1.  **Reads Actual Count:** Looks at the `.txt` label files to see how many panels a human annotated.
2.  **Reads Predicted Count:** Runs the model and counts how many boxes/masks pass the `--conf` threshold.
3.  **Calculates Error:** `Absolute Error = |Actual - Predicted|`
4.  **Calculates Accuracy:** `1 - (Absolute Error / Actual)`
5.  **Outputs Reports:** Creates `counting_evaluation.csv` (per-image results) and `counting_summary.json` (overall metrics).

### Edge Case Handling
*   If Actual = 0 and Predicted = 0, Accuracy = 100%.
*   If Actual = 0 and Predicted > 0, Accuracy = 0% (False Positives).
