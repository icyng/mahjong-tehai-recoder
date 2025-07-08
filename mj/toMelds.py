from mahjong.hand_calculating.hand import HandCalculator
from mahjong.tile import TilesConverter
from mahjong.hand_calculating.hand_config import HandConfig, OptionalRules
from mahjong.meld import Meld
from mahjong.constants import EAST, SOUTH, WEST, NORTH

# 手牌には副露牌も含める
# 手牌には0を含めても良いが、鳴きやドラなどそれ以外の牌は0を含めないでほしい

"""テスト用
melds = [
    Meld(Meld.PON, TilesConverter.string_to_136_array(man='555')),
    Meld(Meld.CHANKAN, TilesConverter.string_to_136_array(man='2222'), opened=True),
]
"""


calculator = HandCalculator()

def print_hand_result(hand_result):
    print('----------------')
    print(hand_result.han, hand_result.fu)
    print(hand_result.cost['main'], hand_result.cost['additional'])
    print(hand_result.yaku)
    for fu_item in hand_result.fu_details: 
        print(fu_item)
    print('')

honor_map = {'ton': '1', 'nan': '2', 'sha': '3', 'pei': '4', 'hak': '5', 'hat': '6', 'tyn': '7'}

def tiles_to_string(tiles):
    man, pin, sou, honors = [], [], [], []

    for tile in tiles:
        t = tile['tile']
        is_red = 'r' in t
        t = t.replace('r', '')
        num = '5' if is_red else t[0]

        if t[-1] == 'm': man.append(num)
        elif t[-1] == 'p': pin.append(num)
        elif t[-1] == 's': sou.append(num)
        else: honors.append(honor_map.get(t, t))

    return ''.join(man), ''.join(pin), ''.join(sou), ''.join(honors)

def convert_to_melds(actions):
    new_actions = []
    reminders = []
    
    for action in actions:
        target_tiles = action['target_tiles']
        if len(target_tiles) != 1: new_actions.append(action)
        else: reminders.append(target_tiles[0]['tile'])
    
    new2_actions = []
    processed_tiles = set()

    for action in new_actions:
        action_type = action['action_type']
        target_tiles = action['target_tiles']

        if action_type == 'pon':
            tile_base = target_tiles[0]['tile'][:2]
            for reminder in reminders:
                reminder_base = reminder[:2]
                if reminder_base == tile_base and reminder not in processed_tiles:
                    target_tiles.insert(2, {'tile': reminder, 'fromOther': False})
                    action_type = 'chkan'
                    processed_tiles.add(reminder)
                    break
        new2_actions.append({'target_tiles': target_tiles, 'action_type': action_type})
    
    melds = []

    for action in new2_actions:
        action_type = action['action_type']
        target_tiles = action['target_tiles']
        from_other = any(tile['fromOther'] for tile in target_tiles)

        man, pin, sou, honors = tiles_to_string(target_tiles)

        if action_type == 'chi':
            melds.append(Meld(Meld.CHI, TilesConverter.string_to_136_array(man=man, pin=pin, sou=sou, honors=honors)))
        elif action_type == 'pon':
            melds.append(Meld(Meld.PON, TilesConverter.string_to_136_array(man=man, pin=pin, sou=sou, honors=honors)))
        elif action_type == 'kan':
            if from_other:
                melds.append(Meld(Meld.KAN, TilesConverter.string_to_136_array(man=man, pin=pin, sou=sou, honors=honors), opened=True))
            else:
                melds.append(Meld(Meld.KAN, TilesConverter.string_to_136_array(man=man, pin=pin, sou=sou, honors=honors), opened=False))
        elif action_type == 'chkan':
            melds.append(Meld(Meld.CHANKAN, TilesConverter.string_to_136_array(man=man, pin=pin, sou=sou, honors=honors)))

    return melds

# Example usage

input_actions = [
    {'target_tiles': [{'tile': '5mr', 'fromOther': False}], 'action_type': "kan"},
    {'target_tiles': [{'tile': '2m', 'fromOther': False}, {'tile': '2m', 'fromOther': False}, {'tile': '2m', 'fromOther': False}, {'tile': '2m', 'fromOther': False}], 'action_type': "kan"},
    {'target_tiles': [{'tile': '5m', 'fromOther': True}, {'tile': '5m', 'fromOther': False}, {'tile': '5m', 'fromOther': False}], 'action_type': "pon"},
    {'target_tiles': [{'tile': '1p', 'fromOther': True}, {'tile': '2p', 'fromOther': False}, {'tile': '3p', 'fromOther': False}], 'action_type': "chi"},
    {'target_tiles': [{'tile': 'hat', 'fromOther': True}, {'tile': 'hat', 'fromOther': False}, {'tile': 'hat', 'fromOther': False}], 'action_type': "pon"},
]

# 手牌（カンの場合も全て含める、赤は含められる）
tiles = TilesConverter.string_to_136_array(man='1122225505', pin='123', honors='666', has_aka_dora=True)
# 上がり牌（赤は含められる）
win_tile = TilesConverter.string_to_136_array(man='1', has_aka_dora=False)[0]
# input_actions を melds型の配列に変換
melds = convert_to_melds(input_actions)
# ドラ（赤は含められる）
dora_indicators = [TilesConverter.string_to_136_array(pin='1', has_aka_dora=False)[0]]
# オプション等の設定
config = HandConfig(is_tsumo=True,is_rinshan=False, options=OptionalRules(has_open_tanyao=True, has_aka_dora=True))
# 評価
result = calculator.estimate_hand_value(tiles, win_tile,melds,dora_indicators, config)
# 点数等の表示
print_hand_result(result)