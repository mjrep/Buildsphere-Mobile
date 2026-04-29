import json
import os
import shutil
from pathlib import Path

def convert_coco_to_yolo():
    base_dir = Path("datasets/train")
    images_dir = base_dir / "images"
    labels_dir = base_dir / "labels"
    
    # Ensure directories exist
    images_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)

    json_path = base_dir / "_annotations.coco.json"
    if not json_path.exists():
        print("No COCO JSON found.")
        return

    print("Loading COCO JSON...")
    with open(json_path, 'r') as f:
        data = json.load(f)

    # Build image lookup
    images = {img['id']: img for img in data['images']}

    # Group annotations by image_id
    ann_by_image = {}
    for ann in data['annotations']:
        img_id = ann['image_id']
        if img_id not in ann_by_image:
            ann_by_image[img_id] = []
        ann_by_image[img_id].append(ann)

    converted_count = 0

    for img_id, img_info in images.items():
        img_filename = img_info['file_name']
        width = img_info['width']
        height = img_info['height']
        
        import uuid
        short_id = str(uuid.uuid4())[:8]
        new_img_filename = f"{short_id}.jpg"
        
        src_img_path = base_dir / img_filename
        dst_img_path = images_dir / new_img_filename
        
        # Move and rename image if it exists in the root of train/
        if src_img_path.exists() and not dst_img_path.exists():
            shutil.move(str(src_img_path), str(dst_img_path))
            print(f"Moved {img_filename} to images/{new_img_filename}")
        elif (images_dir / img_filename).exists():
            # Already moved but we need to rename it
            shutil.move(str(images_dir / img_filename), str(dst_img_path))
            
        # Create YOLO label file
        label_filename = f"{short_id}.txt"
        label_path = labels_dir / label_filename
        
        annotations = ann_by_image.get(img_id, [])
        yolo_lines = []
        
        for ann in annotations:
            # Force class 0 for all glass panels
            class_id = 0
            
            if 'segmentation' in ann and isinstance(ann['segmentation'], list) and len(ann['segmentation']) > 0 and len(ann['segmentation'][0]) > 4:
                # Polygon format
                poly = ann['segmentation'][0]
                norm_poly = []
                for i in range(0, len(poly), 2):
                    nx = float(poly[i]) / float(width)
                    ny = float(poly[i+1]) / float(height)
                    norm_poly.extend([f"{nx:.6f}", f"{ny:.6f}"])
                
                line = f"{class_id} " + " ".join(norm_poly)
                yolo_lines.append(line)
            else:
                # Bounding box format
                x_min, y_min, bw, bh = [float(v) for v in ann['bbox']]
                nx = (x_min + bw / 2) / float(width)
                ny = (y_min + bh / 2) / float(height)
                nw = bw / float(width)
                nh = bh / float(height)
                
                line = f"{class_id} {nx:.6f} {ny:.6f} {nw:.6f} {nh:.6f}"
                yolo_lines.append(line)
                
        if yolo_lines:
            with open(label_path, 'w') as f:
                f.write("\n".join(yolo_lines) + "\n")
            converted_count += 1

    # Cleanup JSON file to avoid confusion later
    # os.remove(json_path)
    print(f"✅ Converted {converted_count} images to YOLO format.")

if __name__ == "__main__":
    convert_coco_to_yolo()
