import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { flushSync } from "react-dom";
import type { Seat, TileStr, SeatAction } from "./ui/types";
import { SeatSummaryBar } from "./components/SeatSummaryBar";
import { SeatBlock } from "./components/SeatBlock";
import { MeldTiles } from "./components/MeldTiles";
import { useSeatViewModel } from "./hooks/useSeatViewModel";
import {
  buildJapaneseYakuList,
  computeDoraCountsForWin,
  formatScoreSummaryForLog,
  getDoraDisplayTiles,
  getDoraIndicators,
  getLimitTier,
  getUraDoraIndicators,
  rebuildDoraYakuList,
  type DoraCounts
} from "./lib/score_utils";
import { analyzeTilesFromImage, postTenpai, scoreWin, type TenpaiResponse, type WinPayload } from "./lib/mahjong_api";

type Step = {
  index: number;
  actor: string;
  action: string;
  tile?: string | null;
  hands: Record<string, string[]>;
  points: Record<string, number>;
  doraIndicators: string[];
  note?: string | null;
};

type Round = {
  roundIndex: number;
  wind: string;
  kyoku: number;
  honba: number;
  riichiSticks: number;
  dealer: string;
  steps: Step[];
};

type Kifu = {
  gameId: string;
  rounds: Round[];
};

const TILE_W = 36;
const TILE_H = 48;
const MELD_TILE_W = 20;
const MELD_TILE_H = 28;
const TOTAL_TILES = 136;
const SCORE_DEBUG = false;

const HONOR_MAP: Record<string, string> = {
  E: "to",
  S: "na",
  W: "sh",
  N: "pe",
  P: "hk",
  F: "ht",
  C: "ty"
};

const HONOR_MAP_REVERSE: Record<string, string> = {
  to: "E",
  na: "S",
  sh: "W",
  pe: "N",
  hk: "P",
  ht: "F",
  ty: "C"
};

const HONOR_ORDER: Record<string, number> = {
  E: 1,
  S: 2,
  W: 3,
  N: 4,
  P: 5,
  F: 6,
  C: 7
};

const TILE_PLACEHOLDER = "PLACEHOLDER";
const TILE_BACK = "BACK";

const TILE_LIMITS: Record<string, number> = (() => {
  const limits: Record<string, number> = {};
  const suits = ["m", "p", "s"];
  for (const suit of suits) {
    for (let i = 1; i <= 9; i += 1) {
      limits[`${i}${suit}`] = 4;
    }
    limits[`5${suit}`] = 3;
    limits[`0${suit}`] = 1;
  }
  for (const honor of ["E", "S", "W", "N", "P", "F", "C"]) {
    limits[honor] = 4;
  }
  return limits;
})();

const WIND_LABELS: Record<Seat, string> = {
  E: "東",
  S: "南",
  W: "西",
  N: "北"
};

const WIND_ORDER: Seat[] = ["E", "S", "W", "N"];
const KYOKU_TO_SEAT: Seat[] = ["E", "S", "W", "N"];

const getDealerFromKyoku = (kyoku: number) => {
  const idx = Math.max(1, kyoku) - 1;
  return KYOKU_TO_SEAT[idx % 4];
};

const roundIndexFromMeta = (wind: Seat, kyoku: number) => {
  const windIdx = Math.max(0, WIND_ORDER.indexOf(wind));
  const kyokuIdx = Math.max(0, Math.min(3, (kyoku ?? 1) - 1));
  return windIdx * 4 + kyokuIdx;
};

const roundMetaFromIndex = (index: number) => {
  const safe = Math.max(0, Math.min(15, index));
  const wind = WIND_ORDER[Math.floor(safe / 4)] ?? "E";
  const kyoku = (safe % 4) + 1;
  return { wind, kyoku };
};

const ROUND_OPTIONS = WIND_ORDER.flatMap((wind) =>
  [1, 2, 3, 4].map((kyoku) => ({
    value: roundIndexFromMeta(wind, kyoku),
    wind,
    kyoku,
    label: `${WIND_LABELS[wind]}${kyoku}局`
  }))
);

const suitTiles = (suit: string) =>
  ["1", "2", "3", "4", "5", "0", "6", "7", "8", "9"].map((n) => `${n}${suit}`);

const TILE_CHOICES = [
  ...suitTiles("m"),
  ...suitTiles("p"),
  ...suitTiles("s"),
  "E",
  "S",
  "W",
  "N",
  "P",
  "F",
  "C"
];

const honorFromZ = (tile: string) => {
  const digit = tile[0];
  if (digit === "1") return "E";
  if (digit === "2") return "S";
  if (digit === "3") return "W";
  if (digit === "4") return "N";
  if (digit === "5") return "P";
  if (digit === "6") return "F";
  if (digit === "7") return "C";
  return null;
};

const canonicalTile = (tile: string) => {
  const trimmed = tile.trim();
  if (!trimmed) return trimmed;
  if (trimmed.length === 2 && trimmed[1] === "z") {
    return honorFromZ(trimmed) ?? trimmed;
  }
  if (trimmed.length === 2 && HONOR_MAP_REVERSE[trimmed]) {
    return HONOR_MAP_REVERSE[trimmed];
  }
  return trimmed;
};

const tileNorm = (tile: string) => {
  const t = canonicalTile(tile);
  if (t.length === 2 && t[0] === "0" && "mps".includes(t[1])) {
    return `5${t[1]}`;
  }
  return t;
};

const tileEq = (a: string, b: string) => tileNorm(a) === tileNorm(b);

const normalizeTile = (tile: string) => canonicalTile(tile);

const removeOneExactThenNorm = (tiles: string[], target: string) => {
  if (!target) return [...tiles];
  const next = [...tiles];
  let idx = next.findIndex((tile) => tile === target);
  if (idx >= 0) {
    next.splice(idx, 1);
    return next;
  }
  idx = next.findIndex((tile) => tile && tileEq(tile, target));
  if (idx >= 0) next.splice(idx, 1);
  return next;
};

const takeTilesExactThenNorm = (tiles: string[], target: string, count: number) => {
  const remaining = [...tiles];
  const taken: string[] = [];
  if (!target || count <= 0) return { taken, remaining };
  for (let i = 0; i < remaining.length && taken.length < count; ) {
    if (remaining[i] === target) {
      taken.push(remaining[i]);
      remaining.splice(i, 1);
    } else {
      i += 1;
    }
  }
  for (let i = 0; i < remaining.length && taken.length < count; ) {
    if (remaining[i] && tileEq(remaining[i], target)) {
      taken.push(remaining[i]);
      remaining.splice(i, 1);
    } else {
      i += 1;
    }
  }
  return { taken, remaining };
};

const tileToAsset = (tile: string) => {
  const trimmed = canonicalTile(tile);
  if (!trimmed) return null;
  if (trimmed.length === 2 && "mps".includes(trimmed[1])) {
    return `/tiles/${trimmed}.png`;
  }
  if (trimmed.length === 2 && trimmed[1] === "z") {
    const honor = honorFromZ(trimmed);
    if (!honor) return null;
    const mapped = HONOR_MAP[honor];
    return mapped ? `/tiles/${mapped}.png` : null;
  }
  const mapped = HONOR_MAP[trimmed];
  return mapped ? `/tiles/${mapped}.png` : null;
};

const tileKeyForCount = (tile: string) => {
  const trimmed = canonicalTile(tile);
  if (!trimmed || trimmed === "BACK" || trimmed === "PLACEHOLDER") return null;
  if (trimmed.length === 2 && trimmed[1] === "z") {
    return honorFromZ(trimmed);
  }
  if (trimmed.length === 2 && "mps".includes(trimmed[1])) {
    return trimmed;
  }
  const honor = trimmed.toUpperCase();
  return HONOR_ORDER[honor] ? honor : null;
};

const tileSortKey = (tile: string) => {
  const t = canonicalTile(tile);
  if (!t) return { suit: 9, rank: 99, red: 0, honor: 99 };
  const lower = t.toLowerCase();
  if (lower.length === 2 && "mps".includes(lower[1])) {
    const raw = lower[0];
    const isRed = raw === "0";
    const rank = raw === "0" ? 5 : Number(raw);
    const suitOrder = lower[1] === "m" ? 0 : lower[1] === "p" ? 1 : 2;
    return { suit: suitOrder, rank, red: isRed ? 1 : 0, honor: 0 };
  }
  if (lower.length === 2 && lower[1] === "z") {
    const honor = honorFromZ(lower);
    return { suit: 3, rank: 0, red: 0, honor: honor ? HONOR_ORDER[honor] ?? 99 : 99 };
  }
  const honorKey = t.toUpperCase();
  return { suit: 3, rank: 0, red: 0, honor: HONOR_ORDER[honorKey] ?? 99 };
};

const sortTiles = (tiles: string[]) => {
  const normalized = tiles.map((tile) => normalizeTile(tile));
  const filled = normalized.filter((tile) => tile);
  const blanks = normalized.length - filled.length;
  const sorted = [...filled].sort((a, b) => {
    const ka = tileSortKey(a);
    const kb = tileSortKey(b);
    if (ka.suit !== kb.suit) return ka.suit - kb.suit;
    if (ka.rank !== kb.rank) return ka.rank - kb.rank;
    if (ka.red !== kb.red) return ka.red - kb.red;
    return ka.honor - kb.honor;
  });
  return [...sorted, ...Array(blanks).fill("")];
};

const buildTileDeck = () => {
  const deck: string[] = [];
  for (const suit of ["m", "p", "s"]) {
    for (let i = 1; i <= 9; i += 1) {
      const count = i === 5 ? 3 : 4;
      for (let c = 0; c < count; c += 1) {
        deck.push(`${i}${suit}`);
      }
    }
    deck.push(`0${suit}`);
  }
  for (const honor of ["E", "S", "W", "N", "P", "F", "C"]) {
    for (let c = 0; c < 4; c += 1) {
      deck.push(honor);
    }
  }
  return deck;
};

const cloneState = <T,>(value: T): T => {
  const cloner = (globalThis as typeof globalThis & { structuredClone?: <U>(v: U) => U }).structuredClone;
  if (typeof cloner === "function") {
    return cloner(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const LOG_TOKEN_TO_TILE: Record<string, TileStr> = {
  ton: "E",
  nan: "S",
  sha: "W",
  pei: "N",
  hak: "P",
  hat: "F",
  chu: "C"
};

const tileToLogCode = (tile: TileStr): number | null => {
  const canon = canonicalTile(tile);
  if (!canon || canon === TILE_BACK || canon === TILE_PLACEHOLDER) return null;
  if (canon.startsWith("0") && canon.length === 2) {
    const suit = canon[1];
    return suit === "m" ? 51 : suit === "p" ? 52 : suit === "s" ? 53 : null;
  }
  if (canon.length === 2 && ["m", "p", "s"].includes(canon[1])) {
    const suitBase = canon[1] === "m" ? 10 : canon[1] === "p" ? 20 : 30;
    return suitBase + Number(canon[0]);
  }
  if (canon.length === 1) {
    switch (canon) {
      case "E":
        return 41;
      case "S":
        return 42;
      case "W":
        return 43;
      case "N":
        return 44;
      case "P":
        return 45;
      case "F":
        return 46;
      case "C":
        return 47;
      default:
        return null;
    }
  }
  return null;
};

const logTokenToTile = (token: string): TileStr | null => {
  if (!token) return null;
  if (LOG_TOKEN_TO_TILE[token]) return LOG_TOKEN_TO_TILE[token];
  if (/^0[ mps]$/i.test(token)) return canonicalTile(token);
  if (/^[1-9][mps]$/i.test(token)) return canonicalTile(token);
  return null;
};

const shuffleInPlace = (arr: string[]) => {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
};

type Meld = {
  kind: "CHI" | "PON" | "KAN" | "ANKAN" | "MINKAN" | "KAKAN";
  tiles: TileStr[];
  by?: Seat;
  calledFrom?: Seat;
  calledTile?: TileStr;
  open: boolean;
};

type CallMeldOption = {
  type: "CHI" | "PON" | "KAN";
  by: Seat;
  from: Seat;
  tile: TileStr;
  usedTiles: TileStr[];
  meldTiles: TileStr[];
  label: string;
};

type PlayerState = {
  hand: TileStr[];
  drawnTile: TileStr | null; // draw is tracked separately from hand ordering
  drawnFrom?: "WALL" | "CALL" | "RINSHAN" | null;
  melds: Meld[];
  discards: TileStr[];
  riichi: boolean;
  ippatsu: boolean;
  closed: boolean;
  furiten: boolean;
  furitenTemp: boolean;
};

type RoundMeta = {
  wind: Seat;
  kyoku: number;
  honba: number;
  riichiSticks: number;
  dealer: Seat;
  points: Record<Seat, number>;
  doraRevealedCount: number;
  liveWall: TileStr[];
  deadWall: TileStr[];
  doraIndicators: TileStr[];
  uraDoraIndicators: TileStr[];
};

type GamePhase = "BEFORE_DRAW" | "AFTER_DRAW_MUST_DISCARD" | "AWAITING_CALL" | "ENDED";

type GameState = {
  meta: RoundMeta;
  players: Record<Seat, PlayerState>;
  turn: Seat;
  phase: GamePhase;
  lastDiscard?: { seat: Seat; tile: TileStr };
  pendingClaims?: { type: "CHI" | "PON" | "KAN" | "RON"; by: Seat; tile: TileStr }[];
};

type InitOverrides = {
  hands?: Record<Seat, TileStr[]>;
  points?: Record<Seat, number>;
  doraIndicators?: TileStr[];
  uraDoraIndicators?: TileStr[];
  turn?: Seat;
  phase?: GamePhase;
  meta?: Partial<Omit<RoundMeta, "points">>;
};

const SEATS: Seat[] = ["E", "S", "W", "N"];

const nextSeat = (seat: Seat) => SEATS[(SEATS.indexOf(seat) + 1) % 4];

const prevSeat = (seat: Seat) => SEATS[(SEATS.indexOf(seat) + 3) % 4];

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

const buildPlayer = (hand: TileStr[] = []): PlayerState => ({
  hand: hand.map((tile) => canonicalTile(tile)),
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

const initFromKifuStep = (
  round?: { wind?: string; kyoku?: number; honba?: number; riichiSticks?: number; dealer?: string },
  step?: { action?: string; actor?: string; tile?: string | null; hands?: Record<string, string[]>; points?: Record<string, number>; doraIndicators?: string[] },
  overrides: InitOverrides = {}
): GameState => {
  const baseHands = overrides.hands ?? (step?.hands as Record<Seat, TileStr[]>) ?? {};
  const points = overrides.points ?? (step?.points as Record<Seat, number>) ?? {
    E: 25000,
    S: 25000,
    W: 25000,
    N: 25000
  };
  const dealer = normalizeSeat(round?.dealer, "E");
  const desiredDora = (overrides.doraIndicators ?? step?.doraIndicators ?? []).map((tile) => canonicalTile(tile));
  const desiredUra = (overrides.uraDoraIndicators ?? []).map((tile) => canonicalTile(tile));
  const meta: RoundMeta = {
    wind: normalizeSeat(overrides.meta?.wind ?? round?.wind, "E"),
    kyoku: overrides.meta?.kyoku ?? round?.kyoku ?? 1,
    honba: overrides.meta?.honba ?? round?.honba ?? 0,
    riichiSticks: overrides.meta?.riichiSticks ?? round?.riichiSticks ?? 0,
    dealer: normalizeSeat(overrides.meta?.dealer ?? round?.dealer, dealer),
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
      E: buildPlayer(baseHands.E ?? Array(13).fill("")),
      S: buildPlayer(baseHands.S ?? Array(13).fill("")),
      W: buildPlayer(baseHands.W ?? Array(13).fill("")),
      N: buildPlayer(baseHands.N ?? Array(13).fill(""))
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
      state.lastDiscard = { seat: state.turn, tile: step.tile ?? "" };
    }
  } else if (action.includes("ron") || action.includes("和了") || action.includes("agari")) {
    state.phase = "ENDED";
  }

  if (overrides.phase) state.phase = overrides.phase;
  if (overrides.turn) state.turn = overrides.turn;

  if (!state.meta.liveWall.length && !state.meta.deadWall.length) {
    const wallState = WallOps.buildWallStateFromState(state);
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

const oppositeSeat = (seat: Seat) => SEATS[(SEATS.indexOf(seat) + 2) % 4];

const calledIndexFor = (by: Seat, from: Seat | undefined, size: number) => {
  if (!from) return null;
  if (from === prevSeat(by)) return 0; // kamicha (left) -> leftmost
  if (from === oppositeSeat(by)) return size === 4 ? 1 : Math.floor(size / 2);
  if (from === nextSeat(by)) return size - 1; // shimocha (right) -> rightmost
  return null;
};

type LegalAction =
  | { type: "DRAW"; by: Seat }
  | { type: "DISCARD"; by: Seat }
  | { type: "RIICHI_DECLARE"; by: Seat }
  | { type: "TSUMO_WIN"; by: Seat }
  | { type: "RON_WIN"; by: Seat; from: Seat; tile: TileStr }
  | { type: "CHI" | "PON" | "KAN"; by: Seat; from: Seat; tile: TileStr };

const countNonEmptyTiles = (tiles: TileStr[]) => tiles.filter((tile) => tile && tile !== "BACK").length;

const tileCounts = (tiles: TileStr[]) => {
  const counts = new Map<string, number>();
  tiles.forEach((tile) => {
    if (!tile || tile === "BACK") return;
    const key = tileNorm(tile);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
};

const isSuitTile = (tile: TileStr) => tile.length === 2 && "mps".includes(tile[1]);

const canChi = (hand: TileStr[], tile: TileStr) => {
  if (!isSuitTile(tile)) return false;
  const n = Number(tile[0] === "0" ? "5" : tile[0]);
  const suit = tile[1];
  const normalized = new Set(hand.filter((t) => t).map(tileNorm));
  const combos: [number, number][] = [
    [n - 2, n - 1],
    [n - 1, n + 1],
    [n + 1, n + 2]
  ];
  return combos.some(([a, b]) => normalized.has(`${a}${suit}`) && normalized.has(`${b}${suit}`));
};

const canPon = (hand: TileStr[], tile: TileStr) => {
  const counts = tileCounts(hand);
  return (counts.get(tileNorm(tile)) ?? 0) >= 2;
};

const canKanFromDiscard = (hand: TileStr[], tile: TileStr) => {
  const counts = tileCounts(hand);
  return (counts.get(tileNorm(tile)) ?? 0) >= 3;
};

const canClosedKan = (hand: TileStr[]) => {
  const counts = tileCounts(hand);
  return [...counts.values()].some((count) => count >= 4);
};

const canAddedKan = (hand: TileStr[], ponTiles: TileStr[]) => {
  const counts = tileCounts(hand);
  return ponTiles.some((tile) => (counts.get(tileNorm(tile)) ?? 0) >= 1);
};


const getLegalActions = (state: GameState, viewerSeat?: Seat): LegalAction[] => {
  const actions: LegalAction[] = [];
  const turnSeat = state.turn;
  if (state.phase === "BEFORE_DRAW") {
    actions.push({ type: "DRAW", by: turnSeat });
  } else if (state.phase === "AFTER_DRAW_MUST_DISCARD") {
    actions.push({ type: "DISCARD", by: turnSeat });
    const hand = [
      ...state.players[turnSeat].hand,
      ...(state.players[turnSeat].drawnTile ? [state.players[turnSeat].drawnTile] : [])
    ];
    if (state.players[turnSeat].drawnTile) {
      if (!state.players[turnSeat].riichi && canClosedKan(hand)) {
        actions.push({ type: "KAN", by: turnSeat, from: turnSeat, tile: "" });
      }
      const ponTiles = state.players[turnSeat].melds.filter((meld) => meld.kind === "PON").flatMap((meld) => meld.tiles);
      if (!state.players[turnSeat].riichi && ponTiles.length && canAddedKan(hand, ponTiles)) {
        actions.push({ type: "KAN", by: turnSeat, from: turnSeat, tile: "" });
      }
    }
  } else if (state.phase === "AWAITING_CALL" && state.lastDiscard) {
    const { seat: discarder, tile } = state.lastDiscard;
    SEATS.forEach((seat) => {
      if (seat === discarder) return;
      const hand = state.players[seat].hand;
      if (!state.players[seat].riichi && seat === nextSeat(discarder) && canChi(hand, tile)) {
        actions.push({ type: "CHI", by: seat, from: discarder, tile });
      }
      if (!state.players[seat].riichi && canPon(hand, tile)) {
        actions.push({ type: "PON", by: seat, from: discarder, tile });
      }
      if (!state.players[seat].riichi && canKanFromDiscard(hand, tile)) {
        actions.push({ type: "KAN", by: seat, from: discarder, tile });
      }
    });
  }

  if (!viewerSeat) return actions;
  return actions.filter((action) => action.by === viewerSeat);
};

const validateState = (state: GameState): string[] => {
  const errors: string[] = [];
  SEATS.forEach((seat) => {
    const player = state.players[seat];
    const handCount = countNonEmptyTiles(player.hand);
    const drawnCount = player.drawnTile && player.drawnFrom !== "CALL" ? 1 : 0;
    const meldUsedFromHand = player.melds.reduce((sum, meld) => {
      switch (meld.kind) {
        case "CHI":
        case "PON":
          return sum + 2;
        case "MINKAN":
          return sum + 3;
        case "ANKAN":
          return sum + 4;
        case "KAKAN":
          return sum + 3;
        case "KAN":
          return sum + 3;
        default:
          return sum;
      }
    }, 0);
    const base = state.phase === "AFTER_DRAW_MUST_DISCARD" && seat === state.turn ? 14 : 13;
    const expectedBase = Math.max(base - meldUsedFromHand, 0);
    if (handCount + drawnCount !== expectedBase && state.phase !== "ENDED") {
      errors.push(`${seat}の枚数が${handCount + drawnCount}枚です（期待: ${expectedBase}枚）`);
    }
    if (player.riichi && !player.closed) {
      errors.push(`${seat}が副露後にリーチしています`);
    }
  });
  if (state.lastDiscard) {
    const left = nextSeat(state.lastDiscard.seat);
    const invalidChi = state.pendingClaims?.some(
      (claim) => claim.type === "CHI" && claim.by !== left
    );
    if (invalidChi) {
      errors.push("チーは次の席からのみ可能です");
    }
  }
  errors.push(...assertTileConservation(state));
  return errors;
};

const normalizeHandForTenpai = (hand: TileStr[]) =>
  hand
    .filter((tile) => tile && tile !== "BACK")
    .map((tile) => canonicalTile(tile));

const fetchTenpai = async (hand: TileStr[], melds: any[] = [], timeoutMs = 5000) => {
  const canonicalHand = hand.filter((tile) => tile && tile !== "BACK").map((tile) => canonicalTile(tile));
  try {
    const res = await postTenpai(canonicalHand, melds, timeoutMs);
    if (res.ok || canonicalHand.every((tile) => tileNorm(tile) === tile)) return res;
    const normed = canonicalHand.map((tile) => tileNorm(tile));
    return await postTenpai(normed, melds, timeoutMs);
  } catch (err) {
    const normed = canonicalHand.map((tile) => tileNorm(tile));
    if (normed.join(",") === canonicalHand.join(",")) throw err;
    return await postTenpai(normed, melds, timeoutMs);
  }
};

type WinOptionFlags = {
  is_ippatsu: boolean;
  is_rinshan: boolean;
  is_chankan: boolean;
  is_haitei: boolean;
  is_houtei: boolean;
  is_daburu_riichi: boolean;
  is_nagashi_mangan: boolean;
  is_tenhou: boolean;
  is_renhou: boolean;
  is_chiihou: boolean;
  is_open_riichi: boolean;
  paarenchan: boolean;
  doraCount: number;
  uraCount: number;
  akaCount: number;
};


type ScoreContext = {
  player: PlayerState;
  winner: Seat;
  winTile: TileStr;
  winType: "ron" | "tsumo";
  meta: RoundMeta;
};

const buildScoreContext = (meta: RoundMeta, player: PlayerState, winner: Seat, winTile: TileStr, winType: "ron" | "tsumo"): ScoreContext => ({
  player,
  winner,
  winTile,
  winType,
  meta
});

const SCORE_ERROR_LABELS: Record<string, string> = {
  hand_not_winning: "和了形ではない",
  no_yaku: "役なし",
  winning_tile_not_in_hand: "和了牌が手牌にない",
  open_hand_riichi_not_allowed: "副露リーチ不可",
  open_hand_daburi_not_allowed: "副露ダブリー不可",
  ippatsu_without_riichi_not_allowed: "一発条件不一致"
};

const formatScoreFailureDetail = (res: any) => {
  const key = res?.error;
  if (key) return `(${SCORE_ERROR_LABELS[key] ?? key})`;
  if (res?.result?.yaku) return "(役なし)";
  return "(判定失敗)";
};

const SCORE_MELD_VARIANTS: Omit<MeldScoreOptions, "normalizeTile">[] = [
  { collapseKanKind: false, includeCalledTileInTiles: "keep", includeCalledField: true, sortTiles: true },
  { collapseKanKind: true, includeCalledTileInTiles: "keep", includeCalledField: true, sortTiles: true },
  { collapseKanKind: true, includeCalledTileInTiles: "force", includeCalledField: true, sortTiles: true },
  { collapseKanKind: true, includeCalledTileInTiles: "keep", includeCalledField: false, sortTiles: true }
];

const buildScorePayload = (
  context: ScoreContext,
  variant: Omit<MeldScoreOptions, "normalizeTile">,
  tileMode: "canonical" | "norm",
  extraFlags?: WinOptionFlags
): WinPayload => {
  const normalize = tileMode === "norm" ? tileNorm : canonicalTile;
  const baseHand = normalizeHandForScore(context.player.hand, normalize);
  const winTile = normalize(context.winTile);
  const trimmedHand = baseHand;
  const melds = normalizeMeldsForScore(context.player.melds, {
    ...variant,
    normalizeTile: normalize
  });
  const isRiichi = context.player.riichi || Boolean(extraFlags?.is_daburu_riichi || extraFlags?.is_open_riichi);
  const isIppatsu = extraFlags?.is_ippatsu ?? false;
  return {
    hand: trimmedHand,
    melds,
    winTile,
    winType: context.winType,
    isClosed: context.player.closed,
    riichi: isRiichi,
    ippatsu: isIppatsu,
    is_rinshan: extraFlags?.is_rinshan,
    is_chankan: extraFlags?.is_chankan,
    is_haitei: extraFlags?.is_haitei,
    is_houtei: extraFlags?.is_houtei,
    is_daburu_riichi: extraFlags?.is_daburu_riichi,
    is_nagashi_mangan: extraFlags?.is_nagashi_mangan,
    is_tenhou: extraFlags?.is_tenhou,
    is_renhou: extraFlags?.is_renhou,
    is_chiihou: extraFlags?.is_chiihou,
    is_open_riichi: extraFlags?.is_open_riichi,
    paarenchan: extraFlags?.paarenchan ? 1 : 0,
    roundWind: context.meta.wind,
    seatWind: context.winner,
    doraIndicators: getDoraIndicators(context.meta).filter(Boolean).map((tile) => normalize(tile)),
    uraDoraIndicators: getUraDoraIndicators(context.meta).filter(Boolean).map((tile) => normalize(tile)),
    honba: context.meta.honba,
    riichiSticks: context.meta.riichiSticks,
    dealer: context.winner === context.meta.dealer,
    ...(context.winType === "tsumo" ? { menzenTsumo: context.player.closed } : {}),
    ...(SCORE_DEBUG ? { debug: true } : {})
  };
};

const scoreWinWithVariants = async (context: ScoreContext, extraFlags?: WinOptionFlags) => {
  const tried = new Set<string>();
  let firstResult: any = null;
  const attempt = async (variant: Omit<MeldScoreOptions, "normalizeTile">, tileMode: "canonical" | "norm") => {
    const payload = buildScorePayload(context, variant, tileMode, extraFlags);
    const key = JSON.stringify(payload);
    if (tried.has(key)) return null;
    tried.add(key);
    const res = await scoreWin(payload).catch((err) => ({ ok: false, error: String(err) }));
    if (!firstResult) firstResult = res;
    const han = res?.result?.han ?? 0;
    if (res?.ok && han > 0) return res;
    return null;
  };

  const baseVariant = SCORE_MELD_VARIANTS[0];
  const base = await attempt(baseVariant, "canonical");
  if (base) return base;

  for (const tileMode of ["canonical", "norm"] as const) {
    for (const variant of SCORE_MELD_VARIANTS) {
      if (tileMode === "canonical" && variant === baseVariant) continue;
      const res = await attempt(variant, tileMode);
      if (res) return res;
    }
  }
  return firstResult ?? { ok: false, error: "scoreWin failed" };
};

type RemainingTileInfo = {
  tile: string;
  count: number;
};

type LeftToolsProps = {
  wallRemaining: number;
  remainingTiles: RemainingTileInfo[];
  onRemainingTileClick: (tile: string, count: number) => void;
  showRemaining: boolean;
  getTileSrc: (tile: string) => string | null;
};

const LeftTools = ({
  wallRemaining,
  remainingTiles,
  onRemainingTileClick,
  showRemaining,
  getTileSrc
}: LeftToolsProps) => (
  <div className="left-tools">
    {showRemaining && (
      <div className="panel">
        <div className="panel-title">山 : {wallRemaining}</div>
        <div className="remaining-grid">
          {remainingTiles.map(({ tile, count }) => {
            const src = getTileSrc(tile);
            return (
              <Fragment key={`remain-${tile}`}>
                <div
                  className={`remaining-item ${count === 0 ? "empty" : ""}`}
                  onClick={() => onRemainingTileClick(tile, count)}
                >
                  {src ? (
                    <img className="remaining-img" src={src} alt={tile} />
                  ) : (
                    <span className="remaining-tile">{tile}</span>
                  )}
                  <span className="remaining-count">{count}</span>
                </div>
                {tile === "N" && <div className="remaining-break" aria-hidden="true" />}
              </Fragment>
            );
          })}
        </div>
      </div>
    )}
  </div>
);

type RightPanelProps = {
  showButtons: boolean;
  initialLocked: boolean;
  onRandomHands: () => void;
  onLogClear: () => void;
  onClearHands: () => void;
  onLogExport: () => void;
  onUndo: () => void;
  undoDisabled: boolean;
  onPickDora: (index: number) => void;
  doraDisplayTiles: TileStr[];
  doraRevealedCount: number;
  getTileSrc: (tile: string) => string | null;
  settingsDraft: SettingsDraft | null;
  onUpdateSettingsDraft: (updates: Partial<SettingsDraft>) => void;
  tenpaiChecking: boolean;
  tenpaiError: string | null;
  rulesErrors: string[];
  actionLog: string[];
};


const RightPanel = ({
  showButtons,
  initialLocked,
  onRandomHands,
  onLogClear,
  onClearHands,
  onLogExport,
  onUndo,
  undoDisabled,
  onPickDora,
  doraDisplayTiles,
  doraRevealedCount,
  getTileSrc,
  settingsDraft,
  onUpdateSettingsDraft,
  tenpaiChecking,
  tenpaiError,
  rulesErrors,
  actionLog
}: RightPanelProps) => (
  <div className="right">
    <div className="panel">
      {showButtons && (
        <div className="button-grid">
          <button className="action-button" onClick={onRandomHands} disabled={initialLocked}>
            ランダム配牌
          </button>

          <button className="action-button" onClick={onLogClear}>
            ログクリア
          </button>
          <button className="action-button" onClick={onClearHands} disabled={initialLocked}>
            配牌クリア
          </button>
          <button className="action-button" onClick={onLogExport}>
            ログ出力
          </button>
          <button className="action-button" onClick={onUndo} disabled={undoDisabled}>
            元に戻す
          </button>
        </div>
        )}
      <div className="info compact">
        <div className="info-section">
          {settingsDraft && (
            <div className="settings-wrap">
              <div className="settings-grid settings-grid-compact">
                <label className="settings-field">
                  局
                  <select
                    value={roundIndexFromMeta(settingsDraft.wind, settingsDraft.kyoku)}
                    onChange={(e) => {
                      const next = roundMetaFromIndex(Number(e.target.value));
                      onUpdateSettingsDraft({ wind: next.wind, kyoku: next.kyoku });
                    }}
                    className="settings-select"
                  >
                    {ROUND_OPTIONS.map((option) => (
                      <option key={`round-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  本場
                  <input
                    type="number"
                    value={settingsDraft.honba}
                    onChange={(e) => onUpdateSettingsDraft({ honba: Number(e.target.value) })}
                    className="settings-input"
                  />
                </label>
                <label className="settings-field">
                  供託
                  <input
                    type="number"
                    value={settingsDraft.riichiSticks}
                    onChange={(e) => onUpdateSettingsDraft({ riichiSticks: Number(e.target.value) })}
                    className="settings-input"
                  />
                </label>
              </div>
            </div>
          )}
          <div className="dora-display">
            <div className="dora-tiles">
              {Array.from({ length: 5 }, (_, idx) => {
                const tile = doraDisplayTiles[idx] ?? "";
                const revealed = idx < doraRevealedCount && tile;
                const src = revealed ? getTileSrc(tile) : null;
                return (
                  <button
                    key={`dora-${idx}`}
                    type="button"
                    onClick={() => onPickDora(idx)}
                    className={`picker-tile dora-tile ${src ? "" : "dora-tile-back"}`}
                    style={src ? { backgroundImage: `url(${src})` } : undefined}
                  >
                    {!src && ""}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {tenpaiChecking && <div>判定中...</div>}
        {tenpaiError && <div>{tenpaiError}</div>}
        {rulesErrors.length > 0 && <div>牌枚数の不整合があります</div>}
        <div className="action-log">
        {actionLog.length === 0 && <div>ログなし</div>}
        {actionLog.map((line, idx) => (
          <div key={`log-${idx}`}>{line}</div>
        ))}
        </div>
      </div>
    </div>
  </div>
);

type PickerModalProps = {
  open: boolean;
  kind: "hand" | "dora" | "ura" | "rinshan" | "draw";
  anchorPosition?: "above" | "below" | null;
  isTileAvailable: (tile: string) => boolean;
  remainingCount: (tile: string) => number;
  tileToAsset: (tile: string) => string | null;
  onSelect: (tile: string | null) => void;
  onClose: () => void;
};

const PickerModal = ({
  open,
  kind,
  anchorPosition,
  isTileAvailable,
  remainingCount,
  tileToAsset,
  onSelect,
  onClose
}: PickerModalProps) => {
  if (!open) return null;
  const tiles = kind === "dora" || kind === "ura" ? [...TILE_CHOICES, "BACK"] : TILE_CHOICES;
  const anchorClass =
    anchorPosition === "above"
      ? "picker-backdrop picker-backdrop--above"
      : anchorPosition === "below"
        ? "picker-backdrop picker-backdrop--below"
        : "picker-backdrop";

  return (
    <div className={anchorClass} onClick={onClose} role="presentation">
      <div className="picker-modal" onClick={(e) => e.stopPropagation()} role="presentation">
        <div className="picker-title">牌選択</div>
        <div className="picker-grid">
          {tiles.map((tile) => {
            const src = tile === "BACK" ? null : tileToAsset(tile);
            const disabled = tile === "BACK" ? false : !isTileAvailable(tile);
            const remaining = tile === "BACK" ? 0 : remainingCount(tile);
            return (
              <button
                key={tile}
                className={`picker-tile ${tile === "BACK" ? "back" : ""}`}
                style={src ? { backgroundImage: `url(${src})` } : undefined}
                onClick={() => onSelect(tile === "BACK" ? "BACK" : tile)}
                disabled={disabled}
                type="button"
              >
                {tile !== "BACK" && <span className="picker-count">{remaining}</span>}
              </button>
            );
          })}
        </div>
        <div className="picker-actions">
          <button className="picker-clear" onClick={() => onSelect(null)} type="button">
            空白に戻す
          </button>
          <button className="picker-close" onClick={onClose} type="button">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};

type WinOptionKey = keyof Omit<WinOptionFlags, "doraCount" | "uraCount" | "akaCount">;

const WIN_OPTION_FIELDS: { key: WinOptionKey; label: string }[] = [
  { key: "is_ippatsu", label: "一発" },
  { key: "is_rinshan", label: "嶺上開花" },
  { key: "is_chankan", label: "槍槓" },
  { key: "is_haitei", label: "ハイテイ" },
  { key: "is_houtei", label: "ホウテイ" },
  { key: "is_daburu_riichi", label: "ダブル立直" },
  { key: "is_nagashi_mangan", label: "流し満貫" },
  { key: "is_tenhou", label: "天和" },
  { key: "is_renhou", label: "人和" },
  { key: "is_chiihou", label: "地和" },
  { key: "is_open_riichi", label: "オープン立直" },
  { key: "paarenchan", label: "八連荘" }
];

type WinOptionsModalProps = {
  open: boolean;
  winType: "ron" | "tsumo" | null;
  options: WinOptionFlags;
  doraIndicators: TileStr[];
  showUraIndicators: boolean;
  uraDoraIndicators: TileStr[];
  doraRevealedCount: number;
  getTileSrc: (tile: string) => string | null;
  onPickDora: (index: number) => void;
  onPickUra: (index: number) => void;
  onChange: (next: WinOptionFlags) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

const WinOptionsModal = ({
  open,
  winType,
  options,
  doraIndicators,
  showUraIndicators,
  uraDoraIndicators,
  doraRevealedCount,
  getTileSrc,
  onPickDora,
  onPickUra,
  onChange,
  onConfirm,
  onCancel
}: WinOptionsModalProps) => {
  if (!open) return null;
  return (
    <div className="win-options-backdrop" onClick={onCancel} role="presentation">
      <div className="win-options-modal" onClick={(e) => e.stopPropagation()} role="presentation">
        <div className="win-options-title">
          {winType === "ron" ? "ロン" : winType === "tsumo" ? "ツモ" : "和了"}: 追加役
        </div>
        <div className="win-options-grid">
          {WIN_OPTION_FIELDS.map((field) => (
            <label key={field.key} className="win-option">
              <input
                type="checkbox"
                checked={options[field.key]}
                onChange={(e) => onChange({ ...options, [field.key]: e.target.checked })}
              />
              <span>{field.label}</span>
            </label>
          ))}
        </div>
        <div className="win-options-ura">
          <div className="win-options-title">ドラ</div>
          <div className="dora-tiles">
            {Array.from({ length: 5 }, (_, idx) => {
              const indicator = doraIndicators[idx] ?? "";
              const revealed = idx < doraRevealedCount && indicator;
              const src = revealed ? getTileSrc(indicator) : null;
              return (
                <button
                  key={`win-dora-${idx}`}
                  type="button"
                  onClick={() => onPickDora(idx)}
                  className={`picker-tile dora-tile ${src ? "" : "dora-tile-back"}`}
                  style={src ? { backgroundImage: `url(${src})` } : undefined}
                >
                  {!src && ""}
                </button>
              );
            })}
          </div>
        </div>
        {showUraIndicators && (
          <div className="win-options-ura">
            <div className="win-options-title">裏ドラ</div>
            <div className="dora-tiles dora-tiles-ura">
              {Array.from({ length: 5 }, (_, idx) => {
                const indicator = uraDoraIndicators[idx] ?? "";
                const revealed = idx < doraRevealedCount && indicator;
                const src = revealed ? getTileSrc(indicator) : null;
                return (
                  <button
                    key={`win-ura-${idx}`}
                    type="button"
                    onClick={() => onPickUra(idx)}
                    className={`picker-tile dora-tile ${src ? "" : "dora-tile-back"}`}
                    style={src ? { backgroundImage: `url(${src})` } : undefined}
                  >
                    {!src && ""}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="win-options-actions">
          <button className="picker-close" type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button className="picker-clear" type="button" onClick={onConfirm}>
            決定
          </button>
        </div>
      </div>
    </div>
  );
};

type SettingsDraft = {
  wind: Seat;
  kyoku: number;
  honba: number;
  riichiSticks: number;
  doraIndicators: string;
  uraDoraIndicators: string;
};

type WinInfo = {
  seat: Seat;
  tile: string;
  type: "ron" | "tsumo";
  result?: any;
  from?: Seat;
  doraCounts?: DoraCounts;
};

type UndoSnapshot = {
  ui: GameUiState;
  pendingRinshan: Seat | null;
};

type GameUiState = {
  gameState: GameState | null;
  actionLog: string[];
  actionIndex: number;
  junmeCount: number;
  selectedDiscard: TileStr | null;
  pendingRiichi: boolean;
  riichiDiscards: Record<Seat, number | null>;
  winInfo: WinInfo | null;
};

type GameUiAction =
  | { type: "SET_FIELD"; field: keyof GameUiState; value: GameUiState[keyof GameUiState] }
  | { type: "UPDATE_FIELD"; field: keyof GameUiState; updater: (prev: any) => any }
  | { type: "RESET"; state: GameUiState };

const emptyRiichiDiscards = (): Record<Seat, number | null> => ({
  E: null,
  S: null,
  W: null,
  N: null
});

const initialGameUiState: GameUiState = {
  gameState: null,
  actionLog: [],
  actionIndex: 0,
  junmeCount: 0,
  selectedDiscard: null,
  pendingRiichi: false,
  riichiDiscards: emptyRiichiDiscards(),
  winInfo: null
};

const gameUiReducer = (state: GameUiState, action: GameUiAction): GameUiState => {
  switch (action.type) {
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };
    case "UPDATE_FIELD":
      return { ...state, [action.field]: action.updater(state[action.field]) };
    case "RESET":
      return { ...action.state };
    default:
      return state;
  }
};

const SEAT_LIST: Seat[] = SEATS;

const stripTiles = (tiles: TileStr[]) => tiles.filter((tile) => tile && tile !== "BACK" && tile !== "PLACEHOLDER");

const extractHands = (state: GameState): Record<Seat, TileStr[]> => ({
  E: state.players.E.hand,
  S: state.players.S.hand,
  W: state.players.W.hand,
  N: state.players.N.hand
});

const mergeHandsForOverrides = (
  overrides: Record<Seat, TileStr[]> | undefined,
  baseHands?: Record<Seat, TileStr[]>
) => {
  if (!overrides) return undefined;
  const merged: Record<Seat, TileStr[]> = { E: [], S: [], W: [], N: [] };
  SEAT_LIST.forEach((seat) => {
    const base = overrides[seat] ?? baseHands?.[seat] ?? Array(13).fill("");
    merged[seat] = base;
  });
  return merged;
};

const splitDisplayTiles = (state: GameState, seat: Seat) => {
  const base = sortTiles(state.players[seat].hand);
  const drawn = state.players[seat].drawnTile ?? null;
  return { tiles: base.slice(0, 13), drawn };
};

const buildSettingsDraft = (meta: RoundMeta): SettingsDraft => ({
  wind: meta.wind,
  kyoku: meta.kyoku,
  honba: meta.honba,
  riichiSticks: meta.riichiSticks,
  doraIndicators: (meta.doraIndicators ?? []).filter(Boolean).join(","),
  uraDoraIndicators: (meta.uraDoraIndicators ?? []).filter(Boolean).join(",")
});

const parseTiles = (input: string) =>
  input
    .split(",")
    .map((tile) => tile.trim())
    .filter((tile) => tile.length > 0)
    .map((tile) => TileOps.canonicalTile(tile));

const countTilesInState = (state: GameState) => {
  const counts: Record<string, number> = {};
  const add = (tile: string) => {
    const key = TileOps.tileKeyForCount(TileOps.canonicalTile(tile));
    if (!key) return;
    counts[key] = (counts[key] ?? 0) + 1;
  };
  SEAT_LIST.forEach((seat) => {
    const player = state.players[seat];
    player.hand.forEach(add);
    if (player.drawnTile && player.drawnFrom !== "CALL") add(player.drawnTile);
    player.discards.forEach(add);
    player.melds.forEach((meld) => meld.tiles.forEach(add));
  });
  (state.meta.doraIndicators ?? []).forEach(add);
  return counts;
};

const buildWallStateFromState = (state: GameState) => {
  const counts = countTilesInState(state);
  const pool: TileStr[] = [];
  TILE_CHOICES.forEach((tile) => {
    const key = tileKeyForCount(tile);
    if (!key) return;
    const limit = TILE_LIMITS[key] ?? 0;
    const used = counts[key] ?? 0;
    const remaining = Math.max(limit - used, 0);
    for (let i = 0; i < remaining; i += 1) {
      pool.push(canonicalTile(tile));
    }
  });
  shuffleInPlace(pool);
  const liveWall = [...pool];
  const deadWall: TileStr[] = [];
  return { liveWall, deadWall };
};

const popWallTile = (wall: TileStr[]) => {
  const next = [...wall];
  const tile = next.pop() ?? "";
  return { tile, next };
};

const removeWallTile = (wall: TileStr[], tile: TileStr) => {
  const next = [...wall];
  let idx = next.findIndex((t) => t === tile);
  if (idx < 0) idx = next.findIndex((t) => tileEq(t, tile));
  if (idx < 0) return { tile: "", next, found: false };
  const removed = next.splice(idx, 1)[0] ?? "";
  return { tile: removed, next, found: true };
};

const TileOps = {
  canonicalTile,
  tileNorm,
  tileEq,
  tileKeyForCount,
  tileToAsset,
  sortTiles,
  buildTileDeck,
  shuffleInPlace,
  removeOneExactThenNorm,
  takeTilesExactThenNorm,
  stripTiles,
  countNonEmptyTiles
};

const WallOps = {
  buildWallStateFromState,
  popWallTile,
  removeWallTile,
  countTilesInState
};

const getWallRemaining = (meta: RoundMeta) => (meta.liveWall ? meta.liveWall.length : 0);

const assertTileConservation = (state: GameState) => {
  const errors: string[] = [];
  if (!state.meta.liveWall || !state.meta.deadWall) return errors;
  const counts: Record<string, number> = {};
  const add = (tile: string) => {
    const key = TileOps.tileKeyForCount(TileOps.canonicalTile(tile));
    if (!key) return;
    counts[key] = (counts[key] ?? 0) + 1;
  };
  SEAT_LIST.forEach((seat) => {
    const player = state.players[seat];
    player.hand.forEach(add);
    if (player.drawnTile && player.drawnFrom !== "CALL") add(player.drawnTile);
    player.melds.forEach((meld) => meld.tiles.forEach(add));
    player.discards.forEach(add);
  });
  (state.meta.doraIndicators ?? []).forEach(add);
  state.meta.liveWall.forEach(add);
  state.meta.deadWall.forEach(add);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const doraCount = (state.meta.doraIndicators ?? [])
    .map((tile) => TileOps.tileKeyForCount(TileOps.canonicalTile(tile)))
    .filter((key): key is string => Boolean(key)).length;
  if (total !== TOTAL_TILES && total - doraCount !== TOTAL_TILES) {
    errors.push(`牌総数が${total}枚です（期待: ${TOTAL_TILES}枚）`);
  }
  Object.keys(counts).forEach((key) => {
    const limit = TILE_LIMITS[key] ?? 0;
    if (counts[key] > limit) {
      errors.push(`${key}が${counts[key]}枚（上限${limit}枚）`);
    }
  });
  return errors;
};

const checkTileConservation = (state: GameState, label: string) => {
  const errors = assertTileConservation(state);
  if (errors.length) {
    console.warn(`[tile-conservation:${label}]`, errors);
  }
  return errors;
};

const expectedHandCountBeforeDraw = (player: PlayerState) => {
  // このアプリでは副露1組につき手牌の実枚数が3枚ずつ減る表現で保持している。
  return Math.max(13 - player.melds.length * 3, 0);
};

const pickRandomAvailableTile = (state: GameState) => {
  const counts = countTilesInState(state);
  const pool: string[] = [];
  TILE_CHOICES.forEach((tile) => {
    const key = TileOps.tileKeyForCount(TileOps.canonicalTile(tile));
    if (!key) return;
    const limit = TILE_LIMITS[key] ?? 0;
    const used = counts[key] ?? 0;
    const remaining = Math.max(limit - used, 0);
    for (let i = 0; i < remaining; i += 1) {
      pool.push(tile);
    }
  });
  if (!pool.length) return "";
  return pool[Math.floor(Math.random() * pool.length)];
};

const ENABLE_RANDOM_FALLBACK = false;

const removeTiles = (hand: TileStr[], tilesToRemove: TileStr[]) => {
  let remaining = [...hand];
  tilesToRemove.forEach((tile) => {
    remaining = removeOneExactThenNorm(remaining, tile);
  });
  return sortTiles(remaining);
};

const removeTilesFromWall = (wall: TileStr[], tiles: TileStr[]) => {
  let next = [...wall];
  tiles.forEach((tile) => {
    if (!tile) return;
    const removed = WallOps.removeWallTile(next, tile);
    if (removed.found) next = removed.next;
  });
  return next;
};

const removeTilesFromWallExact = (wall: TileStr[], tiles: TileStr[]) => {
  let next = [...wall];
  tiles.forEach((tile) => {
    if (!tile) return;
    const idx = next.findIndex((t) => t === tile);
    if (idx >= 0) {
      next.splice(idx, 1);
    }
  });
  return next;
};

const removeLastDiscard = (discards: TileStr[], tile: TileStr) => {
  for (let i = discards.length - 1; i >= 0; i -= 1) {
    if (tileEq(discards[i], tile)) {
      return [...discards.slice(0, i), ...discards.slice(i + 1)];
    }
  }
  return discards;
};

type MeldScoreOptions = {
  collapseKanKind: boolean;
  includeCalledTileInTiles: "keep" | "force" | "remove";
  includeCalledField: boolean;
  sortTiles: boolean;
  normalizeTile: (tile: string) => string;
};

const normalizeMeldKindForScore = (kind: Meld["kind"], collapseKanKind: boolean) => {
  const upper = kind?.toUpperCase?.() ?? kind;
  if (upper === "CHI" || upper === "PON") return upper as Meld["kind"];
  if (upper === "KAN" || upper === "ANKAN" || upper === "MINKAN" || upper === "KAKAN") {
    return (collapseKanKind ? "KAN" : upper) as Meld["kind"];
  }
  return (collapseKanKind ? "KAN" : upper) as Meld["kind"];
};

const normalizeMeldTilesForScore = (meld: Meld, options: MeldScoreOptions) => {
  const normalize = options.normalizeTile;
  let tiles = (meld.tiles ?? []).map((tile) => normalize(tile));
  const called = meld.calledTile ? normalize(meld.calledTile) : "";
  if (options.includeCalledTileInTiles === "remove" && called) {
    const idx = tiles.findIndex((tile) => tileEq(tile, called));
    if (idx >= 0) tiles.splice(idx, 1);
  } else if (options.includeCalledTileInTiles === "force" && called) {
    if (!tiles.some((tile) => tileEq(tile, called))) {
      tiles.push(called);
    }
  }
  if (options.sortTiles) {
    tiles = sortTiles(tiles);
  }
  return tiles;
};

const normalizeMeldsForTenpai = (melds: Meld[]): Meld[] =>
  melds.map((meld) => {
    const kindUpper = meld.kind.toUpperCase();
    const kind =
      kindUpper === "CHI"
        ? "CHI"
        : kindUpper === "PON"
          ? "PON"
          : "KAN";
    return {
      ...meld,
      kind: kind as Meld["kind"],
      tiles: (meld.tiles ?? []).map((tile) => TileOps.canonicalTile(tile)),
      calledTile: meld.calledTile ? TileOps.canonicalTile(meld.calledTile) : meld.calledTile,
      open: meld.open ?? true
    };
  });

const normalizeMeldsForScore = (melds: Meld[], options: MeldScoreOptions): Meld[] =>
  melds.map((meld) => {
    const normalizedKind = normalizeMeldKindForScore(meld.kind, options.collapseKanKind);
    const tiles = normalizeMeldTilesForScore(meld, options);
    const calledTile = meld.calledTile ? options.normalizeTile(meld.calledTile) : meld.calledTile;
    return {
      ...meld,
      kind: normalizedKind,
      tiles,
      calledTile: options.includeCalledField ? calledTile : undefined,
      calledFrom: options.includeCalledField ? meld.calledFrom : undefined,
      open: meld.open ?? true
    };
  });

const normalizeHandForScore = (hand: TileStr[], normalize: (tile: string) => string) =>
  stripTiles(hand).map((tile) => normalize(tile));

const formatYakuList = (yaku: unknown) => {
  if (!Array.isArray(yaku)) return "";
  return yaku.filter((item) => typeof item === "string").join(", ");
};

const formatScoreLine = (result: any) => {
  if (!result) return "";
  const han = result.han ?? 0;
  const fu = result.fu ?? 0;
  const cost = result.cost ?? null;
  const costText = cost
    ? cost.additional
      ? `(${cost.main}/${cost.additional})`
      : `(${cost.main ?? 0})`
    : "";
  const yakuText = formatYakuList(result.yaku);
  const yakuLabel = yakuText ? ` 役:${yakuText}` : "";
  return `${han}翻 ${fu}符 ${costText}${yakuLabel}`.trim();
};

const calculateCostFromHanFu = (
  han: number,
  fu: number,
  winType: "ron" | "tsumo",
  isDealer: boolean
) => {
  if (!Number.isFinite(han) || han <= 0) return null;
  const safeFu = Number.isFinite(fu) ? fu : 0;
  const limitTier = getLimitTier(han, safeFu);
  const round100 = (value: number) => Math.ceil(value / 100) * 100;
  const basePoints = (() => {
    if (limitTier === "満貫") return 2000;
    if (limitTier === "跳満") return 3000;
    if (limitTier === "倍満") return 4000;
    if (limitTier === "三倍満") return 6000;
    if (limitTier === "役満") return 8000;
    if (safeFu <= 0) return null;
    return safeFu * Math.pow(2, han + 2);
  })();
  if (basePoints == null) return null;
  if (winType === "ron") {
    const pay = round100(basePoints * (isDealer ? 6 : 4));
    return { main: pay };
  }
  if (isDealer) {
    const pay = round100(basePoints * 2);
    return { main: pay };
  }
  return {
    main: round100(basePoints * 2),
    additional: round100(basePoints)
  };
};


const sanitizeDoraCounts = (options?: WinOptionFlags): DoraCounts | null => {
  if (!options) return null;
  const hasAny =
    typeof options.doraCount === "number" ||
    typeof options.uraCount === "number" ||
    typeof options.akaCount === "number";
  if (!hasAny) return null;
  const normalize = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);
  return {
    dora: normalize(options.doraCount ?? 0),
    ura: normalize(options.uraCount ?? 0),
    aka: normalize(options.akaCount ?? 0)
  };
};

const extractDoraCountsFromYaku = (yaku: unknown): DoraCounts => {
  if (!Array.isArray(yaku)) return { dora: 0, ura: 0, aka: 0 };
  const counts = { dora: 0, ura: 0, aka: 0 };
  yaku.forEach((item) => {
    if (typeof item !== "string") return;
    const normalized = item.replace(/[\s_-]+/g, "").toLowerCase();
    if (normalized.includes("akadora")) {
      counts.aka += 1;
      return;
    }
    if (normalized.includes("uradora")) {
      counts.ura += 1;
      return;
    }
    if (normalized.includes("dora")) {
      counts.dora += 1;
    }
  });
  return counts;
};

const applyDoraOverridesToResult = (
  result: any,
  context: ScoreContext,
  options?: WinOptionFlags
) => {
  if (!result) return result;
  const hasRiichi =
    context.player.riichi || Boolean(options?.is_daburu_riichi || options?.is_open_riichi);
  const target =
    sanitizeDoraCounts(options) ??
    computeDoraCountsForWin(context.meta, context.player, context.winTile, hasRiichi);
  const resultCounts = extractDoraCountsFromYaku(result.yaku);
  const resultTotal = resultCounts.dora + resultCounts.ura + resultCounts.aka;
  const targetTotal = target.dora + target.ura + target.aka;
  const nextHan = Math.max(0, (result.han ?? 0) - resultTotal + targetTotal);
  const nextCost =
    nextHan > 0
      ? calculateCostFromHanFu(nextHan, result.fu ?? 0, context.winType, context.winner === context.meta.dealer)
      : result.cost;
  return {
    ...result,
    han: nextHan,
    cost: nextCost ?? result.cost,
    yaku: rebuildDoraYakuList(result.yaku, target)
  };
};

const LOG_TILE_LABELS: Record<string, string> = {
  E: "ton",
  S: "nan",
  W: "sha",
  N: "pei",
  P: "hak",
  F: "hat",
  C: "chu"
};

const formatTileForLog = (tile: string) => {
  const canon = canonicalTile(tile);
  if (!canon) return "";
  if (canon.length === 1) return LOG_TILE_LABELS[canon] ?? canon;
  return canon;
};

const formatSeatForLog = (seat: Seat) => WIND_LABELS[seat] ?? seat;

const SEAT_LABEL_TO_SEAT: Record<string, Seat> = {
  東: "E",
  南: "S",
  西: "W",
  北: "N"
};

const formatLogCode = (code: number) => String(code).padStart(2, "0");

const buildCallLogToken = (
  kind: "CHI" | "PON" | "MINKAN" | "ANKAN" | "KAKAN",
  meld: Meld
) => {
  const orderedTiles = [...(meld.tiles ?? [])];
  const codes = orderedTiles
    .map(tileToLogCode)
    .filter((code): code is number => typeof code === "number");
  if (!codes.length) return null;
  if (kind === "CHI") {
    return `c${codes.map(formatLogCode).join("")}`;
  }
  const marker = kind === "PON" ? "p" : kind === "MINKAN" ? "m" : kind === "ANKAN" ? "a" : "k";
  let calledIndex = -1;
  if (meld.by && meld.calledFrom) {
    const idx = calledIndexFor(meld.by, meld.calledFrom, orderedTiles.length);
    if (typeof idx === "number") calledIndex = idx;
  }
  if (calledIndex < 0 && meld.calledTile) {
    const idx = orderedTiles.findIndex((tile) => tileEq(tile, meld.calledTile!));
    if (idx >= 0) calledIndex = idx;
  }
  if (kind === "ANKAN" || kind === "KAKAN") {
    const target = meld.calledTile ?? orderedTiles[orderedTiles.length - 1];
    const lastIdx = target
      ? [...orderedTiles]
          .map((tile, idx) => ({ tile, idx }))
          .reverse()
          .find((item) => tileEq(item.tile, target))?.idx ?? -1
      : -1;
    if (lastIdx >= 0) calledIndex = lastIdx;
  }
  if (calledIndex < 0) calledIndex = 0;
  return codes
    .map((code, idx) => (idx === calledIndex ? `${marker}${formatLogCode(code)}` : formatLogCode(code)))
    .join("");
};

const tileLabel = (tile: string) => TileOps.canonicalTile(tile);

const uniqueTileCombos = (combos: TileStr[][]) => {
  const unique = new Map<string, TileStr[]>();
  combos.forEach((combo) => {
    const key = [...combo].sort().join("|");
    if (!unique.has(key)) unique.set(key, combo);
  });
  return [...unique.values()];
};

const isValidChiTiles = (tile: TileStr, pair: TileStr[]) => {
  if (pair.length !== 2) return false;
  const canon = TileOps.canonicalTile(tile);
  if (canon.length !== 2 || !"mps".includes(canon[1])) return false;
  const suit = canon[1];
  const n = Number(canon[0] === "0" ? "5" : canon[0]);
  const nums = pair.map((p) => {
    const c = TileOps.canonicalTile(p);
    if (c.length !== 2 || c[1] !== suit) return null;
    return Number(c[0] === "0" ? "5" : c[0]);
  });
  if (nums.some((v) => v === null)) return false;
  const sorted = (nums as number[]).slice().sort((a, b) => a - b);
  const [a, b] = sorted;
  return (
    (a === n - 2 && b === n - 1) ||
    (a === n - 1 && b === n + 1) ||
    (a === n + 1 && b === n + 2)
  );
};

const collectMatchingCombos = (hand: TileStr[], tile: TileStr, count: number) => {
  const matches = hand.filter((t) => t && tileEq(t, tile));
  if (matches.length < count) return [];
  if (count === 1) return matches.map((t) => [t]);
  const combos: TileStr[][] = [];
  if (count === 2) {
    for (let i = 0; i < matches.length - 1; i += 1) {
      for (let j = i + 1; j < matches.length; j += 1) {
        combos.push([matches[i], matches[j]]);
      }
    }
  } else if (count === 3) {
    for (let i = 0; i < matches.length - 2; i += 1) {
      for (let j = i + 1; j < matches.length - 1; j += 1) {
        for (let k = j + 1; k < matches.length; k += 1) {
          combos.push([matches[i], matches[j], matches[k]]);
        }
      }
    }
  }
  return uniqueTileCombos(combos);
};

const getChiCandidates = (hand: TileStr[], tile: TileStr) => {
  const canon = TileOps.canonicalTile(tile);
  if (canon.length !== 2 || !"mps".includes(canon[1])) return [];
  const suit = canon[1];
  const n = Number(canon[0] === "0" ? "5" : canon[0]);
  const combos: [number, number][] = [
    [n - 2, n - 1],
    [n - 1, n + 1],
    [n + 1, n + 2]
  ];
  const results: TileStr[][] = [];
  for (const [a, b] of combos) {
    if (a < 1 || b > 9) continue;
    const aMatches = hand.filter((t) => tileEq(t, `${a}${suit}`));
    const bMatches = hand.filter((t) => tileEq(t, `${b}${suit}`));
    if (!aMatches.length || !bMatches.length) continue;
    for (const aTile of aMatches) {
      for (const bTile of bMatches) {
        results.push([aTile, bTile]);
      }
    }
  }
  return uniqueTileCombos(results).filter((pair) => isValidChiTiles(tile, pair));
};

const pickChiTiles = (hand: TileStr[], tile: TileStr) => {
  const candidates = getChiCandidates(hand, tile);
  return candidates.length ? candidates[0] : null;
};

const pickAddedKanTile = (hand: TileStr[], melds: { kind: string; tiles: TileStr[] }[]) => {
  const counts: Record<string, number> = {};
  hand.forEach((tile) => {
    if (!tile) return;
    const key = tileNorm(tile);
    counts[key] = (counts[key] ?? 0) + 1;
  });
  for (const meld of melds) {
    if (meld.kind !== "PON") continue;
    const tile = meld.tiles[0];
    const key = tileNorm(tile);
    if (tile && counts[key] >= 1) return tile;
  }
  return null;
};

const buildMeldTilesForCall = (
  type: "CHI" | "PON" | "KAN",
  by: Seat,
  from: Seat,
  tile: TileStr,
  usedTiles: TileStr[]
) => {
  const size = type === "KAN" ? 4 : 3;
  const insertIndex = type === "CHI" ? 0 : calledIndexFor(by, from, size) ?? 1;
  const base = sortTiles(usedTiles);
  const list = [...base];
  list.splice(insertIndex, 0, tile);
  return list;
};


export const App = () => {
  const [kifu, setKifu] = useState<Kifu | null>(null);
  const [roundIndex, setRoundIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [handOverrides, setHandOverrides] = useState<Record<string, Record<Seat, string[]>>>({});
  const [doraOverrides, setDoraOverrides] = useState<Record<string, string[]>>({});
  const [uraOverrides, setUraOverrides] = useState<Record<string, string[]>>({});
  const [gameUi, dispatchGameUi] = useReducer(gameUiReducer, initialGameUiState);
  const { gameState, actionLog, actionIndex, junmeCount, selectedDiscard, pendingRiichi, riichiDiscards, winInfo } =
    gameUi;
  const setGameUiField = <K extends keyof GameUiState>(field: K) =>
    (value: GameUiState[K] | ((prev: GameUiState[K]) => GameUiState[K])) => {
      if (typeof value === "function") {
        dispatchGameUi({ type: "UPDATE_FIELD", field, updater: value });
      } else {
        dispatchGameUi({ type: "SET_FIELD", field, value });
      }
    };
  const resetGameUi = (overrides: Partial<GameUiState> = {}) => {
    dispatchGameUi({ type: "RESET", state: { ...initialGameUiState, ...overrides } });
  };
  const setGameState = setGameUiField("gameState");
  const setActionLog = setGameUiField("actionLog");
  const setActionIndex = setGameUiField("actionIndex");
  const setJunmeCount = setGameUiField("junmeCount");
  const setSelectedDiscard = setGameUiField("selectedDiscard");
  const [waitsBySeat, setWaitsBySeat] = useState<Record<Seat, TileStr[]>>({
    E: [],
    S: [],
    W: [],
    N: []
  });
  const [shantenBySeat, setShantenBySeat] = useState<Record<Seat, number | null>>({
    E: null,
    S: null,
    W: null,
    N: null
  });
  const [riichiOptions, setRiichiOptions] = useState<TileStr[]>([]);
  const setPendingRiichi = setGameUiField("pendingRiichi");
  const pushUndo = () => {
    if (!gameState) return;
    const next = [...undoStackRef.current, { ui: cloneState(gameUi), pendingRinshan }];
    if (next.length > 30) next.shift();
    undoStackRef.current = next;
    setUndoCount(next.length);
  };
  const undoLast = () => {
    const stack = undoStackRef.current;
    if (!stack.length) return;
    const snapshot = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    setUndoCount(undoStackRef.current.length);
    undoGuardRef.current = true;
    dispatchGameUi({ type: "RESET", state: snapshot.ui });
    setPendingRinshan(snapshot.pendingRinshan);
    setWinOptionsOpen(false);
    setPendingWin(null);
    setTimeout(() => {
      undoGuardRef.current = false;
    }, 0);
  };
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const settingsInitRef = useRef(false);
  const [seatNames, setSeatNames] = useState<Record<Seat, string>>({
    E: "プレイヤー1",
    S: "プレイヤー2",
    W: "プレイヤー3",
    N: "プレイヤー4"
  });
  const [metaOverrides, setMetaOverrides] = useState<Partial<RoundMeta> | null>(null);
  const [tenpaiChecking, setTenpaiChecking] = useState(false);
  const [tenpaiError, setTenpaiError] = useState<string | null>(null);
  const [tenpaiFlags, setTenpaiFlags] = useState<Record<Seat, boolean>>({
    E: false,
    S: false,
    W: false,
    N: false
  });
  const setRiichiDiscards = setGameUiField("riichiDiscards");
  const setWinInfo = setGameUiField("winInfo");
  const appendActionLog = (lines: string | string[]) => {
    const list = Array.isArray(lines) ? lines : [lines];
    setActionLog((prev) => [...prev, ...list]);
    setActionIndex((prev) => prev + 1);
  };
  const appendScoreDebug = (res: any) => {
    const debug = res?.debug;
    if (!Array.isArray(debug) || debug.length === 0) return;
    appendActionLog(debug);
  };
  const tenpaiCacheRef = useRef(new Map<string, { waits: TileStr[]; shanten?: number; ok?: boolean; error?: string }>());

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKind, setPickerKind] = useState<"hand" | "dora" | "ura" | "rinshan" | "draw">("hand");
  const [pickerSeat, setPickerSeat] = useState<Seat>("E");
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [callPickerOpen, setCallPickerOpen] = useState(false);
  const [callPickerOptions, setCallPickerOptions] = useState<CallMeldOption[]>([]);
  const [pickerBatch, setPickerBatch] = useState<{ active: boolean; firstIndex: number | null }>({
    active: false,
    firstIndex: null
  });
  const imageImportRef = useRef<HTMLInputElement | null>(null);
  const [imageImportSeat, setImageImportSeat] = useState<Seat | null>(null);
  const imageImportSeatRef = useRef<Seat | null>(null);
  const [imageImportBusy, setImageImportBusy] = useState(false);
  const defaultWinOptions: WinOptionFlags = {
    is_ippatsu: false,
    is_rinshan: false,
    is_chankan: false,
    is_haitei: false,
    is_houtei: false,
    is_daburu_riichi: false,
    is_nagashi_mangan: false,
    is_tenhou: false,
    is_renhou: false,
    is_chiihou: false,
    is_open_riichi: false,
    paarenchan: false,
    doraCount: 0,
    uraCount: 0,
    akaCount: 0
  };
  const [winOptionsOpen, setWinOptionsOpen] = useState(false);
  const [winOptions, setWinOptions] = useState<WinOptionFlags>(defaultWinOptions);
  const [pendingWin, setPendingWin] = useState<
    | { type: "ron"; claim: Extract<LegalAction, { type: "RON_WIN" }> }
    | { type: "tsumo"; seat: Seat }
    | null
  >(null);
  const discardGuardRef = useRef<{ sig: string; at: number } | null>(null);
  const [pendingRinshan, setPendingRinshan] = useState<Seat | null>(null);
  const undoStackRef = useRef<UndoSnapshot[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const undoGuardRef = useRef(false);
  const initialRandomizedRef = useRef(false);
  const logInitRef = useRef<GameState | null>(null);
  const runImmediate = <T extends unknown[]>(fn: (...args: T) => void) =>
    (...args: T) => {
      flushSync(() => {
        fn(...args);
      });
    };

  useEffect(() => {
    setKifu(null);
  }, []);
  const round = useMemo(() => kifu?.rounds[roundIndex], [kifu, roundIndex]);
  const steps = round?.steps ?? [];
  const step = steps[stepIndex];
  const handKey = `${roundIndex}-${stepIndex}`;
  const overrideBySeat = (handOverrides[handKey] ?? {}) as Record<Seat, string[]>;
  const overrideDora = (doraOverrides[handKey] ?? []) as string[];
  const overrideUra = (uraOverrides[handKey] ?? []) as string[];
  const hasHandOverrides = Object.keys(overrideBySeat).length > 0;
  const initialLocked = gameState !== null;

  const viewState = useMemo(() => {
    if (gameState) return gameState;
    const metaPoints = (metaOverrides?.points as Record<Seat, number> | undefined) ?? undefined;
    const metaDora = overrideDora.length > 0 ? overrideDora : step?.doraIndicators ?? [];
    const metaUra: string[] = overrideUra;
    const mergedHands = hasHandOverrides
      ? mergeHandsForOverrides(overrideBySeat, step?.hands as Record<Seat, TileStr[]> | undefined)
      : undefined;
    const initOverrides = {
      hands: mergedHands,
      doraIndicators: metaDora,
      uraDoraIndicators: metaUra,
      points: metaPoints ?? ((step?.points as Record<Seat, number> | undefined) ?? undefined),
      meta: metaOverrides ?? undefined
    };
    return initFromKifuStep(round, step, initOverrides);
  }, [gameState, overrideBySeat, overrideDora, overrideUra, round, step, metaOverrides]);

  const seatOrder = useMemo(() => {
    const dealer = getDealerFromKyoku(viewState.meta.kyoku ?? 1);
    return [
      dealer,
      nextSeat(dealer),
      nextSeat(nextSeat(dealer)),
      nextSeat(nextSeat(nextSeat(dealer)))
    ] as Seat[];
  }, [viewState.meta.kyoku]);

  const updateSeatName = (seat: Seat, name: string) => {
    setSeatNames((prev) => ({ ...prev, [seat]: name }));
  };

  const updateSeatPoints = (seat: Seat, value: number) => {
    const nextValue = Number.isFinite(value) ? value : 0;
    if (gameState) {
      setGameState((prev) =>
        prev
          ? {
              ...prev,
              meta: {
                ...prev.meta,
                points: { ...prev.meta.points, [seat]: nextValue }
              }
            }
          : prev
      );
    } else {
      setMetaOverrides((prev) => ({
        ...(prev ?? {}),
        points: { ...(prev?.points ?? viewState.meta.points), [seat]: nextValue }
      }));
    }
  };

  const handSignature = useMemo(() => {
    if (!gameState) return "";
    return SEAT_LIST.map(
      (seat) => `${(gameState.players[seat].hand ?? []).join(",")}#${gameState.players[seat].drawnTile ?? ""}`
    ).join("|");
  }, [gameState]);

  const rulesErrors = useMemo(
    () => (viewState ? validateState(viewState) : []),
    [viewState, pendingRinshan]
  );
  const callOptionsAll = useMemo(() => {
    if (!gameState || gameState.phase !== "AWAITING_CALL" || !gameState.lastDiscard) return [];
    const base = getLegalActions(gameState).filter(
      (action): action is Extract<LegalAction, { type: "CHI" | "PON" | "KAN" }> =>
        action.type === "CHI" || action.type === "PON" || action.type === "KAN"
    );
    const { seat: discarder, tile } = gameState.lastDiscard;
    const ronOptions: Extract<LegalAction, { type: "RON_WIN" }>[] = SEAT_LIST.filter(
      (seat) => seat !== discarder
    )
      .filter((seat) => (waitsBySeat[seat] ?? []).some((wait) => tileEq(wait, tile)))
      .filter((seat) => !gameState.players[seat].furiten && !gameState.players[seat].furitenTemp)
      .map((seat) => ({ type: "RON_WIN", by: seat, from: discarder, tile }));
    return [...base, ...ronOptions];
  }, [gameState, waitsBySeat]);
  const callOptionsSorted = useMemo(() => {
    const priority: Record<string, number> = { RON_WIN: 0, KAN: 1, PON: 2, CHI: 3 };
    if (!callOptionsAll.length) return [];
    if (callOptionsAll.some((action) => action.type === "RON_WIN")) {
      return callOptionsAll.filter((action) => action.type === "RON_WIN");
    }
    if (callOptionsAll.some((action) => action.type === "KAN" || action.type === "PON")) {
      return [...callOptionsAll]
        .filter((action) => action.type === "KAN" || action.type === "PON")
        .sort((a, b) => priority[a.type] - priority[b.type]);
    }
    return [...callOptionsAll].sort((a, b) => priority[a.type] - priority[b.type]);
  }, [callOptionsAll]);
  const riichiAllowed = useMemo(() => {
    if (!gameState || gameState.phase !== "AFTER_DRAW_MUST_DISCARD") return false;
    const seat = gameState.turn;
    const player = gameState.players[seat];
    if (player.riichi || !player.closed) return false;
    if (gameState.meta.points[seat] < 1000) return false;
    const hasWaits = (waitsBySeat[seat]?.length ?? 0) > 0;
    return riichiOptions.length > 0 || hasWaits || tenpaiFlags[seat];
  }, [gameState, riichiOptions, waitsBySeat, tenpaiFlags]);

  useEffect(() => {
    if (!gameState) {
      setWaitsBySeat({ E: [], S: [], W: [], N: [] });
      setShantenBySeat({ E: null, S: null, W: null, N: null });
      setRiichiOptions([]);
      setPendingRiichi(false);
      setTenpaiChecking(false);
      setTenpaiFlags({ E: false, S: false, W: false, N: false });
      setTenpaiError(null);
      return;
    }
    let cancelled = false;
    const buildHandForWaits = (seat: Seat) => stripTiles(gameState.players[seat].hand ?? []);
    const meldSignature = (melds: GameState["players"][Seat]["melds"]) =>
      melds
        .map(
          (meld) =>
            `${meld.kind}:${(meld.tiles ?? []).map((tile) => tileNorm(tile)).join(",")}:${meld.calledFrom ?? ""}`
        )
        .join("|");
    const checkTenpai = async (hand: TileStr[], melds: GameState["players"][Seat]["melds"]) => {
      const normalized = normalizeHandForTenpai(hand);
      const key = `${normalized.join(",")}#${meldSignature(melds)}`;
      const cached = tenpaiCacheRef.current.get(key);
      if (cached) return cached;
      const res = await fetchTenpai(normalized, normalizeMeldsForTenpai(melds));
      const waits = res.ok ? res.waits ?? [] : [];
      const shanten = res.ok ? res.shanten : undefined;
      const value = { waits, shanten, ok: res.ok, error: res.ok ? undefined : res.error };
      tenpaiCacheRef.current.set(key, value);
      return value;
    };
    const computeWaits = async () => {
      setTenpaiChecking(true);
      setTenpaiError(null);
      try {
        let hasTenpaiError = false;
        const entries = await Promise.all(
          SEAT_LIST.map(async (seat) => {
            const hand = buildHandForWaits(seat);
            const melds = gameState.players[seat].melds ?? [];
            if (!melds.length && hand.length !== 13)
              return [
                seat,
                [],
                false,
                hand.length,
                gameState.players[seat].drawnTile ?? "",
                null,
                null
              ] as const;
            try {
              const result = await checkTenpai(hand, melds);
              if (result.ok === false) hasTenpaiError = true;
              const shanten = result.shanten ?? (result.waits?.length ? 0 : undefined);
              const isTenpai = (result.waits?.length ?? 0) > 0 || shanten === 0 || shanten === -1;
              return [
                seat,
                result.waits ?? [],
                isTenpai,
                hand.length,
                gameState.players[seat].drawnTile ?? "",
                shanten ?? null,
                result.ok === false ? result.error ?? "テンパイ判定に失敗しました" : null
              ] as const;
            } catch (err) {
              hasTenpaiError = true;
              return [seat, [], false, hand.length, gameState.players[seat].drawnTile ?? "", null, "テンパイ判定に失敗しました"] as const;
            }
          })
        );
        if (cancelled) return;
        const next: Record<Seat, TileStr[]> = { E: [], S: [], W: [], N: [] };
        const flags: Record<Seat, boolean> = { E: false, S: false, W: false, N: false };
        const nextShanten: Record<Seat, number | null> = { E: null, S: null, W: null, N: null };
        const errors: string[] = [];
        entries.forEach(([seat, waits, isTenpai, , , shanten, error]) => {
          next[seat] = waits ? [...waits] : [];
          flags[seat] = Boolean(isTenpai);
          nextShanten[seat] = shanten ?? null;
          if (error) errors.push(`${WIND_LABELS[seat]}: ${error}`);
        });
        setWaitsBySeat(next);
        setTenpaiFlags(flags);
        setShantenBySeat(nextShanten);
        setTenpaiError(errors.length ? errors.join(" / ") : hasTenpaiError ? "テンパイ判定に失敗しました" : null);
      } catch (err) {
        if (!cancelled) {
          setTenpaiError("テンパイ判定に失敗しました");
        }
      } finally {
        if (!cancelled) {
          setTenpaiChecking(false);
        }
      }
    };
    const computeRiichi = async () => {
      if (gameState.phase !== "AFTER_DRAW_MUST_DISCARD") {
        setRiichiOptions([]);
        return;
      }
      const seat = gameState.turn;
      const raw = stripTiles(gameState.players[seat].hand ?? []);
      if (raw.length < 13 || !gameState.players[seat].drawnTile) {
        setRiichiOptions([]);
        return;
      }
      const full = [...raw, gameState.players[seat].drawnTile].filter(Boolean);
      const uniqueTiles = Array.from(new Set(full));
      const checks = await Promise.all(
        uniqueTiles.map(async (tile) => {
          const hand = removeOneExactThenNorm(full, tile);
          if (hand.length !== 13) return [tile, false] as const;
          try {
            const result = await checkTenpai(hand, gameState.players[seat].melds ?? []);
            const isTenpai = result.waits.length > 0 || result.shanten === 0;
            return [tile, isTenpai] as const;
          } catch {
            return [tile, false] as const;
          }
        })
      );
      if (cancelled) return;
      const options = checks.filter(([, ok]) => ok).map(([tile]) => tile);
      setRiichiOptions(options);
    };
    computeWaits();
    computeRiichi();
    return () => {
      cancelled = true;
    };
  }, [gameState, handSignature]);

  useEffect(() => {
    if (!gameState || !gameState.lastDiscard) return;
    const seat = gameState.lastDiscard.seat;
    const waits = waitsBySeat[seat] ?? [];
    if (!waits.length) return;
    const isFuriten = waits.some((tile) => tileEq(tile, gameState.lastDiscard?.tile ?? ""));
    if (!isFuriten || gameState.players[seat].furiten) return;
    setGameState((prev) =>
      prev
        ? {
            ...prev,
            players: {
              ...prev.players,
              [seat]: { ...prev.players[seat], furiten: true }
            }
          }
        : prev
    );
  }, [gameState, waitsBySeat]);

  const usedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const add = (tile: string) => {
      const key = tileKeyForCount(tile);
      if (!key) return;
      counts[key] = (counts[key] ?? 0) + 1;
    };

    const exclude =
      pickerIndex !== null
        ? { kind: pickerKind, seat: pickerSeat, index: pickerIndex }
        : null;

    SEAT_LIST.forEach((seat) => {
      const tiles = viewState.players[seat].hand ?? [];
      tiles.forEach((tile, idx) => {
        if (exclude?.kind === "hand" && exclude.seat === seat && exclude.index === idx) return;
        add(tile);
      });
      const drawn = viewState.players[seat].drawnTile;
      if (drawn && viewState.players[seat].drawnFrom !== "CALL") add(drawn);
      viewState.players[seat].melds.forEach((meld) => meld.tiles.forEach(add));
      viewState.players[seat].discards.forEach(add);
    });

    const doraSlots = viewState.meta.doraIndicators ?? [];
    doraSlots.forEach((tile, idx) => {
      if (exclude?.kind === "dora" && exclude.index === idx) return;
      add(tile);
    });
    return counts;
  }, [pickerIndex, pickerKind, pickerSeat, viewState]);

  const wallRemainingByKey = useMemo(() => {
    const liveWall = viewState.meta.liveWall ?? [];
    if (!liveWall.length) return null;
    const counts: Record<string, number> = {};
    const add = (tile: string) => {
      const key = tileKeyForCount(tile);
      if (!key) return;
      counts[key] = (counts[key] ?? 0) + 1;
    };
    liveWall.forEach(add);
    return counts;
  }, [viewState.meta.liveWall]);

  const displayRemainingByKey = useMemo(() => {
    const liveWall = viewState.meta.liveWall ?? [];
    if (!liveWall.length) return null;
    const counts: Record<string, number> = {};
    const add = (tile: string) => {
      const key = tileKeyForCount(tile);
      if (!key) return;
      counts[key] = (counts[key] ?? 0) + 1;
    };
    liveWall.forEach(add);
    return counts;
  }, [viewState.meta.liveWall]);

  const isTileAvailable = (tile: string) => {
    const key = tileKeyForCount(tile);
    if (!key) return true;
    if (pickerKind === "rinshan" || pickerKind === "draw") {
      if (gameState && wallRemainingByKey) return (wallRemainingByKey[key] ?? 0) > 0;
      const limit = TILE_LIMITS[key] ?? 0;
      const used = usedCounts[key] ?? 0;
      return used < limit;
    }
    const limit = TILE_LIMITS[key] ?? 0;
    const used = usedCounts[key] ?? 0;
    return used < limit;
  };

  const remainingCountFromUsed = (tile: string) => {
    const key = tileKeyForCount(tile);
    if (!key) return 0;
    const limit = TILE_LIMITS[key] ?? 0;
    const used = usedCounts[key] ?? 0;
    return Math.max(limit - used, 0);
  };

  const remainingCountForPicker = (tile: string) => {
    const key = tileKeyForCount(tile);
    if (!key) return 0;
    if (pickerKind === "rinshan" || pickerKind === "draw") {
      if (gameState && wallRemainingByKey) return wallRemainingByKey[key] ?? 0;
      return remainingCountFromUsed(tile);
    }
    if (gameState && wallRemainingByKey) return wallRemainingByKey[key] ?? 0;
    return remainingCountFromUsed(tile);
  };

  const remainingCountForDisplay = (tile: string) => {
    const key = tileKeyForCount(tile);
    if (!key) return 0;
    if (!gameState || !displayRemainingByKey) return remainingCountFromUsed(tile);
    return displayRemainingByKey[key] ?? 0;
  };

  const remainingTotalFromUsed = useMemo(() => {
    let total = 0;
    Object.keys(TILE_LIMITS).forEach((key) => {
      const limit = TILE_LIMITS[key] ?? 0;
      const used = usedCounts[key] ?? 0;
      total += Math.max(limit - used, 0);
    });
    return total;
  }, [usedCounts]);

  const liveWallRemaining = gameState ? getWallRemaining(viewState.meta) : Math.max(remainingTotalFromUsed, 0);
  const totalWallRemaining = gameState
    ? liveWallRemaining
    : remainingTotalFromUsed;

  const remainingTiles = useMemo(
    () =>
      TILE_CHOICES.map((tile) => ({
        tile,
        count: remainingCountForDisplay(tile)
      })),
    [usedCounts, wallRemainingByKey]
  );

  const handleRandomHands = () => {
    const deck: string[] = TileOps.buildTileDeck();
    if (deck.length !== TOTAL_TILES) {
      console.warn(`牌総数が${deck.length}枚です（期待: ${TOTAL_TILES}枚）`);
    }
    TileOps.shuffleInPlace(deck);
    const randomTiles = (count: number) => TileOps.sortTiles(deck.splice(0, count) as string[]);
    const hands = {
      E: randomTiles(13),
      S: randomTiles(13),
      W: randomTiles(13),
      N: randomTiles(13)
    };
    const doraIndicators = deck.splice(0, 1);
    const uraIndicators: string[] = [];
    const liveWall = deck.splice(0);
    const nextKey = `${roundIndex}-0`;
    setStepIndex(0);
    resetGameUi();
    setHandOverrides((prev) => ({ ...prev, [nextKey]: hands }));
    setDoraOverrides((prev) => ({ ...prev, [nextKey]: doraIndicators }));
    setUraOverrides((prev) => ({ ...prev, [nextKey]: uraIndicators }));
    setMetaOverrides((prev) => ({
      ...(prev ?? {}),
      liveWall,
      deadWall: [],
      doraRevealedCount: 1
    }));
  };

  const handleClearHands = () => {
    if (gameState) {
      setGameState((prev) =>
        prev
          ? {
              ...prev,
              players: {
                E: { ...prev.players.E, hand: Array(13).fill(TILE_PLACEHOLDER), drawnTile: null, drawnFrom: null, melds: [], discards: [], riichi: false, ippatsu: false, closed: true, furiten: false, furitenTemp: false },
                S: { ...prev.players.S, hand: Array(13).fill(TILE_PLACEHOLDER), drawnTile: null, drawnFrom: null, melds: [], discards: [], riichi: false, ippatsu: false, closed: true, furiten: false, furitenTemp: false },
                W: { ...prev.players.W, hand: Array(13).fill(TILE_PLACEHOLDER), drawnTile: null, drawnFrom: null, melds: [], discards: [], riichi: false, ippatsu: false, closed: true, furiten: false, furitenTemp: false },
                N: { ...prev.players.N, hand: Array(13).fill(TILE_PLACEHOLDER), drawnTile: null, drawnFrom: null, melds: [], discards: [], riichi: false, ippatsu: false, closed: true, furiten: false, furitenTemp: false }
              },
              meta: { ...prev.meta, doraRevealedCount: 1, liveWall: [], deadWall: [], doraIndicators: [], uraDoraIndicators: [] },
              phase: "BEFORE_DRAW",
              lastDiscard: undefined,
              pendingClaims: []
            }
          : prev
      );
    } else {
      setHandOverrides((prev) => ({
        ...prev,
        [handKey]: {
          E: Array(13).fill(TILE_PLACEHOLDER),
          S: Array(13).fill(TILE_PLACEHOLDER),
          W: Array(13).fill(TILE_PLACEHOLDER),
          N: Array(13).fill(TILE_PLACEHOLDER)
        }
      }));
      setDoraOverrides((prev) => ({ ...prev, [handKey]: [] }));
      setUraOverrides((prev) => ({ ...prev, [handKey]: [] }));
      setMetaOverrides((prev) =>
        prev
          ? {
              ...prev,
              liveWall: [],
              deadWall: [],
              doraRevealedCount: prev.doraRevealedCount ?? 1
            }
          : prev
      );
    }
    setSelectedDiscard(null);
    setRiichiDiscards(emptyRiichiDiscards());
    setWinInfo(null);
    setJunmeCount(0);
    setPendingRinshan(null);
  };

  useEffect(() => {
    if (initialRandomizedRef.current) return;
    if (gameState) return;
    initialRandomizedRef.current = true;
    handleClearHands();
  }, [gameState, handleClearHands]);

  const buildInitOverrides = () => {
    const metaPoints = (metaOverrides?.points as Record<Seat, number> | undefined) ?? undefined;
    const metaDora = overrideDora.length > 0 ? overrideDora : step?.doraIndicators ?? [];
    const metaUra: string[] = overrideUra;
    const mergedHands = hasHandOverrides
      ? mergeHandsForOverrides(overrideBySeat, step?.hands as Record<Seat, TileStr[]> | undefined)
      : undefined;
    return {
      hands: mergedHands,
      doraIndicators: metaDora,
      uraDoraIndicators: metaUra,
      points: metaPoints ?? ((step?.points as Record<Seat, number> | undefined) ?? undefined),
      meta: metaOverrides ?? undefined
    };
  };

  const buildLogExport = () => {
    const baseState = gameState ?? viewState;
    const initState = logInitRef.current ?? baseState;
    const meta = baseState.meta;
    const initMeta = initState.meta;
    const roundWindLabel = WIND_LABELS[meta.wind] ?? "南";
    const dispWind = roundWindLabel;
    const rule = {
      disp: `般${dispWind}喰赤`,
      aka: 1
    };
    const kyokuIndex =
      (meta.wind === "E" ? 0 : meta.wind === "S" ? 4 : meta.wind === "W" ? 8 : 12) +
      Math.max(0, (meta.kyoku ?? 1) - 1);
    const scores = SEAT_LIST.map((seat) => initMeta.points?.[seat] ?? meta.points[seat] ?? 0);
    const doraCodes = getDoraIndicators(meta)
      .map(tileToLogCode)
      .filter((code): code is number => typeof code === "number");
    const winnerSeat = winInfo?.seat ?? null;
    const winnerRiichi =
      winnerSeat != null &&
      (baseState.players[winnerSeat]?.riichi ||
        (Array.isArray(winInfo?.result?.yaku) &&
          winInfo.result.yaku.some((name: string) => /riichi/i.test(String(name)))));
    const uraCodes = winnerRiichi
      ? getUraDoraIndicators(meta)
          .map(tileToLogCode)
          .filter((code): code is number => typeof code === "number")
      : [];

    type LogValue = number | string;
    const seatState: Record<
      Seat,
      {
        draws: LogValue[];
        discards: LogValue[];
        lastDraw: TileStr | null;
        lastDiscardIndex: number | null;
      }
    > = {
      E: { draws: [], discards: [], lastDraw: null, lastDiscardIndex: null },
      S: { draws: [], discards: [], lastDraw: null, lastDiscardIndex: null },
      W: { draws: [], discards: [], lastDraw: null, lastDiscardIndex: null },
      N: { draws: [], discards: [], lastDraw: null, lastDiscardIndex: null }
    };

    type MeldTracker = {
      meld: Meld;
      usedChi: boolean;
      usedPon: boolean;
      usedKan: boolean;
    };
    const meldTrackers: Record<Seat, MeldTracker[]> = {
      E: (baseState.players.E.melds ?? []).map((meld) => ({
        meld,
        usedChi: false,
        usedPon: false,
        usedKan: false
      })),
      S: (baseState.players.S.melds ?? []).map((meld) => ({
        meld,
        usedChi: false,
        usedPon: false,
        usedKan: false
      })),
      W: (baseState.players.W.melds ?? []).map((meld) => ({
        meld,
        usedChi: false,
        usedPon: false,
        usedKan: false
      })),
      N: (baseState.players.N.melds ?? []).map((meld) => ({
        meld,
        usedChi: false,
        usedPon: false,
        usedKan: false
      }))
    };

    const matchesCalledTile = (meld: Meld, tile: TileStr | null) => {
      if (!tile) return true;
      if (meld.calledTile) return tileEq(meld.calledTile, tile);
      return (meld.tiles ?? []).some((t) => tileEq(t, tile));
    };

    const pickMeld = (
      seat: Seat,
      kinds: Meld["kind"][],
      tile: TileStr | null,
      stage: "chi" | "pon" | "kan"
    ) => {
      const trackers = meldTrackers[seat];
      for (const tracker of trackers) {
        if (!kinds.includes(tracker.meld.kind)) continue;
        if (stage === "chi" && tracker.usedChi) continue;
        if (stage === "pon" && tracker.usedPon) continue;
        if (stage === "kan" && tracker.usedKan) continue;
        if (!matchesCalledTile(tracker.meld, tile)) continue;
        if (stage === "chi") tracker.usedChi = true;
        if (stage === "pon") tracker.usedPon = true;
        if (stage === "kan") tracker.usedKan = true;
        return tracker.meld;
      }
      return null;
    };

    const pickMeldWithFallback = (
      seat: Seat,
      kinds: Meld["kind"][],
      tile: TileStr | null,
      stage: "chi" | "pon" | "kan"
    ) => pickMeld(seat, kinds, tile, stage) ?? pickMeld(seat, kinds, null, stage);

    const pushCallToken = (
      seat: Seat,
      kind: "CHI" | "PON" | "MINKAN" | "ANKAN" | "KAKAN",
      tile: TileStr | null,
      stage: "chi" | "pon" | "kan"
    ) => {
      const kinds: Meld["kind"][] =
        kind === "CHI"
          ? ["CHI"]
          : kind === "PON"
            ? ["PON", "KAKAN"]
            : kind === "MINKAN"
              ? ["MINKAN", "KAN"]
              : kind === "ANKAN"
                ? ["ANKAN"]
                : ["KAKAN"];
      const meld = pickMeld(seat, kinds, tile, stage);
      if (!meld) return;
      const token = buildCallLogToken(kind, meld);
      if (token) seatState[seat].draws.push(token);
      seatState[seat].lastDraw = null;
    };

    const pushDiscardValue = (seat: Seat, value: LogValue) => {
      seatState[seat].lastDiscardIndex = seatState[seat].discards.length;
      seatState[seat].discards.push(value);
    };

    const applySelfKanLog = (seat: Seat, kanTile: TileStr | null) => {
      const lastDraw = seatState[seat].lastDraw;
      const effectiveTile = kanTile ?? lastDraw;
      const useFallback = kanTile == null;
      const kakan = useFallback
        ? pickMeldWithFallback(seat, ["KAKAN"], effectiveTile ?? null, "kan")
        : pickMeld(seat, ["KAKAN"], effectiveTile ?? null, "kan");
      const ankan = kakan
        ? null
        : useFallback
          ? pickMeldWithFallback(seat, ["ANKAN"], effectiveTile ?? null, "kan")
          : pickMeld(seat, ["ANKAN"], effectiveTile ?? null, "kan");
      const meld = kakan ?? ankan;
      if (!meld) return false;
      const kind = meld.kind === "ANKAN" ? "ANKAN" : "KAKAN";
      const kanTileResolved = kanTile ?? meld.calledTile ?? meld.tiles?.[0] ?? null;
      if (lastDraw) {
        const token = buildCallLogToken(kind, meld);
        if (token) pushDiscardValue(seat, token);
        seatState[seat].lastDraw = null;
        return true;
      }
      const token = buildCallLogToken(kind, meld);
      if (token) pushDiscardValue(seat, token);
      seatState[seat].lastDraw = null;
      return true;
    };

    let lastSeat: Seat | null = null;
    actionLog.forEach((line) => {
      const actionMatch = line.match(/^([東南西北])(ツモ|ステ|チー|ポン|カン):\s*(.+)$/);
      if (actionMatch) {
        const seat = SEAT_LABEL_TO_SEAT[actionMatch[1]];
        const action = actionMatch[2];
        const tileToken = actionMatch[3];
        const tile = logTokenToTile(tileToken);
        if (!seat) return;
        lastSeat = seat;
        if (action === "ツモ") {
          if (!tile) return;
          const code = tileToLogCode(tile);
          if (code !== null) seatState[seat].draws.push(code);
          seatState[seat].lastDraw = tile;
          return;
        }
        if (action === "ステ") {
          if (!tile) return;
          const code = tileToLogCode(tile);
          if (code === null) return;
          const isTsumogiri = seatState[seat].lastDraw ? tileEq(seatState[seat].lastDraw, tile) : false;
          const discardValue: LogValue = isTsumogiri ? 60 : code;
          pushDiscardValue(seat, discardValue);
          seatState[seat].lastDraw = null;
          return;
        }
        if (action === "チー") {
          pushCallToken(seat, "CHI", tile, "chi");
          return;
        }
        if (action === "ポン") {
          pushCallToken(seat, "PON", tile, "pon");
          return;
        }
        if (action === "カン") {
          if (!applySelfKanLog(seat, tile)) {
            pushCallToken(seat, "MINKAN", tile, "kan");
            pushDiscardValue(seat, 0);
          }
        }
        return;
      }
      const riichiMatch = line.match(/^([東南西北])リーチ$/);
      if (riichiMatch) {
        const seat = SEAT_LABEL_TO_SEAT[riichiMatch[1]];
        if (!seat) return;
        lastSeat = seat;
        const idx = seatState[seat].lastDiscardIndex;
        if (idx !== null) {
          const value = seatState[seat].discards[idx];
          seatState[seat].discards[idx] = `r${value}`;
        }
        return;
      }
      if (line.trim() === "カン" && lastSeat) {
        applySelfKanLog(lastSeat, null);
      }
    });

    const initialHands = {
      E: (initState.players.E.hand ?? [])
        .map(tileToLogCode)
        .filter((code): code is number => typeof code === "number"),
      S: (initState.players.S.hand ?? [])
        .map(tileToLogCode)
        .filter((code): code is number => typeof code === "number"),
      W: (initState.players.W.hand ?? [])
        .map(tileToLogCode)
        .filter((code): code is number => typeof code === "number"),
      N: (initState.players.N.hand ?? [])
        .map(tileToLogCode)
        .filter((code): code is number => typeof code === "number")
    };

    const logEntry: any[] = [
      [kyokuIndex, meta.honba ?? 0, meta.riichiSticks ?? 0],
      scores,
      doraCodes,
      uraCodes,
      initialHands.E,
      seatState.E.draws,
      seatState.E.discards,
      initialHands.S,
      seatState.S.draws,
      seatState.S.discards,
      initialHands.W,
      seatState.W.draws,
      seatState.W.discards,
      initialHands.N,
      seatState.N.draws,
      seatState.N.discards
    ];

    if (winInfo && baseState.phase === "ENDED") {
      const startPoints = initMeta.points ?? { E: 0, S: 0, W: 0, N: 0 };
      const endPointsRaw = meta.points ?? { E: 0, S: 0, W: 0, N: 0 };
      const loserSeat = winInfo.type === "ron" ? winInfo.from ?? baseState.lastDiscard?.seat ?? null : null;
      const riichiInvalidSeat =
        loserSeat != null &&
        riichiDiscards[loserSeat] != null &&
        baseState.players[loserSeat]?.discards?.length
          ? riichiDiscards[loserSeat] === baseState.players[loserSeat].discards.length - 1
            ? loserSeat
            : null
          : null;
      const endPoints = { ...endPointsRaw };
      SEAT_LIST.forEach((seat) => {
        if (riichiDiscards[seat] == null) return;
        if (riichiInvalidSeat === seat) return;
        endPoints[seat] = (endPoints[seat] ?? 0) + 1000;
      });
      const delta = SEAT_LIST.map((seat) => (endPoints[seat] ?? 0) - (startPoints[seat] ?? 0));
      const dealerSeat = getDealerFromKyoku(meta.kyoku ?? 1);
      const order: Seat[] = [
        dealerSeat,
        nextSeat(dealerSeat),
        nextSeat(nextSeat(dealerSeat)),
        nextSeat(nextSeat(nextSeat(dealerSeat)))
      ];
      const winnerSeat = winInfo.seat;
      const loserSeatFinal = winInfo.type === "ron" ? winInfo.from ?? baseState.lastDiscard?.seat ?? winnerSeat : winnerSeat;
      const winnerIndex = order.indexOf(winnerSeat);
      const loserIndex = order.indexOf(loserSeatFinal);
      const paoIndex = winnerIndex;
      const scoreSummary = formatScoreSummaryForLog(winInfo.result, winInfo.type, winnerSeat === dealerSeat);
      const winnerPlayer = baseState.players[winnerSeat];
      const hasRiichi =
        winnerPlayer.riichi ||
        (Array.isArray(winInfo.result?.yaku) &&
          winInfo.result.yaku.some((name: string) => /riichi/i.test(String(name))));
      const doraCounts =
        winInfo.doraCounts ??
        computeDoraCountsForWin(meta, winnerPlayer, winInfo.tile ?? "", hasRiichi);
      const yakuEntries = buildJapaneseYakuList(
        winInfo.result?.yaku ?? [],
        winnerPlayer?.closed ?? true,
        winnerSeat,
        meta.wind,
        doraCounts
      );
      const detail: any[] = [winnerIndex, loserIndex, paoIndex];
      if (scoreSummary) detail.push(scoreSummary);
      detail.push(...yakuEntries);
      logEntry.push(["和了", delta, detail]);
    } else if (!winInfo && baseState.phase === "ENDED") {
      const startPoints = initMeta.points ?? { E: 0, S: 0, W: 0, N: 0 };
      const endPoints = meta.points ?? { E: 0, S: 0, W: 0, N: 0 };
      const delta = SEAT_LIST.map((seat) => (endPoints[seat] ?? 0) - (startPoints[seat] ?? 0));
      const hasDelta = delta.some((value) => value !== 0);
      const tenpaiList = SEAT_LIST.map((seat) => (tenpaiFlags[seat] ? 1 : 0));
      const hasTenpai = tenpaiList.some((value) => value !== 0);
      if (hasDelta || hasTenpai) {
        logEntry.push(["流局", delta, tenpaiList]);
      } else {
        logEntry.push(["流局", delta]);
      }
    }

    return {
      title: ["", ""],
      name: [seatNames.E, seatNames.S, seatNames.W, seatNames.N],
      rule,
      log: [logEntry]
    };
  };

  const exportLog = () => {
    const snapshot = buildLogExport();
    const blob = new Blob([JSON.stringify(snapshot)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mj-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startGameFromOverrides = () => {
    const initOverrides = buildInitOverrides();
    let nextState = initFromKifuStep(round, step, initOverrides);
    nextState = {
      ...nextState,
      phase: "BEFORE_DRAW",
      lastDiscard: undefined,
      pendingClaims: []
    };
    resetGameUi({ gameState: nextState });
    logInitRef.current = cloneState(nextState);
    undoStackRef.current = [];
    setUndoCount(0);
    return nextState;
  };

  const handleLogClear = () => {
    resetGameUi();
    logInitRef.current = null;
    undoStackRef.current = [];
    setUndoCount(0);
  };

  const openPicker = (seat: Seat, index: number, tileOverride?: string | null, allowGameEdit = false) => {
    if (gameState && !allowGameEdit) {
      if (gameState.phase === "AFTER_DRAW_MUST_DISCARD" && gameState.turn === seat) {
        const display = splitDisplayTiles(gameState, seat);
        const tile = tileOverride ?? display.tiles[index] ?? "";
        if (tile) {
          doDiscard(tile);
        }
      }
      return;
    }
    const hand = allowGameEdit && gameState
      ? gameState.players?.[seat]?.hand ?? []
      : viewState.players?.[seat]?.hand ?? [];
    const hasPlaceholders = hand.some((tile) => !tile || tile === TILE_PLACEHOLDER);
    setPickerBatch(hasPlaceholders ? { active: true, firstIndex: index } : { active: false, firstIndex: null });
    setPickerSeat(seat);
    setPickerIndex(index);
    setPickerKind("hand");
    setPickerOpen(true);
  };

  const normalizeDetectedTile = (value: string) => {
    if (!value) return "";
    let text = value.trim();
    if (!text) return "";
    if (text.includes(" ")) {
      text = text.split(/\s+/).pop() ?? text;
    }
    if (text.includes("-") && text.length > 2) {
      text = text.split("-").pop()?.trim() ?? text;
    }
    const honorMap: Record<string, TileStr> = {
      to: "E",
      na: "S",
      sh: "W",
      pe: "N",
      hk: "P",
      ht: "F",
      ty: "C"
    };
    if (honorMap[text]) return honorMap[text];
    return canonicalTile(text) ?? text;
  };

  const applyDetectedTilesToSeat = (seat: Seat, tiles: string[]) => {
    const normalized = tiles
      .map((tile) => normalizeDetectedTile(tile))
      .map((tile) => canonicalTile(tile))
      .filter((tile): tile is TileStr => Boolean(tile));
    const baseHand = normalized.slice(0, 13);
    const extraTile = normalized[13] ?? null;
    const paddedHand = [...baseHand];
    while (paddedHand.length < 13) paddedHand.push(TILE_PLACEHOLDER);

    if (!gameState) {
      const turnSeat = viewState.turn;
      if (extraTile && seat !== turnSeat) {
        appendActionLog("ツモ牌は手番のみ反映できます");
      }
      if (!(extraTile && seat === turnSeat)) {
        setHandOverrides((prev) => {
          const bySeat = { ...(prev[handKey] ?? {}) };
          bySeat[seat] = sortTiles(paddedHand);
          return { ...prev, [handKey]: bySeat };
        });
        setMetaOverrides((prev) => ({ ...(prev ?? {}), liveWall: [], deadWall: [] }));
        return;
      }
    }

    const ensureState = gameState ?? startGameFromOverrides();
    if (!ensureState) return;
    const player = ensureState.players[seat];
    if (player.discards.length > 0) {
      appendActionLog("捨て牌後は画像反映できません");
      return;
    }

    const isTurnSeat = seat === ensureState.turn;
    const canAssignDrawn = Boolean(extraTile && isTurnSeat);
    if (extraTile && !canAssignDrawn) {
      appendActionLog("ツモ牌は手番のみ反映できます");
    }

    const returnTiles = [
      ...player.hand,
      ...(player.drawnTile && player.drawnFrom !== "CALL" ? [player.drawnTile] : [])
    ]
      .map((tile) => canonicalTile(tile))
      .filter((tile): tile is TileStr => Boolean(tile) && tile !== TILE_PLACEHOLDER && tile !== TILE_BACK);

    const takeTiles = [
      ...baseHand,
      ...(canAssignDrawn ? [extraTile as TileStr] : [])
    ]
      .map((tile) => canonicalTile(tile))
      .filter((tile): tile is TileStr => Boolean(tile) && tile !== TILE_PLACEHOLDER && tile !== TILE_BACK);

    let nextLiveWall = [...(ensureState.meta.liveWall ?? [])];
    if (returnTiles.length) nextLiveWall = [...nextLiveWall, ...returnTiles];
    let failed = false;
    let failedTile = "";
    takeTiles.forEach((tile) => {
      const removed = WallOps.removeWallTile(nextLiveWall, tile);
      if (!removed.found) {
        failed = true;
        failedTile = tile;
        return;
      }
      nextLiveWall = removed.next;
    });
    if (failed) {
      appendActionLog(failedTile ? `山にありません: ${formatTileForLog(failedTile)}` : "山にありません");
      return;
    }

    const nextPlayer: PlayerState = {
      ...player,
      hand: sortTiles(paddedHand),
      drawnTile: canAssignDrawn ? (extraTile as TileStr) : null,
      drawnFrom: canAssignDrawn ? "WALL" : null,
      furitenTemp: false
    };
    let nextPhase = ensureState.phase;
    if (isTurnSeat) {
      if (nextPlayer.drawnTile && ensureState.phase === "BEFORE_DRAW") {
        nextPhase = "AFTER_DRAW_MUST_DISCARD";
      }
      if (!nextPlayer.drawnTile && ensureState.phase === "AFTER_DRAW_MUST_DISCARD") {
        nextPhase = "BEFORE_DRAW";
      }
    }
    const nextState: GameState = {
      ...ensureState,
      players: { ...ensureState.players, [seat]: nextPlayer },
      meta: { ...ensureState.meta, liveWall: nextLiveWall },
      phase: nextPhase
    };
    checkTileConservation(nextState, "importImage");
    setGameState(nextState);
  };

  const onImportImage = (seat: Seat) => {
    setImageImportSeat(seat);
    imageImportSeatRef.current = seat;
    if (imageImportRef.current) {
      imageImportRef.current.value = "";
      imageImportRef.current.click();
    }
  };

  const handleImageImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const seat = imageImportSeatRef.current ?? imageImportSeat;
    if (!file || !seat || imageImportBusy) {
      if (!seat) appendActionLog("画像読込: 対象席が未設定です");
      return;
    }
    setImageImportBusy(true);
    try {
      const result = await analyzeTilesFromImage(file);
      if (!result.ok) {
        appendActionLog(result.error ?? "画像解析に失敗しました");
        return;
      }
      applyDetectedTilesToSeat(seat, result.tiles ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "画像解析に失敗しました";
      appendActionLog(message);
    } finally {
      setImageImportBusy(false);
      setImageImportSeat(null);
      imageImportSeatRef.current = null;
    }
  };

  const openDoraPicker = (index: number) => {
    setPickerIndex(index);
    setPickerKind("dora");
    setPickerBatch({ active: false, firstIndex: null });
    setPickerOpen(true);
  };

  const openUraPicker = (index: number) => {
    setPickerIndex(index);
    setPickerKind("ura");
    setPickerBatch({ active: false, firstIndex: null });
    setPickerOpen(true);
  };

  const openRinshanPicker = (seat: Seat) => {
    setPickerSeat(seat);
    setPickerIndex(0);
    setPickerKind("rinshan");
    setPickerBatch({ active: false, firstIndex: null });
    setPickerOpen(true);
  };

  const canSelectDrawTile = (seat: Seat, state: GameState | null = gameState ?? viewState) => {
    if (!state) return false;
    if (state.phase !== "BEFORE_DRAW") return false;
    if (state.turn !== seat) return false;
    const player = state.players[seat];
    if (player.drawnTile) return false;
    return stripTiles(player.hand).length === expectedHandCountBeforeDraw(player);
  };

  const openDrawPicker = (seat: Seat) => {
    const baseState = gameState ?? viewState;
    const canReplaceDraw =
      Boolean(
        gameState &&
          gameState.turn === seat &&
          gameState.phase === "AFTER_DRAW_MUST_DISCARD" &&
          gameState.players[seat].drawnTile &&
          gameState.players[seat].discards.length === 0
      );
    if (!canReplaceDraw && !canSelectDrawTile(seat, baseState)) {
      if (baseState.turn === seat && baseState.phase === "BEFORE_DRAW") {
        const expected = expectedHandCountBeforeDraw(baseState.players[seat]);
        appendActionLog(`手牌枚数が不正です（現在:${stripTiles(baseState.players[seat].hand).length} / 期待:${expected}）`);
      }
      return;
    }
    if (!gameState) {
      startGameFromOverrides();
    }
    setPickerSeat(seat);
    setPickerIndex(0);
    setPickerKind("draw");
    setPickerBatch({ active: false, firstIndex: null });
    setPickerOpen(true);
  };

  const refreshWinDoraCounts = (metaOverride?: RoundMeta) => {
    if (!winOptionsOpen || !pendingWin || !gameState) return;
    const seat = pendingWin.type === "ron" ? pendingWin.claim.by : pendingWin.seat;
    const winTile =
      pendingWin.type === "ron"
        ? pendingWin.claim.tile
        : gameState.players[seat]?.drawnTile ?? null;
    if (!winTile) return;
    const player = gameState.players[seat];
    const hasRiichi = player.riichi || winOptions.is_daburu_riichi || winOptions.is_open_riichi;
    const counts = computeDoraCountsForWin(metaOverride ?? gameState.meta, player, winTile, hasRiichi);
    setWinOptions((prev) => ({
      ...prev,
      doraCount: counts.dora,
      uraCount: counts.ura,
      akaCount: counts.aka
    }));
  };

  const applyTile = (tile: string | null) => {
    if (pickerIndex === null) return;
    const normalizedTile =
      tile && tile !== "BACK" ? canonicalTile(tile) : tile;
    const isPlaceholderTile = (value: string) => !value || value === TILE_PLACEHOLDER;
    const nextPlaceholderIndex = (tiles: string[]) => tiles.findIndex(isPlaceholderTile);
    const shouldBatch = pickerKind === "hand" && pickerBatch.active;
    if (gameState) {
      if (pickerKind === "rinshan") {
        if (!normalizedTile) return;
        const seat = pendingRinshan ?? gameState.turn;
        const player = gameState.players[seat];
        let nextLiveWall = gameState.meta.liveWall ?? [];
        const liveRemoved = removeOneExactThenNorm(nextLiveWall, normalizedTile);
        if (liveRemoved.length !== nextLiveWall.length) {
          nextLiveWall = liveRemoved;
        } else {
          appendActionLog("山にありません");
          return;
        }
        const nextState: GameState = {
          ...gameState,
          players: {
            ...gameState.players,
            [seat]: {
              ...player,
              drawnTile: normalizedTile,
              drawnFrom: "RINSHAN"
            }
          },
          meta: {
            ...gameState.meta,
            liveWall: nextLiveWall
          },
          phase: "AFTER_DRAW_MUST_DISCARD"
        };
        checkTileConservation(nextState, "rinshan");
        setGameState(nextState);
        appendActionLog(`${formatSeatForLog(seat)}ツモ: ${formatTileForLog(normalizedTile)}`);
        setPendingRinshan(null);
        setPickerBatch({ active: false, firstIndex: null });
        setPickerOpen(false);
        return;
      }
      if (pickerKind === "draw") {
        if (!normalizedTile) return;
        const seat = gameState.turn;
        const player = gameState.players[seat];
        if (gameState.phase === "BEFORE_DRAW") {
          const expected = expectedHandCountBeforeDraw(player);
          if (stripTiles(player.hand).length !== expected) {
            appendActionLog(`手牌枚数が不正です（現在:${stripTiles(player.hand).length} / 期待:${expected}）`);
            return;
          }
          let nextLiveWall = gameState.meta.liveWall ?? [];
          const liveRemoved = removeOneExactThenNorm(nextLiveWall, normalizedTile);
          if (liveRemoved.length !== nextLiveWall.length) {
            nextLiveWall = liveRemoved;
          } else {
            appendActionLog("山にありません");
            return;
          }
          const nextState: GameState = {
            ...gameState,
            players: {
              ...gameState.players,
              [seat]: {
                ...player,
                drawnTile: normalizedTile,
                drawnFrom: "WALL",
                furitenTemp: false
              }
            },
            meta: {
              ...gameState.meta,
              liveWall: nextLiveWall
            },
            phase: "AFTER_DRAW_MUST_DISCARD"
          };
          checkTileConservation(nextState, "drawPicker");
          setGameState(nextState);
          appendActionLog(`${formatSeatForLog(seat)}ツモ: ${formatTileForLog(normalizedTile)}`);
          setSelectedDiscard(null);
          setPickerBatch({ active: false, firstIndex: null });
          setPickerOpen(false);
          return;
        }
        if (
          gameState.phase === "AFTER_DRAW_MUST_DISCARD" &&
          player.drawnTile &&
          player.discards.length === 0
        ) {
          let nextLiveWall = gameState.meta.liveWall ?? [];
          if (player.drawnFrom !== "CALL") {
            nextLiveWall = [...nextLiveWall, player.drawnTile];
          }
          const removed = WallOps.removeWallTile(nextLiveWall, normalizedTile);
          if (!removed.found) {
            appendActionLog("山にありません");
            return;
          }
          nextLiveWall = removed.next;
          const nextState: GameState = {
            ...gameState,
            players: {
              ...gameState.players,
              [seat]: {
                ...player,
                drawnTile: removed.tile,
                drawnFrom: "WALL",
                furitenTemp: false
              }
            },
            meta: {
              ...gameState.meta,
              liveWall: nextLiveWall
            }
          };
          checkTileConservation(nextState, "drawReplace");
          setGameState(nextState);
          appendActionLog(`${formatSeatForLog(seat)}ツモ差替: ${formatTileForLog(removed.tile)}`);
          setSelectedDiscard(null);
          setPickerBatch({ active: false, firstIndex: null });
          setPickerOpen(false);
          return;
        }
        return;
      }
      if (pickerKind === "dora" || pickerKind === "ura") {
        const desiredDora = [...(gameState.meta.doraIndicators ?? [])];
        const desiredUra = [...(gameState.meta.uraDoraIndicators ?? [])];
        while (desiredDora.length <= pickerIndex) desiredDora.push("");
        while (desiredUra.length <= pickerIndex) desiredUra.push("");
        const baseLiveWall = [...(gameState.meta.liveWall ?? [])];
        let nextLiveWall = baseLiveWall;
        if (pickerKind === "dora") {
          const prevTile = desiredDora[pickerIndex] ?? "";
          const indicatorTile = normalizedTile && normalizedTile !== "BACK" ? normalizedTile : "";
          let applied = false;
          if (indicatorTile !== prevTile) {
            if (prevTile) nextLiveWall = [...nextLiveWall, prevTile];
            if (indicatorTile) {
              const removed = WallOps.removeWallTile(nextLiveWall, indicatorTile);
              if (removed.found) {
                nextLiveWall = removed.next;
                desiredDora[pickerIndex] = indicatorTile;
                applied = true;
              } else {
                appendActionLog("山にありません");
                nextLiveWall = baseLiveWall;
                desiredDora[pickerIndex] = prevTile;
              }
            } else {
              desiredDora[pickerIndex] = "";
              applied = true;
            }
          } else {
            applied = true;
          }
          const currentCount = gameState.meta.doraRevealedCount ?? 1;
          const nextCount = applied && indicatorTile
            ? Math.max(1, Math.min(5, Math.max(currentCount, pickerIndex + 1)))
            : currentCount;
          const nextState = {
            ...gameState,
            meta: {
              ...gameState.meta,
              liveWall: nextLiveWall,
              doraIndicators: desiredDora,
              uraDoraIndicators: desiredUra,
              doraRevealedCount: nextCount
            }
          };
          checkTileConservation(nextState, "pickDora");
          setGameState(nextState);
          refreshWinDoraCounts(nextState.meta);
          setPickerBatch({ active: false, firstIndex: null });
          setPickerOpen(false);
          return;
        } else {
          const indicatorTile = normalizedTile && normalizedTile !== "BACK" ? normalizedTile : "";
          desiredUra[pickerIndex] = indicatorTile;
          const nextState = {
            ...gameState,
            meta: {
              ...gameState.meta,
              liveWall: nextLiveWall,
              doraIndicators: desiredDora,
              uraDoraIndicators: desiredUra,
              doraRevealedCount: gameState.meta.doraRevealedCount ?? 1
            }
          };
          checkTileConservation(nextState, "pickUra");
          setGameState(nextState);
          refreshWinDoraCounts(nextState.meta);
          setPickerBatch({ active: false, firstIndex: null });
          setPickerOpen(false);
          return;
        }
      } else {
        const player = gameState.players[pickerSeat];
        const current = [...player.hand];
        while (current.length <= pickerIndex) current.push("");
        let targetIndex = pickerIndex;
        if (shouldBatch) {
          if (pickerBatch.firstIndex !== null) {
            targetIndex = pickerBatch.firstIndex;
          } else {
            const placeholderIdx = nextPlaceholderIndex(current);
            if (placeholderIdx >= 0) targetIndex = placeholderIdx;
          }
        }
        const prevTile = current[targetIndex] ?? "";
        const nextTile = normalizedTile ?? "";
        let nextLiveWall = gameState.meta.liveWall ?? [];
        if (prevTile !== nextTile) {
          const returnTile =
            prevTile && prevTile !== TILE_PLACEHOLDER && prevTile !== TILE_BACK ? canonicalTile(prevTile) : "";
          const takeTile =
            nextTile && nextTile !== TILE_PLACEHOLDER && nextTile !== TILE_BACK ? canonicalTile(nextTile) : "";
          if (returnTile) {
            nextLiveWall = [...nextLiveWall, returnTile];
          }
          if (takeTile) {
            const removed = WallOps.removeWallTile(nextLiveWall, takeTile);
            if (!removed.found) {
              appendActionLog("山にありません");
              return;
            }
            nextLiveWall = removed.next;
            current[targetIndex] = removed.tile;
          } else {
            current[targetIndex] = "";
          }
        }
        const nextHand = sortTiles(current);
        const nextState = {
          ...gameState,
          players: {
            ...gameState.players,
            [pickerSeat]: { ...player, hand: nextHand }
          },
          meta: {
            ...gameState.meta,
            liveWall: nextLiveWall
          }
        };
        checkTileConservation(nextState, "editHand");
        setGameState(nextState);
        if (shouldBatch) {
          const nextIdx = nextPlaceholderIndex(nextHand);
          if (nextIdx >= 0) {
            setPickerIndex(nextIdx);
            setPickerBatch({ active: true, firstIndex: null });
            return;
          }
          setPickerBatch({ active: false, firstIndex: null });
        }
      }
    } else if (pickerKind === "dora") {
      const indicatorTile = normalizedTile && normalizedTile !== "BACK" ? normalizedTile : "";
      setDoraOverrides((prev) => {
        const current = [...(prev[handKey] ?? Array(5).fill(""))];
        current[pickerIndex] = indicatorTile;
        return { ...prev, [handKey]: current };
      });
      const nextCount = Math.max(1, Math.min(5, Math.max(metaOverrides?.doraRevealedCount ?? 1, pickerIndex + 1)));
      setMetaOverrides((prev) => ({ ...(prev ?? {}), doraRevealedCount: nextCount, liveWall: [], deadWall: [] }));
      setPickerBatch({ active: false, firstIndex: null });
    } else if (pickerKind === "ura") {
      const indicatorTile = normalizedTile && normalizedTile !== "BACK" ? normalizedTile : "";
      setUraOverrides((prev) => {
        const current = [...(prev[handKey] ?? Array(5).fill(""))];
        current[pickerIndex] = indicatorTile;
        return { ...prev, [handKey]: current };
      });
      setMetaOverrides((prev) => ({ ...(prev ?? {}), liveWall: [], deadWall: [] }));
      setPickerBatch({ active: false, firstIndex: null });
    } else {
      const base = step?.hands?.[pickerSeat] ?? Array(13).fill("");
      const prevBySeat = handOverrides[handKey] ?? {};
      const currentHand = [...(prevBySeat[pickerSeat] ?? base)];
      while (currentHand.length <= pickerIndex) {
        currentHand.push("");
      }
      let targetIndex = pickerIndex;
      if (shouldBatch) {
        if (pickerBatch.firstIndex !== null) {
          targetIndex = pickerBatch.firstIndex;
        } else {
          const placeholderIdx = nextPlaceholderIndex(currentHand);
          if (placeholderIdx >= 0) targetIndex = placeholderIdx;
        }
      }
      currentHand[targetIndex] = normalizedTile ?? "";
      const nextHand = sortTiles(currentHand);
      setHandOverrides((prev) => {
        const bySeat = { ...(prev[handKey] ?? {}) };
        bySeat[pickerSeat] = nextHand;
        return { ...prev, [handKey]: bySeat };
      });
      setMetaOverrides((prev) => ({ ...(prev ?? {}), liveWall: [], deadWall: [] }));
      setMetaOverrides((prev) => ({ ...(prev ?? {}), liveWall: [], deadWall: [] }));
      if (shouldBatch) {
        const nextIdx = nextPlaceholderIndex(nextHand);
        if (nextIdx >= 0) {
          setPickerIndex(nextIdx);
          setPickerBatch({ active: true, firstIndex: null });
          return;
        }
        setPickerBatch({ active: false, firstIndex: null });
      }
    }
    setPickerOpen(false);
  };

  const updateSettingsDraft = (updates: Partial<SettingsDraft>) => {
    if (!settingsDraft) return;
    setSettingsDraft({ ...settingsDraft, ...updates });
  };

  useEffect(() => {
    if (!settingsDraft) {
      setSettingsDraft(buildSettingsDraft(viewState.meta));
    }
  }, [settingsDraft, viewState.meta]);

  const saveSettings = (draft: SettingsDraft | null = settingsDraft) => {
    if (!draft) return;
    const desiredDora = parseTiles(draft.doraIndicators);
    const desiredUra = parseTiles(draft.uraDoraIndicators);
    const derivedDealer = getDealerFromKyoku(draft.kyoku);
    const nextMeta: Partial<RoundMeta> = {
      wind: draft.wind,
      kyoku: draft.kyoku,
      honba: draft.honba,
      riichiSticks: draft.riichiSticks,
      dealer: derivedDealer
    };
    if (gameState) {
      let nextLiveWall = [...(gameState.meta.liveWall ?? [])];
      const prevIndicators = [...(gameState.meta.doraIndicators ?? [])].filter(Boolean);
      if (prevIndicators.length) {
        nextLiveWall = [...nextLiveWall, ...prevIndicators];
      }
      const removeTargets = [...desiredDora].filter(Boolean);
      removeTargets.forEach((tile) => {
        const removed = WallOps.removeWallTile(nextLiveWall, tile);
        if (removed.found) {
          nextLiveWall = removed.next;
        }
      });
      const nextDoraCount = desiredDora.length
        ? Math.max(1, Math.min(5, desiredDora.length))
        : gameState.meta.doraRevealedCount ?? 1;
      setGameState({
        ...gameState,
        meta: {
          ...gameState.meta,
          ...nextMeta,
          liveWall: nextLiveWall,
          deadWall: [],
          doraIndicators: desiredDora,
          uraDoraIndicators: desiredUra,
          doraRevealedCount: nextDoraCount
        }
      });
    } else {
      setMetaOverrides((prev) => ({
        ...(prev ?? {}),
        ...nextMeta,
        liveWall: [],
        deadWall: [],
        doraRevealedCount: desiredDora.length
          ? Math.max(1, Math.min(5, desiredDora.length))
          : prev?.doraRevealedCount ?? 1
      }));
      setDoraOverrides((prev) => ({ ...prev, [handKey]: desiredDora }));
      setUraOverrides((prev) => ({ ...prev, [handKey]: desiredUra }));
    }
  };

  useEffect(() => {
    if (!settingsDraft) return;
    if (!settingsInitRef.current) {
      settingsInitRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      saveSettings(settingsDraft);
    }, 350);
    return () => {
      window.clearTimeout(timer);
    };
  }, [settingsDraft]);

  const doDraw = () => {
    if (!gameState || gameState.phase !== "BEFORE_DRAW") return;
    pushUndo();
    const seat = gameState.turn;
    const player = gameState.players[seat];
    const expected = expectedHandCountBeforeDraw(player);
    if (stripTiles(player.hand).length !== expected) {
      appendActionLog(`手牌枚数が不正です（現在:${stripTiles(player.hand).length} / 期待:${expected}）`);
      return;
    }
    const liveWall = gameState.meta.liveWall ?? [];
    if (!liveWall.length) {
      if (ENABLE_RANDOM_FALLBACK) {
        const fallback = pickRandomAvailableTile(gameState);
        if (!fallback) return;
        appendActionLog("壁牌が空のためランダム抽選");
        setGameState({
          ...gameState,
          players: {
            ...gameState.players,
            [seat]: { ...gameState.players[seat], drawnTile: fallback, drawnFrom: "WALL", furitenTemp: false }
          },
          phase: "AFTER_DRAW_MUST_DISCARD"
        });
        return;
      }
      appendActionLog("壁牌がありません");
      return;
    }
    const popResult = WallOps.popWallTile(liveWall);
    const tile = popResult.tile;
    if (!tile) return;
    const nextLiveWall = popResult.next;
    const nextState: GameState = {
      ...gameState,
      players: {
        ...gameState.players,
        [seat]: { ...player, drawnTile: tile, drawnFrom: "WALL", furitenTemp: false }
      },
      meta: { ...gameState.meta, liveWall: nextLiveWall },
      phase: "AFTER_DRAW_MUST_DISCARD"
    };
    checkTileConservation(nextState, "doDraw");
    setGameState(nextState);
    appendActionLog(`${formatSeatForLog(seat)}ツモ: ${formatTileForLog(tile)}`);
    setSelectedDiscard(null);
  };

  const doDrawWithTile = (tile: TileStr) => {
    if (!gameState || gameState.phase !== "BEFORE_DRAW") return;
    pushUndo();
    const normalized = TileOps.canonicalTile(tile);
    if (!normalized) return;
    const seat = gameState.turn;
    const player = gameState.players[seat];
    const expected = expectedHandCountBeforeDraw(player);
    if (stripTiles(player.hand).length !== expected) {
      appendActionLog(`手牌枚数が不正です（現在:${stripTiles(player.hand).length} / 期待:${expected}）`);
      return;
    }
    let liveWall = gameState.meta.liveWall ?? [];
    const removed = WallOps.removeWallTile(liveWall, normalized);
    if (!removed.found) {
      appendActionLog("壁牌にありません");
      return;
    }
    liveWall = removed.next;
    const nextState: GameState = {
      ...gameState,
      players: {
        ...gameState.players,
        [seat]: { ...player, drawnTile: removed.tile, drawnFrom: "WALL", furitenTemp: false }
      },
      meta: { ...gameState.meta, liveWall },
      phase: "AFTER_DRAW_MUST_DISCARD"
    };
    checkTileConservation(nextState, "doDrawWithTile");
    setGameState(nextState);
    appendActionLog(`${formatSeatForLog(seat)}ツモ: ${formatTileForLog(removed.tile)}`);
    setSelectedDiscard(null);
  };

  const doDiscard = (tile: TileStr) => {
    if (!gameState || gameState.phase !== "AFTER_DRAW_MUST_DISCARD") return;
    pushUndo();
    const seat = gameState.turn;
    const player = gameState.players[seat];
    if (pendingRinshan && pendingRinshan === seat && !player.drawnTile) {
      setActionLog((prev) => [...prev, "リンシャン牌を選択してください"]);
      return;
    }
    if (!tile) return;
    const guardSig = `${seat}|${tile}|${gameState.phase}`;
    const now = Date.now();
    if (discardGuardRef.current && discardGuardRef.current.sig === guardSig && now - discardGuardRef.current.at < 250) {
      return;
    }
    discardGuardRef.current = { sig: guardSig, at: now };
    if (player.riichi) {
      const drawn = player.drawnTile;
      if (drawn && drawn !== tile) {
        return;
      }
    }
    if (player.drawnFrom === "CALL" && player.drawnTile && player.drawnTile === tile) {
      setActionLog((prev) => [...prev, "鳴き牌は捨てられません"]);
      return;
    }
    if (pendingRiichi) {
      const hasOptions = riichiOptions.length > 0;
      const matches = hasOptions
        ? riichiOptions.some((opt) => tileEq(opt, tile))
        : (() => {
            const drawn = player.drawnTile;
            if (!drawn) return false;
            return drawn === tile;
          })();
      if (!matches) {
        setActionLog((prev) => [...prev, "リーチ不可"]);
        return;
      }
    }
    let nextHand = [...player.hand];
    let nextDrawn: TileStr | null = null;
    let nextDrawnFrom: GameState["players"][Seat]["drawnFrom"] = null;
    if (player.drawnTile && player.drawnTile === tile) {
      nextDrawn = null;
    } else {
      nextHand = removeOneExactThenNorm(nextHand, tile);
      if (player.drawnTile && player.drawnFrom !== "CALL") {
        nextHand.push(player.drawnTile);
      }
    }
    const riichiDeclared = pendingRiichi;
    const nextRiichiSticks = riichiDeclared ? gameState.meta.riichiSticks + 1 : gameState.meta.riichiSticks;
    const nextPoints = riichiDeclared
      ? { ...gameState.meta.points, [seat]: gameState.meta.points[seat] - 1000 }
      : gameState.meta.points;
    const nextState: GameState = {
      ...gameState,
      players: {
        ...gameState.players,
        [seat]: {
          ...player,
          hand: sortTiles(nextHand),
          drawnTile: nextDrawn,
          drawnFrom: nextDrawnFrom,
          discards: [...player.discards, tile],
          riichi: riichiDeclared ? true : player.riichi,
          ippatsu: riichiDeclared ? true : player.ippatsu
        }
      },
      phase: "AWAITING_CALL",
      lastDiscard: { seat, tile },
      meta: {
        ...gameState.meta,
        riichiSticks: nextRiichiSticks,
        points: nextPoints
      }
    };
    checkTileConservation(nextState, "doDiscard");
    if (riichiDeclared) {
      setRiichiDiscards((prev) => ({
        ...prev,
        [seat]: player.discards.length
      }));
    }
    const claims = getLegalActions(nextState)
      .filter(
        (action): action is Extract<LegalAction, { type: "CHI" | "PON" | "KAN" | "RON_WIN" }> =>
          action.type === "CHI" || action.type === "PON" || action.type === "KAN" || action.type === "RON_WIN"
      )
      .map((action) => {
        const claimType: "CHI" | "PON" | "KAN" | "RON" =
          action.type === "RON_WIN" ? "RON" : action.type;
        return {
          type: claimType,
          by: action.by,
          tile: action.tile
        };
      });
    nextState.pendingClaims = claims.length ? claims : [];
    setGameState(nextState);
    appendActionLog([
      `${formatSeatForLog(seat)}ステ: ${formatTileForLog(tile)}`,
      ...(riichiDeclared ? [`${formatSeatForLog(seat)}リーチ`] : [])
    ]);
    setJunmeCount((prev) => prev + 1);
    setSelectedDiscard(null);
    setPendingRiichi(false);
  };

  const advanceToNextDraw = () => {
    if (!gameState) return;
    pushUndo();
    const ronSeats = callOptionsAll
      .filter((action) => action.type === "RON_WIN")
      .map((action) => action.by);
    const nextTurn = nextSeat(gameState.turn);
    const updatedPlayers: Record<Seat, GameState["players"][Seat]> = {
      E: { ...gameState.players.E },
      S: { ...gameState.players.S },
      W: { ...gameState.players.W },
      N: { ...gameState.players.N }
    };
    ronSeats.forEach((seat) => {
      updatedPlayers[seat] = { ...updatedPlayers[seat], furitenTemp: true };
    });
    const nextState: GameState = {
      ...gameState,
      turn: nextTurn,
      players: {
        ...updatedPlayers,
        [nextTurn]: { ...updatedPlayers[nextTurn], drawnTile: null, drawnFrom: null, furitenTemp: false }
      },
      phase: "BEFORE_DRAW",
      lastDiscard: undefined,
      pendingClaims: []
    };
    checkTileConservation(nextState, "advanceToNextDraw");
    setGameState(nextState);
    setSelectedDiscard(null);
    setPendingRiichi(false);
  };

  const applyClaim = (
    claim: Extract<LegalAction, { type: "CHI" | "PON" | "KAN" }>,
    selectedTiles?: TileStr[]
  ) => {
    if (!gameState) return;
    pushUndo();
    const by = claim.by;
    const from = claim.from ?? gameState.lastDiscard?.seat ?? by;
    const tile = claim.tile || gameState.lastDiscard?.tile || "";
    if ((claim.type === "CHI" || claim.type === "PON" || claim.type === "KAN") && !gameState.lastDiscard) return;
    const player = gameState.players[by];
    let meldTiles: TileStr[] = [];
    let updatedHand = player.hand;
    let meldKind: "CHI" | "PON" | "MINKAN" = "CHI";
    let nextDrawnTile: TileStr | null = null;
    let nextDrawnFrom: GameState["players"][Seat]["drawnFrom"] = null;
    let nextDoraCount = gameState.meta.doraRevealedCount ?? 1;

    if (claim.type === "CHI") {
      if (from !== prevSeat(by)) return;
      const pair = selectedTiles && selectedTiles.length === 2 ? selectedTiles : pickChiTiles(player.hand, tile);
      if (!pair || !isValidChiTiles(tile, pair)) {
        appendActionLog("チー不可");
        return;
      }
      const ordered = sortTiles(pair);
      const list = [...ordered];
      list.splice(0, 0, tile);
      meldTiles = list;
      updatedHand = removeTiles(player.hand, pair);
      meldKind = "CHI";
      nextDrawnTile = null;
      nextDrawnFrom = null;
    } else if (claim.type === "PON") {
      const taken = selectedTiles && selectedTiles.length === 2 ? selectedTiles : null;
      const { taken: autoTaken, remaining } = takeTilesExactThenNorm(player.hand, tile, 2);
      const finalTaken = taken ?? autoTaken;
      if (finalTaken.length < 2) return;
      const insertIndex = calledIndexFor(by, from, 3) ?? 1;
      const list = [...sortTiles(finalTaken)];
      list.splice(insertIndex, 0, tile);
      meldTiles = list;
      updatedHand = sortTiles(taken ? removeTiles(player.hand, finalTaken) : remaining);
      meldKind = "PON";
      nextDrawnTile = null;
      nextDrawnFrom = null;
    } else {
      const taken = selectedTiles && selectedTiles.length === 3 ? selectedTiles : null;
      const { taken: autoTaken, remaining } = takeTilesExactThenNorm(player.hand, tile, 3);
      const finalTaken = taken ?? autoTaken;
      if (finalTaken.length < 3) return;
      const insertIndex = calledIndexFor(by, from, 4) ?? 1;
      const list = [...sortTiles(finalTaken)];
      list.splice(insertIndex, 0, tile);
      meldTiles = list;
      updatedHand = sortTiles(taken ? removeTiles(player.hand, finalTaken) : remaining);
      meldKind = "MINKAN";
      nextDrawnTile = null;
      nextDrawnFrom = null;
      if (nextDoraCount < 5) nextDoraCount += 1;
    }

    const clearedPlayers: Record<Seat, GameState["players"][Seat]> = {
      E: { ...gameState.players.E, ippatsu: false },
      S: { ...gameState.players.S, ippatsu: false },
      W: { ...gameState.players.W, ippatsu: false },
      N: { ...gameState.players.N, ippatsu: false }
    };
    const baseHand = updatedHand;
    const currentDoraCount = gameState.meta.doraRevealedCount ?? 1;
    let nextDoraIndicators = [...(gameState.meta.doraIndicators ?? [])];
    let nextLiveWall = [...(gameState.meta.liveWall ?? [])];
    if (claim.type === "KAN" && nextDoraCount > currentDoraCount) {
      const revealed = nextLiveWall.pop();
      if (revealed) {
        while (nextDoraIndicators.length < nextDoraCount) nextDoraIndicators.push("");
        nextDoraIndicators[nextDoraCount - 1] = revealed;
      }
    }
    const nextState: GameState = {
      ...gameState,
      players: {
        ...clearedPlayers,
        [by]: {
          ...clearedPlayers[by],
          hand: sortTiles(baseHand),
          drawnTile: nextDrawnTile,
          drawnFrom: nextDrawnFrom,
          melds: [
            ...player.melds,
            {
              kind: meldKind,
              tiles: meldTiles,
              by,
              calledFrom: from,
              calledTile: tile,
              open: true
            }
          ],
          closed: false
        },
        ...(by !== from && gameState.lastDiscard?.tile
          ? {
              [from]: {
                ...clearedPlayers[from],
                discards: removeLastDiscard(gameState.players[from].discards, gameState.lastDiscard.tile)
              }
            }
          : {})
      },
      meta: {
        ...gameState.meta,
        doraRevealedCount: nextDoraCount,
        doraIndicators: nextDoraIndicators,
        liveWall: nextLiveWall
      },
      turn: by,
      phase: "AFTER_DRAW_MUST_DISCARD",
      lastDiscard: undefined,
      pendingClaims: []
    };
    checkTileConservation(nextState, "applyClaim");
    setGameState(nextState);
    const label = claim.type === "CHI" ? "チー" : claim.type === "PON" ? "ポン" : "カン";
    appendActionLog(`${formatSeatForLog(by)}${label}: ${formatTileForLog(tile)}`);
    setPendingRiichi(false);
    if (claim.type === "KAN") {
      setPendingRinshan(by);
      openRinshanPicker(by);
    }
  };

  const closeCallPicker = () => {
    setCallPickerOpen(false);
    setCallPickerOptions([]);
  };

  const openCallPicker = (action: Extract<LegalAction, { type: "CHI" | "PON" | "KAN" }>) => {
    if (!gameState || !gameState.lastDiscard) return;
    const by = action.by;
    const from = action.from ?? gameState.lastDiscard.seat;
    const tile = action.tile || gameState.lastDiscard.tile;
    const hand = gameState.players[by].hand;
    let options: CallMeldOption[] = [];

    if (action.type === "CHI") {
      const pairs = getChiCandidates(hand, tile);
      options = pairs.map((pair) => ({
        type: "CHI",
        by,
        from,
        tile,
        usedTiles: pair,
        meldTiles: buildMeldTilesForCall("CHI", by, from, tile, pair),
        label: "チー"
      }));
    } else if (action.type === "PON") {
      const pairs = collectMatchingCombos(hand, tile, 2);
      options = pairs.map((pair) => ({
        type: "PON",
        by,
        from,
        tile,
        usedTiles: pair,
        meldTiles: buildMeldTilesForCall("PON", by, from, tile, pair),
        label: "ポン"
      }));
    } else if (action.type === "KAN") {
      const triples = collectMatchingCombos(hand, tile, 3);
      options = triples.map((triple) => ({
        type: "KAN",
        by,
        from,
        tile,
        usedTiles: triple,
        meldTiles: buildMeldTilesForCall("KAN", by, from, tile, triple),
        label: "カン"
      }));
    }

    if (!options.length) return;
    setCallPickerOptions(options);
    setCallPickerOpen(true);
  };

  const applyCallOption = (option: CallMeldOption) => {
    applyClaim(option, option.usedTiles);
    closeCallPicker();
  };

  useEffect(() => {
    if (!gameState || gameState.phase !== "AWAITING_CALL") {
      closeCallPicker();
    }
  }, [gameState]);

  const doClaim = (type: "CHI" | "PON" | "KAN") => {
    if (!gameState) return;
    const claim = getLegalActions(gameState, "E").find(
      (action): action is Extract<LegalAction, { type: "CHI" | "PON" | "KAN" }> => action.type === type
    );
    if (!claim) return;
    applyClaim(claim);
  };

  const applyWinResult = (
    winType: "ron" | "tsumo",
    winner: Seat,
    result: any,
    loser?: Seat
  ) => {
    if (!gameState || !result?.cost) return { nextPoints: gameState?.meta.points ?? { E: 0, S: 0, W: 0, N: 0 } };
    const points: Record<Seat, number> = { ...gameState.meta.points };
    const cost = result.cost;
    if (winType === "ron" && loser) {
      const pay = Number(cost.main ?? 0);
      points[loser] = (points[loser] ?? 0) - pay;
      points[winner] = (points[winner] ?? 0) + pay;
    } else if (winType === "tsumo") {
      const isDealer = winner === gameState.meta.dealer;
      if (isDealer) {
        const pay = Number(cost.main ?? 0);
        SEAT_LIST.forEach((seat) => {
          if (seat === winner) return;
          points[seat] = (points[seat] ?? 0) - pay;
          points[winner] = (points[winner] ?? 0) + pay;
        });
      } else {
        const payDealer = Number(cost.main ?? 0);
        const payOther = Number(cost.additional ?? 0);
        SEAT_LIST.forEach((seat) => {
          if (seat === winner) return;
          const pay = seat === gameState.meta.dealer ? payDealer : payOther;
          points[seat] = (points[seat] ?? 0) - pay;
          points[winner] = (points[winner] ?? 0) + pay;
        });
      }
    }
    const riichiPayout = Math.max(0, (gameState.meta.riichiSticks ?? 0)) * 1000;
    if (riichiPayout > 0) {
      points[winner] = (points[winner] ?? 0) + riichiPayout;
    }
    return { nextPoints: points };
  };

  const buildDefaultWinOptions = (seat: Seat, winType: "ron" | "tsumo", winTile: TileStr | null) => {
    const base = { ...defaultWinOptions };
    const player = gameState?.players[seat];
    if (player) {
      if (winType === "tsumo" && player.drawnFrom === "RINSHAN") {
        base.is_rinshan = true;
      }
      if (gameState && winTile) {
        const hasRiichi = player.riichi || base.is_daburu_riichi || base.is_open_riichi;
        const counts = computeDoraCountsForWin(gameState.meta, player, winTile, hasRiichi);
        base.doraCount = counts.dora;
        base.uraCount = counts.ura;
        base.akaCount = counts.aka;
      }
    }
    return base;
  };

  const openWinOptions = (next: { type: "ron"; claim: Extract<LegalAction, { type: "RON_WIN" }> } | { type: "tsumo"; seat: Seat }) => {
    const seat = next.type === "ron" ? next.claim.by : next.seat;
    const winTile =
      next.type === "ron"
        ? next.claim.tile
        : gameState?.players[seat]?.drawnTile ?? null;
    setWinOptions(buildDefaultWinOptions(seat, next.type, winTile));
    setPendingWin(next);
    setWinOptionsOpen(true);
  };

  const applyRon = async (claim: Extract<LegalAction, { type: "RON_WIN" }>, extraFlags?: WinOptionFlags) => {
    if (!gameState || !gameState.lastDiscard) return;
    pushUndo();
    const winner = claim.by;
    const tile = claim.tile;
    const player = gameState.players[winner];
    if (player.furiten || player.furitenTemp) {
      setActionLog((prev) => [...prev, "ロン不可"]);
      return;
    }
    const context = buildScoreContext(gameState.meta, player, winner, tile, "ron");
    const res = await scoreWinWithVariants(context, extraFlags).catch((err) => ({ ok: false, error: String(err) }));
    appendScoreDebug(res);
    const adjustedResult = applyDoraOverridesToResult(res?.result, context, extraFlags);
    const han = adjustedResult?.han ?? 0;
    if (!res?.ok || han <= 0) {
      setActionLog((prev) => [...prev, `ロン不可${formatScoreFailureDetail(res)}`]);
      return;
    }
    const loserSeat = gameState.lastDiscard.seat;
    const riichiDiscardIndex = riichiDiscards[loserSeat];
    const lastDiscardIndex = gameState.players[loserSeat]?.discards.length
      ? gameState.players[loserSeat].discards.length - 1
      : null;
    const isRiichiDeclarationRon =
      riichiDiscardIndex != null && lastDiscardIndex != null && riichiDiscardIndex === lastDiscardIndex;
    let { nextPoints } = applyWinResult("ron", winner, adjustedResult, loserSeat);
    if (isRiichiDeclarationRon) {
      nextPoints = {
        ...nextPoints,
        [winner]: (nextPoints[winner] ?? 0) - 1000,
        [loserSeat]: (nextPoints[loserSeat] ?? 0) + 1000
      };
    }
    setGameState({
      ...gameState,
      meta: { ...gameState.meta, points: nextPoints, riichiSticks: 0 },
      phase: "ENDED"
    });
    const doraCounts =
      sanitizeDoraCounts(extraFlags) ??
      computeDoraCountsForWin(
        gameState.meta,
        player,
        tile,
        player.riichi || Boolean(extraFlags?.is_daburu_riichi || extraFlags?.is_open_riichi)
      );
    setWinInfo({
      seat: winner,
      tile,
      type: "ron",
      result: adjustedResult,
      from: loserSeat,
      doraCounts
    });
    appendActionLog([
      `${formatSeatForLog(winner)}ロン`,
      formatScoreLine(adjustedResult),
      `点数: 東${nextPoints.E} 南${nextPoints.S} 西${nextPoints.W} 北${nextPoints.N}`
    ]);
  };

  const doRon = async () => {
    if (!gameState) return;
    const claim = callOptionsSorted.find(
      (action): action is Extract<LegalAction, { type: "RON_WIN" }> => action.type === "RON_WIN"
    );
    if (!claim) return;
    openWinOptions({ type: "ron", claim });
  };

  const applyTsumoWin = async (extraFlags?: WinOptionFlags) => {
    if (!gameState || gameState.phase !== "AFTER_DRAW_MUST_DISCARD") return;
    pushUndo();
    const winner = gameState.turn;
    const player = gameState.players[winner];
    if (player.drawnFrom === "CALL") return;
    const winTile = player.drawnTile ?? "";
    if (!winTile) return;
    const context = buildScoreContext(gameState.meta, player, winner, winTile, "tsumo");
    const res = await scoreWinWithVariants(context, extraFlags).catch((err) => ({ ok: false, error: String(err) }));
    appendScoreDebug(res);
    const adjustedResult = applyDoraOverridesToResult(res?.result, context, extraFlags);
    const han = adjustedResult?.han ?? 0;
    if (!res?.ok || han <= 0) {
      setActionLog((prev) => [...prev, `ツモ和了不可${formatScoreFailureDetail(res)}`]);
      return;
    }
    const { nextPoints } = applyWinResult("tsumo", winner, adjustedResult);
    setGameState({
      ...gameState,
      meta: { ...gameState.meta, points: nextPoints, riichiSticks: 0 },
      phase: "ENDED"
    });
    const doraCounts =
      sanitizeDoraCounts(extraFlags) ??
      computeDoraCountsForWin(
        gameState.meta,
        player,
        winTile,
        player.riichi || Boolean(extraFlags?.is_daburu_riichi || extraFlags?.is_open_riichi)
      );
    setWinInfo({
      seat: winner,
      tile: winTile,
      type: "tsumo",
      result: adjustedResult,
      from: winner,
      doraCounts
    });
    appendActionLog([
      `${formatSeatForLog(winner)}ツモ`,
      ...(player.closed ? ["門前ツモ"] : []),
      formatScoreLine(adjustedResult),
      `点数: 東${nextPoints.E} 南${nextPoints.S} 西${nextPoints.W} 北${nextPoints.N}`
    ]);
  };

  const doTsumoWin = async () => {
    if (!gameState || gameState.phase !== "AFTER_DRAW_MUST_DISCARD") return;
    const winner = gameState.turn;
    const player = gameState.players[winner];
    if (player.drawnFrom === "CALL") return;
    if (!player.drawnTile) return;
    openWinOptions({ type: "tsumo", seat: winner });
  };

  const confirmWinOptions = async () => {
    if (!pendingWin) return;
    if (pendingWin.type === "ron") {
      await applyRon(pendingWin.claim, winOptions);
    } else {
      await applyTsumoWin(winOptions);
    }
    setPendingWin(null);
    setWinOptionsOpen(false);
  };

  const doRiichi = () => {
    if (!gameState || gameState.phase !== "AFTER_DRAW_MUST_DISCARD") return;
    const seat = gameState.turn;
    const player = gameState.players[seat];
    if (player.riichi) return;
    if (gameState.meta.points[seat] < 1000) return;
    if (!riichiAllowed) return;
    setPendingRiichi(true);
    appendActionLog(`${formatSeatForLog(seat)}リーチ宣言: 捨て牌を選択してください`);
  };

  const cancelRiichiDeclaration = () => {
    if (!pendingRiichi) return;
    const seat = gameState?.turn ?? null;
    setPendingRiichi(false);
    if (seat) {
      appendActionLog(`${formatSeatForLog(seat)}リーチ取消`);
    }
  };

  const doSelfKan = () => {
    if (!gameState || gameState.phase !== "AFTER_DRAW_MUST_DISCARD") return;
    pushUndo();
    const seat = gameState.turn;
    const player = gameState.players[seat];
    if (player.riichi) return;
    const workingHand = player.drawnTile ? [...player.hand, player.drawnTile] : [...player.hand];
    const counts: Record<string, number> = {};
    workingHand.forEach((tile) => {
      const key = tileNorm(tile);
      if (!key) return;
      counts[key] = (counts[key] ?? 0) + 1;
    });
    const closedTarget = Object.keys(counts).find((tile) => counts[tile] >= 4) ?? null;
    const addedTarget = closedTarget ? null : pickAddedKanTile(workingHand, player.melds);
    if (!closedTarget && !addedTarget) return;

    let nextHand = workingHand;
    let nextMelds = player.melds;
    let nextClosed = player.closed;
    if (closedTarget) {
      const { taken, remaining } = takeTilesExactThenNorm(nextHand, closedTarget, 4);
      nextHand = remaining;
      nextMelds = [
        ...nextMelds,
        {
          kind: "ANKAN",
          tiles: taken.length ? taken : [closedTarget, closedTarget, closedTarget, closedTarget],
          by: seat,
          calledFrom: undefined,
          calledTile: closedTarget,
          open: false
        }
      ];
    } else if (addedTarget) {
      const { taken, remaining } = takeTilesExactThenNorm(nextHand, addedTarget, 1);
      nextHand = remaining;
      let upgraded = false;
      nextMelds = nextMelds.map((meld) => {
        if (upgraded || meld.kind !== "PON") return meld;
        const match = tileNorm(meld.tiles[0]) === tileNorm(addedTarget);
        if (!match) return meld;
        upgraded = true;
        return {
          ...meld,
          kind: "KAKAN",
          tiles: [...meld.tiles, ...(taken.length ? taken : [addedTarget])],
          by: seat,
          open: true
        };
      });
      nextClosed = false;
    }

    const currentDoraCount = gameState.meta.doraRevealedCount ?? 1;
    const nextDoraCount = Math.min(5, currentDoraCount + 1);
    let nextDoraIndicators = [...(gameState.meta.doraIndicators ?? [])];
    let nextLiveWall = [...(gameState.meta.liveWall ?? [])];
    if (nextDoraCount > currentDoraCount) {
      const revealed = nextLiveWall.pop();
      if (revealed) {
        while (nextDoraIndicators.length < nextDoraCount) nextDoraIndicators.push("");
        nextDoraIndicators[nextDoraCount - 1] = revealed;
      }
    }
    const clearedPlayers: Record<Seat, GameState["players"][Seat]> = {
      E: { ...gameState.players.E, ippatsu: false },
      S: { ...gameState.players.S, ippatsu: false },
      W: { ...gameState.players.W, ippatsu: false },
      N: { ...gameState.players.N, ippatsu: false }
    };
    const nextState: GameState = {
      ...gameState,
      players: {
        ...clearedPlayers,
        [seat]: {
          ...clearedPlayers[seat],
          hand: sortTiles(nextHand),
          drawnTile: null,
          drawnFrom: null,
          melds: nextMelds,
          closed: nextClosed
        }
      },
      meta: {
        ...gameState.meta,
        doraRevealedCount: nextDoraCount,
        doraIndicators: nextDoraIndicators,
        liveWall: nextLiveWall
      },
      phase: "AFTER_DRAW_MUST_DISCARD"
    };
    checkTileConservation(nextState, "doSelfKan");
    setGameState(nextState);
    const kanTileLabel = closedTarget ?? addedTarget ?? "";
    if (kanTileLabel) {
      appendActionLog(`${formatSeatForLog(seat)}カン: ${formatTileForLog(kanTileLabel)}`);
    } else {
      appendActionLog("カン");
    }
    setPendingRinshan(seat);
    openRinshanPicker(seat);
  };

  useEffect(() => {
    if (!gameState || gameState.phase !== "AWAITING_CALL") return;
    if (undoGuardRef.current) return;
    if (tenpaiChecking) return;
    if (callOptionsAll.length === 0) {
      advanceToNextDraw();
    }
  }, [gameState, callOptionsAll, tenpaiChecking]);

  useEffect(() => {
    if (!gameState || gameState.phase !== "AFTER_DRAW_MUST_DISCARD") {
      if (undoGuardRef.current) return;
      setPendingRiichi(false);
    }
  }, [gameState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    if (pickerOpen || callPickerOpen) return;
      const key = event.key.toLowerCase();
      if (key === "d") {
        doDraw();
      } else if (key === "x") {
        if (selectedDiscard) doDiscard(selectedDiscard);
      } else if (key === "t") {
        doTsumoWin();
      } else if (key === "r") {
        doRon();
      } else if (key === "c") {
        doClaim("CHI");
      } else if (key === "p") {
        doClaim("PON");
      } else if (key === "k") {
        doClaim("KAN");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedDiscard, pickerOpen, callPickerOpen, gameState]);

  const getTileSrc = (tile: string) => TileOps.tileToAsset(tileLabel(tile));
  const handleRemainingTileClick = (tile: string, count: number) => {
    if (!gameState || gameState.phase !== "BEFORE_DRAW") return;
    if (remainingCountForDisplay(tile) <= 0) return;
    doDrawWithTile(tile);
  };

  const rightPanelProps = {
    showButtons: true,
    initialLocked,
    onRandomHands: runImmediate(handleRandomHands),
    onLogClear: runImmediate(handleLogClear),
    onClearHands: runImmediate(handleClearHands),
    onLogExport: exportLog,
    onUndo: undoLast,
    undoDisabled: undoCount === 0,
    onPickDora: runImmediate(openDoraPicker),
    doraDisplayTiles: getDoraDisplayTiles(viewState.meta),
    doraRevealedCount: viewState.meta.doraRevealedCount ?? 1,
    getTileSrc,
    settingsDraft,
    onUpdateSettingsDraft: updateSettingsDraft,
    tenpaiChecking,
    tenpaiError,
    rulesErrors,
    actionLog
  };

  const buildSeatActions = useCallback((seat: Seat, player: PlayerState) => {
    const actions: SeatAction[] = [];
    if (!gameState) return actions;
    if (pendingRinshan === seat) return actions;
    if (gameState.phase === "AFTER_DRAW_MUST_DISCARD" && gameState.turn === seat) {
      if (riichiAllowed) {
        actions.push({ key: "riichi", label: "リーチ", onClick: doRiichi, disabled: pendingRiichi });
      }
      if (pendingRiichi) {
        actions.push({ key: "riichi-cancel", label: "キャンセル", onClick: cancelRiichiDeclaration });
      }
      if (tenpaiFlags[seat] && player.drawnTile && player.drawnFrom !== "CALL") {
        actions.push({ key: "tsumo", label: "ツモ", onClick: doTsumoWin });
      }
      const selfActions = getLegalActions(gameState, seat);
      if (selfActions.some((action) => action.type === "KAN")) {
        actions.push({ key: "self-kan", label: "カン", onClick: doSelfKan });
      }
    }
    if (gameState.phase === "AWAITING_CALL") {
      const seatCalls = callOptionsAll.filter((action) => action.by === seat);
      seatCalls.forEach((action, idx) => {
        if (action.type === "RON_WIN") {
          actions.push({ key: `ron-${idx}`, label: "ロン", onClick: () => openWinOptions({ type: "ron", claim: action }) });
        } else if (action.type === "CHI" || action.type === "PON" || action.type === "KAN") {
          const label = action.type === "CHI" ? "チー" : action.type === "PON" ? "ポン" : "カン";
          actions.push({ key: `${action.type}-${idx}`, label, onClick: () => openCallPicker(action) });
        }
      });
      if (seatCalls.length > 0) {
        actions.push({ key: "call-cancel", label: "キャンセル", onClick: advanceToNextDraw });
      }
    }
    return actions;
  }, [
    gameState,
    pendingRinshan,
    riichiAllowed,
    pendingRiichi,
    tenpaiFlags,
    callOptionsAll,
    doRiichi,
    cancelRiichiDeclaration,
    doTsumoWin,
    doSelfKan,
    openWinOptions,
    openCallPicker,
    advanceToNextDraw
  ]);

  const handleHandTileClick = useCallback((seat: Seat, tile: TileStr, index: number, event?: ReactMouseEvent) => {
    if (!tile) return;
    if (gameState) {
      const player = gameState.players[seat];
      const canEditInitial = player.discards.length === 0;
      const wantsEdit = Boolean(event?.shiftKey) && canEditInitial;
      if (gameState.phase === "AFTER_DRAW_MUST_DISCARD" && gameState.turn === seat && !wantsEdit) {
        doDiscard(tile);
        return;
      }
      if (canEditInitial) {
        openPicker(seat, index, tile, true);
      }
      return;
    }
    openPicker(seat, index, tile);
  }, [gameState, doDiscard, openPicker]);

  const handleHandTileContextMenu = useCallback(
    (seat: Seat, tile: TileStr, index: number, event: ReactMouseEvent) => {
      if (!gameState) return;
      const player = gameState.players[seat];
      if (player.discards.length !== 0) return;
      event.preventDefault();
      if (player.drawnTile && index >= player.hand.length && gameState.turn === seat) {
        openDrawPicker(seat);
        return;
      }
      openPicker(seat, index, tile, true);
    },
    [gameState, openPicker, openDrawPicker]
  );

  const handleDrawTileClick = useCallback((seat: Seat) => {
    openDrawPicker(seat);
  }, [openDrawPicker]);

  const editableBySeat = useMemo(() => {
    if (!gameState) return { E: true, S: true, W: true, N: true };
    const base = { E: false, S: false, W: false, N: false };
    SEAT_LIST.forEach((seat) => {
      const player = gameState.players[seat];
      if (player.discards.length === 0) {
        base[seat] = true;
      }
    });
    return base;
  }, [gameState]);

  const clickableBySeat = useMemo(() => {
    if (!gameState) return { E: true, S: true, W: true, N: true };
    const base = { E: false, S: false, W: false, N: false };
    if (gameState.phase === "AFTER_DRAW_MUST_DISCARD") {
      base[gameState.turn] = true;
    }
    SEAT_LIST.forEach((seat) => {
      const player = gameState.players[seat];
      if (player.discards.length === 0) {
        base[seat] = true;
      }
    });
    return base;
  }, [gameState]);

  const { seatSummaryItems, seatBlockItems } = useSeatViewModel({
    seatOrder,
    viewState,
    waitsBySeat,
    tenpaiFlags,
    seatNames,
    windLabels: WIND_LABELS,
    buildSeatActions,
    updateSeatName,
    updateSeatPoints,
    clickableBySeat,
    editableBySeat,
    riichiDiscards
  });

  const pickerAnchorPosition = useMemo<"above" | "below" | null>(() => {
    if (!pickerOpen) return null;
    if (!["hand", "draw", "rinshan"].includes(pickerKind)) return null;
    const idx = seatBlockItems.findIndex((item) => item.seat === pickerSeat);
    if (idx < 0) return null;
    return idx < 2 ? "below" : "above";
  }, [pickerOpen, pickerKind, pickerSeat, seatBlockItems]);
  const pendingWinSeat =
    pendingWin?.type === "ron" ? pendingWin.claim.by : pendingWin?.type === "tsumo" ? pendingWin.seat : null;
  const showUraIndicators = Boolean(
    pendingWinSeat &&
      (viewState.players[pendingWinSeat]?.riichi ||
        winOptions.is_daburu_riichi ||
        winOptions.is_open_riichi)
  );

  return (
    <div className="app-shell">
      <input
        ref={imageImportRef}
        type="file"
        accept="image/*"
        onChange={handleImageImport}
        style={{ display: "none" }}
      />
      <SeatSummaryBar
        items={seatSummaryItems}
        tileToAsset={tileToAsset}
        remainingCountForDisplay={remainingCountForDisplay}
      />
      <div className="app-container">
        <LeftTools
          wallRemaining={totalWallRemaining}
          remainingTiles={remainingTiles}
          onRemainingTileClick={handleRemainingTileClick}
          showRemaining
          getTileSrc={getTileSrc}
        />
        <div className="center-column">
          <div className="simple-list">
            {seatBlockItems.map((item) => (
              <SeatBlock
                key={`seat-${item.seat}`}
                item={item}
                onHandTileClick={handleHandTileClick}
                onHandTileContextMenu={handleHandTileContextMenu}
                onDrawTileClick={handleDrawTileClick}
                showDrawPlaceholder={canSelectDrawTile(item.seat)}
                onImportImage={onImportImage}
                importDisabled={imageImportBusy}
                tileToAsset={tileToAsset}
                tileBack={TILE_BACK}
                tilePlaceholder={TILE_PLACEHOLDER}
                tileWidth={TILE_W}
                tileHeight={TILE_H}
                meldTileWidth={MELD_TILE_W}
                meldTileHeight={MELD_TILE_H}
                calledIndexFor={calledIndexFor}
              />
            ))}
          </div>
        </div>
        <RightPanel {...rightPanelProps} />
      </div>

      <PickerModal
        open={pickerOpen}
        kind={pickerKind}
        anchorPosition={pickerAnchorPosition}
        isTileAvailable={isTileAvailable}
        remainingCount={remainingCountForPicker}
        tileToAsset={tileToAsset}
        onSelect={applyTile}
        onClose={() => {
          if (pickerKind === "rinshan") return;
          setPickerBatch({ active: false, firstIndex: null });
          setPickerOpen(false);
        }}
      />

      <WinOptionsModal
        open={winOptionsOpen}
        winType={pendingWin?.type ?? null}
        options={winOptions}
        doraIndicators={getDoraIndicators(viewState.meta)}
        showUraIndicators={showUraIndicators}
        uraDoraIndicators={getUraDoraIndicators(viewState.meta)}
        doraRevealedCount={viewState.meta.doraRevealedCount ?? 1}
        getTileSrc={getTileSrc}
        onPickDora={runImmediate(openDoraPicker)}
        onPickUra={runImmediate(openUraPicker)}
        onChange={setWinOptions}
        onConfirm={confirmWinOptions}
        onCancel={() => {
          setWinOptionsOpen(false);
          setPendingWin(null);
        }}
      />

      {callPickerOpen && (
        <div className="call-picker-backdrop" onClick={closeCallPicker} role="presentation">
          <div className="call-picker-modal" onClick={(e) => e.stopPropagation()} role="presentation">
            <div className="call-picker-title">鳴き候補</div>
            <div className="call-picker-options">
              {callPickerOptions.map((option, idx) => (
                <button
                  key={`call-option-${idx}`}
                  className="call-picker-option"
                  type="button"
                  onClick={() => applyCallOption(option)}
                >
                  <div className="call-picker-label">{option.label}</div>
                  <div className="call-picker-tiles">
                    <MeldTiles
                      meld={{
                        kind: option.type,
                        tiles: option.meldTiles,
                        by: option.by,
                        calledFrom: option.from,
                        calledTile: option.tile
                      }}
                      owner={option.by}
                      tileToAsset={tileToAsset}
                      tileBack={TILE_BACK}
                      tilePlaceholder={TILE_PLACEHOLDER}
                      meldTileWidth={MELD_TILE_W}
                      meldTileHeight={MELD_TILE_H}
                      calledIndexFor={calledIndexFor}
                    />
                  </div>
                </button>
              ))}
            </div>
            <div className="call-picker-actions">
              <button className="picker-close" type="button" onClick={closeCallPicker}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
