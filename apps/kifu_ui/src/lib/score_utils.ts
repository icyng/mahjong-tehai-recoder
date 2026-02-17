import type { Seat, TileStr } from "../ui/types";
import MANGAN_OVER_TABLE from "./mangan_over_table.json";
import { YAKU_BASE_MAP } from "./yaku_map";

export type DoraCounts = {
  dora: number;
  ura: number;
  aka: number;
};

export type PlayerForScore = {
  hand: TileStr[];
  melds: { tiles: TileStr[] }[];
  riichi?: boolean;
  closed?: boolean;
};

export type MetaForScore = {
  doraIndicators?: TileStr[];
  uraDoraIndicators?: TileStr[];
  doraRevealedCount?: number;
  dealer?: Seat;
};

export type ScoreContextLike = {
  player: PlayerForScore;
  winner: Seat;
  winTile: TileStr;
  winType: "ron" | "tsumo";
  meta: MetaForScore;
};

const LIMIT_TIER_KEY: Record<string, "mangan" | "haneman" | "baiman" | "sanbaiman" | "yakuman"> = {
  満貫: "mangan",
  跳満: "haneman",
  倍満: "baiman",
  三倍満: "sanbaiman",
  役満: "yakuman"
};

const canonicalTile = (tile: string) => {
  const trimmed = tile.trim();
  if (!trimmed) return trimmed;
  return trimmed;
};

const tileNorm = (tile: string) => {
  const t = canonicalTile(tile);
  if (t.length === 2 && t[0] === "0" && "mps".includes(t[1])) {
    return `5${t[1]}`;
  }
  return t;
};

export const doraFromIndicator = (tile: string): string | null => {
  const canon = canonicalTile(tile);
  if (!canon) return null;
  if (canon.length === 2 && "mps".includes(canon[1])) {
    const raw = canon[0] === "0" ? "5" : canon[0];
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;
    const next = num === 9 ? 1 : num + 1;
    return `${next}${canon[1]}`;
  }
  const winds = ["E", "S", "W", "N"];
  const dragons = ["P", "F", "C"];
  if (winds.includes(canon)) {
    const idx = winds.indexOf(canon);
    return winds[(idx + 1) % winds.length];
  }
  if (dragons.includes(canon)) {
    const idx = dragons.indexOf(canon);
    return dragons[(idx + 1) % dragons.length];
  }
  return null;
};

export const indicatorFromDora = (tile: string): string | null => {
  const canon = canonicalTile(tile);
  if (!canon) return null;
  if (canon.length === 2 && "mps".includes(canon[1])) {
    const raw = canon[0] === "0" ? "5" : canon[0];
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;
    const prev = num === 1 ? 9 : num - 1;
    return `${prev}${canon[1]}`;
  }
  const winds = ["E", "S", "W", "N"];
  const dragons = ["P", "F", "C"];
  if (winds.includes(canon)) {
    const idx = winds.indexOf(canon);
    return winds[(idx + winds.length - 1) % winds.length];
  }
  if (dragons.includes(canon)) {
    const idx = dragons.indexOf(canon);
    return dragons[(idx + dragons.length - 1) % dragons.length];
  }
  return null;
};

export const getDoraIndicators = (meta: MetaForScore) => {
  const count = Math.max(1, Math.min(5, meta.doraRevealedCount ?? 1));
  return (meta.doraIndicators ?? []).slice(0, count);
};

export const getUraDoraIndicators = (meta: MetaForScore) => {
  const count = Math.max(1, Math.min(5, meta.doraRevealedCount ?? 1));
  return (meta.uraDoraIndicators ?? []).slice(0, count);
};

export const getDoraDisplayTiles = (meta: MetaForScore) =>
  getDoraIndicators(meta).map((tile) => doraFromIndicator(tile) ?? "");

const countDoraTiles = (tiles: string[], indicators: string[]) => {
  const doraTiles = indicators
    .map((tile) => doraFromIndicator(tile))
    .filter((tile): tile is string => !!tile);
  if (!doraTiles.length) return 0;
  let count = 0;
  tiles.forEach((tile) => {
    const norm = tileNorm(tile);
    if (!norm) return;
    doraTiles.forEach((dora) => {
      if (norm === dora) count += 1;
    });
  });
  return count;
};

const collectWinTiles = (player: PlayerForScore, winTile: TileStr) =>
  [
    ...(player.hand ?? []),
    ...(player.melds ?? []).flatMap((meld) => meld.tiles ?? []),
    ...(winTile ? [winTile] : [])
  ].filter((tile) => tile);

export const computeDoraCountsForWin = (
  meta: MetaForScore,
  player: PlayerForScore,
  winTile: TileStr,
  hasRiichi: boolean
): DoraCounts => {
  const tiles = collectWinTiles(player, winTile);
  const dora = countDoraTiles(tiles, getDoraIndicators(meta));
  const ura = hasRiichi ? countDoraTiles(tiles, getUraDoraIndicators(meta)) : 0;
  const aka = tiles.filter((tile) => tile && tile[0] === "0").length;
  return { dora, ura, aka };
};

export const rebuildDoraYakuList = (yaku: unknown, doraCounts: DoraCounts | null) => {
  if (!Array.isArray(yaku)) return yaku;
  const filtered = yaku.filter((item) => {
    if (typeof item !== "string") return true;
    const normalized = item.replace(/[\s_-]+/g, "").toLowerCase();
    return normalized !== "dora" && normalized !== "akadora" && normalized !== "uradora";
  });
  if (!doraCounts) return filtered;
  const next = [...filtered];
  for (let i = 0; i < doraCounts.dora; i += 1) next.push("Dora");
  for (let i = 0; i < doraCounts.ura; i += 1) next.push("Ura Dora");
  for (let i = 0; i < doraCounts.aka; i += 1) next.push("Aka Dora");
  return next;
};

export const getLimitTier = (han: number, fu: number) => {
  if (han >= 13) return "役満";
  if (han >= 11) return "三倍満";
  if (han >= 8) return "倍満";
  if (han >= 6) return "跳満";
  if (han >= 5) return "満貫";
  if (han === 4 && fu >= 40) return "満貫";
  if (han === 3 && fu >= 70) return "満貫";
  return null;
};

export const formatScoreSummaryForLog = (
  result: any,
  winType: "ron" | "tsumo",
  isDealer: boolean
) => {
  if (!result) return "";
  const han = result.han ?? 0;
  const fu = result.fu ?? 0;
  const cost = result.cost ?? null;
  const limitTier = getLimitTier(han, fu);
  if (limitTier) {
    const tierKey = LIMIT_TIER_KEY[limitTier];
    const points =
      (MANGAN_OVER_TABLE?.points as any)?.[winType]?.[isDealer ? "dealer" : "nonDealer"]?.[tierKey] ?? "";
    return `${limitTier}${points}`;
  }
  if (cost?.additional) {
    return `${fu}符${han}飜${cost.main ?? 0}-${cost.additional}点`;
  }
  if (cost?.main) {
    if (winType === "tsumo" && isDealer) {
      return `${fu}符${han}飜${cost.main}点∀`;
    }
    return `${fu}符${han}飜${cost.main}点`;
  }
  if (winType === "tsumo") {
    return `${fu}符${han}飜0-0点`;
  }
  return `${fu}符${han}飜0点`;
};

export const buildJapaneseYakuList = (
  yaku: unknown,
  isClosed: boolean,
  seatWind: Seat,
  roundWind: Seat,
  doraCounts?: DoraCounts
) => {
  if (!Array.isArray(yaku)) return [];
  const results: string[] = [];
  const windLabel = (seat: Seat) => (seat === "E" ? "東" : seat === "S" ? "南" : seat === "W" ? "西" : "北");
  yaku.forEach((raw) => {
    if (typeof raw !== "string") return;
    const name = raw.trim();
    if (!name) return;
    const normalizedKey = name.replace(/[\s_-]+/g, "").toLowerCase();
    const normalizedName = name.replace(/[_-]+/g, " ");
    if (normalizedKey.startsWith("yakuhai")) {
      const lower = name.toLowerCase();
      const has = (token: string) => lower.includes(token);
      if (has("haku") || has("hak")) {
        results.push("役牌 白(1飜)");
        return;
      }
      if (has("hatsu") || has("hat")) {
        results.push("役牌 發(1飜)");
        return;
      }
      if (has("chun") || has("chu")) {
        results.push("役牌 中(1飜)");
        return;
      }
      if (has("roundwind") || has("round wind")) {
        if (has("east")) results.push("場風 東(1飜)");
        else if (has("south")) results.push("場風 南(1飜)");
        else if (has("west")) results.push("場風 西(1飜)");
        else if (has("north")) results.push("場風 北(1飜)");
        else results.push("場風(1飜)");
        return;
      }
      if (has("seatwind") || has("seat wind")) {
        if (has("east")) results.push("自風 東(1飜)");
        else if (has("south")) results.push("自風 南(1飜)");
        else if (has("west")) results.push("自風 西(1飜)");
        else if (has("north")) results.push("自風 北(1飜)");
        else results.push("自風(1飜)");
        return;
      }
      // fallback: use wind tokens if present
      if (has("east")) {
        results.push("役牌 東(1飜)");
        return;
      }
      if (has("south")) {
        results.push("役牌 南(1飜)");
        return;
      }
      if (has("west")) {
        results.push("役牌 西(1飜)");
        return;
      }
      if (has("north")) {
        results.push("役牌 北(1飜)");
        return;
      }
    }
    if (normalizedKey === "dora" || normalizedKey === "akadora" || normalizedKey === "uradora") return;
    if (/^roundwind(east|south|west|north)$/i.test(normalizedKey)) {
      const wind = normalizedKey.replace(/^roundwind/i, "");
      results.push(`場風 ${windLabel(wind === "east" ? "E" : wind === "south" ? "S" : wind === "west" ? "W" : "N")}(1飜)`);
      return;
    }
    if (/^seatwind(east|south|west|north)$/i.test(normalizedKey)) {
      const wind = normalizedKey.replace(/^seatwind/i, "");
      results.push(`自風 ${windLabel(wind === "east" ? "E" : wind === "south" ? "S" : wind === "west" ? "W" : "N")}(1飜)`);
      return;
    }
    const mapped = YAKU_BASE_MAP.find((entry) => {
      if (typeof entry.match === "string") return entry.match === name;
      return entry.match.test(name) || entry.match.test(normalizedName) || entry.match.test(normalizedKey);
    })?.entry;
    if (!mapped) {
      results.push(`${name}`);
      return;
    }
    if (mapped.yakuman) {
      results.push(`${mapped.name}(役満)`);
      return;
    }
    const han =
      isClosed || mapped.hanNaki == null ? mapped.hanMenzen ?? mapped.hanNaki ?? 0 : mapped.hanNaki ?? 0;
    results.push(`${mapped.name}(${han}飜)`);
  });
  if (doraCounts) {
    if (doraCounts.dora > 0) results.push(`ドラ(${doraCounts.dora}飜)`);
    if (doraCounts.ura > 0) results.push(`裏ドラ(${doraCounts.ura}飜)`);
    if (doraCounts.aka > 0) results.push(`赤ドラ(${doraCounts.aka}飜)`);
  }
  return results;
};
