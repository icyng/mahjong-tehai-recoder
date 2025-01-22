# 麻雀手牌解析ツール(仮)

麻雀での手配状況を解析し、逐次可視化

icyng、update: 2025/01/22

---

## 概要

- 「物体検知を用いて麻雀の手配解析をする」
- 機能：
  - [x] 手元カメラ：手牌解析
  - [x] 天井での解析をもとに、手牌に対して「待ち」や「和了」の実装
  - [ ] 手牌情報から鳴きやドラを計算

## 仕様

- 実行環境：M1 mac air, win 11
- データ元：[abemaの配信キャプチャ](https://abema.tv/video/genre/mahjong)
- データ作成(annotation)：[Label-Studio](https://labelstud.io/)
- 物体検知：[YOLOv8](https://docs.ultralytics.com/)

## todo

- 手元データから鳴き・捨て牌のデータベースを作成
- ドラはいったん手入力
