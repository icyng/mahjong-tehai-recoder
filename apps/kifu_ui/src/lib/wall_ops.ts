import type { TileStr } from "../ui/types";
import { canonicalTile, tileEq, tileKeyForCount } from "./tile_ops";

export type WallState = {
  liveWall: TileStr[];
  deadWall: TileStr[];
};

export const popWallTile = (wall: TileStr[]): { tile: TileStr; next: TileStr[] } => {
  const next = [...wall];
  const tile = next.pop() ?? "";
  return { tile, next };
};

export const removeWallTile = (
  wall: TileStr[],
  tile: TileStr
): { tile: TileStr; next: TileStr[]; found: boolean } => {
  const next = [...wall];
  let idx = next.findIndex((t) => t === tile);
  if (idx < 0) idx = next.findIndex((t) => tileEq(t, tile));
  if (idx < 0) return { tile: "", next, found: false };
  const removed = next.splice(idx, 1)[0] ?? "";
  return { tile: removed, next, found: true };
};

export const buildWallStateFromUsage = (
  tileChoices: readonly TileStr[],
  tileLimits: Readonly<Record<string, number>>,
  usedCounts: Readonly<Record<string, number>>
): WallState => {
  const pool: TileStr[] = [];
  tileChoices.forEach((tile) => {
    const key = tileKeyForCount(tile);
    if (!key) return;
    const limit = tileLimits[key] ?? 0;
    const used = usedCounts[key] ?? 0;
    const remaining = Math.max(limit - used, 0);
    for (let i = 0; i < remaining; i += 1) {
      pool.push(canonicalTile(tile));
    }
  });
  return { liveWall: [...pool], deadWall: [] };
};

export const WallOps = {
  popWallTile,
  removeWallTile,
  buildWallStateFromUsage
};
