import type { Seat } from "../ui/types";

export const WIND_ORDER: Seat[] = ["E", "S", "W", "N"];

export const WIND_LABELS: Record<Seat, string> = {
  E: "東",
  S: "南",
  W: "西",
  N: "北"
};

export const roundIndexFromMeta = (wind: Seat, kyoku: number): number => {
  const windIdx = Math.max(0, WIND_ORDER.indexOf(wind));
  const safeKyoku = Math.min(4, Math.max(1, kyoku));
  return windIdx * 4 + (safeKyoku - 1);
};

export const roundMetaFromIndex = (index: number): { wind: Seat; kyoku: number } => {
  const safe = Math.min(15, Math.max(0, index));
  const wind = WIND_ORDER[Math.floor(safe / 4)] ?? "E";
  const kyoku = (safe % 4) + 1;
  return { wind, kyoku };
};

export const dealerSeatFromKyoku = (kyoku: number): Seat => {
  const idx = Math.max(1, kyoku) - 1;
  return WIND_ORDER[idx % 4] ?? "E";
};
