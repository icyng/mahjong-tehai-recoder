import type { Seat, SeatAction } from "../ui/types";

export type SeatCallOption = {
  type: "RON_WIN" | "CHI" | "PON" | "KAN";
  by: Seat;
};

type BuildSeatActionsParams = {
  seat: Seat;
  hasGameState: boolean;
  pendingRinshan: boolean;
  afterDrawOnTurn: boolean;
  awaitingCall: boolean;
  riichiAllowed: boolean;
  pendingRiichi: boolean;
  canTsumoNow: boolean;
  canSelfKan: boolean;
  seatCalls: SeatCallOption[];
  captureActive: boolean;
  captureAnalyzing: boolean;
  captureStarting: boolean;
  onCapture: (seat: Seat) => void;
  onCaptureStop: () => void;
  onRiichi: () => void;
  onRiichiCancel: () => void;
  onTsumo: () => void;
  onSelfKan: () => void;
  onOpenRon: (index: number) => void;
  onOpenClaim: (index: number) => void;
  onCallCancel: () => void;
};

const claimLabelMap: Record<"CHI" | "PON" | "KAN", string> = {
  CHI: "チー",
  PON: "ポン",
  KAN: "カン"
};

export const buildSeatActionList = ({
  seat,
  hasGameState,
  pendingRinshan,
  afterDrawOnTurn,
  awaitingCall,
  riichiAllowed,
  pendingRiichi,
  canTsumoNow,
  canSelfKan,
  seatCalls,
  captureActive,
  captureAnalyzing,
  captureStarting,
  onCapture,
  onCaptureStop,
  onRiichi,
  onRiichiCancel,
  onTsumo,
  onSelfKan,
  onOpenRon,
  onOpenClaim,
  onCallCancel
}: BuildSeatActionsParams): SeatAction[] => {
  const actions: SeatAction[] = [];

  if (captureActive) {
    actions.push({
      key: "capture-run",
      label: captureAnalyzing ? "解析中..." : "キャプチャ",
      onClick: () => onCapture(seat),
      disabled: captureAnalyzing || captureStarting
    });
    actions.push({
      key: "capture-stop",
      label: "共有終了",
      onClick: onCaptureStop,
      disabled: captureAnalyzing
    });
  }

  if (!hasGameState) return actions;
  if (pendingRinshan) return actions;

  if (afterDrawOnTurn) {
    if (riichiAllowed) {
      actions.push({ key: "riichi", label: "リーチ", onClick: onRiichi, disabled: pendingRiichi });
    }
    if (pendingRiichi) {
      actions.push({ key: "riichi-cancel", label: "キャンセル", onClick: onRiichiCancel });
    }
    if (canTsumoNow) {
      actions.push({ key: "tsumo", label: "ツモ", onClick: onTsumo });
    }
    if (canSelfKan) {
      actions.push({ key: "self-kan", label: "カン", onClick: onSelfKan });
    }
  }

  if (awaitingCall) {
    seatCalls.forEach((call, idx) => {
      if (call.type === "RON_WIN") {
        actions.push({ key: `ron-${idx}`, label: "ロン", onClick: () => onOpenRon(idx) });
        return;
      }
      actions.push({ key: `${call.type}-${idx}`, label: claimLabelMap[call.type], onClick: () => onOpenClaim(idx) });
    });
    if (seatCalls.length > 0) {
      actions.push({ key: "call-cancel", label: "キャンセル", onClick: onCallCancel });
    }
  }

  return actions;
};
