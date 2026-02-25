import { buildLogExportSnapshot } from "../lib/log_export";
import { buildCallLogToken, logTokenToTile, SEAT_LABEL_TO_SEAT, tileToLogCode } from "../lib/log_codec";
import type { Seat } from "../ui/types";

const seatList: Seat[] = ["E", "S", "W", "N"];
const kyokuToSeat: Seat[] = ["E", "S", "W", "N"];

const createBaseState = () => ({
  phase: "ENDED",
  lastDiscard: { seat: "S" as Seat, tile: "2m" },
  meta: {
    wind: "E" as Seat,
    kyoku: 1,
    honba: 0,
    riichiSticks: 0,
    points: { E: 30200, S: 20800, W: 25000, N: 24000 },
    doraIndicators: ["4m"],
    uraDoraIndicators: ["6m"],
    doraRevealedCount: 1
  },
  players: {
    E: { hand: ["1m"], melds: [], discards: ["1m"], riichi: true, closed: true },
    S: { hand: ["2m"], melds: [], discards: ["2m"], riichi: false, closed: true },
    W: { hand: ["3m"], melds: [], discards: [], riichi: false, closed: true },
    N: { hand: ["4m"], melds: [], discards: [], riichi: false, closed: true }
  }
});

describe("log_export", () => {
  test("ログJSON整合: 必須ヘッダと4家分配列が出力される", () => {
    const snapshot = buildLogExportSnapshot({
      baseState: createBaseState(),
      initState: {
        ...createBaseState(),
        phase: "AFTER_DRAW_MUST_DISCARD",
        meta: { ...createBaseState().meta, points: { E: 25000, S: 25000, W: 25000, N: 25000 } }
      },
      logTitle: ["t1", "t2"],
      ruleDisplay: "般南喰赤",
      akaEnabled: true,
      seatNames: { E: "user1", S: "user2", W: "user3", N: "user4" },
      winInfo: {
        seat: "E",
        tile: "2m",
        type: "ron",
        from: "S",
        result: { han: 1, fu: 30, cost: { main: 1000 }, yaku: ["Riichi"] }
      },
      tenpaiFlags: { E: true, S: false, W: false, N: false },
      riichiDiscards: { E: 0, S: null, W: null, N: null },
      actionLog: ["東ステ: 1m", "東リーチ", "南ステ: 2m"],
      initialHands: {
        E: ["1m", "2m", "3m"],
        S: ["4m", "5m", "6m"],
        W: ["7m", "8m", "9m"],
        N: ["E", "E", "E"]
      },
      seatList,
      seatLabelToSeat: SEAT_LABEL_TO_SEAT,
      kyokuToSeat,
      tileToLogCode,
      logTokenToTile,
      buildCallLogToken,
      tileEq: (a, b) => a === b,
      hasRiichiYaku: () => false,
      getDealerFromKyoku: () => "E",
      getDoraIndicators: (meta) => meta.doraIndicators ?? [],
      getUraDoraIndicators: (meta) => meta.uraDoraIndicators ?? [],
      computeDoraCountsForWin: () => ({ doraCount: 0, uraCount: 0, akaCount: 0 }),
      formatScoreSummaryForLog: () => "30符1飜1000点",
      buildJapaneseYakuList: () => ["立直(1飜)"],
      resolveSeatWind: () => "E"
    });

    expect(snapshot.title).toEqual(["t1", "t2"]);
    expect(snapshot.name).toEqual(["user1", "user2", "user3", "user4"]);
    expect(snapshot.rule).toEqual({ disp: "般南喰赤", aka: 1 });
    expect(Array.isArray(snapshot.log)).toBe(true);
    expect(snapshot.log).toHaveLength(1);

    const entry = snapshot.log[0] as unknown[];
    expect(Array.isArray(entry[0])).toBe(true);
    expect(Array.isArray(entry[1])).toBe(true);
    expect(Array.isArray(entry[16])).toBe(true);
    const resultBlock = entry[16] as unknown[];
    expect(resultBlock[0]).toBe("和了");
  });

  test("リーチ宣言牌: リーチ宣言時に直前の捨て牌へ r プレフィックスを付与する", () => {
    const snapshot = buildLogExportSnapshot({
      baseState: createBaseState(),
      initState: {
        ...createBaseState(),
        meta: { ...createBaseState().meta, points: { E: 25000, S: 25000, W: 25000, N: 25000 } }
      },
      logTitle: ["", ""],
      ruleDisplay: "般南喰赤",
      akaEnabled: true,
      seatNames: { E: "user1", S: "user2", W: "user3", N: "user4" },
      winInfo: null,
      tenpaiFlags: { E: false, S: false, W: false, N: false },
      riichiDiscards: { E: 0, S: null, W: null, N: null },
      actionLog: ["東ステ: 1m", "東リーチ"],
      initialHands: { E: [], S: [], W: [], N: [] },
      seatList,
      seatLabelToSeat: SEAT_LABEL_TO_SEAT,
      kyokuToSeat,
      tileToLogCode,
      logTokenToTile,
      buildCallLogToken,
      tileEq: (a, b) => a === b,
      hasRiichiYaku: () => false,
      getDealerFromKyoku: () => "E",
      getDoraIndicators: (meta) => meta.doraIndicators ?? [],
      getUraDoraIndicators: (meta) => meta.uraDoraIndicators ?? [],
      computeDoraCountsForWin: () => ({ doraCount: 0, uraCount: 0, akaCount: 0 }),
      formatScoreSummaryForLog: () => "",
      buildJapaneseYakuList: () => [],
      resolveSeatWind: () => "E"
    });

    const entry = snapshot.log[0] as unknown[];
    const eastDiscards = entry[6] as Array<number | string>;
    expect(eastDiscards[0]).toBe("r11");
  });
});
