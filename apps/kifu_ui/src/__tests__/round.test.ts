import { dealerSeatFromKyoku, roundIndexFromMeta, roundMetaFromIndex } from "../lib/round";

describe("round", () => {
  test("roundIndexFromMeta: 東1〜北4を0〜15に変換する", () => {
    expect(roundIndexFromMeta("E", 1)).toBe(0);
    expect(roundIndexFromMeta("S", 4)).toBe(7);
    expect(roundIndexFromMeta("N", 4)).toBe(15);
  });

  test("roundMetaFromIndex: インデックスを場風/局へ戻す", () => {
    expect(roundMetaFromIndex(0)).toEqual({ wind: "E", kyoku: 1 });
    expect(roundMetaFromIndex(10)).toEqual({ wind: "W", kyoku: 3 });
    expect(roundMetaFromIndex(15)).toEqual({ wind: "N", kyoku: 4 });
  });

  test("dealerSeatFromKyoku: 局数に応じた親座席を返す", () => {
    expect(dealerSeatFromKyoku(1)).toBe("E");
    expect(dealerSeatFromKyoku(2)).toBe("S");
    expect(dealerSeatFromKyoku(3)).toBe("W");
    expect(dealerSeatFromKyoku(4)).toBe("N");
    expect(dealerSeatFromKyoku(5)).toBe("E");
  });
});
