import { type CSSProperties, Fragment, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";

type Seat = "E" | "S" | "W" | "N";

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

const TILE_W = 28;
const TILE_H = 36;
const SMALL_TILE_W = 24;
const SMALL_TILE_H = 32;
const MELD_TILE_W = 20;
const MELD_TILE_H = 28;
const TOTAL_TILES = 136;

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

const shuffleInPlace = (arr: string[]) => {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
};

type TileStr = string;

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
    if (!state.players[turnSeat].riichi && canClosedKan(hand)) {
      actions.push({ type: "KAN", by: turnSeat, from: turnSeat, tile: "" });
    }
    const ponTiles = state.players[turnSeat].melds.filter((meld) => meld.kind === "PON").flatMap((meld) => meld.tiles);
    if (!state.players[turnSeat].riichi && ponTiles.length && canAddedKan(hand, ponTiles)) {
      actions.push({ type: "KAN", by: turnSeat, from: turnSeat, tile: "" });
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

const validateState = (state: GameState, pendingRinshanSeat?: Seat | null): string[] => {
  const errors: string[] = [];
  SEATS.forEach((seat) => {
    const player = state.players[seat];
    const handCount = countNonEmptyTiles(player.hand);
    const drawnCount = player.drawnTile && player.drawnFrom !== "CALL" ? 1 : 0;
    const meldTileCount = player.melds.reduce((sum, meld) => sum + (meld.tiles?.length ?? 0), 0);
    const totalHeld = handCount + drawnCount + meldTileCount;
    let expectedTotal = state.phase === "AFTER_DRAW_MUST_DISCARD" && seat === state.turn ? 14 : 13;
    if (pendingRinshanSeat && pendingRinshanSeat === seat && !player.drawnTile) {
      expectedTotal = 13;
    }
    if (totalHeld !== expectedTotal && state.phase !== "ENDED") {
      errors.push(`${seat}の枚数が${totalHeld}枚です（期待: ${expectedTotal}枚）`);
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

type TenpaiResponse = {
  ok: boolean;
  status?: string;
  shanten?: number;
  waits?: TileStr[];
  error?: string;
};

const normalizeHandForTenpai = (hand: TileStr[]) =>
  hand
    .filter((tile) => tile && tile !== "BACK")
    .map((tile) => canonicalTile(tile));

const postTenpai = async (hand: TileStr[], melds: any[] = [], timeoutMs = 5000) => {
  const payload = { hand, melds };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch("http://localhost:8000/analysis/tenpai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal
  }).finally(() => clearTimeout(timeoutId));
  if (!res.ok) {
    throw new Error(`tenpai request failed: ${res.status}`);
  }
  return (await res.json()) as TenpaiResponse;
};

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

type WinPayload = {
  hand: TileStr[];
  melds: Meld[];
  winTile: TileStr;
  winType: "ron" | "tsumo";
  isClosed: boolean;
  riichi: boolean;
  ippatsu: boolean;
  roundWind: Seat;
  seatWind: Seat;
  doraIndicators: TileStr[];
  uraDoraIndicators: TileStr[];
  honba: number;
  riichiSticks: number;
  dealer: boolean;
  menzenTsumo?: boolean;
};

const scoreWin = async (payload: WinPayload) => {
  const res = await fetch("http://localhost:8000/analysis/hand", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    console.warn(`scoreWin failed: ${res.status}`);
    throw new Error(`scoreWin failed: ${res.status}`);
  }
  return res.json();
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

const formatScoreFailureDetail = (res: any) => {
  if (res?.error) return `(${res.error})`;
  if (res?.result?.yaku) return "(役なし)";
  return "(判定失敗)";
};

const SCORE_MELD_VARIANTS: Omit<MeldScoreOptions, "normalizeTile">[] = [
  { collapseKanKind: false, includeCalledTileInTiles: "keep", includeCalledField: true, sortTiles: true },
  { collapseKanKind: true, includeCalledTileInTiles: "keep", includeCalledField: true, sortTiles: true },
  { collapseKanKind: true, includeCalledTileInTiles: "force", includeCalledField: true, sortTiles: true },
  { collapseKanKind: true, includeCalledTileInTiles: "remove", includeCalledField: true, sortTiles: true },
  { collapseKanKind: true, includeCalledTileInTiles: "keep", includeCalledField: false, sortTiles: true }
];

const buildScorePayload = (context: ScoreContext, variant: Omit<MeldScoreOptions, "normalizeTile">, tileMode: "canonical" | "norm"): WinPayload => {
  const normalize = tileMode === "norm" ? tileNorm : canonicalTile;
  const baseHand = normalizeHandForScore(context.player.hand, normalize);
  const winTile = normalize(context.winTile);
  const trimmedHand = trimHandForScore(baseHand, context.player.melds, winTile);
  const melds = normalizeMeldsForScore(context.player.melds, {
    ...variant,
    normalizeTile: normalize
  });
  return {
    hand: trimmedHand,
    melds,
    winTile,
    winType: context.winType,
    isClosed: context.player.closed,
    riichi: context.player.riichi,
    ippatsu: context.player.ippatsu,
    roundWind: context.meta.wind,
    seatWind: context.winner,
    doraIndicators: getDoraIndicators(context.meta).filter(Boolean).map((tile) => normalize(tile)),
    uraDoraIndicators: getUraDoraIndicators(context.meta).filter(Boolean).map((tile) => normalize(tile)),
    honba: context.meta.honba,
    riichiSticks: context.meta.riichiSticks,
    dealer: context.winner === context.meta.dealer,
    ...(context.winType === "tsumo" ? { menzenTsumo: context.player.closed } : {})
  };
};

const scoreWinWithVariants = async (context: ScoreContext) => {
  const tried = new Set<string>();
  let firstResult: any = null;
  const attempt = async (variant: Omit<MeldScoreOptions, "normalizeTile">, tileMode: "canonical" | "norm") => {
    const payload = buildScorePayload(context, variant, tileMode);
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
      <div className="panel remaining-panel">
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
  showSaved: boolean;
  onLogStart: () => void;
  onRandomHands: () => void;
  onLogClear: () => void;
  onClearHands: () => void;
  onPickDora: (index: number) => void;
  onPickUra: (index: number) => void;
  doraIndicators: TileStr[];
  uraDoraIndicators: TileStr[];
  doraRevealedCount: number;
  getTileSrc: (tile: string) => string | null;
  settingsDraft: SettingsDraft | null;
  onUpdateSettingsDraft: (updates: Partial<SettingsDraft>) => void;
  viewState: GameState;
  tenpaiChecking: boolean;
  tenpaiError: string | null;
  rulesErrors: string[];
  actionLog: string[];
};

const RightPanel = ({
  showButtons,
  initialLocked,
  showSaved,
  onLogStart,
  onRandomHands,
  onLogClear,
  onClearHands,
  onPickDora,
  onPickUra,
  doraIndicators,
  uraDoraIndicators,
  doraRevealedCount,
  getTileSrc,
  settingsDraft,
  onUpdateSettingsDraft,
  viewState,
  tenpaiChecking,
  tenpaiError,
  rulesErrors,
  actionLog
}: RightPanelProps) => (
  <div className="right">
    <div className="panel">
      {showButtons && (
        <div className="button-grid">
          <button className="action-button" onClick={onLogStart}>
            ログ開始
          </button>
          <button className="action-button" onClick={onRandomHands} disabled={initialLocked}>
            ランダム配牌
          </button>

          <button className="action-button" onClick={onLogClear}>
            ログクリア
          </button>
          <button className="action-button" onClick={onClearHands} disabled={initialLocked}>
            配牌クリア
          </button>
        </div>
        )}
      <div className="info compact">
        <div className="info-section">
          {settingsDraft && (
            <div style={{ marginTop: 0 }}>
              <div className="settings-grid" style={{ gap: 4 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  場風
                  <select
                    value={settingsDraft.wind}
                    onChange={(e) => onUpdateSettingsDraft({ wind: e.target.value as Seat })}
                    style={{ width: 48 }}
                  >
                    {SEAT_LIST.map((seat) => (
                      <option key={`wind-${seat}`} value={seat}>
                        {WIND_LABELS[seat]}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  局数
                  <input
                    type="number"
                    value={settingsDraft.kyoku}
                    onChange={(e) => onUpdateSettingsDraft({ kyoku: Number(e.target.value) })}
                    style={{ width: 48 }}
                  />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  親
                  <select
                    value={settingsDraft.dealer}
                    onChange={(e) => onUpdateSettingsDraft({ dealer: e.target.value as Seat })}
                    style={{ width: 48 }}
                  >
                    {SEAT_LIST.map((seat) => (
                      <option key={`dealer-${seat}`} value={seat}>
                        {WIND_LABELS[seat]}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  本場
                  <input
                    type="number"
                    value={settingsDraft.honba}
                    onChange={(e) => onUpdateSettingsDraft({ honba: Number(e.target.value) })}
                    style={{ width: 48 }}
                  />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  供託
                  <input
                    type="number"
                    value={settingsDraft.riichiSticks}
                    onChange={(e) => onUpdateSettingsDraft({ riichiSticks: Number(e.target.value) })}
                    style={{ width: 48 }}
                  />
                </label>
                {showSaved && 
                <label style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <div
                    className="save-status"
                    style={{ width: 48, marginTop: 15 }}
                  >保存済み</div>
                </label>
                }
              </div>
            </div>
          )}
          <div className="dora-tiles">
            {Array.from({ length: 5 }, (_, idx) => {
              const tile = doraIndicators[idx] ?? "";
              const revealed = idx < doraRevealedCount && tile;
              const src = revealed ? getTileSrc(tile) : null;
              return (
                <button
                  key={`dora-${idx}`}
                  type="button"
                  onClick={() => onPickDora(idx)}
                  className="picker-tile"
                  style={
                    src
                      ? { backgroundImage: `url(${src})`, width: 28, height: 36 }
                      : {
                          width: 28,
                          height: 36,
                          backgroundColor: "#7b2a2f",
                          border: "1px solid #f0c9c9"
                        }
                  }
                >
                  {!src && ""}
                </button>
              );
            })}
          </div>
          {SEAT_LIST.some((seat) => viewState.players[seat].riichi) && (
            <>
              <div className="dora-tiles dora-tiles-ura">
                {Array.from({ length: 5 }, (_, idx) => {
                  const tile = uraDoraIndicators[idx] ?? "";
                  const revealed = idx < doraRevealedCount && tile;
                  const src = revealed ? getTileSrc(tile) : null;
                  return (
                    <button
                      key={`ura-${idx}`}
                      type="button"
                      onClick={() => onPickUra(idx)}
                      className="picker-tile"
                      style={
                        src
                          ? { backgroundImage: `url(${src})`, width: 28, height: 36 }
                          : {
                              width: 28,
                              height: 36,
                              backgroundColor: "#7b2a2f",
                              border: "1px solid #f0c9c9"
                            }
                      }
                    >
                      {!src && ""}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        {tenpaiChecking && <div>判定中...</div>}
        {tenpaiError && <div className="warn">{tenpaiError}</div>}
        {rulesErrors.length > 0 && <div className="warn">牌枚数の不整合があります</div>}
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
  kind: "hand" | "dora" | "ura" | "rinshan";
  isTileAvailable: (tile: string) => boolean;
  remainingCount: (tile: string) => number;
  tileToAsset: (tile: string) => string | null;
  onSelect: (tile: string | null) => void;
  onClose: () => void;
};

const PickerModal = ({
  open,
  kind,
  isTileAvailable,
  remainingCount,
  tileToAsset,
  onSelect,
  onClose
}: PickerModalProps) => {
  if (!open) return null;
  const tiles = kind === "dora" || kind === "ura" ? [...TILE_CHOICES, "BACK"] : TILE_CHOICES;

  return (
    <div className="picker-backdrop" onClick={onClose} role="presentation">
      <div className="picker-modal" onClick={(e) => e.stopPropagation()} role="presentation">
        <div className="picker-title">牌を選択</div>
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

type SettingsDraft = {
  wind: Seat;
  kyoku: number;
  honba: number;
  riichiSticks: number;
  dealer: Seat;
  points: Record<Seat, number>;
  doraIndicators: string;
  uraDoraIndicators: string;
};

type WinInfo = { seat: Seat; tile: string; type: "ron" | "tsumo" };

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
  dealer: meta.dealer,
  points: { ...meta.points },
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

const getDoraIndicators = (meta: RoundMeta) => {
  const count = Math.max(1, Math.min(5, meta.doraRevealedCount ?? 1));
  return (meta.doraIndicators ?? []).slice(0, count);
};

const getUraDoraIndicators = (meta: RoundMeta) => {
  const count = Math.max(1, Math.min(5, meta.doraRevealedCount ?? 1));
  return (meta.uraDoraIndicators ?? []).slice(0, count);
};

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
  if (total !== TOTAL_TILES) {
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

const isKanKind = (kind: Meld["kind"]) =>
  kind === "KAN" || kind === "ANKAN" || kind === "MINKAN" || kind === "KAKAN";

const trimHandForScore = (hand: TileStr[], melds: Meld[], winTile: TileStr | null) => {
  let tiles = [...hand];
  const meldTileCount = melds.reduce((sum, meld) => sum + (meld.tiles?.length ?? 0), 0);
  const extra = tiles.length + meldTileCount + (winTile ? 1 : 0) - 14;
  if (extra <= 0) return tiles;
  const kanTiles = melds.filter((meld) => isKanKind(meld.kind)).flatMap((meld) => meld.tiles ?? []);
  for (let i = 0; i < extra; i += 1) {
    let removed = false;
    for (const t of kanTiles) {
      const next = removeOneExactThenNorm(tiles, t);
      if (next.length !== tiles.length) {
        tiles = next;
        removed = true;
        break;
      }
    }
    if (!removed && tiles.length) {
      tiles = tiles.slice(0, -1);
    }
  }
  return tiles;
};

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
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const savedTimerRef = useRef<number | null>(null);
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
  const tenpaiCacheRef = useRef(new Map<string, { waits: TileStr[]; shanten?: number; ok?: boolean; error?: string }>());

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKind, setPickerKind] = useState<"hand" | "dora" | "ura" | "rinshan">("hand");
  const [pickerSeat, setPickerSeat] = useState<Seat>("E");
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [callPickerOpen, setCallPickerOpen] = useState(false);
  const [callPickerOptions, setCallPickerOptions] = useState<CallMeldOption[]>([]);
  const discardGuardRef = useRef<{ sig: string; at: number } | null>(null);
  const [pendingRinshan, setPendingRinshan] = useState<Seat | null>(null);
  const initialRandomizedRef = useRef(false);
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
    setSettingsDraft((prev) =>
      prev ? { ...prev, points: { ...prev.points, [seat]: nextValue } } : prev
    );
  };

  const handSignature = useMemo(() => {
    if (!gameState) return "";
    return SEAT_LIST.map(
      (seat) => `${(gameState.players[seat].hand ?? []).join(",")}#${gameState.players[seat].drawnTile ?? ""}`
    ).join("|");
  }, [gameState]);

  const rulesErrors = useMemo(
    () => (viewState ? validateState(viewState, pendingRinshan) : []),
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
    if (pickerKind === "rinshan") {
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
    if (pickerKind === "rinshan") {
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

  const wallCountForTile = (tile: string) => {
    const key = tileKeyForCount(tile);
    if (!key) return 0;
    return wallRemainingByKey?.[key] ?? 0;
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
    const uraIndicators = deck.length ? [deck[Math.floor(Math.random() * deck.length)]] : [];
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

  useEffect(() => {
    if (initialRandomizedRef.current) return;
    if (gameState) return;
    initialRandomizedRef.current = true;
    handleRandomHands();
  }, [gameState, handleRandomHands]);

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

  const handleLogStart = () => {
    const initOverrides = buildInitOverrides();
    let nextState = initFromKifuStep(round, step, initOverrides);
    nextState = {
      ...nextState,
      phase: "BEFORE_DRAW",
      lastDiscard: undefined,
      pendingClaims: []
    };
    nextState = { ...nextState, phase: "BEFORE_DRAW" };
    resetGameUi({ gameState: nextState });
  };

  const handleLogClear = () => {
    resetGameUi();
  };

  const openPicker = (seat: Seat, index: number, tileOverride?: string | null) => {
    if (gameState) {
      if (gameState.phase === "AFTER_DRAW_MUST_DISCARD" && gameState.turn === seat) {
        const display = splitDisplayTiles(gameState, seat);
        const tile = tileOverride ?? display.tiles[index] ?? "";
        if (tile) {
          doDiscard(tile);
        }
      }
      return;
    }
    setPickerSeat(seat);
    setPickerIndex(index);
    setPickerKind("hand");
    setPickerOpen(true);
  };

  const openDoraPicker = (index: number) => {
    setPickerIndex(index);
    setPickerKind("dora");
    setPickerOpen(true);
  };

  const openUraPicker = (index: number) => {
    setPickerIndex(index);
    setPickerKind("ura");
    setPickerOpen(true);
  };

  const openRinshanPicker = (seat: Seat) => {
    setPickerSeat(seat);
    setPickerIndex(0);
    setPickerKind("rinshan");
    setPickerOpen(true);
  };

  const applyTile = (tile: string | null) => {
    if (pickerIndex === null) return;
    const normalizedTile =
      tile && tile !== "BACK" ? canonicalTile(tile) : tile;
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
        setPendingRinshan(null);
        setPickerOpen(false);
        return;
      }
      if (pickerKind === "dora" || pickerKind === "ura") {
        const desiredDora = [...(gameState.meta.doraIndicators ?? [])];
        const desiredUra = [...(gameState.meta.uraDoraIndicators ?? [])];
        while (desiredDora.length <= pickerIndex) desiredDora.push("");
        while (desiredUra.length <= pickerIndex) desiredUra.push("");
        let nextLiveWall = [...(gameState.meta.liveWall ?? [])];
        if (pickerKind === "dora") {
          const prevTile = desiredDora[pickerIndex] ?? "";
          desiredDora[pickerIndex] = normalizedTile ?? "";
          if (prevTile) nextLiveWall = [...nextLiveWall, prevTile];
          if (normalizedTile) {
            const removed = WallOps.removeWallTile(nextLiveWall, normalizedTile);
            if (removed.found) {
              nextLiveWall = removed.next;
            } else {
              appendActionLog("山にありません");
            }
          }
        } else {
          desiredUra[pickerIndex] = normalizedTile ?? "";
        }
        const nextCount =
          pickerKind === "dora"
            ? Math.max(1, Math.min(5, Math.max(gameState.meta.doraRevealedCount ?? 1, pickerIndex + 1)))
            : gameState.meta.doraRevealedCount ?? 1;
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
        setGameState(nextState);
      } else {
        const player = gameState.players[pickerSeat];
        const current = [...player.hand];
        while (current.length <= pickerIndex) current.push("");
        current[pickerIndex] = normalizedTile ?? "";
        const nextState = {
          ...gameState,
          players: {
            ...gameState.players,
            [pickerSeat]: { ...player, hand: sortTiles(current) }
          }
        };
        setGameState(nextState);
      }
    } else if (pickerKind === "dora") {
      setDoraOverrides((prev) => {
        const current = [...(prev[handKey] ?? Array(5).fill(""))];
        current[pickerIndex] = normalizedTile ?? "";
        return { ...prev, [handKey]: current };
      });
      const nextCount = Math.max(1, Math.min(5, Math.max(metaOverrides?.doraRevealedCount ?? 1, pickerIndex + 1)));
      setMetaOverrides((prev) => ({ ...(prev ?? {}), doraRevealedCount: nextCount }));
    } else if (pickerKind === "ura") {
      setUraOverrides((prev) => {
        const current = [...(prev[handKey] ?? Array(5).fill(""))];
        current[pickerIndex] = normalizedTile ?? "";
        return { ...prev, [handKey]: current };
      });
      const nextCount = Math.max(1, Math.min(5, Math.max(metaOverrides?.doraRevealedCount ?? 1, pickerIndex + 1)));
      setMetaOverrides((prev) => ({ ...(prev ?? {}), doraRevealedCount: nextCount }));
    } else {
      setHandOverrides((prev) => {
        const bySeat = { ...(prev[handKey] ?? {}) };
        const base = step?.hands?.[pickerSeat] ?? Array(13).fill("");
        const current = [...(bySeat[pickerSeat] ?? base)];
        while (current.length <= pickerIndex) {
          current.push("");
        }
        current[pickerIndex] = normalizedTile ?? "";
        bySeat[pickerSeat] = sortTiles(current);
        return { ...prev, [handKey]: bySeat };
      });
    }
    setPickerOpen(false);
  };

  const updateSettingsDraft = (updates: Partial<SettingsDraft>) => {
    if (!settingsDraft) return;
    if (showSaved) {
      setShowSaved(false);
    }
    setSettingsDraft({ ...settingsDraft, ...updates });
  };

  useEffect(() => {
    if (!settingsDraft) {
      setSettingsDraft(buildSettingsDraft(viewState.meta));
    }
  }, [settingsDraft, viewState.meta]);

  const markSettingsSaved = () => {
    if (savedTimerRef.current) {
      window.clearTimeout(savedTimerRef.current);
    }
    setShowSaved(true);
    savedTimerRef.current = window.setTimeout(() => {
      setShowSaved(false);
    }, 1500);
  };

  const saveSettings = (draft: SettingsDraft | null = settingsDraft) => {
    if (!draft) return;
    const desiredDora = parseTiles(draft.doraIndicators);
    const desiredUra = parseTiles(draft.uraDoraIndicators);
    const nextMeta: Partial<RoundMeta> = {
      wind: draft.wind,
      kyoku: draft.kyoku,
      honba: draft.honba,
      riichiSticks: draft.riichiSticks,
      dealer: draft.dealer,
      points: { ...draft.points }
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
          points: nextMeta.points ?? gameState.meta.points,
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
        doraRevealedCount: desiredDora.length || desiredUra.length
          ? Math.max(1, Math.min(5, Math.max(desiredDora.length, desiredUra.length)))
          : prev?.doraRevealedCount ?? 1
      }));
      setDoraOverrides((prev) => ({ ...prev, [handKey]: desiredDora }));
      setUraOverrides((prev) => ({ ...prev, [handKey]: desiredUra }));
    }
    markSettingsSaved();
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

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const doDraw = () => {
    if (!gameState || gameState.phase !== "BEFORE_DRAW") return;
    const seat = gameState.turn;
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
    const player = gameState.players[seat];
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
    const normalized = TileOps.canonicalTile(tile);
    if (!normalized) return;
    let liveWall = gameState.meta.liveWall ?? [];
    const removed = WallOps.removeWallTile(liveWall, normalized);
    if (!removed.found) {
      appendActionLog("壁牌にありません");
      return;
    }
    liveWall = removed.next;
    const seat = gameState.turn;
    const player = gameState.players[seat];
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
    return { nextPoints: points };
  };

  const finalizeRon = (claim: Extract<LegalAction, { type: "RON_WIN" }>) => {
    if (!gameState) return;
    setGameState({ ...gameState, phase: "ENDED" });
    appendActionLog("ロン");
  };

  const applyRon = async (claim: Extract<LegalAction, { type: "RON_WIN" }>) => {
    if (!gameState || !gameState.lastDiscard) return;
    const winner = claim.by;
    const tile = claim.tile;
    const player = gameState.players[winner];
    if (player.furiten || player.furitenTemp) {
      setActionLog((prev) => [...prev, "ロン不可"]);
      return;
    }
    const context = buildScoreContext(gameState.meta, player, winner, tile, "ron");
    const res = await scoreWinWithVariants(context).catch((err) => ({ ok: false, error: String(err) }));
    const han = res?.result?.han ?? 0;
    if (!res?.ok || han <= 0) {
      setActionLog((prev) => [...prev, `ロン不可${formatScoreFailureDetail(res)}`]);
      return;
    }
    const { nextPoints } = applyWinResult("ron", winner, res?.result, gameState.lastDiscard.seat);
    setGameState({
      ...gameState,
      meta: { ...gameState.meta, points: nextPoints, riichiSticks: 0 },
      phase: "ENDED"
    });
    setWinInfo({ seat: gameState.lastDiscard.seat, tile, type: "ron" });
    appendActionLog([
      `${formatSeatForLog(winner)}ロン`,
      formatScoreLine(res?.result),
      `点数: 東${nextPoints.E} 南${nextPoints.S} 西${nextPoints.W} 北${nextPoints.N}`
    ]);
  };

  const doRon = async () => {
    if (!gameState) return;
    const claim = callOptionsSorted.find(
      (action): action is Extract<LegalAction, { type: "RON_WIN" }> => action.type === "RON_WIN"
    );
    if (!claim) return;
    applyRon(claim);
  };

  const doTsumoWin = async () => {
    if (!gameState || gameState.phase !== "AFTER_DRAW_MUST_DISCARD") return;
    const winner = gameState.turn;
    const player = gameState.players[winner];
    if (player.drawnFrom === "CALL") return;
    const winTile = player.drawnTile ?? "";
    if (!winTile) return;
    const context = buildScoreContext(gameState.meta, player, winner, winTile, "tsumo");
    const res = await scoreWinWithVariants(context).catch((err) => ({ ok: false, error: String(err) }));
    const han = res?.result?.han ?? 0;
    if (!res?.ok || han <= 0) {
      setActionLog((prev) => [...prev, `ツモ和了不可${formatScoreFailureDetail(res)}`]);
      return;
    }
    const { nextPoints } = applyWinResult("tsumo", winner, res?.result);
    setGameState({
      ...gameState,
      meta: { ...gameState.meta, points: nextPoints, riichiSticks: 0 },
      phase: "ENDED"
    });
    setWinInfo({ seat: winner, tile: winTile, type: "tsumo" });
    appendActionLog([
      `${formatSeatForLog(winner)}ツモ`,
      ...(player.closed ? ["門前ツモ"] : []),
      formatScoreLine(res?.result),
      `点数: 東${nextPoints.E} 南${nextPoints.S} 西${nextPoints.W} 北${nextPoints.N}`
    ]);
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
    appendActionLog("カン");
    setPendingRinshan(seat);
    openRinshanPicker(seat);
  };

  useEffect(() => {
    if (!gameState || gameState.phase !== "AWAITING_CALL") return;
    if (tenpaiChecking) return;
    if (callOptionsAll.length === 0) {
      advanceToNextDraw();
    }
  }, [gameState, callOptionsAll, tenpaiChecking]);

  useEffect(() => {
    if (!gameState || gameState.phase !== "AFTER_DRAW_MUST_DISCARD") {
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
    showSaved,
    onLogStart: runImmediate(handleLogStart),
    onRandomHands: runImmediate(handleRandomHands),
    onLogClear: runImmediate(handleLogClear),
    onClearHands: runImmediate(handleClearHands),
    onPickDora: runImmediate(openDoraPicker),
    onPickUra: runImmediate(openUraPicker),
    doraIndicators: getDoraIndicators(viewState.meta),
    uraDoraIndicators: getUraDoraIndicators(viewState.meta),
    doraRevealedCount: viewState.meta.doraRevealedCount ?? 1,
    getTileSrc,
    settingsDraft,
    onUpdateSettingsDraft: updateSettingsDraft,
    viewState,
    tenpaiChecking,
    tenpaiError,
    rulesErrors,
    actionLog
  };

  const renderTileImage = (
    tile: string,
    idx: number,
    onClick?: () => void,
    size: { w: number; h: number } = { w: TILE_W, h: TILE_H }
  ) => {
    if (!tile) return null;
    if (tile === TILE_PLACEHOLDER || tile === TILE_BACK) {
      return (
        <span
          key={`${tile}-${idx}`}
          className={tile === TILE_BACK ? "tile-back" : "tile-placeholder"}
          style={{ width: size.w, height: size.h, cursor: onClick ? "pointer" : "default" }}
          onClick={onClick}
        />
      );
    }
    const src = tileToAsset(tile);
    const style: CSSProperties = {
      width: `${size.w}px`,
      height: `${size.h}px`,
      cursor: onClick ? "pointer" : "default"
    };
    if (src) {
      return (
        <img
          key={`${tile}-${idx}`}
          className="tile-img"
          src={src}
          alt={tile}
          style={style}
          onClick={onClick}
        />
      );
    }
    return (
      <span key={`${tile}-${idx}`} onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
        {tile}
      </span>
    );
  };

  const renderTileRow = (tiles: TileStr[], size?: { w: number; h: number }) => {
    const visible = tiles.filter((tile) => tile && tile !== "BACK" && tile !== "PLACEHOLDER");
    if (!visible.length) return <span>なし</span>;
    return <span>{visible.map((tile, idx) => renderTileImage(tile, idx, undefined, size))}</span>;
  };

  const renderDiscardRow = (seat: Seat, tiles: TileStr[]) => {
    if (!tiles.length) return <span className="discard-empty">河</span>;
    const riichiIndex = riichiDiscards[seat];
    const renderDiscardTile = (tile: TileStr, idx: number) => {
      const sideways = riichiIndex !== null && riichiIndex === idx;
      const wrapStyle: CSSProperties = {
        width: sideways ? MELD_TILE_H : MELD_TILE_W,
        height: sideways ? MELD_TILE_W : MELD_TILE_H,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center"
      };
      const imgStyle: CSSProperties = {
        width: MELD_TILE_W,
        height: MELD_TILE_H,
        transform: sideways ? "rotate(90deg)" : "none"
      };
      if (tile === TILE_PLACEHOLDER || tile === TILE_BACK) {
        return (
          <span
            key={`discard-${seat}-${idx}`}
            className={tile === TILE_BACK ? "tile-back" : "tile-placeholder"}
            style={wrapStyle}
          />
        );
      }
      const src = tileToAsset(tile);
      if (src) {
        return (
          <span key={`discard-${seat}-${idx}`} className="discard-tile-wrap" style={wrapStyle}>
            <img className="discard-tile-img" src={src} alt={tile} style={imgStyle} />
          </span>
        );
      }
      return (
        <span key={`discard-${seat}-${idx}`} className="discard-tile-wrap" style={wrapStyle}>
          {tile}
        </span>
      );
    };
    return <span className="discard-row">{tiles.map((tile, idx) => renderDiscardTile(tile, idx))}</span>;
  };

  const buildSeatActions = (seat: Seat, player: PlayerState) => {
    const actions: { key: string; label: string; onClick: () => void; disabled?: boolean }[] = [];
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
          actions.push({ key: `ron-${idx}`, label: "ロン", onClick: () => applyRon(action) });
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
  };

  const handleHandTileClick = (seat: Seat, tile: TileStr, index: number) => {
    if (!tile) return;
    if (gameState) {
      if (gameState.phase !== "AFTER_DRAW_MUST_DISCARD") return;
      if (gameState.turn !== seat) return;
      doDiscard(tile);
      return;
    }
    openPicker(seat, index, tile);
  };

  const renderHandRow = (seat: Seat, player: PlayerState) => {
    const clickable = !gameState || (gameState.phase === "AFTER_DRAW_MUST_DISCARD" && gameState.turn === seat);
    const tiles = player.hand ?? [];
    const hasAny = tiles.some((tile) => tile);
    if (!hasAny && !player.drawnTile) return <span>なし</span>;
    return (
      <span>
        {tiles.map((tile, idx) =>
          tile
            ? renderTileImage(tile, idx, clickable ? () => handleHandTileClick(seat, tile, idx) : undefined)
            : null
        )}
        {player.drawnTile ? (
          <span style={{ marginLeft: 8 }}>
            {renderTileImage(
              player.drawnTile,
              tiles.length,
              clickable ? () => handleHandTileClick(seat, player.drawnTile ?? "", tiles.length) : undefined
            )}
          </span>
        ) : null}
      </span>
    );
  };

  const renderMeldBlock = (meld: Meld, idx: number, owner: Seat) => {
    const meldOwner = meld.by ?? owner;
    const calledIndex =
      meld.calledTile ? calledIndexFor(meldOwner, meld.calledFrom ?? meldOwner, meld.tiles.length) : -1;
    const renderMeldTile = (tile: TileStr, tileIdx: number) => {
      const sideways = tileIdx === calledIndex;
      const wrapStyle: CSSProperties = {
        width: sideways ? MELD_TILE_H : MELD_TILE_W,
        height: sideways ? MELD_TILE_W : MELD_TILE_H,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center"
      };
      const imgStyle: CSSProperties = {
        width: MELD_TILE_W,
        height: MELD_TILE_H,
        transform: sideways ? "rotate(90deg)" : "none"
      };
      if (tile === TILE_PLACEHOLDER || tile === TILE_BACK) {
        return (
          <span
            key={`meld-${idx}-${tileIdx}`}
            className={tile === TILE_BACK ? "tile-back" : "tile-placeholder"}
            style={wrapStyle}
          />
        );
      }
      const src = tileToAsset(tile);
      if (src) {
        return (
          <span key={`meld-${idx}-${tileIdx}`} className="meld-tile-wrap" style={wrapStyle}>
            <img className="meld-tile-img" src={src} alt={tile} style={imgStyle} />
          </span>
        );
      }
      return (
        <span key={`meld-${idx}-${tileIdx}`} className="meld-tile-wrap" style={wrapStyle}>
          {tile}
        </span>
      );
    };
    return (
      <div key={`meld-${idx}`} className="meld-row">
        {meld.tiles.map((tile, tileIdx) => renderMeldTile(tile, tileIdx))}
      </div>
    );
  };

  return (
    <div className="app-shell">
      <div className="seat-summary-bar">
        <div className="seat-summary-row">
          {SEAT_LIST.map((seat) => {
            const player = viewState.players[seat];
            const isTurn = seat === viewState.turn;
            const statusLabel = player.riichi ? "リーチ" : tenpaiFlags[seat] ? "テンパイ" : "";
            const statusClass = player.riichi ? "status-riichi" : "status-tenpai";
            return (
              <div key={`seat-summary-${seat}`} className={`seat-summary${isTurn ? " is-turn" : ""}`}>
                <div className="seat-summary-body">
                  <div className="seat-summary-avatar-col">
                    <div className="seat-summary-avatar-box">
                      <div className="seat-summary-avatar">
                        <svg className="avatar-icon" viewBox="0 0 64 64" role="img" aria-label="player">
                          <circle cx="32" cy="22" r="12" />
                          <path d="M12 54c0-10 9-18 20-18s20 8 20 18v4H12z" />
                        </svg>
                      </div>
                      {statusLabel && (
                        <div className={`seat-summary-status ${statusClass}`}>{statusLabel}</div>
                      )}
                    </div>
                  </div>
                  <div className="seat-summary-info">
                    <div className="seat-summary-name-row">
                      <span className="seat-summary-wind-label">{WIND_LABELS[seat]} :</span>
                      <input
                        className="seat-summary-name-input"
                        value={seatNames[seat] ?? ""}
                        onChange={(e) => updateSeatName(seat, e.target.value)}
                      />
                    </div>
                    <div className="seat-summary-points-row">
                      <input
                        className="seat-summary-points-input"
                        type="number"
                        value={viewState.meta.points[seat]}
                        onChange={(e) => updateSeatPoints(seat, Number(e.target.value))}
                      />
                      <span className="points-unit">点</span>
                    </div>
                    {waitsBySeat[seat]?.length ? (
                      <div className="seat-summary-waits">
                        <span className="waits-label">待ち</span>
                        <span className="waits-tiles">
                          {waitsBySeat[seat].map((tile, idx) => {
                            const src = tileToAsset(tile);
                            const count = remainingCountForDisplay(tile);
                            return (
                              <span key={`wait-${seat}-${idx}`} className="waits-tile">
                                {src ? (
                                  <img className="waits-tile-img" src={src} alt={tile} />
                                ) : (
                                  <span className="waits-tile-placeholder" />
                                )}
                                <span className="waits-count">{count}</span>
                              </span>
                            );
                          })}
                        </span>
                      </div>
                    ) : (
                      <div className="seat-summary-waits empty" />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="app-container" style={{ display: "flex", gap: 16 }}>
        <LeftTools
          wallRemaining={totalWallRemaining}
          remainingTiles={remainingTiles}
          onRemainingTileClick={handleRemainingTileClick}
          showRemaining
          getTileSrc={getTileSrc}
        />
        <div className="center-column" style={{ flex: 1, padding: 4, display: "flex", justifyContent: "center" }}>
          <div className="simple-list" style={{ width: "100%", maxWidth: 1000 }}>
            {SEAT_LIST.map((seat) => {
              const player = viewState.players[seat];
              const seatActions = buildSeatActions(seat, player);
              return (
                <div
                  key={`seat-${seat}`}
                  className={`seat-block${seat === viewState.turn ? " is-turn" : ""}`}
                >
                  <div className="seat-block-row">
                    <div className="seat-block-main">
                      <div className="seat-title-row">
                        <div className="seat-title">
                          <span>{`${WIND_LABELS[seat]}家`}</span>
                        </div>
                        {seatActions.length > 0 && (
                          <div className="seat-title-actions">
                            {seatActions.map((action) => (
                              <button
                                key={`${seat}-${action.key}`}
                                className="action-button"
                                type="button"
                                onClick={action.onClick}
                                disabled={action.disabled}
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="hand-row">
                        <div className="hand-tiles">{renderHandRow(seat, player)}</div>
                        <div className="melds-inline">
                          {player.melds.length ? (
                            [...player.melds].reverse().map((meld, idx) => renderMeldBlock(meld, idx, seat))
                          ) : (
                            <div className="meld-empty"></div>
                          )}
                        </div>
                      </div>
                      <div className="discard-block">
                        {renderDiscardRow(seat, player.discards)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <RightPanel {...rightPanelProps} />
      </div>

      <PickerModal
        open={pickerOpen}
        kind={pickerKind}
        isTileAvailable={isTileAvailable}
        remainingCount={remainingCountForPicker}
        tileToAsset={tileToAsset}
        onSelect={applyTile}
        onClose={() => {
          if (pickerKind === "rinshan") return;
          setPickerOpen(false);
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
                    {renderMeldBlock(
                      {
                        kind: option.type,
                        tiles: option.meldTiles,
                        by: option.by,
                        calledFrom: option.from,
                        calledTile: option.tile,
                        open: true
                      },
                      idx,
                      option.by
                    )}
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
