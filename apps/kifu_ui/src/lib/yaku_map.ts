export type YakuEntry = {
  name: string;
  hanMenzen?: number | null;
  hanNaki?: number | null;
  yakuman?: boolean;
};

export type YakuMapEntry = {
  match: RegExp | string;
  entry: YakuEntry;
};

export const YAKU_BASE_MAP: YakuMapEntry[] = [
  { match: /^riichi$/i, entry: { name: "立直", hanMenzen: 1, hanNaki: null } },
  { match: /^daburu ?riichi$/i, entry: { name: "両立直", hanMenzen: 2, hanNaki: null } },
  { match: /^double ?riichi$/i, entry: { name: "両立直", hanMenzen: 2, hanNaki: null } },
  { match: /^open ?riichi$/i, entry: { name: "開立直", hanMenzen: 2, hanNaki: null } },
  { match: /^daburu ?open ?riichi$/i, entry: { name: "両開立直", hanMenzen: 2, hanNaki: null } },
  { match: /^ippatsu$/i, entry: { name: "一発", hanMenzen: 1, hanNaki: null } },
  { match: /^tsumo$/i, entry: { name: "門前清自摸和", hanMenzen: 1, hanNaki: null } },
  { match: /^menzen ?tsumo$/i, entry: { name: "門前清自摸和", hanMenzen: 1, hanNaki: null } },
  { match: /^pinfu$/i, entry: { name: "平和", hanMenzen: 1, hanNaki: null } },
  { match: /^iipeiko$/i, entry: { name: "一盃口", hanMenzen: 1, hanNaki: null } },
  { match: /^ryanpeikou$/i, entry: { name: "二盃口", hanMenzen: 3, hanNaki: null } },
  { match: /^chiitoitsu$/i, entry: { name: "七対子", hanMenzen: 2, hanNaki: null } },
  { match: /^tanyao$/i, entry: { name: "断幺九", hanMenzen: 1, hanNaki: 1 } },
  { match: /^haku$/i, entry: { name: "役牌 白", hanMenzen: 1, hanNaki: 1 } },
  { match: /^hatsu$/i, entry: { name: "役牌 發", hanMenzen: 1, hanNaki: 1 } },
  { match: /^chun$/i, entry: { name: "役牌 中", hanMenzen: 1, hanNaki: 1 } },
  { match: /^haitei/i, entry: { name: "海底摸月", hanMenzen: 1, hanNaki: 1 } },
  { match: /^houtei/i, entry: { name: "河底撈魚", hanMenzen: 1, hanNaki: 1 } },
  { match: /^rinshan/i, entry: { name: "嶺上開花", hanMenzen: 1, hanNaki: 1 } },
  { match: /^chankan/i, entry: { name: "槍槓", hanMenzen: 1, hanNaki: 1 } },
  { match: /^toitoi$/i, entry: { name: "対々和", hanMenzen: 2, hanNaki: 2 } },
  { match: /^san ?ankou$/i, entry: { name: "三暗刻", hanMenzen: 2, hanNaki: 2 } },
  { match: /^sanshoku ?doujun$/i, entry: { name: "三色同順", hanMenzen: 2, hanNaki: 1 } },
  { match: /^sanshoku ?doukou$/i, entry: { name: "三色同刻", hanMenzen: 2, hanNaki: 2 } },
  { match: /^sanshoku$/i, entry: { name: "三色同順", hanMenzen: 2, hanNaki: 1 } },
  { match: /^ittsu$/i, entry: { name: "一気通貫", hanMenzen: 2, hanNaki: 1 } },
  { match: /^chantai$/i, entry: { name: "混全帯幺九", hanMenzen: 2, hanNaki: 1 } },
  { match: /^chanta$/i, entry: { name: "混全帯幺九", hanMenzen: 2, hanNaki: 1 } },
  { match: /^junchan$/i, entry: { name: "純全帯幺九", hanMenzen: 3, hanNaki: 2 } },
  { match: /^sankantsu$/i, entry: { name: "三槓子", hanMenzen: 2, hanNaki: 2 } },
  { match: /^shosangen$/i, entry: { name: "小三元", hanMenzen: 2, hanNaki: 2 } },
  { match: /^shousangen$/i, entry: { name: "小三元", hanMenzen: 2, hanNaki: 2 } },
  { match: /^honroutou$/i, entry: { name: "混老頭", hanMenzen: 2, hanNaki: 2 } },
  { match: /^honroto$/i, entry: { name: "混老頭", hanMenzen: 2, hanNaki: 2 } },
  { match: /^honitsu$/i, entry: { name: "混一色", hanMenzen: 3, hanNaki: 2 } },
  { match: /^chinitsu$/i, entry: { name: "清一色", hanMenzen: 6, hanNaki: 5 } },
  { match: /^nagashi ?mangan$/i, entry: { name: "流し満貫", hanMenzen: 5, hanNaki: 5 } },
  { match: /^kokushi ?musou ?13$/i, entry: { name: "国士無双１３面", yakuman: true } },
  { match: /^daburu ?kokushi/i, entry: { name: "国士無双１３面", yakuman: true } },
  { match: /^kokushi/i, entry: { name: "国士無双", yakuman: true } },
  { match: /^suu ?ankou ?tanki$/i, entry: { name: "四暗刻単騎", yakuman: true } },
  { match: /^suu ?ankou$/i, entry: { name: "四暗刻", yakuman: true } },
  { match: /^daisangen$/i, entry: { name: "大三元", yakuman: true } },
  { match: /^shousuushii$/i, entry: { name: "小四喜", yakuman: true } },
  { match: /^dai ?suushii$/i, entry: { name: "大四喜", yakuman: true } },
  { match: /^tsuuiisou$/i, entry: { name: "字一色", yakuman: true } },
  { match: /^chinroutou$/i, entry: { name: "清老頭", yakuman: true } },
  { match: /^ryuuiisou$/i, entry: { name: "緑一色", yakuman: true } },
  { match: /^daburu ?chuuren/i, entry: { name: "純正九蓮宝燈", yakuman: true } },
  { match: /^chuuren/i, entry: { name: "九蓮宝燈", yakuman: true } },
  { match: /^suukantsu$/i, entry: { name: "四槓子", yakuman: true } },
  { match: /^tenhou$/i, entry: { name: "天和", yakuman: true } },
  { match: /^chiihou$/i, entry: { name: "地和", yakuman: true } },
  { match: /^renhou ?yakuman$/i, entry: { name: "人和", yakuman: true } },
  { match: /^renhou$/i, entry: { name: "人和", hanMenzen: 1, hanNaki: null } },
  { match: /^daichisei$/i, entry: { name: "大七星", yakuman: true } },
  { match: /^daisharin$/i, entry: { name: "大車輪", yakuman: true } },
  { match: /^paarenchan$/i, entry: { name: "八連荘", yakuman: true } }
];
