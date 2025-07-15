# 麻雀手牌解析

icyng、2025/07/15

---

## 概要

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
Class: ht, Confidence: 0.923
Class: ht, Confidence: 0.922
Class: 1s, Confidence: 0.918
Class: 3s, Confidence: 0.901
Class: 5s, Confidence: 0.935
Class: 6s, Confidence: 0.937
Class: 8s, Confidence: 0.895
Class: 5m, Confidence: 0.915
Class: 6m, Confidence: 0.937
Class: 6p, Confidence: 0.907
Class: pe, Confidence: 0.891
Class: 9s, Confidence: 0.925
Class: 9s, Confidence: 0.860
```
