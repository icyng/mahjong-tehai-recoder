import os
import random
import shutil
from collections import defaultdict

def split_data(
    image_source_folder: str, 
    label_source_folder: str, 
    o_folders: list, 
    ratios: list, 
    pic_num: int
):
    """
    指定した画像・ラベルフォルダからデータを train/val/test に分割し、対応するフォルダにコピーする関数

    Args:
        image_source_folder (str): 画像ファイルが格納されているソースフォルダのパス（フォーマット文字列）
        label_source_folder (str): ラベルファイルが格納されているソースフォルダのパス（フォーマット文字列）
        o_folders (list): 出力フォルダ名のリスト（例: ["test", "val", "train"]）
        ratios (list): o_folders に対応する各フォルダへの分割比（例: [0.1, 0.1, 0.8]）
        pic_num (int): 処理対象のソースフォルダ番号（例: 1 → "pic1"）、フォーマット文字列にしてるのはそのため
    """

    for folder in o_folders:
        image_out_dir = f'../dataset/mj/images/{folder}'
        label_out_dir = f'../dataset/mj/labels/{folder}'
        os.makedirs(image_out_dir, exist_ok=True)
        os.makedirs(label_out_dir, exist_ok=True)

    image_files = sorted(os.listdir(image_source_folder.format(pic_num)))
    label_files = sorted(os.listdir(label_source_folder.format(pic_num)))

    random.seed(42)
    all_files = list(zip(image_files, label_files))
    random.shuffle(all_files)
    image_files, label_files = zip(*all_files)

    total = len(image_files)
    group_sizes = [int(total * ratio) for ratio in ratios]
    groups = defaultdict(list)
    start = 0
    for i, size in enumerate(group_sizes):
        groups[i] = (image_files[start:start + size], label_files[start:start + size])
        start += size

    for group_index, (images, labels) in groups.items():
        for image, label in zip(images, labels):
            image_source_path = os.path.join(image_source_folder.format(pic_num), image)
            label_source_path = os.path.join(label_source_folder.format(pic_num), label)

            image_target_path = os.path.join(
                f'../dataset/mj/images/{o_folders[group_index]}', f'{pic_num}{image}'
            )
            label_target_path = os.path.join(
                f'../dataset/mj/labels/{o_folders[group_index]}', f'{pic_num}{label}'
            )

            shutil.copy(image_source_path, image_target_path)
            shutil.copy(label_source_path, label_target_path)

# ========== 設定 ==========
images = "../dataset/org/pic{}/images"
labels = "../dataset/org/pic{}/labels"
o_folders = ["test", "val", "train"]
# 分割比率（例: test:val:train = 1:1:8）
ratios = [1/10, 1/10, 8/10]
pic_nums = 11
for i in range(pic_nums):
    split_data(images, labels, o_folders, ratios, i + 1)
