# mj/models/tehai/train.py
# This script is used to fine‑tune a YOLO model for Mahjong tile detection.

from ultralytics import YOLO

def main():
    version = 'yolov12m.pt'
    model = YOLO(version)
    results = model.train(
        data='../dataset/coco128.yml',
        epochs=500,
        batch=16,
        device='0'
    )
    metrics = model.val()
    print(metrics.box.map)
    print(metrics.box.map50)
    print(metrics.box.map75)
    print(metrics.box.maps)

if __name__ == '__main__':
    from multiprocessing import freeze_support
    freeze_support()  # Windows 環境のために必要
    main()
