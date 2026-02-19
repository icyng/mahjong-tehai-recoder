import type { Seat } from "../ui/types";

type WinCost = {
  main?: number;
  additional?: number;
};

export type ApplyWinPointParams = {
  winType: "ron" | "tsumo";
  winner: Seat;
  dealer: Seat;
  loser?: Seat;
  cost?: WinCost | null;
  riichiSticks: number;
  basePoints: Record<Seat, number>;
};

const SEATS: Seat[] = ["E", "S", "W", "N"];

export const applyWinPoints = ({
  winType,
  winner,
  dealer,
  loser,
  cost,
  riichiSticks,
  basePoints
}: ApplyWinPointParams): Record<Seat, number> => {
  const points: Record<Seat, number> = { ...basePoints };
  if (!cost) return points;

  if (winType === "ron") {
    if (!loser) return points;
    const payment = Number(cost.main ?? 0);
    points[loser] = (points[loser] ?? 0) - payment;
    points[winner] = (points[winner] ?? 0) + payment;
  } else if (winner === dealer) {
    const payment = Number(cost.main ?? 0);
    SEATS.forEach((seat) => {
      if (seat === winner) return;
      points[seat] = (points[seat] ?? 0) - payment;
      points[winner] = (points[winner] ?? 0) + payment;
    });
  } else {
    const dealerPayment = Number(cost.main ?? 0);
    const childPayment = Number(cost.additional ?? 0);
    SEATS.forEach((seat) => {
      if (seat === winner) return;
      const payment = seat === dealer ? dealerPayment : childPayment;
      points[seat] = (points[seat] ?? 0) - payment;
      points[winner] = (points[winner] ?? 0) + payment;
    });
  }

  const riichiPayout = Math.max(0, riichiSticks) * 1000;
  if (riichiPayout > 0) {
    points[winner] = (points[winner] ?? 0) + riichiPayout;
  }
  return points;
};
