from ultralytics import YOLO
import os

model = YOLO("best-train2.pt")

image_dir = "autoano/images"
output_dir = "autoano"

results = model.predict(
    source=image_dir,
    save_txt=True,
    save_conf=False,
    project=output_dir,
    name="",
    exist_ok=True,
    imgsz=640
)