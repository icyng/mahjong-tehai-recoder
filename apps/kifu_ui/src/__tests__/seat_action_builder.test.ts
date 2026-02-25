import { buildSeatActionList, type SeatCallOption } from "../lib/seat_action_builder";

describe("seat_action_builder", () => {
  const createHandlers = () => ({
    onCapture: jest.fn(),
    onRiichi: jest.fn(),
    onRiichiCancel: jest.fn(),
    onTsumo: jest.fn(),
    onSelfKan: jest.fn(),
    onOpenRon: jest.fn(),
    onOpenClaim: jest.fn(),
    onCallCancel: jest.fn()
  });

  test("AFTER_DRAW_MUST_DISCARD かつ手番時はリーチ/ツモ/カンを表示する", () => {
    const handlers = createHandlers();
    const actions = buildSeatActionList({
      seat: "E",
      hasGameState: true,
      pendingRinshan: false,
      afterDrawOnTurn: true,
      awaitingCall: false,
      riichiAllowed: true,
      pendingRiichi: false,
      canTsumoNow: true,
      canSelfKan: true,
      seatCalls: [],
      captureActive: false,
      captureAnalyzing: false,
      captureStarting: false,
      ...handlers
    });

    expect(actions.map((action) => action.label)).toEqual(["リーチ", "ツモ", "カン"]);
  });

  test("AWAITING_CALL時は鳴き/ロン候補とキャンセルを表示する", () => {
    const handlers = createHandlers();
    const seatCalls: SeatCallOption[] = [
      { type: "RON_WIN", by: "S" },
      { type: "CHI", by: "S" }
    ];
    const actions = buildSeatActionList({
      seat: "S",
      hasGameState: true,
      pendingRinshan: false,
      afterDrawOnTurn: false,
      awaitingCall: true,
      riichiAllowed: false,
      pendingRiichi: false,
      canTsumoNow: false,
      canSelfKan: false,
      seatCalls,
      captureActive: false,
      captureAnalyzing: false,
      captureStarting: false,
      ...handlers
    });

    expect(actions.map((action) => action.label)).toEqual(["ロン", "チー", "キャンセル"]);
  });

  test("画面共有中は先頭にキャプチャボタンを表示する", () => {
    const handlers = createHandlers();
    const actions = buildSeatActionList({
      seat: "W",
      hasGameState: false,
      pendingRinshan: false,
      afterDrawOnTurn: false,
      awaitingCall: false,
      riichiAllowed: false,
      pendingRiichi: false,
      canTsumoNow: false,
      canSelfKan: false,
      seatCalls: [],
      captureActive: true,
      captureAnalyzing: false,
      captureStarting: false,
      ...handlers
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.label).toBe("キャプチャ");
    actions[0]?.onClick();
    expect(handlers.onCapture).toHaveBeenCalledWith("W");
  });
});
