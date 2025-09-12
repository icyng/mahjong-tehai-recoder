# mj/models/tehai/train-mps.py

from ultralytics import YOLO
from multiprocessing import freeze_support

DATA_YAML = "dataset/coco128.yml"
WEIGHTS = "yolov12m.pt"
PROJECT = "runs_mj"
RUN_NAME = "yolov12m_tehai_mps"

def main():
    model = YOLO(WEIGHTS)
    model.train(
        data=DATA_YAML,
        device="mps",
        batch=16,
        epochs=200,
        patience=30,
        optimizer="AdamW",
        lr0=3e-3,
        lrf=0.2,
        cos_lr=True,
        warmup_epochs=3,
        momentum=0.9,
        weight_decay=5e-4,
        workers=4,
        cache="ram",
        mosaic=0.0,
        mixup=0.0,
        copy_paste=0.0,
        hsv_h=0.0, hsv_s=0.0, hsv_v=0.0,
        degrees=0.0, translate=0.04, scale=0.4, shear=0.0,
        fliplr=0.0, flipud=0.0,
        erasing=0.0,
        close_mosaic=15,
        amp=True,
        seed=42,
        conf=0.001,
        iou=0.7,
        agnostic_nms=False,
        max_det=300,
        project=PROJECT,
        name=RUN_NAME,
        save_period=0,
        verbose=False,
        exist_ok=True,
    )
    model.val(
        data=DATA_YAML,
        device="mps",
        conf=0.001,
        iou=0.7,
        max_det=300,
        save_json=False,
        verbose=False,
    )

if __name__ == "__main__":
    freeze_support()
    main()
