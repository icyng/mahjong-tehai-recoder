# mj/models/tehai/train.py
# This script is used to fine‑tune a YOLO model for Mahjong tile detection.

from ultralytics import YOLO
import os

# os.environ['KMP_DUPLICATE_LIB_OK']='TRUE'

version = 'yolov12m.pt'
model = YOLO(version)

results = model.train(
    data='../dataset/coco128.yml', 
    epochs=300,
    batch=32,
    device=[0,1]
)

results = model.val()
