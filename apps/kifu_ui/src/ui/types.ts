export type Seat = "E" | "S" | "W" | "N";

export type TileStr = string;

export type SeatAction = {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export type MeldLike = {
  kind: string;
  tiles: TileStr[];
  calledTile?: TileStr;
  calledFrom?: Seat;
  by?: Seat;
};

export type PlayerLike = {
  hand: TileStr[];
  drawnTile?: TileStr | null;
  drawnFrom?: string | null;
  melds: MeldLike[];
  discards: TileStr[];
  riichi: boolean;
};

export type SeatSummaryItem = {
  seat: Seat;
  windLabel: string;
  name: string;
  points: number;
  statusLabel: string;
  statusClass: string;
  waits: TileStr[];
  onNameChange: (value: string) => void;
  onPointsChange: (value: number) => void;
};

export type SeatBlockItem = {
  seat: Seat;
  seatLabel: string;
  isTurn: boolean;
  isEditable: boolean;
  actions: SeatAction[];
  player: PlayerLike;
  clickable: boolean;
  riichiIndex: number | null;
  calledDiscardIndices?: number[];
  riichiPending?: boolean;
  riichiDiscardables?: TileStr[];
};
