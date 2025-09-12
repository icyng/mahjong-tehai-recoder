from typing import List, Dict, Any

def generate_naki_choices(action_type: str, tiles: List[str], target_tile: str, from_who: str = "left") -> List[Dict[str, Any]]:
    """
    指定された鳴き（ポン・チー・カン(暗、明、加)）が可能であるという仮定のもと、鳴き後の手牌と副露情報を返す

    :param action_type: "pon", "chi", "kan" のいずれか
    :param tiles: 現在の手牌
    :param target_tile: 鳴きを試みる牌（つまり拾ってくる牌）
    :param from_who: "pon" および "kan" の場合に必要な、鳴きの発生元（"left", "opposite", "right", "me" のいずれか）

    :return: 鳴き候補のリスト（鳴けない場合は空リスト）
    """
    candidates = []
    # 白と発の表記揺れを修正
    tiles = [tile.replace("hak","hk").replace("hat","ht") for tile in tiles]
    target_tile = target_tile.replace("hak","hk").replace("hat","ht")

    # ポン
    if action_type == "pon":
        # 倒す牌を決めるためのフラグ
        muki = ["left", "opposite", "right"]
        pon_eval = 0

        for tile in tiles:
            if target_tile[:2] == tile[:2]:
                pon_eval += 1
        
        if pon_eval >= 2:
            remaining_tiles = tiles[:]
            removed_count = 0

            # 2枚だけ削除
            new_tiles = []
            furo = []
            for tile in remaining_tiles:
                if tile[:2] == target_tile[:2] and removed_count < 2:
                    furo.append(tile)
                    removed_count += 1
                else:
                    new_tiles.append(tile)
            
            # 副露牌セット
            for i in range(3):
                if muki[i] == from_who:
                    furo.insert(i,target_tile)

            # フラグをもとに倒す牌を決定
            candidates.append({
                "target_tiles": [{"tile": f, "fromOther": who == from_who} for f,who in zip(furo,muki)],
                "tiles": new_tiles
            })
    
    # チー
    elif action_type == "chi":
        # 字牌はチーできない
        if target_tile in ["ton","nan","sha","pei","hk","ht","tyn"]:
            return candidates
        num_list_1 = [int(target_tile[0]) - i for i in range(2,0,-1)]
        num_list_2 = [int(target_tile[0]) + i for i in range(1,3, 1)]
        num_list = num_list_1 + num_list_2

        # 赤を含めた連番を全て作成
        possible_sets = []
        for i in range(3):
            possible_sets.append([str(num_list[i]) + target_tile[1], str(num_list[i+1]) + target_tile[1]])
            if num_list[i] == 5: 
                possible_sets.append([str(num_list[i]) + target_tile[1] + 'r', str(num_list[i+1]) + target_tile[1]])
            elif num_list[i+1] == 5: 
                possible_sets.append([str(num_list[i]) + target_tile[1], str(num_list[i+1]) + target_tile[1] + 'r'])
        
        for chi_set in possible_sets:
            # 手牌にあるものだけを抽出
            ava_tiles = [tile for tile in chi_set if tile in tiles]
            
            if len(ava_tiles) >= 2:
                remaining_tiles = tiles[:]
                
                # 2枚だけ削除
                for tile in ava_tiles:
                    remaining_tiles.remove(tile)
                
                # target_tiles を数値順にソートし、鳴いた牌を左端に固定
                target_tiles = \
                    [{"tile": target_tile, "fromOther": True}] + \
                    [{"tile": tile, "fromOther": False} for tile in sorted(ava_tiles, key=lambda x: (x[1], int(x[0])))]
                
                candidates.append({
                    "target_tiles": target_tiles,
                    "tiles": remaining_tiles
                })
    
    # カン
    elif action_type == "kan":
        kan_eval = 0

        for tile in tiles:
            if target_tile[:2] == tile[:2]:
                kan_eval += 1
        # 自分でツモった場合（暗槓 or 加槓）
        if from_who == "me":
            # 暗槓（手牌内に3枚,target_tileが1枚の計4枚が揃っている場合）
            # target_tileには必ずカンする対象の牌を1つ加えてもらうようにする
            # ツモった場合はそれでいいが、4枚を既に抱えている場合はtarget_tileを対象の牌と入れ替えて欲しい
            if kan_eval == 3:
                remaining_tiles = tiles[:]
                removed_count = 0

                # 手牌から3枚削除
                new_tiles = []
                furo = [target_tile]
                for tile in remaining_tiles:
                    if tile[:2] == target_tile[:2] and removed_count < 3:
                        furo.append(tile)
                        removed_count += 1
                    else:
                        new_tiles.append(tile)

                candidates.append({
                    "target_tiles": [{"tile": f, "fromOther": False} for f in furo],
                    "tiles": new_tiles
                })
            # 加槓（すでにポンしている場合）
            else:
                candidates.append({
                    "target_tiles": [{"tile": target_tile, "fromOther": False}],
                    "tiles": tiles
                })

        # 他家から拾った場合（大明槓）
        else:
            # 倒す牌を決めるためのフラグ
            muki = ["left", "opposite", "not use", "right"]

            if kan_eval == 3:
                remaining_tiles = tiles[:]
                removed_count = 0

                # 手牌から3枚削除
                new_tiles = []
                furo = []
                for tile in remaining_tiles:
                    if tile[:2] == target_tile[:2] and removed_count < 3:
                        furo.append(tile)
                        removed_count += 1
                    else:
                        new_tiles.append(tile)
                
                # 副露牌セット
                for i in range(4):
                    if muki[i] == from_who:
                        furo.insert(i,target_tile)

                # フラグをもとに倒す牌を決定
                candidates.append({
                    "target_tiles": [{"tile": f, "fromOther": who == from_who} for f,who in zip(furo,muki)],
                    "tiles": new_tiles
                })
    
    # 表記を元に戻す
    for candidate in candidates:
        for target_tile in candidate["target_tiles"]:
            target_tile["tile"] = target_tile["tile"].replace("hk","hak").replace("ht","hat")
        candidate["tiles"] = [tile.replace("hk","hak").replace("ht","hat") for tile in candidate["tiles"]]
    
    return candidates

# 動作確認 (pon)
g = generate_naki_choices(
    action_type="pon",
    tiles=['1m', '1m', '1m', '2m', '4m', '5m', '5m', '5mr', '8m', '8m', 'hak', 'hak', 'hat'],
    target_tile='hak',
    from_who="right"
)
print("pon ",g,end='\n\n')

# 動作確認 (chi)
g = generate_naki_choices(
    action_type="chi",
    tiles=['2m', '3m', '5mr', '8m', '8m', '8m', '9m', '9m', '1p', '1p', '2p', '2p', '3p'],
    target_tile='4m'
)
print("chi ",g,end='\n\n')

# 動作確認 (暗カン)
g = generate_naki_choices(
    action_type="kan",
    tiles=['5mr', '5m', '5m', '7m', '7m', '8m', '9m', '9m', '9m', '1p', '1p', '2p', '2p'],
    target_tile='5m',
    from_who="me"
)
print("an-kan ",g,end='\n\n')

# 動作確認 (明カン)
g = generate_naki_choices(
    action_type="kan",
    tiles=['5m', '5m', '5m', '7m', '7m', '8m', '9m', '9m', '9m', '1p', '1p', '2p', '2p'],
    target_tile='5mr',
    from_who="opposite"
)
print("min-kan ",g,end='\n\n')

# 動作確認 (加カン)
g = generate_naki_choices(
    action_type="kan",
    tiles=['7m', '7m', '8m', '9m', '9m', '9m', '1p', '1p', '2p', '2p'],
    target_tile='5m',
    from_who="me"
)
print("ka-kan ",g,end='\n\n')