import type { Seat, TileStr } from "../ui/types";
import type { ScoreResult } from "./mahjong_api";
import type { DoraCounts } from "./score_utils";

type ExportMeld = {
  kind: "CHI" | "PON" | "KAN" | "ANKAN" | "MINKAN" | "KAKAN";
  tiles: TileStr[];
  by?: Seat;
  calledFrom?: Seat;
  calledTile?: TileStr;
  open: boolean;
};

type ExportPlayer = {
  hand: TileStr[];
  melds: ExportMeld[];
  discards: TileStr[];
  riichi: boolean;
  closed: boolean;
};

type ExportMeta = {
  wind: Seat;
  kyoku: number;
  honba: number;
  riichiSticks: number;
  points: Record<Seat, number>;
  doraIndicators?: TileStr[];
  uraDoraIndicators?: TileStr[];
  doraRevealedCount?: number;
};

type ExportState = {
  meta: ExportMeta;
  players: Record<Seat, ExportPlayer>;
  phase: string;
  lastDiscard?: { seat: Seat; tile: TileStr };
};

type ExportWinInfo = {
  seat: Seat;
  tile: TileStr;
  type: "ron" | "tsumo";
  result?: ScoreResult;
  from?: Seat;
  doraCounts?: DoraCounts;
};

type LogValue = number | string;

type LogSnapshot = {
  title: [string, string];
  name: [string, string, string, string];
  rule: { disp: string; aka: 0 | 1 };
  log: [unknown[]];
};

type BuildLogExportArgs = {
  baseState: ExportState;
  initState: ExportState;
  logTitle: [string, string];
  ruleDisplay: string;
  akaEnabled: boolean;
  seatNames: Record<Seat, string>;
  winInfo: ExportWinInfo | null;
  tenpaiFlags: Record<Seat, boolean>;
  riichiDiscards: Record<Seat, number | null>;
  actionLog: string[];
  initialHands: Record<Seat, TileStr[]>;
  seatList: Seat[];
  seatLabelToSeat: Record<string, Seat>;
  kyokuToSeat: Seat[];
  tileToLogCode: (tile: TileStr) => number | null;
  logTokenToTile: (token: string) => TileStr | null;
  buildCallLogToken: (
    kind: "CHI" | "PON" | "MINKAN" | "ANKAN" | "KAKAN",
    meld: ExportMeld
  ) => string | null;
  tileEq: (a: string, b: string) => boolean;
  hasRiichiYaku: (yaku: unknown) => boolean;
  getDealerFromKyoku: (kyoku: number) => Seat;
  getDoraIndicators: (meta: ExportMeta) => TileStr[];
  getUraDoraIndicators: (meta: ExportMeta) => TileStr[];
  computeDoraCountsForWin: (
    meta: ExportMeta,
    player: { hand: TileStr[]; melds: { tiles: TileStr[] }[]; riichi?: boolean; closed?: boolean },
    winTile: TileStr,
    hasRiichi: boolean
  ) => DoraCounts;
  formatScoreSummaryForLog: (result: ScoreResult | null | undefined, winType: "ron" | "tsumo", isDealer: boolean) => string;
  buildJapaneseYakuList: (
    yaku: unknown,
    isClosed: boolean,
    seatWind: Seat,
    roundWind: Seat,
    doraCounts?: DoraCounts
  ) => string[];
  resolveSeatWind: (seat: Seat, dealerSeat: Seat) => Seat;
};

export const buildLogExportSnapshot = (args: BuildLogExportArgs): LogSnapshot => {
  const {
    baseState,
    initState,
    logTitle,
    ruleDisplay,
    akaEnabled,
    seatNames,
    winInfo,
    tenpaiFlags,
    riichiDiscards,
    actionLog,
    initialHands,
    seatList,
    seatLabelToSeat,
    kyokuToSeat,
    tileToLogCode,
    logTokenToTile,
    buildCallLogToken,
    tileEq,
    hasRiichiYaku,
    getDealerFromKyoku,
    getDoraIndicators,
    getUraDoraIndicators,
    computeDoraCountsForWin,
    formatScoreSummaryForLog,
    buildJapaneseYakuList,
    resolveSeatWind
  } = args;

  const meta = baseState.meta;
  const initMeta = initState.meta;
  const headerMeta = initMeta ?? meta;
  const normalizedRuleDisplay = ruleDisplay.trim() || "般南喰赤";
  const rule = {
    disp: normalizedRuleDisplay,
    aka: (akaEnabled ? 1 : 0) as 0 | 1
  };
  const kyokuIndex =
    (headerMeta.wind === "E" ? 0 : headerMeta.wind === "S" ? 4 : headerMeta.wind === "W" ? 8 : 12) +
    Math.max(0, (headerMeta.kyoku ?? 1) - 1);
  const scores = seatList.map((seat) => initMeta.points?.[seat] ?? meta.points[seat] ?? 0);
  const doraCodes = getDoraIndicators(meta)
    .map(tileToLogCode)
    .filter((code): code is number => typeof code === "number");

  const winnerSeat = winInfo?.seat ?? null;
  const winnerRiichi = winnerSeat != null && (baseState.players[winnerSeat]?.riichi || hasRiichiYaku(winInfo?.result?.yaku));
  const uraCodes = winnerRiichi
    ? getUraDoraIndicators(meta)
        .map(tileToLogCode)
        .filter((code): code is number => typeof code === "number")
    : [];

  const seatState: Record<
    Seat,
    {
      draws: LogValue[];
      discards: LogValue[];
      lastDraw: TileStr | null;
      lastDiscardIndex: number | null;
    }
  > = {
    E: { draws: [], discards: [], lastDraw: null, lastDiscardIndex: null },
    S: { draws: [], discards: [], lastDraw: null, lastDiscardIndex: null },
    W: { draws: [], discards: [], lastDraw: null, lastDiscardIndex: null },
    N: { draws: [], discards: [], lastDraw: null, lastDiscardIndex: null }
  };

  type MeldTracker = {
    meld: ExportMeld;
    usedChi: boolean;
    usedPon: boolean;
    usedKan: boolean;
  };

  const meldTrackers: Record<Seat, MeldTracker[]> = {
    E: (baseState.players.E.melds ?? []).map((meld) => ({ meld, usedChi: false, usedPon: false, usedKan: false })),
    S: (baseState.players.S.melds ?? []).map((meld) => ({ meld, usedChi: false, usedPon: false, usedKan: false })),
    W: (baseState.players.W.melds ?? []).map((meld) => ({ meld, usedChi: false, usedPon: false, usedKan: false })),
    N: (baseState.players.N.melds ?? []).map((meld) => ({ meld, usedChi: false, usedPon: false, usedKan: false }))
  };

  const matchesCalledTile = (meld: ExportMeld, tile: TileStr | null): boolean => {
    if (!tile) return true;
    if (meld.calledTile) return tileEq(meld.calledTile, tile);
    return (meld.tiles ?? []).some((t) => tileEq(t, tile));
  };

  const pickMeld = (
    seat: Seat,
    kinds: ExportMeld["kind"][],
    tile: TileStr | null,
    stage: "chi" | "pon" | "kan"
  ): ExportMeld | null => {
    const trackers = meldTrackers[seat];
    for (const tracker of trackers) {
      if (!kinds.includes(tracker.meld.kind)) continue;
      if (stage === "chi" && tracker.usedChi) continue;
      if (stage === "pon" && tracker.usedPon) continue;
      if (stage === "kan" && tracker.usedKan) continue;
      if (!matchesCalledTile(tracker.meld, tile)) continue;
      if (stage === "chi") tracker.usedChi = true;
      if (stage === "pon") tracker.usedPon = true;
      if (stage === "kan") tracker.usedKan = true;
      return tracker.meld;
    }
    return null;
  };

  const pickMeldWithFallback = (
    seat: Seat,
    kinds: ExportMeld["kind"][],
    tile: TileStr | null,
    stage: "chi" | "pon" | "kan"
  ): ExportMeld | null => pickMeld(seat, kinds, tile, stage) ?? pickMeld(seat, kinds, null, stage);

  const pushCallToken = (
    seat: Seat,
    kind: "CHI" | "PON" | "MINKAN" | "ANKAN" | "KAKAN",
    tile: TileStr | null,
    stage: "chi" | "pon" | "kan"
  ): void => {
    const kinds: ExportMeld["kind"][] =
      kind === "CHI"
        ? ["CHI"]
        : kind === "PON"
          ? ["PON", "KAKAN"]
          : kind === "MINKAN"
            ? ["MINKAN", "KAN"]
            : kind === "ANKAN"
              ? ["ANKAN"]
              : ["KAKAN"];
    const meld = pickMeld(seat, kinds, tile, stage);
    if (!meld) return;
    const token = buildCallLogToken(kind, meld);
    if (token) seatState[seat].draws.push(token);
    seatState[seat].lastDraw = null;
  };

  const pushDiscardValue = (seat: Seat, value: LogValue): void => {
    seatState[seat].lastDiscardIndex = seatState[seat].discards.length;
    seatState[seat].discards.push(value);
  };

  const pushDrawValue = (seat: Seat, tile: TileStr, replaceLast = false): void => {
    const code = tileToLogCode(tile);
    if (code === null) return;
    if (replaceLast && seatState[seat].draws.length > 0) {
      seatState[seat].draws[seatState[seat].draws.length - 1] = code;
    } else {
      seatState[seat].draws.push(code);
    }
    seatState[seat].lastDraw = tile;
  };

  const applySelfKanLog = (seat: Seat, kanTile: TileStr | null): boolean => {
    const lastDraw = seatState[seat].lastDraw;
    const effectiveTile = kanTile ?? lastDraw;
    const useFallback = kanTile == null;
    const kakan = useFallback
      ? pickMeldWithFallback(seat, ["KAKAN"], effectiveTile ?? null, "kan")
      : pickMeld(seat, ["KAKAN"], effectiveTile ?? null, "kan");
    const ankan = kakan
      ? null
      : useFallback
        ? pickMeldWithFallback(seat, ["ANKAN"], effectiveTile ?? null, "kan")
        : pickMeld(seat, ["ANKAN"], effectiveTile ?? null, "kan");
    const meld = kakan ?? ankan;
    if (!meld) return false;
    const kind = meld.kind === "ANKAN" ? "ANKAN" : "KAKAN";
    const token = buildCallLogToken(kind, meld);
    if (token) pushDiscardValue(seat, token);
    seatState[seat].lastDraw = null;
    return true;
  };

  let lastSeat: Seat | null = null;
  actionLog.forEach((line) => {
    const actionMatch = line.match(/^([東南西北])(ツモ差替|ツモ|ステ|チー|ポン|カン):\s*(.+)$/);
    if (actionMatch) {
      const seat = seatLabelToSeat[actionMatch[1]];
      const action = actionMatch[2];
      const tileToken = actionMatch[3];
      const tile = logTokenToTile(tileToken);
      if (!seat) return;
      lastSeat = seat;
      if (action === "ツモ" || action === "ツモ差替") {
        if (!tile) return;
        pushDrawValue(seat, tile, action === "ツモ差替");
        return;
      }
      if (action === "ステ") {
        if (!tile) return;
        const code = tileToLogCode(tile);
        if (code === null) return;
        const isTsumogiri = seatState[seat].lastDraw ? tileEq(seatState[seat].lastDraw, tile) : false;
        pushDiscardValue(seat, isTsumogiri ? 60 : code);
        seatState[seat].lastDraw = null;
        return;
      }
      if (action === "チー") {
        pushCallToken(seat, "CHI", tile, "chi");
        return;
      }
      if (action === "ポン") {
        pushCallToken(seat, "PON", tile, "pon");
        return;
      }
      if (action === "カン") {
        if (!applySelfKanLog(seat, tile)) {
          pushCallToken(seat, "MINKAN", tile, "kan");
          pushDiscardValue(seat, 0);
        }
      }
      return;
    }

    const riichiMatch = line.match(/^([東南西北])リーチ$/);
    if (riichiMatch) {
      const seat = seatLabelToSeat[riichiMatch[1]];
      if (!seat) return;
      lastSeat = seat;
      const idx = seatState[seat].lastDiscardIndex;
      if (idx !== null) {
        const value = seatState[seat].discards[idx];
        seatState[seat].discards[idx] = `r${value}`;
      }
      return;
    }

    if (line.trim() === "カン" && lastSeat) {
      applySelfKanLog(lastSeat, null);
    }
  });

  const initialHandCodes = {
    E: initialHands.E.map(tileToLogCode).filter((code): code is number => typeof code === "number"),
    S: initialHands.S.map(tileToLogCode).filter((code): code is number => typeof code === "number"),
    W: initialHands.W.map(tileToLogCode).filter((code): code is number => typeof code === "number"),
    N: initialHands.N.map(tileToLogCode).filter((code): code is number => typeof code === "number")
  };

  const logEntry: unknown[] = [
    [kyokuIndex, headerMeta.honba ?? 0, headerMeta.riichiSticks ?? 0],
    scores,
    doraCodes,
    uraCodes,
    initialHandCodes.E,
    seatState.E.draws,
    seatState.E.discards,
    initialHandCodes.S,
    seatState.S.draws,
    seatState.S.discards,
    initialHandCodes.W,
    seatState.W.draws,
    seatState.W.discards,
    initialHandCodes.N,
    seatState.N.draws,
    seatState.N.discards
  ];

  if (winInfo && baseState.phase === "ENDED") {
    const startPoints = initMeta.points ?? { E: 0, S: 0, W: 0, N: 0 };
    const endPointsRaw = meta.points ?? { E: 0, S: 0, W: 0, N: 0 };
    const loserSeat = winInfo.type === "ron" ? winInfo.from ?? baseState.lastDiscard?.seat ?? null : null;
    const riichiInvalidSeat =
      loserSeat != null &&
      riichiDiscards[loserSeat] != null &&
      baseState.players[loserSeat]?.discards?.length
        ? riichiDiscards[loserSeat] === baseState.players[loserSeat].discards.length - 1
          ? loserSeat
          : null
        : null;
    const endPoints = { ...endPointsRaw };
    seatList.forEach((seat) => {
      if (riichiDiscards[seat] == null) return;
      if (riichiInvalidSeat === seat) return;
      endPoints[seat] = (endPoints[seat] ?? 0) + 1000;
    });
    const delta = seatList.map((seat) => (endPoints[seat] ?? 0) - (startPoints[seat] ?? 0));
    const dealerSeat = kyokuToSeat[kyokuIndex % 4] ?? getDealerFromKyoku(headerMeta.kyoku ?? 1);
    const winnerSeatFinal = winInfo.seat;
    const loserSeatFinal = winInfo.type === "ron" ? winInfo.from ?? baseState.lastDiscard?.seat ?? winnerSeatFinal : winnerSeatFinal;
    const winnerIndex = seatList.indexOf(winnerSeatFinal);
    const loserIndex = seatList.indexOf(loserSeatFinal);
    const paoIndex = winnerIndex;
    const scoreSummary = formatScoreSummaryForLog(winInfo.result, winInfo.type, winnerSeatFinal === dealerSeat);
    const winnerPlayer = baseState.players[winnerSeatFinal];
    const hasRiichi = winnerPlayer.riichi || hasRiichiYaku(winInfo.result?.yaku);
    const doraCounts = winInfo.doraCounts ?? computeDoraCountsForWin(meta, winnerPlayer, winInfo.tile ?? "", hasRiichi);
    const yakuEntries = buildJapaneseYakuList(
      winInfo.result?.yaku ?? [],
      winnerPlayer.closed ?? true,
      resolveSeatWind(winnerSeatFinal, dealerSeat),
      headerMeta.wind,
      doraCounts
    );
    const detail: Array<number | string> = [winnerIndex, loserIndex, paoIndex];
    if (scoreSummary) detail.push(scoreSummary);
    detail.push(...yakuEntries);
    logEntry.push(["和了", delta, detail]);
  } else if (!winInfo && baseState.phase === "ENDED") {
    const startPoints = initMeta.points ?? { E: 0, S: 0, W: 0, N: 0 };
    const endPoints = meta.points ?? { E: 0, S: 0, W: 0, N: 0 };
    const delta = seatList.map((seat) => (endPoints[seat] ?? 0) - (startPoints[seat] ?? 0));
    const hasDelta = delta.some((value) => value !== 0);
    const tenpaiList = seatList.map((seat) => (tenpaiFlags[seat] ? 1 : 0));
    const hasTenpai = tenpaiList.some((value) => value !== 0);
    logEntry.push(hasDelta || hasTenpai ? ["流局", delta, tenpaiList] : ["流局", delta]);
  }

  return {
    title: [logTitle[0] ?? "", logTitle[1] ?? ""],
    name: [seatNames.E, seatNames.S, seatNames.W, seatNames.N],
    rule,
    log: [logEntry]
  };
};
