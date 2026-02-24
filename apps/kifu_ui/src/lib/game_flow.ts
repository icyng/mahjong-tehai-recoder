import type { Seat, TileStr } from "../ui/types";
import { canonicalTile, removeOneExactThenNorm, sortTiles, takeTilesExactThenNorm, tileEq, tileNorm } from "./tile_ops";

export const SEATS: Seat[] = ["E", "S", "W", "N"];

export type Meld = {
  kind: "CHI" | "PON" | "KAN" | "ANKAN" | "MINKAN" | "KAKAN";
  tiles: TileStr[];
  by?: Seat;
  calledFrom?: Seat;
  calledTile?: TileStr;
  open: boolean;
};

export type PlayerState = {
  hand: TileStr[];
  drawnTile: TileStr | null;
  drawnFrom?: "WALL" | "CALL" | "RINSHAN" | null;
  melds: Meld[];
  discards: TileStr[];
  riichi: boolean;
  ippatsu: boolean;
  closed: boolean;
  furiten: boolean;
  furitenTemp: boolean;
};

export type RoundMeta = {
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

export type GamePhase = "BEFORE_DRAW" | "AFTER_DRAW_MUST_DISCARD" | "AWAITING_CALL" | "ENDED";

export type GameState = {
  meta: RoundMeta;
  players: Record<Seat, PlayerState>;
  turn: Seat;
  phase: GamePhase;
  lastDiscard?: { seat: Seat; tile: TileStr };
  pendingClaims?: { type: "CHI" | "PON" | "KAN" | "RON"; by: Seat; tile: TileStr }[];
};

export type LegalAction =
  | { type: "DRAW"; by: Seat }
  | { type: "DISCARD"; by: Seat }
  | { type: "RIICHI_DECLARE"; by: Seat }
  | { type: "TSUMO_WIN"; by: Seat }
  | { type: "RON_WIN"; by: Seat; from: Seat; tile: TileStr }
  | { type: "CHI" | "PON" | "KAN"; by: Seat; from: Seat; tile: TileStr };

export type ClaimAction = Extract<LegalAction, { type: "CHI" | "PON" | "KAN" }>;

export const nextSeat = (seat: Seat) => SEATS[(SEATS.indexOf(seat) + 1) % 4];

export const prevSeat = (seat: Seat) => SEATS[(SEATS.indexOf(seat) + 3) % 4];

export const oppositeSeat = (seat: Seat) => SEATS[(SEATS.indexOf(seat) + 2) % 4];

export const calledIndexFor = (by: Seat, from: Seat | undefined, size: number) => {
  if (!from) return null;
  if (from === prevSeat(by)) return 0;
  if (from === oppositeSeat(by)) return size === 4 ? 1 : Math.floor(size / 2);
  if (from === nextSeat(by)) return size - 1;
  return null;
};

const mapPlayers = (
  players: Record<Seat, PlayerState>,
  mapper: (player: PlayerState, seat: Seat) => PlayerState
): Record<Seat, PlayerState> =>
  SEATS.reduce(
    (acc, seat) => {
      acc[seat] = mapper(players[seat], seat);
      return acc;
    },
    {} as Record<Seat, PlayerState>
  );

const clearIppatsuForAllPlayers = (players: Record<Seat, PlayerState>) =>
  mapPlayers(players, (player) => ({ ...player, ippatsu: false }));

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

export const getLegalActions = (state: GameState, viewerSeat?: Seat): LegalAction[] => {
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
      if (canClosedKan(hand)) {
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

const uniqueTileCombos = (combos: TileStr[][]) => {
  const unique = new Map<string, TileStr[]>();
  combos.forEach((combo) => {
    const key = [...combo].sort().join("|");
    if (!unique.has(key)) unique.set(key, combo);
  });
  return [...unique.values()];
};

export const isValidChiTiles = (tile: TileStr, pair: TileStr[]) => {
  if (pair.length !== 2) return false;
  const canon = canonicalTile(tile);
  if (canon.length !== 2 || !"mps".includes(canon[1])) return false;
  const suit = canon[1];
  const n = Number(canon[0] === "0" ? "5" : canon[0]);
  const nums = pair.map((p) => {
    const c = canonicalTile(p);
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

export const collectMatchingCombos = (hand: TileStr[], tile: TileStr, count: number) => {
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

export const getChiCandidates = (hand: TileStr[], tile: TileStr) => {
  const canon = canonicalTile(tile);
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

export const pickChiTiles = (hand: TileStr[], tile: TileStr) => {
  const candidates = getChiCandidates(hand, tile);
  return candidates.length ? candidates[0] : null;
};

export const buildMeldTilesForCall = (
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

const removeTiles = (hand: TileStr[], tilesToRemove: TileStr[]) => {
  let remaining = [...hand];
  tilesToRemove.forEach((tile) => {
    remaining = removeOneExactThenNorm(remaining, tile);
  });
  return sortTiles(remaining);
};

const removeLastDiscard = (discards: TileStr[], tile: TileStr) => {
  for (let i = discards.length - 1; i >= 0; i -= 1) {
    if (tileEq(discards[i], tile)) {
      return [...discards.slice(0, i), ...discards.slice(i + 1)];
    }
  }
  return discards;
};

export const buildDiscardTransition = (
  state: GameState,
  tile: TileStr,
  pendingRiichi: boolean
): { nextState: GameState; riichiDeclared: boolean; riichiDiscardIndex: number | null } => {
  const seat = state.turn;
  const player = state.players[seat];
  let nextHand = [...player.hand];
  let nextDrawn: TileStr | null = null;
  let nextDrawnFrom: PlayerState["drawnFrom"] = null;

  if (player.drawnTile && player.drawnTile === tile) {
    nextDrawn = null;
  } else {
    nextHand = removeOneExactThenNorm(nextHand, tile);
    if (player.drawnTile && player.drawnFrom !== "CALL") {
      nextHand.push(player.drawnTile);
    }
  }

  const riichiDeclared = pendingRiichi;
  const nextRiichiSticks = riichiDeclared ? state.meta.riichiSticks + 1 : state.meta.riichiSticks;
  const nextPoints = riichiDeclared
    ? { ...state.meta.points, [seat]: state.meta.points[seat] - 1000 }
    : state.meta.points;

  const nextState: GameState = {
    ...state,
    players: {
      ...state.players,
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
      ...state.meta,
      riichiSticks: nextRiichiSticks,
      points: nextPoints
    }
  };

  const claims = getLegalActions(nextState)
    .filter(
      (action): action is Extract<LegalAction, { type: "CHI" | "PON" | "KAN" | "RON_WIN" }> =>
        action.type === "CHI" || action.type === "PON" || action.type === "KAN" || action.type === "RON_WIN"
    )
    .map((action) => {
      const claimType: "CHI" | "PON" | "KAN" | "RON" = action.type === "RON_WIN" ? "RON" : action.type;
      return {
        type: claimType,
        by: action.by,
        tile: action.tile
      };
    });
  nextState.pendingClaims = claims.length ? claims : [];

  return {
    nextState,
    riichiDeclared,
    riichiDiscardIndex: riichiDeclared ? player.discards.length : null
  };
};

export const buildAdvanceToNextDrawTransition = (
  state: GameState,
  callOptionsAll: LegalAction[]
): GameState => {
  const ronSeats = callOptionsAll
    .filter((action) => action.type === "RON_WIN")
    .map((action) => action.by);
  const nextTurn = nextSeat(state.turn);
  const updatedPlayers = mapPlayers(state.players, (player) => ({ ...player }));
  ronSeats.forEach((seat) => {
    updatedPlayers[seat] = { ...updatedPlayers[seat], furitenTemp: true };
  });
  return {
    ...state,
    turn: nextTurn,
    players: {
      ...updatedPlayers,
      [nextTurn]: { ...updatedPlayers[nextTurn], drawnTile: null, drawnFrom: null, furitenTemp: false }
    },
    phase: "BEFORE_DRAW",
    lastDiscard: undefined,
    pendingClaims: []
  };
};

export const buildClaimTransition = (
  state: GameState,
  claim: ClaimAction,
  selectedTiles?: TileStr[]
): { nextState: GameState; label: "チー" | "ポン" | "カン"; tile: TileStr; isKan: boolean } | null => {
  const by = claim.by;
  const from = claim.from ?? state.lastDiscard?.seat ?? by;
  const tile = claim.tile || state.lastDiscard?.tile || "";
  if ((claim.type === "CHI" || claim.type === "PON" || claim.type === "KAN") && !state.lastDiscard) return null;
  const player = state.players[by];
  let meldTiles: TileStr[] = [];
  let updatedHand = player.hand;
  let meldKind: "CHI" | "PON" | "MINKAN" = "CHI";
  let nextDrawnTile: TileStr | null = null;
  let nextDrawnFrom: PlayerState["drawnFrom"] = null;
  let nextDoraCount = state.meta.doraRevealedCount ?? 1;

  if (claim.type === "CHI") {
    if (from !== prevSeat(by)) return null;
    const pair = selectedTiles && selectedTiles.length === 2 ? selectedTiles : pickChiTiles(player.hand, tile);
    if (!pair || !isValidChiTiles(tile, pair)) return null;
    const list = [...sortTiles(pair)];
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
    if (finalTaken.length < 2) return null;
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
    if (finalTaken.length < 3) return null;
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

  const clearedPlayers = clearIppatsuForAllPlayers(state.players);
  const currentDoraCount = state.meta.doraRevealedCount ?? 1;
  let nextDoraIndicators = [...(state.meta.doraIndicators ?? [])];
  let nextLiveWall = [...(state.meta.liveWall ?? [])];
  if (claim.type === "KAN" && nextDoraCount > currentDoraCount) {
    const revealed = nextLiveWall.pop();
    if (revealed) {
      while (nextDoraIndicators.length < nextDoraCount) nextDoraIndicators.push("");
      nextDoraIndicators[nextDoraCount - 1] = revealed;
    }
  }

  const nextState: GameState = {
    ...state,
    players: {
      ...clearedPlayers,
      [by]: {
        ...clearedPlayers[by],
        hand: sortTiles(updatedHand),
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
      ...(by !== from && state.lastDiscard?.tile
        ? {
            [from]: {
              ...clearedPlayers[from],
              discards: removeLastDiscard(state.players[from].discards, state.lastDiscard.tile)
            }
          }
        : {})
    },
    meta: {
      ...state.meta,
      doraRevealedCount: nextDoraCount,
      doraIndicators: nextDoraIndicators,
      liveWall: nextLiveWall
    },
    turn: by,
    phase: "AFTER_DRAW_MUST_DISCARD",
    lastDiscard: undefined,
    pendingClaims: []
  };

  return {
    nextState,
    label: claim.type === "CHI" ? "チー" : claim.type === "PON" ? "ポン" : "カン",
    tile,
    isKan: claim.type === "KAN"
  };
};

