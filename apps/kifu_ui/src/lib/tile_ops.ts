import type { TileStr } from "../ui/types";

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

const honorFromZ = (tile: string): string | null => {
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

export const canonicalTile = (tile: string): string => {
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

export const tileNorm = (tile: string): string => {
  const t = canonicalTile(tile);
  if (t.length === 2 && t[0] === "0" && "mps".includes(t[1])) {
    return `5${t[1]}`;
  }
  return t;
};

export const tileEq = (a: string, b: string): boolean => tileNorm(a) === tileNorm(b);

export const removeOneExactThenNorm = (tiles: string[], target: string): string[] => {
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

export const takeTilesExactThenNorm = (
  tiles: string[],
  target: string,
  count: number
): { taken: string[]; remaining: string[] } => {
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

export const tileToAsset = (tile: string): string | null => {
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

export const tileKeyForCount = (tile: string): string | null => {
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

export const sortTiles = (tiles: string[]): string[] => {
  const normalized = tiles.map((tile) => canonicalTile(tile));
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

export const stripTiles = (tiles: TileStr[]): TileStr[] =>
  tiles.filter((tile) => tile && tile !== "BACK" && tile !== "PLACEHOLDER");

export const TileOps = {
  canonicalTile,
  tileNorm,
  tileEq,
  tileKeyForCount,
  tileToAsset,
  sortTiles,
  removeOneExactThenNorm,
  takeTilesExactThenNorm,
  stripTiles
};
