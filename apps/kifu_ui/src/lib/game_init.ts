import type { Seat, TileStr } from "../ui/types";
import type { GamePhase, GameState, PlayerState, RoundMeta } from "./game_flow";
import { dealerSeatFromKyoku } from "./round";
import { canonicalTile, tileKeyForCount } from "./tile_ops";
import { buildWallStateFromUsage } from "./wall_ops";

type RoundLike = {
  wind?: string;
  kyoku?: number;
  honba?: number;
  riichiSticks?: number;
  dealer?: string;
};

type StepLike = {
  action?: string;
  actor?: string;
  tile?: string | null;
  hands?: Record<string, string[]>;
  points?: Record<string, number>;
  doraIndicators?: string[];
};

export type InitOverrides = {
  hands?: Record<Seat, TileStr[]>;
  points?: Record<Seat, number>;
  doraIndicators?: TileStr[];
  uraDoraIndicators?: TileStr[];
  turn?: Seat;
  phase?: GamePhase;
  meta?: Partial<Omit<RoundMeta, "points">>;
};

export type InitTileConfig = {
  tileChoices: readonly TileStr[];
  tileLimits: Readonly<Record<string, number>>;
  normalizeTile: (tile: TileStr) => TileStr;
};

const SEATS: Seat[] = ["E", "S", "W", "N"];

const seatMap: Record<string, Seat> = {
  E: "E",
  S: "S",
  W: "W",
  N: "N",
  東: "E",
  南: "S",
  西: "W",
  北: "N"
};

const normalizeSeat = (value: string | undefined, fallback: Seat): Seat =>
  (value && seatMap[value]) || fallback;

const buildPlayer = (hand: TileStr[] = [], normalizeTile: (tile: TileStr) => TileStr = canonicalTile): PlayerState => ({
  hand: hand.map((tile) => normalizeTile(tile)),
  drawnTile: null,
  drawnFrom: null,
  melds: [],
  discards: [],
  riichi: false,
  ippatsu: false,
  closed: true,
  furiten: false,
  furitenTemp: false
});

const countTilesInState = (state: GameState) => {
  const counts: Record<string, number> = {};
  const add = (tile: string) => {
    const key = tileKeyForCount(tile);
    if (!key) return;
    counts[key] = (counts[key] ?? 0) + 1;
  };
  SEATS.forEach((seat) => {
    const player = state.players[seat];
    player.hand.forEach(add);
    if (player.drawnTile && player.drawnFrom !== "CALL") add(player.drawnTile);
    player.discards.forEach(add);
    player.melds.forEach((meld) => meld.tiles.forEach(add));
  });
  (state.meta.doraIndicators ?? []).forEach(add);
  return counts;
};

export const initFromKifuStep = (
  round: RoundLike | undefined,
  step: StepLike | undefined,
  overrides: InitOverrides,
  tileConfig: InitTileConfig
): GameState => {
  const normalizeTile = tileConfig.normalizeTile;
  const baseHands = overrides.hands ?? (step?.hands as Record<Seat, TileStr[]>) ?? {};
  const kyoku = overrides.meta?.kyoku ?? round?.kyoku ?? 1;
  const dealerFromKyoku = dealerSeatFromKyoku(kyoku);
  const points = overrides.points ?? (step?.points as Record<Seat, number>) ?? {
    E: 25000,
    S: 25000,
    W: 25000,
    N: 25000
  };
  const desiredDora = (overrides.doraIndicators ?? step?.doraIndicators ?? []).map((tile) => normalizeTile(tile));
  const desiredUra = (overrides.uraDoraIndicators ?? []).map((tile) => normalizeTile(tile));
  const meta: RoundMeta = {
    wind: normalizeSeat(overrides.meta?.wind ?? round?.wind, "E"),
    kyoku,
    honba: overrides.meta?.honba ?? round?.honba ?? 0,
    riichiSticks: overrides.meta?.riichiSticks ?? round?.riichiSticks ?? 0,
    dealer: dealerFromKyoku,
    points,
    doraRevealedCount: overrides.meta?.doraRevealedCount ?? Math.max(1, desiredDora.length || 1),
    liveWall: overrides.meta?.liveWall ?? [],
    deadWall: overrides.meta?.deadWall ?? [],
    doraIndicators: desiredDora,
    uraDoraIndicators: desiredUra
  };

  const state: GameState = {
    meta,
    players: {
      E: buildPlayer(baseHands.E ?? Array(13).fill(""), normalizeTile),
      S: buildPlayer(baseHands.S ?? Array(13).fill(""), normalizeTile),
      W: buildPlayer(baseHands.W ?? Array(13).fill(""), normalizeTile),
      N: buildPlayer(baseHands.N ?? Array(13).fill(""), normalizeTile)
    },
    turn: normalizeSeat(overrides.turn ?? step?.actor, meta.dealer),
    phase: "BEFORE_DRAW",
    lastDiscard: undefined,
    pendingClaims: []
  };

  const action = (step?.action ?? "").toLowerCase();
  if (action.includes("draw") || action.includes("tsumo") || action.includes("ツモ")) {
    state.phase = "AFTER_DRAW_MUST_DISCARD";
  } else if (action.includes("discard") || action.includes("打")) {
    state.phase = "AWAITING_CALL";
    if (step?.tile) {
      state.lastDiscard = { seat: state.turn, tile: normalizeTile(step.tile ?? "") };
    }
  } else if (action.includes("ron") || action.includes("和了") || action.includes("agari")) {
    state.phase = "ENDED";
  }

  if (overrides.phase) state.phase = overrides.phase;
  if (overrides.turn) state.turn = overrides.turn;

  if (!state.meta.liveWall.length && !state.meta.deadWall.length) {
    const counts = countTilesInState(state);
    const wallState = buildWallStateFromUsage(tileConfig.tileChoices, tileConfig.tileLimits, counts);
    state.meta.liveWall = wallState.liveWall;
    state.meta.deadWall = wallState.deadWall;
  }
  if (state.meta.deadWall.length) {
    state.meta.liveWall = [...state.meta.liveWall, ...state.meta.deadWall];
    state.meta.deadWall = [];
  }
  if (desiredDora.length) {
    state.meta.doraRevealedCount = Math.max(1, Math.min(5, desiredDora.length));
  }

  return state;
};

