import { useMemo } from "react";
import type { Seat, SeatAction, SeatBlockItem, SeatSummaryItem, TileStr, PlayerLike } from "../ui/types";

type ViewState<PlayerT> = {
  players: Record<Seat, PlayerT>;
  meta: { points: Record<Seat, number> };
  turn: Seat;
};

type UseSeatViewModelParams<PlayerT extends PlayerLike> = {
  seatOrder: Seat[];
  viewState: ViewState<PlayerT>;
  waitsBySeat: Record<Seat, TileStr[]>;
  tenpaiFlags: Record<Seat, boolean>;
  seatNames: Record<Seat, string>;
  windLabels: Record<Seat, string>;
  buildSeatActions: (seat: Seat, player: PlayerT) => SeatAction[];
  updateSeatName: (seat: Seat, value: string) => void;
  updateSeatPoints: (seat: Seat, value: number) => void;
  clickableBySeat: Record<Seat, boolean>;
  editableBySeat: Record<Seat, boolean>;
  riichiDiscards: Record<Seat, number | null>;
};

export const useSeatViewModel = <PlayerT extends PlayerLike>(params: UseSeatViewModelParams<PlayerT>) => {
  const {
    seatOrder,
    viewState,
    waitsBySeat,
    tenpaiFlags,
    seatNames,
    windLabels,
    buildSeatActions,
    updateSeatName,
    updateSeatPoints,
    clickableBySeat,
    editableBySeat,
    riichiDiscards
  } = params;

  const seatSummaryItems: SeatSummaryItem[] = useMemo(
    () =>
      seatOrder.map((seat) => {
        const player = viewState.players[seat];
        const statusLabel = player.riichi ? "リーチ" : tenpaiFlags[seat] ? "テンパイ" : "";
        const statusClass = player.riichi ? "status-riichi" : "status-tenpai";
        return {
          seat,
          windLabel: windLabels[seat],
          name: seatNames[seat] ?? "",
          points: viewState.meta.points[seat],
          statusLabel,
          statusClass,
          waits: waitsBySeat[seat] ?? [],
          onNameChange: (value) => updateSeatName(seat, value),
          onPointsChange: (value) => updateSeatPoints(seat, value)
        };
      }),
    [seatOrder, viewState.players, viewState.meta.points, waitsBySeat, tenpaiFlags, seatNames, windLabels, updateSeatName, updateSeatPoints]
  );

  const seatBlockItems: SeatBlockItem[] = useMemo(
    () =>
      seatOrder.map((seat) => {
        const player = viewState.players[seat];
        return {
          seat,
          seatLabel: `${windLabels[seat]}家`,
          isTurn: seat === viewState.turn,
          isEditable: editableBySeat[seat],
          actions: buildSeatActions(seat, player),
          player,
          clickable: clickableBySeat[seat],
          riichiIndex: riichiDiscards[seat] ?? null
        };
      }),
    [seatOrder, viewState.players, viewState.turn, windLabels, buildSeatActions, clickableBySeat, editableBySeat, riichiDiscards]
  );

  return { seatSummaryItems, seatBlockItems };
};
