from ultralytics import YOLO

<<<<<<< HEAD
# 字牌と赤牌を2文字表記に揃える置換ルール
replace = {
    '5mr': '0m',
    '5pr': '0p',
    '5sr': '0s',
    'hak': 'hk',
    'hat': 'ht',
    'nan': 'na',
    'pei': 'pe',
    'sha': 'sh',
    'ton': 'to',
    'tyn': 'ty',
}

def MYYOLO(
    model_path: str, 
    file_path: str,
    conf: float = 0.4,
    iou: float = 0.4
=======
def MYYOLO(
    model_path: str, 
    image_path: str,
    conf: float = 0.5,
    iou: float = 0.5
>>>>>>> 3a0fbafee8d93edba41c2cad6f5b27816fde0ec7
):
    """指定されたモデルを使用して指定画像内の牌を検出し、結果を整形して返す

    Args:
        model_path (str): モデルのパス
<<<<<<< HEAD
        file_path (str): ファイルのパス
=======
        image_path (str): ファイルのパス
>>>>>>> 3a0fbafee8d93edba41c2cad6f5b27816fde0ec7
        conf (float, optional): 検出の信頼度閾値
        iou (float, optional): IoUの閾値
    Returns:
        tuple:
            - list[dict]: 検出された牌の情報を含む辞書
            - list[str]: 検出された牌の名前のリスト
    """
    
    model = YOLO(model_path)
<<<<<<< HEAD
    result = model(file_path, conf=conf, iou=iou)[0]
    cls_names = {k: replace.get(v, v) for k, v in model.names.items()}
=======
    result = model.predict(
        source=image_path,
        conf=conf,
        iou=iou,
        save=False
    )[0]
    result.show(font_size=3, line_width=2)
    cls_names = model.names
>>>>>>> 3a0fbafee8d93edba41c2cad6f5b27816fde0ec7
    
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
<<<<<<< HEAD
=======

>>>>>>> 3a0fbafee8d93edba41c2cad6f5b27816fde0ec7
    return tile_infos, tile_names