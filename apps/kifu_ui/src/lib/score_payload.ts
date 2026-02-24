import type { Seat, TileStr } from "../ui/types";
import { scoreWin, type ScoreResponse, type WinPayload } from "./mahjong_api";
import { getDoraIndicators, getUraDoraIndicators, resolveSeatWind } from "./score_utils";

export type WinOptionFlags = {
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

// 画面側の副露表現（表示用情報を含む）
export type MeldLike = {
  kind: string;
  tiles: TileStr[];
  calledTile?: TileStr;
  calledFrom?: Seat;
  open?: boolean;
  [key: string]: unknown;
};

// 点数判定APIへ渡すための最小プレイヤー情報
export type PlayerForScorePayload = {
  hand: TileStr[];
  melds: MeldLike[];
  closed: boolean;
  riichi: boolean;
};

// 局メタ（場風/供託/本場/ドラ表示牌）
export type MetaForScorePayload = {
  wind: Seat;
  honba: number;
  riichiSticks: number;
  dealer: Seat;
  doraIndicators?: TileStr[];
  uraDoraIndicators?: TileStr[];
  doraRevealedCount?: number;
};

// 和了判定呼び出し時の文脈
export type ScoreContext = {
  player: PlayerForScorePayload;
  winner: Seat;
  winTile: TileStr;
  winType: "ron" | "tsumo";
  meta: MetaForScorePayload;
};

// score API へ送る副露正規化のバリアント
export type MeldScoreOptions = {
  collapseKanKind: boolean;
  includeCalledTileInTiles: "keep" | "force" | "remove";
  includeCalledField: boolean;
  sortTiles: boolean;
  normalizeTile: (tile: string) => string;
  tileEq: (a: string, b: string) => boolean;
  sort: (tiles: TileStr[]) => TileStr[];
};

export const SCORE_MELD_VARIANTS: Omit<MeldScoreOptions, "normalizeTile" | "tileEq" | "sort">[] = [
  { collapseKanKind: false, includeCalledTileInTiles: "keep", includeCalledField: true, sortTiles: true },
  { collapseKanKind: true, includeCalledTileInTiles: "keep", includeCalledField: true, sortTiles: true },
  { collapseKanKind: true, includeCalledTileInTiles: "force", includeCalledField: true, sortTiles: true },
  { collapseKanKind: true, includeCalledTileInTiles: "keep", includeCalledField: false, sortTiles: true }
];

type BuildScorePayloadParams = {
  context: ScoreContext;
  variant: Omit<MeldScoreOptions, "normalizeTile" | "tileEq" | "sort">;
  tileMode: "canonical" | "norm";
  canonicalTile: (tile: string) => string;
  tileNorm: (tile: string) => string;
  tileEq: (a: string, b: string) => boolean;
  sortTiles: (tiles: TileStr[]) => TileStr[];
  extraFlags?: WinOptionFlags;
  kiriage?: boolean;
  debug?: boolean;
};

type ScoreWithVariantsParams = {
  context: ScoreContext;
  extraFlags?: WinOptionFlags;
  kiriage?: boolean;
  canonicalTile: (tile: string) => string;
  tileNorm: (tile: string) => string;
  tileEq: (a: string, b: string) => boolean;
  sortTiles: (tiles: TileStr[]) => TileStr[];
  scoreWinFn?: (payload: WinPayload) => Promise<ScoreResponse>;
  debug?: boolean;
};

// バックエンド互換のため槓種別を必要に応じて KAN へ畳む
const normalizeMeldKindForScore = (kind: string, collapseKanKind: boolean) => {
  const upper = kind?.toUpperCase?.() ?? kind;
  if (upper === "CHI" || upper === "PON") return upper;
  if (upper === "KAN" || upper === "ANKAN" || upper === "MINKAN" || upper === "KAKAN") {
    return collapseKanKind ? "KAN" : upper;
  }
  return collapseKanKind ? "KAN" : upper;
};

// 副露牌を用途に応じて並び替え・呼び牌の含有調整を行う
const normalizeMeldTilesForScore = (meld: MeldLike, options: MeldScoreOptions) => {
  const normalize = options.normalizeTile;
  let tiles = (meld.tiles ?? []).map((tile) => normalize(tile));
  const called = meld.calledTile ? normalize(meld.calledTile) : "";
  if (options.includeCalledTileInTiles === "remove" && called) {
    const idx = tiles.findIndex((tile) => options.tileEq(tile, called));
    if (idx >= 0) tiles.splice(idx, 1);
  } else if (options.includeCalledTileInTiles === "force" && called) {
    if (!tiles.some((tile) => options.tileEq(tile, called))) {
      tiles.push(called);
    }
  }
  if (options.sortTiles) {
    tiles = options.sort(tiles);
  }
  return tiles;
};

const normalizeMeldsForScore = (melds: MeldLike[], options: MeldScoreOptions): MeldLike[] =>
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
  hand
    .filter((tile) => tile && tile !== "BACK" && tile !== "PLACEHOLDER")
    .map((tile) => normalize(tile));

export const normalizeMeldsForTenpai = (
  melds: MeldLike[],
  canonicalTile: (tile: string) => string
): MeldLike[] =>
  melds.map((meld) => {
    const kindUpper = meld.kind.toUpperCase();
    const kind = kindUpper === "CHI" ? "CHI" : kindUpper === "PON" ? "PON" : "KAN";
    return {
      ...meld,
      kind,
      tiles: (meld.tiles ?? []).map((tile) => canonicalTile(tile)),
      calledTile: meld.calledTile ? canonicalTile(meld.calledTile) : meld.calledTile,
      open: meld.open ?? true
    };
  });

export const buildScoreContext = (
  meta: MetaForScorePayload,
  player: PlayerForScorePayload,
  winner: Seat,
  winTile: TileStr,
  winType: "ron" | "tsumo"
): ScoreContext => ({
  player,
  winner,
  winTile,
  winType,
  meta
});

// score API 送信payloadを構築
export const buildScorePayload = ({
  context,
  variant,
  tileMode,
  canonicalTile,
  tileNorm,
  tileEq,
  sortTiles,
  extraFlags,
  kiriage,
  debug
}: BuildScorePayloadParams): WinPayload => {
  const normalize = tileMode === "norm" ? tileNorm : canonicalTile;
  const baseHand = normalizeHandForScore(context.player.hand, normalize);
  const winTile = normalize(context.winTile);
  const melds = normalizeMeldsForScore(context.player.melds, {
    ...variant,
    normalizeTile: normalize,
    tileEq,
    sort: sortTiles
  });
  const isRiichi = context.player.riichi || Boolean(extraFlags?.is_daburu_riichi || extraFlags?.is_open_riichi);
  const isIppatsu = extraFlags?.is_ippatsu ?? false;
  return {
    hand: baseHand,
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
    seatWind: resolveSeatWind(context.winner, context.meta.dealer),
    doraIndicators: getDoraIndicators(context.meta).filter(Boolean).map((tile) => normalize(tile)),
    uraDoraIndicators: getUraDoraIndicators(context.meta).filter(Boolean).map((tile) => normalize(tile)),
    honba: context.meta.honba,
    riichiSticks: context.meta.riichiSticks,
    dealer: context.winner === context.meta.dealer,
    kiriage,
    ...(context.winType === "tsumo" ? { menzenTsumo: context.player.closed } : {}),
    ...(debug ? { debug: true } : {})
  };
};

// 複数表現を順に試し、han>0 を最優先で採用
export const scoreWinWithVariants = async ({
  context,
  extraFlags,
  kiriage,
  canonicalTile,
  tileNorm,
  tileEq,
  sortTiles,
  scoreWinFn = scoreWin,
  debug
}: ScoreWithVariantsParams): Promise<ScoreResponse> => {
  const tried = new Set<string>();
  let firstResult: ScoreResponse | null = null;

  const attempt = async (variant: (typeof SCORE_MELD_VARIANTS)[number], tileMode: "canonical" | "norm") => {
    const payload = buildScorePayload({
      context,
      variant,
      tileMode,
      canonicalTile,
      tileNorm,
      tileEq,
      sortTiles,
      extraFlags,
      kiriage,
      debug
    });
    const key = JSON.stringify(payload);
    if (tried.has(key)) return null;
    tried.add(key);

    const res = await scoreWinFn(payload).catch(
      (err): ScoreResponse => ({ ok: false, error: String(err), result: undefined })
    );
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
