from typing import List
from mahjong.shanten import Shanten
from mahjong.tile import TilesConverter
from mj.utils import (
    tiles_to_mahjong_array_strings,
    ALL_TILES_NO_RED_TILES
)

def machi_hai_13(hand: list[str]) -> List[str] | str:
    '''
    13枚の場合待ち牌候補を返す
    
    :param hand: list[str], 牌の名前のリスト
    
    :return: list[str] or str, 待ち牌候補の牌の名前のリスト、または和了や向聴数
    
    - 和了     → '和了'
    - 向聴数 n → 'n向聴'
    - 聴牌     → ['1m', '4p', ...]（待ち牌リスト）
    '''
    
    waits = []
    if len(hand) == 13:
        shanten_engine = Shanten()
        config = tiles_to_mahjong_array_strings(hand, need_aka=False)
        base34 = TilesConverter.string_to_34_array(*config)
        current = shanten_engine.calculate_shanten(base34)
        
        if current < 0: 
            return '和了'
        elif current > 0: 
            return f'{current}向聴'
        
        waits: list[str] = []
        for idx, tile in enumerate(ALL_TILES_NO_RED_TILES):
            if base34[idx] > 3:
                continue
            test34 = base34.copy()
            test34[idx] += 1
            if shanten_engine.calculate_shanten(test34) < 0:
                waits.append(tile)
    return waits