import type { ScoreResponse, ScoreResult } from "./mahjong_api";
import type { ScoreContext, WinOptionFlags } from "./score_payload";
import {
  computeDoraCountsForWin,
  getLimitTier,
  rebuildDoraYakuList,
  type DoraCounts
} from "./score_utils";

const SCORE_ERROR_LABELS: Record<string, string> = {
  hand_not_winning: "和了形ではない",
  no_yaku: "役なし",
  winning_tile_not_in_hand: "和了牌が手牌にない",
  open_hand_riichi_not_allowed: "副露リーチ不可",
  open_hand_daburi_not_allowed: "副露ダブリー不可",
  ippatsu_without_riichi_not_allowed: "一発条件不一致"
};

export const formatScoreFailureDetail = (res: ScoreResponse | null | undefined): string => {
  const key = res?.error;
  if (key) return `(${SCORE_ERROR_LABELS[key] ?? key})`;
  if (res?.result?.yaku) return "(役なし)";
  return "(判定失敗)";
};

export const formatYakuList = (yaku: unknown): string => {
  if (!Array.isArray(yaku)) return "";
  return yaku.filter((item) => typeof item === "string").join(", ");
};

export const hasRiichiYaku = (yaku: unknown): boolean =>
  Array.isArray(yaku) && yaku.some((name) => typeof name === "string" && /riichi/i.test(name));

export const formatScoreLine = (result: ScoreResult | null | undefined): string => {
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
): ScoreResult["cost"] | null => {
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

export const sanitizeDoraCounts = (options?: WinOptionFlags): DoraCounts | null => {
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

export const applyDoraOverridesToResult = (
  result: ScoreResult | null | undefined,
  context: ScoreContext,
  options?: WinOptionFlags
): ScoreResult | null | undefined => {
  if (!result) return result;
  const hasRiichi =
    context.player.riichi || Boolean(options?.is_daburu_riichi || options?.is_open_riichi);
  const requestedCounts =
    sanitizeDoraCounts(options) ??
    computeDoraCountsForWin(context.meta, context.player, context.winTile, hasRiichi);
  const resultCounts = extractDoraCountsFromYaku(result.yaku);
  const resultTotal = resultCounts.dora + resultCounts.ura + resultCounts.aka;
  const targetTotal = requestedCounts.dora + requestedCounts.ura + requestedCounts.aka;
  const nextHan = Math.max(0, (result.han ?? 0) - resultTotal + targetTotal);
  const nextCost =
    nextHan > 0
      ? calculateCostFromHanFu(nextHan, result.fu ?? 0, context.winType, context.winner === context.meta.dealer)
      : result.cost;
  return {
    ...result,
    han: nextHan,
    cost: nextCost ?? result.cost,
    yaku: rebuildDoraYakuList(result.yaku, requestedCounts)
  };
};
