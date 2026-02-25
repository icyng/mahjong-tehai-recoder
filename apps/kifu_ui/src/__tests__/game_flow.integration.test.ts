import {
  buildAdvanceToNextDrawTransition,
  buildClaimTransition,
  buildDiscardTransition,
  type GameState,
  type PlayerState
} from "../lib/game_flow";

const createPlayer = (overrides: Partial<PlayerState> = {}): PlayerState => ({
  hand: [],
  drawnTile: null,
  drawnFrom: null,
  melds: [],
  discards: [],
  riichi: false,
  ippatsu: false,
  closed: true,
  furiten: false,
  furitenTemp: false,
  ...overrides
});

const createBaseState = (): GameState => ({
  turn: "E",
  phase: "AFTER_DRAW_MUST_DISCARD",
  players: {
    E: createPlayer({
      hand: ["1m", "2m", "3m", "4p", "5p", "6p", "1s", "2s", "3s", "E", "E", "S", "S"],
      drawnTile: "5m",
      drawnFrom: "WALL"
    }),
    S: createPlayer({
      hand: ["4m", "6m", "1p", "2p", "3p", "4p", "5p", "6p", "7p", "1s", "1s", "N", "N"]
    }),
    W: createPlayer({ hand: ["1m"] }),
    N: createPlayer({ hand: ["1m"] })
  },
  meta: {
    wind: "E",
    kyoku: 1,
    honba: 0,
    riichiSticks: 0,
    dealer: "E",
    points: { E: 25000, S: 25000, W: 25000, N: 25000 },
    doraRevealedCount: 1,
    liveWall: ["9m", "8m", "7m", "6m", "5m"],
    deadWall: [],
    doraIndicators: ["4m"],
    uraDoraIndicators: []
  }
});

describe("game_flow integration", () => {
  test("局進行: 打牌 -> 鳴き(チー) -> 鳴き手打牌 -> 次ツモ待ちへ遷移する", () => {
    const afterDiscard = buildDiscardTransition(createBaseState(), "5m", false).nextState;
    expect(afterDiscard.phase).toBe("AWAITING_CALL");
    expect(afterDiscard.lastDiscard).toEqual({ seat: "E", tile: "5m" });

    const claimed = buildClaimTransition(
      afterDiscard,
      { type: "CHI", by: "S", from: "E", tile: "5m" },
      ["4m", "6m"]
    );
    expect(claimed).not.toBeNull();
    const afterClaim = claimed!.nextState;
    expect(afterClaim.phase).toBe("AFTER_DRAW_MUST_DISCARD");
    expect(afterClaim.turn).toBe("S");
    expect(afterClaim.players.S.melds).toHaveLength(1);
    expect(afterClaim.players.S.melds[0]?.kind).toBe("CHI");

    const afterCallerDiscard = buildDiscardTransition(afterClaim, "1p", false).nextState;
    expect(afterCallerDiscard.phase).toBe("AWAITING_CALL");
    expect(afterCallerDiscard.lastDiscard).toEqual({ seat: "S", tile: "1p" });

    const next = buildAdvanceToNextDrawTransition(afterCallerDiscard, []);
    expect(next.phase).toBe("BEFORE_DRAW");
    expect(next.turn).toBe("W");
  });

  test("リーチ宣言牌: リーチ時に供託/点数/宣言状態を更新する", () => {
    const state = createBaseState();
    const { nextState, riichiDeclared, riichiDiscardIndex } = buildDiscardTransition(state, "1m", true);

    expect(riichiDeclared).toBe(true);
    expect(riichiDiscardIndex).toBe(0);
    expect(nextState.players.E.riichi).toBe(true);
    expect(nextState.players.E.ippatsu).toBe(true);
    expect(nextState.meta.riichiSticks).toBe(1);
    expect(nextState.meta.points.E).toBe(24000);
    expect(nextState.phase).toBe("AWAITING_CALL");
  });
});
