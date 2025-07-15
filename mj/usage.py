import os
from dotenv import load_dotenv
from mahjong.constants import EAST, SOUTH, WEST, NORTH
from mj.models.tehai.myyolo import MYYOLO
from mj.utils import print_hand_result
from mj.calcHand import analyze_hand
from mj.toMelds import convert_to_melds


def main():
    
    load_dotenv()
    
    # --- 手牌解析の計算 ---
    
    tile_infos, tile_names = MYYOLO(
        model_path=os.environ['MODEL_PATH'],
        image_path=os.environ['IMAGE_PATH'],
    )
    
    for result in tile_infos:
        print(f"Class: {result['class']}, Confidence: {result['conf']:.3f}")
    
    hand, agari, config = analyze_hand(
        tiles=tile_names,
        win='5p',
        has_aka=False,
        melds=[],
        doras=['to','8m'],
        is_riichi=True,
        is_ippatsu=False,
        is_tsumo=True,
        player_wind=WEST,
        round_wind=EAST,
    )

    print_hand_result(hand, agari, config, is_tsumo=True)
    
    # --- 鳴き変換器（toMelds）の確認 ---
    
    tile_names = ['1m','2m','2m','2m','2m','5m','5m','0m','5m','1p','2p','3p','ht','ht','ht']
    
    input_actions = [
        {'target_tiles': [{'tile': '5mr', 'fromOther': False}], 'action_type': "kan"},
        {'target_tiles': [{'tile': '2m', 'fromOther': False}, {'tile': '2m', 'fromOther': False}, {'tile': '2m', 'fromOther': False}, {'tile': '2m', 'fromOther': False}], 'action_type': "kan"},
        {'target_tiles': [{'tile': '5m', 'fromOther': True}, {'tile': '5m', 'fromOther': False}, {'tile': '5m', 'fromOther': False}], 'action_type': "pon"},
        {'target_tiles': [{'tile': '1p', 'fromOther': True}, {'tile': '2p', 'fromOther': False}, {'tile': '3p', 'fromOther': False}], 'action_type': "chi"},
        {'target_tiles': [{'tile': 'hat', 'fromOther': True}, {'tile': 'hat', 'fromOther': False}, {'tile': 'hat', 'fromOther': False}], 'action_type': "pon"},
    ]
    
    melds = convert_to_melds(input_actions)
    
    hand_136, win_136, result = analyze_hand(
        tiles=tile_names,
        win='1m',
        melds=melds,
        doras=['1p'],
        has_aka=True,
        is_tsumo=True,
        is_riichi=False,
        is_ippatsu=False,
        player_wind=NORTH,
        round_wind=SOUTH,
    )
    
    print_hand_result(hand_136, win_136, result, is_tsumo=True)

if __name__ == '__main__':
    main()