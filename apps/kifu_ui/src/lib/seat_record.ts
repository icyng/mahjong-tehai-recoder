import type { Seat } from "../ui/types";
import { SEATS } from "./game_flow";

export const createSeatRecord = <T>(factory: (seat: Seat) => T): Record<Seat, T> =>
  SEATS.reduce(
    (acc, seat) => {
      acc[seat] = factory(seat);
      return acc;
    },
    {} as Record<Seat, T>
  );
