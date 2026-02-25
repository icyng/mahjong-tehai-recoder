import { fireEvent, render, screen } from "@testing-library/react";
import { RightPanel } from "../components/RightPanel";
import type { ActionLogEntry } from "../ui/types";

const noop = () => undefined;

const baseActionLog: ActionLogEntry[] = [
  { kind: "ui", text: "東ツモ: 1m" },
  { kind: "ui", text: "東画像: 解析送信中..." },
  { kind: "error", text: "牌枚数の不整合があります" },
  { kind: "system", text: "画面共有開始" }
];

const createProps = () => ({
  showButtons: true,
  initialLocked: false,
  onScreenCaptureToggle: noop,
  screenCaptureDisabled: false,
  screenCaptureActive: false,
  onLogClear: noop,
  onClearHands: noop,
  onLogExport: noop,
  onOpenRuleSettings: noop,
  onRyukyoku: noop,
  ryukyokuDisabled: false,
  onUndo: noop,
  undoDisabled: false,
  onPickDora: noop,
  doraDisplayTiles: [],
  doraRevealedCount: 1,
  getTileSrc: () => null,
  logTitle: ["", ""] as [string, string],
  onUpdateLogTitle: noop as (index: 0 | 1, value: string) => void,
  settingsDraft: {
    wind: "E" as const,
    kyoku: 1,
    honba: 0,
    riichiSticks: 0,
    doraIndicators: "",
    uraDoraIndicators: ""
  },
  onUpdateSettingsDraft: noop,
  tenpaiChecking: false,
  tenpaiError: null,
  actionLog: baseActionLog
});

describe("RightPanel", () => {
  test("メインログ表示は対局進行ログ(UI)のみを表示する", () => {
    render(<RightPanel {...createProps()} />);
    expect(screen.getByText("東ツモ: 1m")).toBeInTheDocument();
    expect(screen.queryByText("東画像: 解析送信中...")).not.toBeInTheDocument();
    expect(screen.queryByText("牌枚数の不整合があります")).not.toBeInTheDocument();
  });

  test("ログ詳細モーダルで種別フィルタできる", () => {
    render(<RightPanel {...createProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "ログ詳細" }));
    expect(screen.getByText("ログ詳細")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "[ERROR]" }));
    expect(screen.getByText("牌枚数の不整合があります")).toBeInTheDocument();
    expect(screen.queryByText("東ツモ: 1m")).not.toBeInTheDocument();
  });

  test("画面共有の状態に応じてボタン文言が変わる", () => {
    render(<RightPanel {...createProps()} screenCaptureActive />);
    expect(screen.getByRole("button", { name: "共有終了" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "手牌読込" })).not.toBeInTheDocument();
  });
});
