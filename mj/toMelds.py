from mahjong.tile import TilesConverter
from mahjong.meld import Meld

honor_map = {'to': '1', 'na': '2', 'sh': '3', 'pe': '4', 'hk': '5', 'ht': '6', 'ty': '7'}

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

def tiles_to_string(tiles):
    man, pin, sou, honors = [], [], [], []
    for tile in tiles:
        t = replace.get(tile['tile'], tile['tile'])
        num = '5' if '0' in t else t[0]
        if t[-1] == 'm': man.append(num)
        elif t[-1] == 'p': pin.append(num)
        elif t[-1] == 's': sou.append(num)
        else: honors.append(honor_map.get(t, t))
    return ''.join(man), ''.join(pin), ''.join(sou), ''.join(honors)

def convert_to_melds(actions: list[dict]) -> list[Meld]:
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