# models/utils.py

# {牌:数字}に対応する辞書 - 2chars対応済み
SZ_TO_NUM = {'1s':1,'2s':2,'3s':3,'4s':4,'5s':5,'0s':0,'6s':6,'7s':7,'8s':8,'9s':9}
MZ_TO_NUM = {'1m':1,'2m':2,'3m':3,'4m':4,'5m':5,'0m':0,'6m':6,'7m':7,'8m':8,'9m':9}
PZ_TO_NUM = {'1p':1,'2p':2,'3p':3,'4p':4,'5p':5,'0p':0,'6p':6,'7p':7,'8p':8,'9p':9}
HZ_TO_NUM = {'to':1,'na':2,'sh':3,'pe':4,'hk':5,'ht':6,'ty':7}

# それぞれ全牌、赤牌、赤牌なし、の辞書
ALL_TILES = SZ_TO_NUM | PZ_TO_NUM | MZ_TO_NUM | HZ_TO_NUM
RED_TILES = {'0m', '0p', '0s'}
ALL_TILES_NO_RED_TILES = {k: v for k, v in ALL_TILES.items() if k not in RED_TILES}

def tiles_to_mahjong_array_strings(
    clsnames: list[str], 
    extra: list[str] = [],
    need_aka: bool = False
    ):
    '''
    TileConverter の型に沿うように成形して返す
    
    :param clsnames: list[str], 牌の名前のみリスト
    :param extra: list[str], 追加したい牌の名前のみリスト（あれば）
    :param need_aka: bool, 赤牌を含ませたいか否か（デフォルトはFalse）
    
    :return: list[str], 34枚の牌を牌種で分別した文字列のリスト
    '''
    
    man,pin,sou,honor = '','','',''
    for hai in clsnames+extra:
        if hai in SZ_TO_NUM: 
            sou += str(SZ_TO_NUM[hai])
        elif hai in MZ_TO_NUM: 
            man += str(MZ_TO_NUM[hai])
        elif hai in PZ_TO_NUM: 
            pin += str(PZ_TO_NUM[hai])
        elif hai in HZ_TO_NUM: 
            honor += str(HZ_TO_NUM[hai])
    
    # TilesConverter.string_to_34_array expects [man, pin, sou, honors]
    hand = [man,pin,sou,honor]
    if not need_aka: 
        return [h.replace('0','5') for h in hand]
    return hand

def print_hand_result(hand, agari, res, is_tsumo):
    '''
    結果出力
    
    :param hand: list[str], 自家手牌
    :param agari: str, アガリ牌
    :param res: HandResult, 手牌の解析結果
    :param is_tsumo: bool, ツモかロン
    '''
    print(f"\n@自家手牌 : {hand}")
    print(f"@アガリ牌 : {agari}")
    if not res.cost or not res.fu_details:
        print(f"@result : {res}")
        return
    if is_tsumo:
        print(f"@ツモ : {res.han}翻 {res.fu}符 {res.cost['additional']} {res.cost['main']}")
    else:
        print(f"@ロン : {res.han}翻 {res.fu}符 {res.cost['main']} {res.cost['additional']}")
    print(f"@役 : {res.yaku}")
    print("@符詳細 : ")
    for fu_item in res.fu_details: 
        print(fu_item)
