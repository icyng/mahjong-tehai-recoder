from mahjong.hand_calculating.hand import HandCalculator
from mahjong.tile import TilesConverter
from mahjong.hand_calculating.hand_config import HandConfig, OptionalRules
from mahjong.meld import Meld
from mahjong.constants import EAST, SOUTH, WEST, NORTH

from mj.models.tehai.myyolo import MYYOLO
from mj.machi import machi_hai_13
from mj.utils import *

def analyze_hand(
    tiles: list[str], 
    win: str, 
    melds: list, 
    doras: list[str], 
    has_aka: bool = False, 
    **kwargs
):
    """
    手牌の分析を行い、和了・シャン点数や得点を返す
    """
    calculator = HandCalculator()
    
    # 待ち牌
    machi_hai = machi_hai_13(tiles)
    assert type(machi_hai) is list, machi_hai
    
    # 手牌（アガリ牌含）
    hand14 = tiles_to_mahjong_array_strings(tiles, [win], need_aka=True)
    hand14_136 = TilesConverter.string_to_136_array(*hand14, has_aka_dora=has_aka)
    
    # アガリ牌
    winhai = tiles_to_mahjong_array_strings([win], need_aka=True)
    win_136 = TilesConverter.string_to_136_array(*winhai, has_aka_dora=has_aka)[0]
    
    # ドラ(表示牌, 裏ドラ)
    doras_136 = []
    for dora in doras:
        dora = tiles_to_mahjong_array_strings([dora], need_aka=True)
        dora_136 = TilesConverter.string_to_136_array(*dora, has_aka_dora=has_aka)[0]
        doras_136.append(dora_136)
    
    result = calculator.estimate_hand_value(hand14_136, win_136, melds, doras_136, self_config(has_aka=has_aka, **kwargs))
    return hand14, win, result
    
def self_config(has_aka, **kwargs):
    """
    手牌の設定引数を整理して返す
    """
    return HandConfig(
        is_tsumo=kwargs.get('is_tsumo', False),
        is_riichi=kwargs.get('is_riichi', True),
        is_ippatsu=kwargs.get('is_ippatsu', False),
        is_rinshan=kwargs.get('is_rinshan', False),
        is_chankan=kwargs.get('is_chankan', False),
        is_haitei=kwargs.get('is_haitei', False),
        is_houtei=kwargs.get('is_houtei', False),
        is_daburu_riichi=kwargs.get('is_daburu_riichi', False),
        is_nagashi_mangan=kwargs.get('is_nagashi_mangan', False),
        is_tenhou=kwargs.get('is_tenhou', False),
        is_renhou=kwargs.get('is_renhou', False),
        is_chiihou=kwargs.get('is_chiihou', False),
        is_open_riichi=kwargs.get('is_open_riichi', False),
        player_wind=kwargs.get('player_wind', EAST),
        round_wind=kwargs.get('round_wind', EAST),
        kyoutaku_number=kwargs.get('kyoutaku_number', 0),
        tsumi_number=kwargs.get('tsumi_number', 0),
        paarenchan=kwargs.get('paarenchan', 0),
        options=OptionalRules(
            has_open_tanyao=kwargs.get('has_open_tanyao', False),
            has_aka_dora=has_aka,
            has_double_yakuman=kwargs.get('has_double_yakuman', False),
            kazoe_limit=HandConfig.KAZOE_LIMITED,
            kiriage=kwargs.get('kiriage', False),
            fu_for_open_pinfu=kwargs.get('fu_for_open_pinfu', False),
            fu_for_pinfu_tsumo=kwargs.get('fu_for_pinfu_tsumo', False),
            renhou_as_yakuman=kwargs.get('renhou_as_yakuman', False),
            has_daisharin=kwargs.get('has_daisharin', False),
            has_daisharin_other_suits=kwargs.get('has_daisharin_other_suits', False),
            has_sashikomi_yakuman=kwargs.get('has_sashikomi_yakuman', False),
            limit_to_sextuple_yakuman=kwargs.get('limit_to_sextuple_yakuman', False),
            paarenchan_needs_yaku=kwargs.get('paarenchan_needs_yaku', False),
            has_daichisei=kwargs.get('has_daichisei', False),
        )
    )

def print_hand_result(hand, agari, res, is_tsumo):
    '''結果出力'''
    print(f"\n@自家手牌 : {hand}")
    print(f"@アガリ牌 : {agari}")
    print(f"@結果 : {res.han}翻 {res.fu}符 {res.cost['main']} {res.cost['additional']}")
    print(f"@役 : {res.yaku}")
    print(f"@符詳細 : {res.fu_details}")


def main():
    tile_infos, tile_names = MYYOLO(
        model_path='models/tehai/best.pt',
        file_path='models/dataset/data_tempai/agari1.png',
    )
    
    # TODO: 成形部分の完成
    melds = [
        Meld(Meld.KAN, TilesConverter.string_to_136_array(man='2222'), False),
        Meld(Meld.PON, TilesConverter.string_to_136_array(pin='333')),
        Meld(Meld.CHI, TilesConverter.string_to_136_array(sou='567'))
    ]
    
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
        is_rinshan=False,
        is_chankan=False,
        is_haitei=False,
        is_houtei=False,
        is_daburu_riichi=False,
        is_nagashi_mangan=False,
        is_tenhou=False,
        is_renhou=False,
        is_chiihou=False,
        is_open_riichi=False,
        has_open_tanyao=False,
        has_double_yakuman=False,
        kiriage=False,
        fu_for_open_pinfu=False,
        fu_for_pinfu_tsumo=False,
        renhou_as_yakuman=False,
        has_daisharin=False,
        has_daisharin_other_suits=False,
        has_sashikomi_yakuman=False,
        limit_to_sextuple_yakuman=False,
        paarenchan_needs_yaku=False,
        has_daichisei=False,
        kyoutaku_number=0,
        tsumi_number=0,
        paarenchan=0,
    )

    print_hand_result(hand, agari, config, is_tsumo=True)

if __name__ == '__main__':
    main()
