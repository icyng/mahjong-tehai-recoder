from mahjong.tile import TilesConverter
from mahjong.meld import Meld
from mahjong_runtime.utils import tiles_to_mahjong_array_strings, RED_TILES
from typing import List, TypedDict, Literal

class TileInfo(TypedDict):
    tile: str
    fromOther: bool

class ActionDict(TypedDict):
    target_tiles: List[TileInfo]
    action_type: Literal["chi", "pon", "kan", "chkan"]

def tile_infos_to_string(tiles):
    tiles = [tile['tile'] for tile in tiles]
    return tiles_to_mahjong_array_strings(tiles, need_aka=False)

def convert_to_melds(actions: List[ActionDict]) -> List[Meld]:
    reminders = {a['target_tiles'][0]['tile'] for a in actions if len(a['target_tiles']) == 1}

    melds = []
    meld_type_map = {
        'chi': Meld.CHI,
        'pon': Meld.PON,
        'kan': Meld.KAN,
        'chkan': Meld.CHANKAN
    }

    for act in (a for a in actions if len(a['target_tiles']) > 1):
        tiles = act['target_tiles']

        # 加槓への昇格判定（pon → chkan）
        if act['action_type'] == 'pon':
            base = tiles[0]['tile']
            red_match = {r for r in reminders if '5' in base and r in RED_TILES}
            exact_match = {r for r in reminders if r == base}
            candidates = (red_match | exact_match) - {t['tile'] for t in tiles}
            if candidates:
                tiles.insert(2, {'tile': candidates.pop(), 'fromOther': False})
                act['action_type'] = 'chkan'

        sou, pin, man, honors = tile_infos_to_string(tiles)
        path = TilesConverter.string_to_136_array(
            man=man, pin=pin, sou=sou, honors=honors
        )

        opened = any(t.get('fromOther') for t in tiles)
        meld_const = meld_type_map[act['action_type']]
        kwargs = {'opened': opened} if act['action_type'] == 'kan' else {}
        melds.append(Meld(meld_const, path, **kwargs))

    return melds
