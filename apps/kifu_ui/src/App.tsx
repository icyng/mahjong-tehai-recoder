import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { flushSync } from "react-dom";
import type { ActionLogEntry, ActionLogKind, HonorTile, Seat, TileStr } from "./ui/types";
import { SeatSummaryBar } from "./components/SeatSummaryBar";
import { SeatBlock } from "./components/SeatBlock";
import { LeftTools } from "./components/LeftTools";
import { RightPanel } from "./components/RightPanel";
import { CallPickerModal } from "./components/CallPickerModal";
import { PickerModal } from "./components/PickerModal";
import { WinOptionsModal } from "./components/WinOptionsModal";
import { RuleSettingsModal } from "./components/RuleSettingsModal";
import { useSeatViewModel } from "./hooks/useSeatViewModel";
import { useScreenCapture } from "./hooks/useScreenCapture";
import {
  buildJapaneseYakuList,
  computeDoraCountsForWin,
  doraFromIndicator,
  formatScoreSummaryForLog,
  getDoraDisplayTiles,
  getDoraIndicators,
  resolveSeatWind,
  getUraDoraIndicators,
  type DoraCounts
} from "./lib/score_utils";
import { 
  buildSeatActionList 
} from "./lib/seat_action_builder";
import {
  buildScoreContext,
  type MeldLike,
  normalizeMeldsForTenpai,
  scoreWinWithVariants,
  type WinOptionFlags
} from "./lib/score_payload";
import { 
  applyNotenPenaltyPoints, 
  applyWinPoints 
} from "./lib/win_points";
import { 
  postTenpai, 
  type ScoreResponse, 
  type ScoreResult 
} from "./lib/mahjong_api";
import { 
  buildLogExportSnapshot 
} from "./lib/log_export";
import {
  applyDoraOverridesToResult,
  formatScoreFailureDetail,
  formatScoreLine,
  hasRiichiYaku,
  sanitizeDoraCounts
} from "./lib/score_log";
import {
  buildCallLogToken,
  formatSeatForLog,
  formatTileForLog,
  logTokenToTile,
  SEAT_LABEL_TO_SEAT,
  tileToLogCode
} from "./lib/log_codec";
import {
  canonicalTile,
  removeOneExactThenNorm,
  sortTiles,
  stripTiles,
  takeTilesExactThenNorm,
  tileEq,
  tileKeyForCount,
  tileNorm,
  tileToAsset,
  TileOps
} from "./lib/tile_ops";
import { 
  WallOps as BaseWallOps 
} from "./lib/wall_ops";
import { 
  createSeatRecord 
} from "./lib/seat_record";
import { 
  dealerSeatFromKyoku, 
  WIND_LABELS 
} from "./lib/round";
import { 
  initFromKifuStep, 
  type InitOverrides, 
  type InitTileConfig 
} from "./lib/game_init";
import {
  SEATS,
  buildAdvanceToNextDrawTransition,
  buildClaimTransition,
  buildDiscardTransition,
  buildMeldTilesForCall,
  calledIndexFor,
  collectMatchingCombos,
  getChiCandidates,
  getLegalActions,
  nextSeat,
  type GamePhase,
  type GameState,
  type LegalAction,
  type Meld,
  type PlayerState,
  type RoundMeta
} from "./lib/game_flow";

// 1手ごとのスナップショット（入力棋譜との互換用）
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

// 1局分のログデータ
type Round = {
  roundIndex: number;
  wind: string;
  kyoku: number;
  honba: number;
  riichiSticks: number;
  dealer: string;
  steps: Step[];
};

// 画面全体で扱う棋譜データ
type Kifu = {
  gameId: string;
  rounds: Round[];
};

// 牌表示・キャプチャ関連のUI定数
const TILE_W = 36;
const TILE_H = 48;
const MELD_TILE_W = 20;
const MELD_TILE_H = 28;
const TOTAL_TILES = 136;

const TILE_PLACEHOLDER = "PLACEHOLDER";
const TILE_BACK = "BACK";
const HONOR_TILES: HonorTile[] = ["E", "S", "W", "N", "P", "F", "C"];
const RED_FIVE_RE = /^0([mps])$/;

const normalizeTileByAkaRule = (tile: TileStr, akaEnabled: boolean): TileStr => {
  const canon = canonicalTile(tile);
  if (!canon || canon === TILE_BACK || canon === TILE_PLACEHOLDER) return canon;
  if (!akaEnabled) {
    const match = canon.match(RED_FIVE_RE);
    if (match) return `5${match[1]}`;
  }
  return canon;
};

const suitTiles = (suit: string, akaEnabled: boolean) =>
  (akaEnabled ? ["1", "2", "3", "4", "5", "0", "6", "7", "8", "9"] : ["1", "2", "3", "4", "5", "6", "7", "8", "9"]).map(
    (n) => `${n}${suit}`
  );

const buildTileChoices = (akaEnabled: boolean): TileStr[] => [
  ...suitTiles("m", akaEnabled),
  ...suitTiles("p", akaEnabled),
  ...suitTiles("s", akaEnabled),
  ...HONOR_TILES
];

// 136枚（赤あり: 赤5mps=各1、赤なし: 0xなし）
const buildTileLimits = (akaEnabled: boolean): Record<string, number> => {
  const limits: Record<string, number> = {};
  const suits = ["m", "p", "s"];
  for (const suit of suits) {
    for (let i = 1; i <= 9; i += 1) {
      limits[`${i}${suit}`] = 4;
    }
    if (akaEnabled) {
      limits[`5${suit}`] = 3;
      limits[`0${suit}`] = 1;
    } else {
      limits[`5${suit}`] = 4;
      limits[`0${suit}`] = 0;
    }
  }
  for (const honor of HONOR_TILES) {
    limits[honor] = 4;
  }
  return limits;
};

const TILE_CHOICES_AKA = buildTileChoices(true);
const TILE_CHOICES_NO_AKA = buildTileChoices(false);
const TILE_LIMITS_AKA = buildTileLimits(true);
const TILE_LIMITS_NO_AKA = buildTileLimits(false);
const KYOKU_TO_SEAT: Seat[] = ["E", "S", "W", "N"];

const cloneState = <T,>(value: T): T => {
  const cloner = (globalThis as typeof globalThis & { structuredClone?: <U>(v: U) => U }).structuredClone;
  if (typeof cloner === "function") {
    return cloner(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
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

const resetPlayerForHandClear = (player: PlayerState): PlayerState => ({
  ...player,
  hand: Array(13).fill(TILE_PLACEHOLDER),
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

const normalizeHandForTenpai = (hand: TileStr[]) =>
  hand
    .filter((tile) => tile && tile !== "BACK")
    .map((tile) => canonicalTile(tile));

const fetchTenpai = async (hand: TileStr[], melds: MeldLike[] = [], timeoutMs = 5000) => {
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
  result?: ScoreResult;
  from?: Seat;
  doraCounts?: DoraCounts;
};

type UndoSnapshot = {
  ui: GameUiState;
  pendingRinshan: Seat | null;
};

type GameUiState = {
  gameState: GameState | null;
  actionLog: ActionLogEntry[];
  junmeCount: number;
  selectedDiscard: TileStr | null;
  pendingRiichi: boolean;
  riichiDiscards: Record<Seat, number | null>;
  winInfo: WinInfo | null;
};

const emptyRiichiDiscards = (): Record<Seat, number | null> => createSeatRecord(() => null);

const initialGameUiState: GameUiState = {
  gameState: null,
  actionLog: [],
  junmeCount: 0,
  selectedDiscard: null,
  pendingRiichi: false,
  riichiDiscards: emptyRiichiDiscards(),
  winInfo: null
};

const SEAT_LIST: Seat[] = SEATS;
const defaultSeatNames = (): Record<Seat, string> =>
  createSeatRecord((seat) => `user${SEAT_LIST.indexOf(seat) + 1}`);

const mergeHandsForOverrides = (
  overrides: Record<Seat, TileStr[]> | undefined,
  baseHands?: Record<Seat, TileStr[]>
) => {
  if (!overrides) return undefined;
  const merged = createSeatRecord<TileStr[]>(() => []);
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

const getWallRemaining = (meta: RoundMeta) => (meta.liveWall ? meta.liveWall.length : 0);

const assertTileConservation = (state: GameState, tileLimits: Readonly<Record<string, number>>) => {
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
    const limit = tileLimits[key] ?? 0;
    if (counts[key] > limit) {
      errors.push(`${key}が${counts[key]}枚（上限${limit}枚）`);
    }
  });
  return errors;
};

const checkTileConservation = (
  state: GameState,
  label: string,
  tileLimits: Readonly<Record<string, number>>
) => {
  const errors = assertTileConservation(state, tileLimits);
  if (errors.length) {
    console.warn(`[tile-conservation:${label}]`, errors);
  }
  return errors;
};

const expectedHandCountBeforeDraw = (player: PlayerState) => {
  return Math.max(13 - player.melds.length * 3, 0);
};

const mapTilesForAkaRule = (tiles: TileStr[], normalizeTile: (tile: TileStr) => TileStr): TileStr[] =>
  tiles.map((tile) => normalizeTile(tile));

const normalizeStateForAkaRule = (
  state: GameState,
  normalizeTile: (tile: TileStr) => TileStr
): GameState => ({
  ...state,
  players: SEATS.reduce((acc, seat) => {
    const player = state.players[seat];
    acc[seat] = {
      ...player,
      hand: mapTilesForAkaRule(player.hand, normalizeTile),
      drawnTile: player.drawnTile ? normalizeTile(player.drawnTile) : null,
      melds: player.melds.map((meld) => ({
        ...meld,
        tiles: mapTilesForAkaRule(meld.tiles, normalizeTile),
        calledTile: meld.calledTile ? normalizeTile(meld.calledTile) : meld.calledTile
      })),
      discards: mapTilesForAkaRule(player.discards, normalizeTile)
    };
    return acc;
  }, {} as Record<Seat, PlayerState>),
  lastDiscard: state.lastDiscard
    ? { seat: state.lastDiscard.seat, tile: normalizeTile(state.lastDiscard.tile) }
    : undefined,
  pendingClaims: state.pendingClaims?.map((claim) => ({ ...claim, tile: normalizeTile(claim.tile) })),
  meta: {
    ...state.meta,
    liveWall: mapTilesForAkaRule(state.meta.liveWall ?? [], normalizeTile),
    deadWall: mapTilesForAkaRule(state.meta.deadWall ?? [], normalizeTile),
    doraIndicators: mapTilesForAkaRule(state.meta.doraIndicators ?? [], normalizeTile),
    uraDoraIndicators: mapTilesForAkaRule(state.meta.uraDoraIndicators ?? [], normalizeTile)
  }
});

const tileLabel = (tile: string) => TileOps.canonicalTile(tile);

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


export const App = () => {
  // 棋譜表示用のベースデータ（未読込時はnull）
  const [kifu, setKifu] = useState<Kifu | null>(null);
  const [roundIndex] = useState(0);
  const stepIndex = 0;
  const [handOverrides, setHandOverrides] = useState<Record<string, Record<Seat, string[]>>>({});
  const [doraOverrides, setDoraOverrides] = useState<Record<string, string[]>>({});
  const [uraOverrides, setUraOverrides] = useState<Record<string, string[]>>({});
  const [gameUi, setGameUi] = useState<GameUiState>(initialGameUiState);
  const { gameState, actionLog, selectedDiscard, pendingRiichi, riichiDiscards, winInfo } =
    gameUi;
  const setGameUiField = <K extends keyof GameUiState>(field: K) =>
    (value: GameUiState[K] | ((prev: GameUiState[K]) => GameUiState[K])) => {
      setGameUi((prev) => {
        const nextValue =
          typeof value === "function"
            ? (value as (prevValue: GameUiState[K]) => GameUiState[K])(prev[field])
            : value;
        return { ...prev, [field]: nextValue };
      });
    };
  const resetGameUi = (overrides: Partial<GameUiState> = {}) => {
    setGameUi({ ...initialGameUiState, ...overrides });
  };
  const setGameState = setGameUiField("gameState");
  const applyStateTransition = (nextState: GameState, label: string) => {
    checkTileConservationForRule(nextState, label);
    setGameState(nextState);
  };
  const setJunmeCount = setGameUiField("junmeCount");
  const setSelectedDiscard = setGameUiField("selectedDiscard");
  const [waitsBySeat, setWaitsBySeat] = useState<Record<Seat, TileStr[]>>(
    () => createSeatRecord<TileStr[]>(() => [])
  );
  const [, setShantenBySeat] = useState<Record<Seat, number | null>>(
    () => createSeatRecord<number | null>(() => null)
  );
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
    setGameUi(snapshot.ui);
    setPendingRinshan(snapshot.pendingRinshan);
    setWinOptionsOpen(false);
    setPendingWin(null);
    setTimeout(() => {
      undoGuardRef.current = false;
    }, 0);
  };
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [logTitle, setLogTitle] = useState<[string, string]>(["", ""]);
  const [ruleDisplay, setRuleDisplay] = useState("般南喰赤");
  const [ruleSettingsOpen, setRuleSettingsOpen] = useState(false);
  const [kiriageEnabled, setKiriageEnabled] = useState(true);
  const [akaEnabled, setAkaEnabled] = useState(true);
  const settingsInitRef = useRef(false);
  const [seatNames, setSeatNames] = useState<Record<Seat, string>>(defaultSeatNames);
  const [seatAvatars, setSeatAvatars] = useState<Record<Seat, string>>(
    () => createSeatRecord(() => "")
  );
  const seatAvatarObjectUrlsRef = useRef<Record<Seat, string | null>>(
    createSeatRecord(() => null)
  );
  const [metaOverrides, setMetaOverrides] = useState<Partial<RoundMeta> | null>(null);
  const [tenpaiChecking, setTenpaiChecking] = useState(false);
  const [tenpaiError, setTenpaiError] = useState<string | null>(null);
  const [tenpaiFlags, setTenpaiFlags] = useState<Record<Seat, boolean>>(
    () => createSeatRecord(() => false)
  );
  const setRiichiDiscards = setGameUiField("riichiDiscards");
  const setWinInfo = setGameUiField("winInfo");
  const appendActionLog = (lines: string | string[], kind: ActionLogKind = "ui") => {
    const list = Array.isArray(lines) ? lines : [lines];
    const entries = list.map((text): ActionLogEntry => ({ kind, text }));
    setGameUi((prev) => ({ ...prev, actionLog: [...prev.actionLog, ...entries] }));
  };
  const clearActionLog = () => {
    setGameUi((prev) => ({ ...prev, actionLog: [] }));
  };
  const appendScoreDebug = (res: ScoreResponse | null | undefined) => {
    const debug = res?.debug;
    if (!Array.isArray(debug) || debug.length === 0) return;
    appendActionLog(debug, "system");
  };
  const gameActionLog = useMemo(
    () => actionLog.filter((entry) => entry.kind === "ui").map((entry) => entry.text),
    [actionLog]
  );
  const tileChoices = useMemo(
    () => (akaEnabled ? TILE_CHOICES_AKA : TILE_CHOICES_NO_AKA),
    [akaEnabled]
  );
  const tileLimits = useMemo(
    () => (akaEnabled ? TILE_LIMITS_AKA : TILE_LIMITS_NO_AKA),
    [akaEnabled]
  );
  const normalizeTileForRule = useCallback(
    (tile: TileStr) => normalizeTileByAkaRule(tile, akaEnabled),
    [akaEnabled]
  );
  const checkTileConservationForRule = useCallback(
    (state: GameState, label: string) => checkTileConservation(state, label, tileLimits),
    [tileLimits]
  );
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
  const initialHandsRef = useRef<Record<Seat, TileStr[]>>(
    createSeatRecord<TileStr[]>(() => [])
  );
  const snapshotInitialHands = useCallback((state: GameState) => {
    initialHandsRef.current = {
      E: [...(state.players.E.hand ?? [])],
      S: [...(state.players.S.hand ?? [])],
      W: [...(state.players.W.hand ?? [])],
      N: [...(state.players.N.hand ?? [])]
    };
  }, []);
  const setInitialHandForSeat = useCallback((seat: Seat, hand: TileStr[]) => {
    initialHandsRef.current = {
      ...initialHandsRef.current,
      [seat]: [...hand]
    };
  }, []);
  const resetInitialHands = useCallback(() => {
    initialHandsRef.current = createSeatRecord<TileStr[]>(() => []);
  }, []);
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
    return initFromKifuStep(round, step, initOverrides, {
      tileChoices,
      tileLimits,
      normalizeTile: normalizeTileForRule
    });
  }, [
    gameState,
    overrideBySeat,
    overrideDora,
    overrideUra,
    round,
    step,
    metaOverrides,
    tileChoices,
    tileLimits,
    normalizeTileForRule
  ]);

  const seatOrder = useMemo(() => {
    const dealer = dealerSeatFromKyoku(viewState.meta.kyoku ?? 1);
    return [
      dealer,
      nextSeat(dealer),
      nextSeat(nextSeat(dealer)),
      nextSeat(nextSeat(nextSeat(dealer)))
    ] as Seat[];
  }, [viewState.meta.kyoku]);

  const currentWindLabels = useMemo(() => {
    const dealer = dealerSeatFromKyoku(viewState.meta.kyoku ?? 1);
    return {
      E: WIND_LABELS[resolveSeatWind("E", dealer)],
      S: WIND_LABELS[resolveSeatWind("S", dealer)],
      W: WIND_LABELS[resolveSeatWind("W", dealer)],
      N: WIND_LABELS[resolveSeatWind("N", dealer)]
    } as Record<Seat, string>;
  }, [viewState.meta.kyoku]);

  const updateSeatName = (seat: Seat, name: string) => {
    setSeatNames((prev) => ({ ...prev, [seat]: name }));
  };

  const updateSeatAvatar = useCallback((seat: Seat, file: File | null) => {
    const prevUrl = seatAvatarObjectUrlsRef.current[seat];
    if (prevUrl) {
      URL.revokeObjectURL(prevUrl);
      seatAvatarObjectUrlsRef.current[seat] = null;
    }
    if (!file) {
      setSeatAvatars((prev) => ({ ...prev, [seat]: "" }));
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    seatAvatarObjectUrlsRef.current[seat] = nextUrl;
    setSeatAvatars((prev) => ({ ...prev, [seat]: nextUrl }));
  }, []);

  useEffect(
    () => () => {
      SEAT_LIST.forEach((seat) => {
        const url = seatAvatarObjectUrlsRef.current[seat];
        if (url) {
          URL.revokeObjectURL(url);
          seatAvatarObjectUrlsRef.current[seat] = null;
        }
      });
    },
    []
  );

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
      setWaitsBySeat(createSeatRecord<TileStr[]>(() => []));
      setShantenBySeat(createSeatRecord<number | null>(() => null));
      setRiichiOptions([]);
      setPendingRiichi(false);
      setTenpaiChecking(false);
      setTenpaiFlags(createSeatRecord(() => false));
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
      const res = await fetchTenpai(normalized, normalizeMeldsForTenpai(melds, canonicalTile));
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
        const next = createSeatRecord<TileStr[]>(() => []);
        const flags = createSeatRecord(() => false);
        const nextShanten = createSeatRecord<number | null>(() => null);
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
      const limit = tileLimits[key] ?? 0;
      const used = usedCounts[key] ?? 0;
      return used < limit;
    }
    const limit = tileLimits[key] ?? 0;
    const used = usedCounts[key] ?? 0;
    return used < limit;
  };

  const remainingCountFromUsed = (tile: string) => {
    const key = tileKeyForCount(tile);
    if (!key) return 0;
    const limit = tileLimits[key] ?? 0;
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
    Object.keys(tileLimits).forEach((key) => {
      const limit = tileLimits[key] ?? 0;
      const used = usedCounts[key] ?? 0;
      total += Math.max(limit - used, 0);
    });
    return total;
  }, [usedCounts, tileLimits]);

  const liveWallRemaining = gameState ? getWallRemaining(viewState.meta) : Math.max(remainingTotalFromUsed, 0);
  const totalWallRemaining = gameState
    ? liveWallRemaining
    : remainingTotalFromUsed;

  const remainingTiles = useMemo(
    () =>
      tileChoices.map((tile) => ({
        tile,
        count: remainingCountForDisplay(tile)
      })),
    [remainingCountForDisplay, tileChoices]
  );

  const handleClearHands = () => {
    resetInitialHands();
    if (gameState) {
      setGameState((prev) =>
        prev
          ? {
              ...prev,
              players: mapPlayers(prev.players, (player) => resetPlayerForHandClear(player)),
              meta: { ...prev.meta, doraRevealedCount: 1, liveWall: [], deadWall: [], doraIndicators: [], uraDoraIndicators: [] },
              turn: dealerSeatFromKyoku(prev.meta.kyoku ?? 1),
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
    let mergedHands = hasHandOverrides
      ? mergeHandsForOverrides(overrideBySeat, step?.hands as Record<Seat, TileStr[]> | undefined)
      : undefined;
    const pendingInitialHands = initialHandsRef.current;
    if (
      pendingInitialHands.E.length ||
      pendingInitialHands.S.length ||
      pendingInitialHands.W.length ||
      pendingInitialHands.N.length
    ) {
      mergedHands = {
        E: pendingInitialHands.E.length ? [...pendingInitialHands.E] : mergedHands?.E ?? [...(step?.hands?.E ?? [])],
        S: pendingInitialHands.S.length ? [...pendingInitialHands.S] : mergedHands?.S ?? [...(step?.hands?.S ?? [])],
        W: pendingInitialHands.W.length ? [...pendingInitialHands.W] : mergedHands?.W ?? [...(step?.hands?.W ?? [])],
        N: pendingInitialHands.N.length ? [...pendingInitialHands.N] : mergedHands?.N ?? [...(step?.hands?.N ?? [])]
      };
    }
    return {
      hands: mergedHands,
      doraIndicators: metaDora,
      uraDoraIndicators: metaUra,
      points: metaPoints ?? ((step?.points as Record<Seat, number> | undefined) ?? undefined),
      meta: metaOverrides ?? undefined
    };
  };

  // 現在状態を天鳳互換JSONに整形して出力
  const buildLogExport = () => {
    const baseState = gameState ?? viewState;
    const initState = logInitRef.current ?? baseState;
    const initialHands = {
      E: initialHandsRef.current.E.length ? initialHandsRef.current.E : initState.players.E.hand ?? [],
      S: initialHandsRef.current.S.length ? initialHandsRef.current.S : initState.players.S.hand ?? [],
      W: initialHandsRef.current.W.length ? initialHandsRef.current.W : initState.players.W.hand ?? [],
      N: initialHandsRef.current.N.length ? initialHandsRef.current.N : initState.players.N.hand ?? []
    };

    return buildLogExportSnapshot({
      baseState,
      initState,
      logTitle,
      ruleDisplay,
      akaEnabled,
      seatNames,
      winInfo,
      tenpaiFlags,
      riichiDiscards,
      actionLog: gameActionLog,
      initialHands,
      seatList: SEAT_LIST,
      seatLabelToSeat: SEAT_LABEL_TO_SEAT,
      kyokuToSeat: KYOKU_TO_SEAT,
      tileToLogCode,
      logTokenToTile,
      buildCallLogToken,
      tileEq,
      hasRiichiYaku,
      getDealerFromKyoku: dealerSeatFromKyoku,
      getDoraIndicators,
      getUraDoraIndicators,
      computeDoraCountsForWin,
      formatScoreSummaryForLog,
      buildJapaneseYakuList,
      resolveSeatWind
    });
  };

  const exportLog = () => {
    const snapshot = buildLogExport();
    const now = new Date();
    const pad2 = (value: number) => String(value).padStart(2, "0");
    const timestamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}T${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const sanitizeFilenamePart = (value: string, fallback: string) => {
      const cleaned = value
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, "")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
      return cleaned || fallback;
    };
    const titleCombined = `${logTitle[0] ?? ""}${logTitle[1] ?? ""}`;
    const titlePart = sanitizeFilenamePart(titleCombined, "untitled");
    const windLabel = WIND_LABELS[viewState.meta.wind] ?? "東";
    const kyoku = Number.isFinite(viewState.meta.kyoku) && viewState.meta.kyoku > 0 ? viewState.meta.kyoku : 1;
    const roundPart = sanitizeFilenamePart(`${windLabel}${kyoku}局`, "東1局");
    const fileName = `${timestamp}_${titlePart}_${roundPart}.json`;
    const blob = new Blob([JSON.stringify(snapshot)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startGameFromOverrides = () => {
    const initOverrides = buildInitOverrides();
    let nextState = initFromKifuStep(round, step, initOverrides, {
      tileChoices,
      tileLimits,
      normalizeTile: normalizeTileForRule
    });
    const dealer = dealerSeatFromKyoku(nextState.meta.kyoku ?? 1);
    nextState = {
      ...nextState,
      turn: dealer,
      phase: "BEFORE_DRAW",
      lastDiscard: undefined,
      pendingClaims: []
    };
    resetGameUi({ gameState: nextState });
    logInitRef.current = cloneState(nextState);
    snapshotInitialHands(nextState);
    undoStackRef.current = [];
    setUndoCount(0);
    return nextState;
  };

  const handleLogClear = () => {
    handleClearHands();
    clearActionLog();
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
    if (honorMap[text]) return normalizeTileForRule(honorMap[text]);
    return normalizeTileForRule(text) ?? text;
  };

  const applyDetectedTilesToSeat = (seat: Seat, tiles: string[]) => {
    const normalized = tiles
      .map((tile) => normalizeDetectedTile(tile))
      .map((tile) => normalizeTileForRule(tile))
      .filter((tile): tile is TileStr => Boolean(tile));
    const baseHand = normalized.slice(0, 13);
    const extraTile = normalized[13] ?? null;
    const paddedHand = [...baseHand];
    while (paddedHand.length < 13) paddedHand.push(TILE_PLACEHOLDER);

    if (!gameState) {
      const turnSeat = viewState.turn;
      if (extraTile && seat !== turnSeat) {
        appendActionLog("ツモ牌は手番のみ反映できます", "error");
      }
      if (!(extraTile && seat === turnSeat)) {
        setInitialHandForSeat(seat, sortTiles(paddedHand));
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
      appendActionLog("捨て牌後は画像反映できません", "error");
      return;
    }

    const isTurnSeat = seat === ensureState.turn;
    const canAssignDrawn = Boolean(extraTile && isTurnSeat);
    if (extraTile && !canAssignDrawn) {
      appendActionLog("ツモ牌は手番のみ反映できます", "error");
    }

    const returnTiles = [
      ...player.hand,
      ...(player.drawnTile && player.drawnFrom !== "CALL" ? [player.drawnTile] : [])
    ]
      .map((tile) => normalizeTileForRule(tile))
      .filter((tile): tile is TileStr => Boolean(tile) && tile !== TILE_PLACEHOLDER && tile !== TILE_BACK);

    const takeTiles = [
      ...baseHand,
      ...(canAssignDrawn ? [extraTile as TileStr] : [])
    ]
      .map((tile) => normalizeTileForRule(tile))
      .filter((tile): tile is TileStr => Boolean(tile) && tile !== TILE_PLACEHOLDER && tile !== TILE_BACK);

    let nextLiveWall = [...(ensureState.meta.liveWall ?? [])];
    if (returnTiles.length) nextLiveWall = [...nextLiveWall, ...returnTiles];
    let failed = false;
    let failedTile = "";
    takeTiles.forEach((tile) => {
      const removed = BaseWallOps.removeWallTile(nextLiveWall, tile);
      if (!removed.found) {
        failed = true;
        failedTile = tile;
        return;
      }
      nextLiveWall = removed.next;
    });
    if (failed) {
      appendActionLog(failedTile ? `山にありません: ${formatTileForLog(failedTile)}` : "山にありません", "error");
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
    applyStateTransition(nextState, "importImage");
    if (ensureState.players[seat].discards.length === 0) {
      setInitialHandForSeat(seat, nextPlayer.hand);
    }
    if (logInitRef.current && logInitRef.current.players[seat].discards.length === 0) {
      logInitRef.current = {
        ...logInitRef.current,
        players: {
          ...logInitRef.current.players,
          [seat]: {
            ...logInitRef.current.players[seat],
            hand: [...nextPlayer.hand],
            drawnTile: null,
            drawnFrom: null
          }
        }
      };
    }
    if (canAssignDrawn && extraTile) {
      const action = player.drawnTile ? "ツモ差替" : "ツモ";
      appendActionLog(`${formatSeatForLog(seat)}${action}: ${formatTileForLog(extraTile)}`);
    }
  };

  const {
    captureVideoRef,
    captureStream,
    captureStarting,
    captureAnalyzing,
    startScreenCapture,
    captureAndAnalyzeForSeat
  } = useScreenCapture({
    appendActionLog,
    applyDetectedTilesToSeat
  });

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
        appendActionLog(
          `手牌枚数が不正です（現在:${stripTiles(baseState.players[seat].hand).length} / 期待:${expected}）`,
          "error"
        );
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
      tile && tile !== "BACK" ? normalizeTileForRule(tile) : tile;
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
          appendActionLog("山にありません", "error");
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
        applyStateTransition(nextState, "rinshan");
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
            appendActionLog(
              `手牌枚数が不正です（現在:${stripTiles(player.hand).length} / 期待:${expected}）`,
              "error"
            );
            return;
          }
          let nextLiveWall = gameState.meta.liveWall ?? [];
          const liveRemoved = removeOneExactThenNorm(nextLiveWall, normalizedTile);
          if (liveRemoved.length !== nextLiveWall.length) {
            nextLiveWall = liveRemoved;
          } else {
            appendActionLog("山にありません", "error");
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
          applyStateTransition(nextState, "drawPicker");
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
          const removed = BaseWallOps.removeWallTile(nextLiveWall, normalizedTile);
          if (!removed.found) {
            appendActionLog("山にありません", "error");
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
          applyStateTransition(nextState, "drawReplace");
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
              const removed = BaseWallOps.removeWallTile(nextLiveWall, indicatorTile);
              if (removed.found) {
                nextLiveWall = removed.next;
                desiredDora[pickerIndex] = indicatorTile;
                applied = true;
              } else {
                appendActionLog("山にありません", "error");
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
          applyStateTransition(nextState, "pickDora");
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
          applyStateTransition(nextState, "pickUra");
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
            prevTile && prevTile !== TILE_PLACEHOLDER && prevTile !== TILE_BACK ? normalizeTileForRule(prevTile) : "";
          const takeTile =
            nextTile && nextTile !== TILE_PLACEHOLDER && nextTile !== TILE_BACK ? normalizeTileForRule(nextTile) : "";
          if (returnTile) {
            nextLiveWall = [...nextLiveWall, returnTile];
          }
          if (takeTile) {
            const removed = BaseWallOps.removeWallTile(nextLiveWall, takeTile);
            if (!removed.found) {
              appendActionLog("山にありません", "error");
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
        applyStateTransition(nextState, "editHand");
        if (player.discards.length === 0) {
          setInitialHandForSeat(pickerSeat, nextHand);
        }
        if (logInitRef.current && logInitRef.current.players[pickerSeat].discards.length === 0) {
          logInitRef.current = {
            ...logInitRef.current,
            players: {
              ...logInitRef.current.players,
              [pickerSeat]: {
                ...logInitRef.current.players[pickerSeat],
                hand: [...nextHand],
                drawnTile: null,
                drawnFrom: null
              }
            }
          };
        }
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
      setInitialHandForSeat(pickerSeat, nextHand);
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

  const updateLogTitle = useCallback((index: 0 | 1, value: string) => {
    setLogTitle((prev) => {
      const next: [string, string] = [...prev] as [string, string];
      next[index] = value;
      return next;
    });
  }, []);

  const handleAkaEnabledChange = useCallback((enabled: boolean) => {
    setAkaEnabled(enabled);
    if (enabled) return;
    const normalizeNoAka = (tile: TileStr) => normalizeTileByAkaRule(tile, false);
    const nextTileLimits = TILE_LIMITS_NO_AKA;

    initialHandsRef.current = {
      E: mapTilesForAkaRule(initialHandsRef.current.E, normalizeNoAka),
      S: mapTilesForAkaRule(initialHandsRef.current.S, normalizeNoAka),
      W: mapTilesForAkaRule(initialHandsRef.current.W, normalizeNoAka),
      N: mapTilesForAkaRule(initialHandsRef.current.N, normalizeNoAka)
    };
    if (logInitRef.current) {
      logInitRef.current = normalizeStateForAkaRule(logInitRef.current, normalizeNoAka);
    }

    setHandOverrides((prev) => {
      const next: Record<string, Record<Seat, string[]>> = {};
      Object.entries(prev).forEach(([key, value]) => {
        next[key] = {
          E: mapTilesForAkaRule(value.E ?? [], normalizeNoAka),
          S: mapTilesForAkaRule(value.S ?? [], normalizeNoAka),
          W: mapTilesForAkaRule(value.W ?? [], normalizeNoAka),
          N: mapTilesForAkaRule(value.N ?? [], normalizeNoAka)
        };
      });
      return next;
    });
    setDoraOverrides((prev) => {
      const next: Record<string, string[]> = {};
      Object.entries(prev).forEach(([key, tiles]) => {
        next[key] = mapTilesForAkaRule(tiles ?? [], normalizeNoAka);
      });
      return next;
    });
    setUraOverrides((prev) => {
      const next: Record<string, string[]> = {};
      Object.entries(prev).forEach(([key, tiles]) => {
        next[key] = mapTilesForAkaRule(tiles ?? [], normalizeNoAka);
      });
      return next;
    });
    setMetaOverrides((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        liveWall: mapTilesForAkaRule(prev.liveWall ?? [], normalizeNoAka),
        deadWall: mapTilesForAkaRule(prev.deadWall ?? [], normalizeNoAka),
        doraIndicators: mapTilesForAkaRule(prev.doraIndicators ?? [], normalizeNoAka),
        uraDoraIndicators: mapTilesForAkaRule(prev.uraDoraIndicators ?? [], normalizeNoAka)
      };
    });
    setWaitsBySeat((prev) => ({
      E: mapTilesForAkaRule(prev.E ?? [], normalizeNoAka),
      S: mapTilesForAkaRule(prev.S ?? [], normalizeNoAka),
      W: mapTilesForAkaRule(prev.W ?? [], normalizeNoAka),
      N: mapTilesForAkaRule(prev.N ?? [], normalizeNoAka)
    }));
    setRiichiOptions((prev) => mapTilesForAkaRule(prev, normalizeNoAka));
    setSelectedDiscard((prev) => (prev ? normalizeNoAka(prev) : prev));
    setWinInfo((prev) => (prev ? { ...prev, tile: normalizeNoAka(prev.tile) } : prev));
    setWinOptions((prev) => ({ ...prev, akaCount: 0 }));

    if (gameState) {
      const normalized = normalizeStateForAkaRule(gameState, normalizeNoAka);
      checkTileConservation(normalized, "toggleAkaOff", nextTileLimits);
      setGameState(normalized);
    }
  }, [gameState, setGameState, setSelectedDiscard, setWinInfo]);

  useEffect(() => {
    if (!settingsDraft) {
      setSettingsDraft(buildSettingsDraft(viewState.meta));
    }
  }, [settingsDraft, viewState.meta]);

  const saveSettings = (draft: SettingsDraft | null = settingsDraft) => {
    if (!draft) return;
    const desiredDora = parseTiles(draft.doraIndicators).map((tile) => normalizeTileForRule(tile));
    const desiredUra = parseTiles(draft.uraDoraIndicators).map((tile) => normalizeTileForRule(tile));
    const derivedDealer = dealerSeatFromKyoku(draft.kyoku);
    const nextMeta: Partial<RoundMeta> = {
      wind: draft.wind,
      kyoku: draft.kyoku,
      honba: draft.honba,
      riichiSticks: draft.riichiSticks,
      dealer: derivedDealer
    };
    if (gameState) {
      const isInitialState = SEAT_LIST.every((seat) => (gameState.players[seat]?.discards?.length ?? 0) === 0);
      let nextLiveWall = [...(gameState.meta.liveWall ?? [])];
      const prevIndicators = [...(gameState.meta.doraIndicators ?? [])].filter(Boolean);
      if (prevIndicators.length) {
        nextLiveWall = [...nextLiveWall, ...prevIndicators];
      }
      const removeTargets = [...desiredDora].filter(Boolean);
      removeTargets.forEach((tile) => {
        const removed = BaseWallOps.removeWallTile(nextLiveWall, tile);
        if (removed.found) {
          nextLiveWall = removed.next;
        }
      });
      const nextDoraCount = desiredDora.length
        ? Math.max(1, Math.min(5, desiredDora.length))
        : gameState.meta.doraRevealedCount ?? 1;
      setGameState({
        ...gameState,
        turn: isInitialState ? derivedDealer : gameState.turn,
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
      appendActionLog(`手牌枚数不正（現在:${stripTiles(player.hand).length} / 期待:${expected}）`, "error");
      return;
    }
    const liveWall = gameState.meta.liveWall ?? [];
    if (!liveWall.length) {
      appendActionLog("壁牌がありません", "error");
      return;
    }
    const popResult = BaseWallOps.popWallTile(liveWall);
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
    applyStateTransition(nextState, "doDraw");
    appendActionLog(`${formatSeatForLog(seat)}ツモ: ${formatTileForLog(tile)}`);
    setSelectedDiscard(null);
  };

  const doDrawWithTile = (tile: TileStr) => {
    if (!gameState || gameState.phase !== "BEFORE_DRAW") return;
    pushUndo();
    const normalized = normalizeTileForRule(tile);
    if (!normalized) return;
    const seat = gameState.turn;
    const player = gameState.players[seat];
    const expected = expectedHandCountBeforeDraw(player);
    if (stripTiles(player.hand).length !== expected) {
      appendActionLog(`手牌枚数が不正です（現在:${stripTiles(player.hand).length} / 期待:${expected}）`, "error");
      return;
    }
    let liveWall = gameState.meta.liveWall ?? [];
    const removed = BaseWallOps.removeWallTile(liveWall, normalized);
    if (!removed.found) {
      appendActionLog("壁牌にありません", "error");
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
    applyStateTransition(nextState, "doDrawWithTile");
    appendActionLog(`${formatSeatForLog(seat)}ツモ: ${formatTileForLog(removed.tile)}`);
    setSelectedDiscard(null);
  };

  const doDiscard = (tile: TileStr) => {
    if (!gameState || gameState.phase !== "AFTER_DRAW_MUST_DISCARD") return;
    pushUndo();
    const seat = gameState.turn;
    const player = gameState.players[seat];
    if (pendingRinshan && pendingRinshan === seat && !player.drawnTile) {
      appendActionLog("リンシャン牌を選択してください", "error");
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
      appendActionLog("鳴き牌は捨てられません", "error");
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
        return;
      }
    }
    const transition = buildDiscardTransition(gameState, tile, pendingRiichi);
    if (transition.riichiDeclared) {
      setRiichiDiscards((prev) => ({
        ...prev,
        [seat]: transition.riichiDiscardIndex
      }));
    }
    applyStateTransition(transition.nextState, "doDiscard");
    appendActionLog([
      `${formatSeatForLog(seat)}ステ: ${formatTileForLog(tile)}`,
      ...(transition.riichiDeclared ? [`${formatSeatForLog(seat)}リーチ`] : [])
    ]);
    setJunmeCount((prev) => prev + 1);
    setSelectedDiscard(null);
    setPendingRiichi(false);
  };

  const advanceToNextDraw = () => {
    if (!gameState) return;
    pushUndo();
    const nextState = buildAdvanceToNextDrawTransition(gameState, callOptionsAll);
    applyStateTransition(nextState, "advanceToNextDraw");
    setSelectedDiscard(null);
    setPendingRiichi(false);
  };

  const applyClaim = (
    claim: Extract<LegalAction, { type: "CHI" | "PON" | "KAN" }>,
    selectedTiles?: TileStr[]
  ) => {
    if (!gameState) return;
    pushUndo();
    const result = buildClaimTransition(gameState, claim, selectedTiles);
    if (!result) {
      if (claim.type === "CHI") appendActionLog("チー不可", "error");
      return;
    }
    applyStateTransition(result.nextState, "applyClaim");
    appendActionLog(`${formatSeatForLog(claim.by)}${result.label}: ${formatTileForLog(result.tile)}`);
    setPendingRiichi(false);
    if (result.isKan) {
      setPendingRinshan(claim.by);
      openRinshanPicker(claim.by);
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
    if (options.length === 1) {
      closeCallPicker();
      applyClaim(options[0], options[0].usedTiles);
      return;
    }
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

  // ロン成立時: 役判定→点数反映→終局化
  const applyRon = async (claim: Extract<LegalAction, { type: "RON_WIN" }>, extraFlags?: WinOptionFlags) => {
    if (!gameState || !gameState.lastDiscard) return;
    pushUndo();
    const winner = claim.by;
    const tile = claim.tile;
    const player = gameState.players[winner];
    const dealerSeat = dealerSeatFromKyoku(gameState.meta.kyoku ?? 1);
    if (player.furiten || player.furitenTemp) {
      appendActionLog("ロン不可", "error");
      return;
    }
    const context = buildScoreContext({ ...gameState.meta, dealer: dealerSeat }, player, winner, tile, "ron");
    const res = await scoreWinWithVariants({
      context,
      extraFlags,
      kiriage: kiriageEnabled,
      canonicalTile,
      tileNorm,
      tileEq,
      sortTiles
    }).catch((err) => ({ ok: false, error: String(err), result: undefined }));
    appendScoreDebug(res);
    const adjustedResult = applyDoraOverridesToResult(res?.result, context, extraFlags);
    const han = adjustedResult?.han ?? 0;
    if (!res?.ok || han <= 0) {
      appendActionLog(`ロン不可${formatScoreFailureDetail(res)}`, "error");
      return;
    }
    const loserSeat = gameState.lastDiscard.seat;
    const riichiDiscardIndex = riichiDiscards[loserSeat];
    const lastDiscardIndex = gameState.players[loserSeat]?.discards.length
      ? gameState.players[loserSeat].discards.length - 1
      : null;
    const isRiichiDeclarationRon =
      riichiDiscardIndex != null && lastDiscardIndex != null && riichiDiscardIndex === lastDiscardIndex;
    let nextPoints = applyWinPoints({
      winType: "ron",
      winner,
      dealer: dealerSeat,
      loser: loserSeat,
      cost: adjustedResult?.cost,
      riichiSticks: gameState.meta.riichiSticks ?? 0,
      honba: gameState.meta.honba ?? 0,
      basePoints: gameState.meta.points
    });
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
      result: adjustedResult ?? undefined,
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

  // ツモ成立時: 役判定→点数反映→終局化
  const applyTsumoWin = async (extraFlags?: WinOptionFlags) => {
    if (!gameState || gameState.phase !== "AFTER_DRAW_MUST_DISCARD") return;
    pushUndo();
    const winner = gameState.turn;
    const player = gameState.players[winner];
    const dealerSeat = dealerSeatFromKyoku(gameState.meta.kyoku ?? 1);
    if (player.drawnFrom === "CALL") return;
    const winTile = player.drawnTile ?? "";
    if (!winTile) return;
    const context = buildScoreContext({ ...gameState.meta, dealer: dealerSeat }, player, winner, winTile, "tsumo");
    const res = await scoreWinWithVariants({
      context,
      extraFlags,
      kiriage: kiriageEnabled,
      canonicalTile,
      tileNorm,
      tileEq,
      sortTiles
    }).catch((err) => ({ ok: false, error: String(err), result: undefined }));
    appendScoreDebug(res);
    const adjustedResult = applyDoraOverridesToResult(res?.result, context, extraFlags);
    const han = adjustedResult?.han ?? 0;
    if (!res?.ok || han <= 0) {
      appendActionLog(`ツモ和了不可${formatScoreFailureDetail(res)}`, "error");
      return;
    }
    const nextPoints = applyWinPoints({
      winType: "tsumo",
      winner,
      dealer: dealerSeat,
      cost: adjustedResult?.cost,
      riichiSticks: gameState.meta.riichiSticks ?? 0,
      honba: gameState.meta.honba ?? 0,
      basePoints: gameState.meta.points
    });
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
      result: adjustedResult ?? undefined,
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
    const waits = waitsBySeat[winner] ?? [];
    if (!waits.some((wait) => tileEq(wait, player.drawnTile ?? ""))) return;
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

  const doRyukyoku = () => {
    if (!gameState || gameState.phase === "ENDED") return;
    pushUndo();
    const nextPoints = applyNotenPenaltyPoints(gameState.meta.points, tenpaiFlags);
    const nextState: GameState = {
      ...gameState,
      meta: {
        ...gameState.meta,
        points: nextPoints
      },
      phase: "ENDED",
      lastDiscard: undefined,
      pendingClaims: []
    };
    applyStateTransition(nextState, "doRyukyoku");
    setWinInfo(null);
    setPendingRiichi(false);
    setPendingWin(null);
    setWinOptionsOpen(false);
    appendActionLog([
      "流局",
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
    pushUndo();
    const seat = gameState.turn;
    const player = gameState.players[seat];
    const workingHand = player.drawnTile ? [...player.hand, player.drawnTile] : [...player.hand];
    const counts: Record<string, number> = {};
    workingHand.forEach((tile) => {
      const key = tileNorm(tile);
      if (!key) return;
      counts[key] = (counts[key] ?? 0) + 1;
    });
    const closedTarget = Object.keys(counts).find((tile) => counts[tile] >= 4) ?? null;
    const addedTarget =
      player.riichi || closedTarget ? null : pickAddedKanTile(workingHand, player.melds);
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
    const clearedPlayers = clearIppatsuForAllPlayers(gameState.players);
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
    applyStateTransition(nextState, "doSelfKan");
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
  const handleRemainingTileClick = (tile: string, _count: number) => {
    if (!gameState || gameState.phase !== "BEFORE_DRAW") return;
    if (remainingCountForDisplay(tile) <= 0) return;
    doDrawWithTile(tile);
  };

  const rightPanelProps = {
    showButtons: true,
    initialLocked,
    onScreenCaptureToggle: startScreenCapture,
    screenCaptureDisabled: captureStarting || captureAnalyzing,
    screenCaptureActive: Boolean(captureStream),
    onLogClear: runImmediate(handleLogClear),
    onClearHands: runImmediate(handleClearHands),
    onLogExport: exportLog,
    onOpenRuleSettings: () => setRuleSettingsOpen(true),
    onRyukyoku: doRyukyoku,
    ryukyokuDisabled: !gameState || gameState.phase === "ENDED",
    onUndo: undoLast,
    undoDisabled: undoCount === 0,
    onPickDora: runImmediate(openDoraPicker),
    doraDisplayTiles: getDoraDisplayTiles(viewState.meta),
    doraRevealedCount: viewState.meta.doraRevealedCount ?? 1,
    getTileSrc,
    logTitle,
    onUpdateLogTitle: updateLogTitle,
    settingsDraft,
    onUpdateSettingsDraft: updateSettingsDraft,
    tenpaiChecking,
    tenpaiError,
    actionLog
  };

  const buildSeatActions = useCallback((seat: Seat, player: PlayerState) => {
    const seatCalls = callOptionsAll.filter((action) => action.by === seat);
    const canTsumoNow =
      Boolean(player.drawnTile) &&
      player.drawnFrom !== "CALL" &&
      (waitsBySeat[seat] ?? []).some((wait) => tileEq(wait, player.drawnTile ?? ""));
    const canSelfKan = seatCalls.some((action) => action.type === "KAN");

    return buildSeatActionList({
      seat,
      hasGameState: Boolean(gameState),
      pendingRinshan: pendingRinshan === seat,
      afterDrawOnTurn: Boolean(gameState && gameState.phase === "AFTER_DRAW_MUST_DISCARD" && gameState.turn === seat),
      awaitingCall: Boolean(gameState && gameState.phase === "AWAITING_CALL"),
      riichiAllowed,
      pendingRiichi,
      canTsumoNow,
      canSelfKan,
      seatCalls,
      captureActive: Boolean(captureStream),
      captureAnalyzing,
      captureStarting,
      onCapture: captureAndAnalyzeForSeat,
      onRiichi: doRiichi,
      onRiichiCancel: cancelRiichiDeclaration,
      onTsumo: doTsumoWin,
      onSelfKan: doSelfKan,
      onOpenRon: (idx) => {
        const action = seatCalls[idx];
        if (action?.type !== "RON_WIN") return;
        openWinOptions({ type: "ron", claim: action });
      },
      onOpenClaim: (idx) => {
        const action = seatCalls[idx];
        if (!action || (action.type !== "CHI" && action.type !== "PON" && action.type !== "KAN")) return;
        openCallPicker(action);
      },
      onCallCancel: advanceToNextDraw
    });
  }, [
    gameState,
    captureAnalyzing,
    captureStarting,
    captureStream,
    captureAndAnalyzeForSeat,
    pendingRinshan,
    riichiAllowed,
    pendingRiichi,
    waitsBySeat,
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
    if (!gameState) return createSeatRecord(() => true);
    const base = createSeatRecord(() => false);
    SEAT_LIST.forEach((seat) => {
      const player = gameState.players[seat];
      if (player.discards.length === 0) {
        base[seat] = true;
      }
    });
    return base;
  }, [gameState]);

  const clickableBySeat = useMemo(() => {
    if (!gameState) return createSeatRecord(() => true);
    const base = createSeatRecord(() => false);
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

  const discardDisplayBySeat = useMemo(() => {
    const empty = createSeatRecord<{ tile: TileStr; called: boolean }[]>(() => []);
    if (!gameState) {
      SEAT_LIST.forEach((seat) => {
        empty[seat] = (viewState.players[seat].discards ?? []).map((tile) => ({ tile, called: false }));
      });
      return empty;
    }

    const pending = { value: null as { seat: Seat; index: number } | null };
    gameActionLog.forEach((line) => {
      const drawMatch = line.match(/^([東南西北])(ツモ|ツモ差替):\s*(.+)$/);
      if (drawMatch && pending.value) {
        pending.value = null;
        return;
      }
      const actionMatch = line.match(/^([東南西北])(ステ|チー|ポン|カン):\s*(.+)$/);
      if (!actionMatch) return;
      const seat = SEAT_LABEL_TO_SEAT[actionMatch[1]];
      const action = actionMatch[2];
      const tile = logTokenToTile(actionMatch[3]);
      if (!seat) return;
      if (action === "ステ") {
        if (!tile) return;
        empty[seat].push({ tile, called: false });
        pending.value = { seat, index: empty[seat].length - 1 };
        return;
      }
      if ((action === "チー" || action === "ポン" || action === "カン") && pending.value) {
        const last = pending.value;
        if (empty[last.seat][last.index]) {
          empty[last.seat][last.index].called = true;
        }
        pending.value = null;
      }
    });

    SEAT_LIST.forEach((seat) => {
      if (empty[seat].length === 0 && (viewState.players[seat].discards ?? []).length > 0) {
        empty[seat] = (viewState.players[seat].discards ?? []).map((tile) => ({ tile, called: false }));
      }
    });
    return empty;
  }, [gameActionLog, gameState, viewState.players]);

  const calledDiscardIndicesBySeat = useMemo(() => {
    const result = createSeatRecord<number[]>(() => []);
    SEAT_LIST.forEach((seat) => {
      result[seat] = discardDisplayBySeat[seat]
        .map((entry, idx) => (entry.called ? idx : -1))
        .filter((idx) => idx >= 0);
    });
    return result;
  }, [discardDisplayBySeat]);

  const riichiDisplayIndexBySeat = useMemo(() => {
    const discardCounts = createSeatRecord(() => 0);
    const riichiIndex = createSeatRecord<number | null>(() => null);
    gameActionLog.forEach((line) => {
      const discardMatch = line.match(/^([東南西北])ステ:\s*(.+)$/);
      if (discardMatch) {
        const seat = SEAT_LABEL_TO_SEAT[discardMatch[1]];
        if (seat) {
          discardCounts[seat] += 1;
        }
        return;
      }
      const riichiMatch = line.match(/^([東南西北])リーチ$/);
      if (!riichiMatch) return;
      const seat = SEAT_LABEL_TO_SEAT[riichiMatch[1]];
      if (!seat) return;
      const idx = discardCounts[seat] - 1;
      if (idx >= 0) {
        riichiIndex[seat] = idx;
      }
    });
    return riichiIndex;
  }, [gameActionLog]);

  const riichiPendingBySeat = useMemo(() => {
    const result = createSeatRecord(() => false);
    if (!gameState || !pendingRiichi || gameState.phase !== "AFTER_DRAW_MUST_DISCARD") return result;
    result[gameState.turn] = true;
    return result;
  }, [gameState, pendingRiichi]);

  const riichiDiscardablesBySeat = useMemo(() => {
    const result = createSeatRecord<TileStr[]>(() => []);
    if (!gameState || !pendingRiichi || gameState.phase !== "AFTER_DRAW_MUST_DISCARD") return result;
    const seat = gameState.turn;
    const player = gameState.players[seat];
    if (riichiOptions.length > 0) {
      result[seat] = [...riichiOptions];
      return result;
    }
    if (player.drawnTile) {
      result[seat] = [player.drawnTile];
    }
    return result;
  }, [gameState, pendingRiichi, riichiOptions]);

  const { seatSummaryItems, seatBlockItems } = useSeatViewModel({
    seatOrder,
    viewState,
    waitsBySeat,
    tenpaiFlags,
    seatNames,
    windLabels: currentWindLabels,
    buildSeatActions,
    updateSeatName,
    updateSeatPoints,
    clickableBySeat,
    editableBySeat,
    riichiDiscards,
    calledDiscardIndicesBySeat,
    riichiPendingBySeat,
    riichiDiscardablesBySeat
  });

  const seatSummaryItemsForView = useMemo(
    () =>
      seatSummaryItems.map((item) => ({
        ...item,
        avatarUrl: seatAvatars[item.seat] ?? "",
        onAvatarChange: (file: File | null) => updateSeatAvatar(item.seat, file)
      })),
    [seatSummaryItems, seatAvatars, updateSeatAvatar]
  );

  const seatBlockItemsForView = useMemo(
    () =>
      seatBlockItems.map((item) => ({
        ...item,
        player: {
          ...item.player,
          discards: discardDisplayBySeat[item.seat].map((entry) => entry.tile)
        },
        calledDiscardIndices: calledDiscardIndicesBySeat[item.seat],
        riichiIndex: riichiDisplayIndexBySeat[item.seat]
      })),
    [calledDiscardIndicesBySeat, discardDisplayBySeat, riichiDisplayIndexBySeat, seatBlockItems]
  );

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
      <video ref={captureVideoRef} className="screen-capture-video" playsInline muted />
      <SeatSummaryBar
        items={seatSummaryItemsForView}
        tileToAsset={tileToAsset}
        remainingCountForDisplay={remainingCountForDisplay}
      />
      <div className="app-container">
        <RightPanel {...rightPanelProps} />
        <div className="center-column">
          <div className="simple-list">
            {seatBlockItemsForView.map((item) => (
              <SeatBlock
                key={`seat-${item.seat}`}
                item={item}
                onHandTileClick={handleHandTileClick}
                onHandTileContextMenu={handleHandTileContextMenu}
                onDrawTileClick={handleDrawTileClick}
                showDrawPlaceholder={canSelectDrawTile(item.seat)}
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
        <LeftTools
          wallRemaining={totalWallRemaining}
          remainingTiles={remainingTiles}
          onRemainingTileClick={handleRemainingTileClick}
          showRemaining
          getTileSrc={getTileSrc}
        />
      </div>

      <PickerModal
        open={pickerOpen}
        kind={pickerKind}
        compact={!akaEnabled}
        tileChoices={tileChoices}
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
        doraDisplayTiles={getDoraDisplayTiles(viewState.meta)}
        showUraIndicators={showUraIndicators}
        uraDisplayTiles={getUraDoraIndicators(viewState.meta).map((tile) => doraFromIndicator(tile) ?? "")}
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

      <RuleSettingsModal
        open={ruleSettingsOpen}
        ruleDisplay={ruleDisplay}
        kiriageEnabled={kiriageEnabled}
        akaEnabled={akaEnabled}
        onChangeRuleDisplay={setRuleDisplay}
        onChangeKiriage={setKiriageEnabled}
        onChangeAkaEnabled={handleAkaEnabledChange}
        onClose={() => setRuleSettingsOpen(false)}
      />

      <CallPickerModal
        open={callPickerOpen}
        options={callPickerOptions}
        onSelect={(idx) => {
          const option = callPickerOptions[idx];
          if (!option) return;
          applyCallOption(option);
        }}
        onClose={closeCallPicker}
        tileToAsset={tileToAsset}
        tileBack={TILE_BACK}
        tilePlaceholder={TILE_PLACEHOLDER}
        meldTileWidth={MELD_TILE_W}
        meldTileHeight={MELD_TILE_H}
        calledIndexFor={calledIndexFor}
      />
    </div>
  );
};

export default App;
