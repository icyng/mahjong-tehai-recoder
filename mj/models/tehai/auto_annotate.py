from ultralytics import YOLO

model = YOLO("best.pt")

image_dir = "autoano/images"
output_dir = "autoano"

results = model.predict(
    source=image_dir,
    save_txt=True,
    save_conf=False,
    project=output_dir,
    name="",
    exist_ok=True,
    iou=0.5,
    imgsz=640,
    device=0
)