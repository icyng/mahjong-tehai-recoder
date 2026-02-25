import {
  canonicalTile,
  removeOneExactThenNorm,
  sortTiles,
  takeTilesExactThenNorm,
  tileEq,
  tileNorm
} from "../lib/tile_ops";

describe("tile_ops", () => {
  test("canonicalTile: z表記と字牌短縮表記を内部表現へ正規化する", () => {
    expect(canonicalTile("1z")).toBe("E");
    expect(canonicalTile("7z")).toBe("C");
    expect(canonicalTile("to")).toBe("E");
    expect(canonicalTile("ht")).toBe("F");
  });

  test("tileNorm / tileEq: 赤5を通常5として比較できる", () => {
    expect(tileNorm("0m")).toBe("5m");
    expect(tileEq("0p", "5p")).toBe(true);
    expect(tileEq("0s", "6s")).toBe(false);
  });

  test("removeOneExactThenNorm: 完全一致を優先して1枚だけ除去する", () => {
    expect(removeOneExactThenNorm(["0m", "5m", "5m"], "0m")).toEqual(["5m", "5m"]);
    expect(removeOneExactThenNorm(["0m", "5m", "5m"], "5m")).toEqual(["0m", "5m"]);
  });

  test("takeTilesExactThenNorm: 完全一致優先で必要枚数を取得する", () => {
    const result = takeTilesExactThenNorm(["0m", "5m", "5m", "6m"], "5m", 2);
    expect(result.taken).toEqual(["5m", "5m"]);
    expect(result.remaining).toEqual(["0m", "6m"]);
  });

  test("sortTiles: 数牌→字牌順で安定ソートする", () => {
    expect(sortTiles(["C", "2m", "E", "1m", "0m"])).toEqual(["1m", "2m", "0m", "E", "C"]);
  });
});
