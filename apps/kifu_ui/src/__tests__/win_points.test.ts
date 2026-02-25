import { applyNotenPenaltyPoints } from "../lib/win_points";

describe("win_points", () => {
  const base = { E: 25000, S: 25000, W: 25000, N: 25000 };

  test("流局精算: 1人テンパイなら3000点受け取り、3人ノーテンが1000点ずつ支払う", () => {
    const result = applyNotenPenaltyPoints(base, { E: true, S: false, W: false, N: false });
    expect(result).toEqual({ E: 28000, S: 24000, W: 24000, N: 24000 });
  });

  test("流局精算: 2人テンパイなら各+1500 / ノーテン各-1500", () => {
    const result = applyNotenPenaltyPoints(base, { E: true, S: true, W: false, N: false });
    expect(result).toEqual({ E: 26500, S: 26500, W: 23500, N: 23500 });
  });

  test("流局精算: 全員テンパイまたは全員ノーテンは移動なし", () => {
    expect(applyNotenPenaltyPoints(base, { E: true, S: true, W: true, N: true })).toEqual(base);
    expect(applyNotenPenaltyPoints(base, { E: false, S: false, W: false, N: false })).toEqual(base);
  });
});
