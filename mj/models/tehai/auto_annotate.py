from ultralytics import YOLO

model = YOLO("best.pt")

images_dir = "../dataset/autoano/images"
output_dir = "../dataset/autoano"

results = model.predict(
    source=images_dir,
    save_txt=True,
    save_conf=False,
    project=output_dir,
    name="",
    exist_ok=True,
    iou=0.5,
    imgsz=640,
    device=0
)