# 麻雀手牌解析

<<<<<<< HEAD
麻雀での手配状況を解析し、点数計算まで行ってくれるツール

icyng、update：2025/07/08
=======
icyng、2025/07/15
>>>>>>> 3a0fbafee8d93edba41c2cad6f5b27816fde0ec7

---

## 概要

<<<<<<< HEAD
- 「物体検知を用いて麻雀の手配解析をする」
- 上がり牌は認識できないので手入力
- 機能：
  - [x] 手元カメラ：手牌解析
  - [x] 手牌に対して「待ち」「和了」「鳴き」の実装
    - 精度悪い
- 今後：
  - [ ] 天井カメラ：捨牌・ドラ・鳴き解析
    - ドラ、風、鳴きを自動読み込みしたい
  - [ ] 「待ち」「和了」「鳴き」の精度改善
=======
- 画像認識を利用して手牌画像から牌情報を抽出し、点数計算まで行う
- 現状、卓情報（アガリ牌・ドラ・副露）は手入力
- 今後、天井カメラによる、卓上の捨牌・ドラ・副露の解析

### todo

```bash
pip-review --auto
pip install -e . 
```

### SAMPLE(YOLOv12m)

![res](./result.png)

```bash
# 左から順に
Class: 9s, Confidence: 0.864
Class: 8s, Confidence: 0.870
Class: 7s, Confidence: 0.926
Class: 2p, Confidence: 0.899
Class: 4p, Confidence: 0.915
Class: 5p, Confidence: 0.933
Class: 5p, Confidence: 0.924
Class: 7p, Confidence: 0.931
Class: 8p, Confidence: 0.895
Class: 9p, Confidence: 0.939
Class: 9m, Confidence: 0.900
Class: 9m, Confidence: 0.901
Class: 0p, Confidence: 0.904
---
待ち：['3p']

@自家手牌 : ['987', '245578903', '99', '']
@アガリ牌 : 3p
@ツモ : 5翻 40符 2000 4000
@役 : [Menzen Tsumo, Riichi, Dora 3]
@符詳細 : 
{'fu': 20, 'reason': 'base'}
{'fu': 8, 'reason': 'closed_terminal_pon'}
{'fu': 2, 'reason': 'kanchan'}
{'fu': 2, 'reason': 'tsumo'}
```
>>>>>>> 3a0fbafee8d93edba41c2cad6f5b27816fde0ec7
