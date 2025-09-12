from ultralytics import YOLO

def MYYOLO(
    model_path: str, 
    image_path: str,
    conf: float = 0.5,
    iou: float = 0.5,
    show: bool = False
):
    """指定されたモデルを使用して指定画像内の牌を検出し、結果を整形して返す

    Args:
        model_path (str): モデルのパス
        image_path (str): ファイルのパス
        conf (float, optional): 検出の信頼度閾値
        iou (float, optional): IoUの閾値
    Returns:
        tuple:
            - list[dict]: 検出された牌の情報を含む辞書
            - list[str]: 検出された牌の名前のリスト
    """
    
    model = YOLO(model_path)
    result = model.predict(
        source=image_path,
        conf=conf,
        iou=iou,
        save=False
    )[0]
    if show: result.show(font_size=3, line_width=2)
    cls_names = model.names
    
    boxes = result.boxes
    tile_infos = []
    
    for box in boxes:
        cls_name = cls_names[int(box.cls[0])]
        conf = box.conf[0]
        ltop = box.xyxy[0][0]
        tile_infos.append({
            'point':ltop,
            'conf':conf,
            'class':cls_name
        })
    
    tile_infos.sort(key=lambda x:x['point'])
    tile_names = [h['class'] for h in tile_infos]
    return tile_infos, tile_names