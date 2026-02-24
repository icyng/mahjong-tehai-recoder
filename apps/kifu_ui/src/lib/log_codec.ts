import type { Seat, TileStr } from "../ui/types";
import type { Meld } from "./game_flow";
import { calledIndexFor } from "./game_flow";
import { WIND_LABELS } from "./round";
import { canonicalTile, tileEq } from "./tile_ops";

const LOG_TOKEN_TO_TILE: Record<string, TileStr> = {
  ton: "E",
  nan: "S",
  sha: "W",
  pei: "N",
  hak: "P",
  hat: "F",
  chu: "C"
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

const formatLogCode = (code: number) => String(code).padStart(2, "0");

export const SEAT_LABEL_TO_SEAT: Record<string, Seat> = {
  東: "E",
  南: "S",
  西: "W",
  北: "N"
};

export const formatTileForLog = (tile: string): string => {
  const canon = canonicalTile(tile);
  if (!canon) return "";
  if (canon.length === 1) return LOG_TILE_LABELS[canon] ?? canon;
  return canon;
};

export const formatSeatForLog = (seat: Seat): string => WIND_LABELS[seat] ?? seat;

export const tileToLogCode = (tile: TileStr): number | null => {
  const canon = canonicalTile(tile);
  if (!canon || canon === "BACK" || canon === "PLACEHOLDER") return null;
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

export const logTokenToTile = (token: string): TileStr | null => {
  if (!token) return null;
  if (LOG_TOKEN_TO_TILE[token]) return LOG_TOKEN_TO_TILE[token];
  if (/^0[ mps]$/i.test(token)) return canonicalTile(token);
  if (/^[1-9][mps]$/i.test(token)) return canonicalTile(token);
  return null;
};

export const buildCallLogToken = (
  kind: "CHI" | "PON" | "MINKAN" | "ANKAN" | "KAKAN",
  meld: Meld
): string | null => {
  const orderedTiles = [...(meld.tiles ?? [])];
  const tokenTiles = kind === "PON" && orderedTiles.length > 3 ? orderedTiles.slice(0, 3) : orderedTiles;
  const codes = tokenTiles
    .map(tileToLogCode)
    .filter((code): code is number => typeof code === "number");
  if (!codes.length) return null;
  if (kind === "CHI") {
    return `c${codes.map(formatLogCode).join("")}`;
  }
  const marker = kind === "PON" ? "p" : kind === "MINKAN" ? "m" : kind === "ANKAN" ? "a" : "k";
  let calledIndex = -1;
  if (meld.by && meld.calledFrom) {
    const idx = calledIndexFor(meld.by, meld.calledFrom, tokenTiles.length);
    if (typeof idx === "number") calledIndex = idx;
  }
  const calledTile = meld.calledTile;
  if (calledIndex < 0 && calledTile) {
    const idx = tokenTiles.findIndex((tile) => tileEq(tile, calledTile));
    if (idx >= 0) calledIndex = idx;
  }
  if (kind === "ANKAN") {
    const target = meld.calledTile ?? tokenTiles[tokenTiles.length - 1];
    const lastIdx = target
      ? [...tokenTiles]
          .map((tile, idx) => ({ tile, idx }))
          .reverse()
          .find((item) => tileEq(item.tile, target))?.idx ?? -1
      : -1;
    if (lastIdx >= 0) calledIndex = lastIdx;
  }
  if (calledIndex < 0) calledIndex = 0;
  if (calledIndex >= codes.length) calledIndex = codes.length - 1;
  return codes
    .map((code, idx) => (idx === calledIndex ? `${marker}${formatLogCode(code)}` : formatLogCode(code)))
    .join("");
};
