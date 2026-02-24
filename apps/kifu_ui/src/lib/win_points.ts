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
  honba: number;
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
  honba,
  basePoints
}: ApplyWinPointParams): Record<Seat, number> => {
  const points: Record<Seat, number> = { ...basePoints };
  if (!cost) return points;
  const honbaBonus = Math.max(0, Math.floor(honba)) * 100;

  if (winType === "ron") {
    if (!loser) return points;
    const payment = Number(cost.main ?? 0) + honbaBonus * 3;
    points[loser] = (points[loser] ?? 0) - payment;
    points[winner] = (points[winner] ?? 0) + payment;
  } else if (winner === dealer) {
    const payment = Number(cost.main ?? 0) + honbaBonus;
    SEATS.forEach((seat) => {
      if (seat === winner) return;
      points[seat] = (points[seat] ?? 0) - payment;
      points[winner] = (points[winner] ?? 0) + payment;
    });
  } else {
    const dealerPayment = Number(cost.main ?? 0) + honbaBonus;
    const childPayment = Number(cost.additional ?? 0) + honbaBonus;
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

export const applyNotenPenaltyPoints = (
  basePoints: Record<Seat, number>,
  tenpaiBySeat: Record<Seat, boolean>
): Record<Seat, number> => {
  const tenpaiSeats = SEATS.filter((seat) => tenpaiBySeat[seat]);
  const notenSeats = SEATS.filter((seat) => !tenpaiBySeat[seat]);
  if (tenpaiSeats.length === 0 || tenpaiSeats.length === 4) {
    return { ...basePoints };
  }
  const tenpaiGain = Math.floor(3000 / tenpaiSeats.length);
  const notenPay = Math.floor(3000 / notenSeats.length);
  const points = { ...basePoints };
  tenpaiSeats.forEach((seat) => {
    points[seat] = (points[seat] ?? 0) + tenpaiGain;
  });
  notenSeats.forEach((seat) => {
    points[seat] = (points[seat] ?? 0) - notenPay;
  });
  return points;
};
