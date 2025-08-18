"""
RoboflowからYOLO形式へのラベル変換スクリプト
"""

import os

# Roboflow names
roboflow_names = [
    '0- 1m', '1- 1p', '10- 4p', '11- 4s', '12- 5m', '13- 0m', '14- 5p', '15- 0p',
    '16- 5s', '17- 0s', '18- 6m', '19- 6p', '2- 1s', '20- 6s', '21- 7m', '22- 7p',
    '23- 7s', '24- 8m', '25- 8p', '26- 8s', '27- 9m', '28- 9p', '29- 9s',
    '3- 2m', '30- hk', '31- ht', '32- na', '33- pe', '34- sh', '35- to', '36- ty',
    '4- 2p', '5- 2s', '6- 3m', '7- 3p', '8- 3s', '9- 4m'
]

# cc128.yml names
yolo_names = [
    '1m', '1p', '1s', '2m', '2p', '2s', '3m', '3p', '3s', '4m',
    '4p', '4s', '5m', '0m', '5p', '0p', '5s', '0s', '6m', '6p',
    '6s', '7m', '7p', '7s', '8m', '8p', '8s', '9m', '9p', '9s',
    'hk', 'ht', 'na', 'pe', 'sh', 'to', 'ty'
]

# Roboflow index -> label
rf_idx_to_label = {i: name.split('- ')[1] for i, name in enumerate(roboflow_names)}
# label -> yolo index
label_to_yolo_idx = {label: i for i, label in enumerate(yolo_names)}
# Roboflow index -> yolo index
conversion_map = {rf_idx: label_to_yolo_idx[label] for rf_idx, label in rf_idx_to_label.items()}

# フォルダ内の全.txtファイルに対して変換を行う
def convert_all_txt_files(folder_path):
    for filename in os.listdir(folder_path):
        if filename.endswith('.txt'):
            file_path = os.path.join(folder_path, filename)

            with open(file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()

            new_lines = []
            for line in lines:
                parts = line.strip().split()
                if not parts:
                    continue
                try:
                    old_idx = int(parts[0])
                    new_idx = conversion_map.get(old_idx, old_idx)
                    parts[0] = str(new_idx)
                    new_lines.append(' '.join(parts))
                except ValueError:
                    new_lines.append(line.strip())
                    
            with open(file_path, 'w', encoding='utf-8') as f:
                for line in new_lines:
                    f.write(line + '\n')

    print(f"✅ 変換完了: {folder_path} 内のすべての .txt ファイルに適用しました。")

# usage
folder = 'pic12/labels'
convert_all_txt_files(folder)
