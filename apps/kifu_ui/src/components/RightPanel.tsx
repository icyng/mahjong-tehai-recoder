import { useMemo, useState } from "react";
import type { ActionLogEntry, Seat, TileStr } from "../ui/types";
import { roundIndexFromMeta, roundMetaFromIndex, WIND_LABELS, WIND_ORDER } from "../lib/round";

type SettingsDraft = {
  wind: Seat;
  kyoku: number;
  honba: number;
  riichiSticks: number;
  doraIndicators: string;
  uraDoraIndicators: string;
};

type RightPanelProps = {
  showButtons: boolean;
  initialLocked: boolean;
  onScreenCaptureToggle: () => void;
  screenCaptureDisabled: boolean;
  screenCaptureActive: boolean;
  onLogClear: () => void;
  onClearHands: () => void;
  onLogExport: () => void;
  onOpenRuleSettings: () => void;
  onRyukyoku: () => void;
  ryukyokuDisabled: boolean;
  onUndo: () => void;
  undoDisabled: boolean;
  onPickDora: (index: number) => void;
  doraDisplayTiles: TileStr[];
  doraRevealedCount: number;
  getTileSrc: (tile: string) => string | null;
  logTitle: [string, string];
  onUpdateLogTitle: (index: 0 | 1, value: string) => void;
  settingsDraft: SettingsDraft | null;
  onUpdateSettingsDraft: (updates: Partial<SettingsDraft>) => void;
  tenpaiChecking: boolean;
  tenpaiError: string | null;
  actionLog: ActionLogEntry[];
};

// actionLog にはシステム/エラーも混ざるため、表示は対局進行ログのみ残す
const VISIBLE_ACTION_LOG_PATTERNS: RegExp[] = [
  /^[東南西北](ツモ差替|ツモ|ステ|チー|ポン|カン):\s*/,
  /^[東南西北](ロン|ツモ)$/,
  /^[東南西北]リーチ(?:宣言:.*|取消)?$/,
  /^門前ツモ$/,
  /^流局$/,
  /^カン$/,
  /^点数:\s*/,
  /^\d+翻\s+\d+符/
];

const isVisibleActionLogLine = (line: string): boolean =>
  VISIBLE_ACTION_LOG_PATTERNS.some((pattern) => pattern.test(line.trim()));

const LOG_KIND_LABEL: Record<ActionLogEntry["kind"], string> = {
  ui: "[UI]",
  error: "[ERROR]",
  system: "[SYSTEM]"
};

type LogDetailFilter = "all" | ActionLogEntry["kind"];

export const RightPanel = ({
  showButtons,
  initialLocked,
  onScreenCaptureToggle,
  screenCaptureDisabled,
  screenCaptureActive,
  onLogClear,
  onClearHands,
  onLogExport,
  onOpenRuleSettings,
  onRyukyoku,
  ryukyokuDisabled,
  onUndo,
  undoDisabled,
  onPickDora,
  doraDisplayTiles,
  doraRevealedCount,
  getTileSrc,
  logTitle,
  onUpdateLogTitle,
  settingsDraft,
  onUpdateSettingsDraft,
  tenpaiChecking,
  tenpaiError,
  actionLog
}: RightPanelProps) => {
  const [logDetailOpen, setLogDetailOpen] = useState(false);
  const [logDetailFilter, setLogDetailFilter] = useState<LogDetailFilter>("all");
  const visibleActionLog = useMemo(
    () =>
      actionLog
        .filter((entry) => entry.kind === "ui" && isVisibleActionLogLine(entry.text))
        .map((entry) => entry.text),
    [actionLog]
  );
  const filteredDetailLog = useMemo(
    () =>
      logDetailFilter === "all"
        ? actionLog
        : actionLog.filter((entry) => entry.kind === logDetailFilter),
    [actionLog, logDetailFilter]
  );

  const roundOptions = useMemo(
    () =>
      WIND_ORDER.flatMap((wind) =>
        [1, 2, 3, 4].map((kyoku) => ({
          value: roundIndexFromMeta(wind, kyoku),
          label: `${WIND_LABELS[wind]}${kyoku}局`
        }))
      ),
    []
  );

  const roundValue = settingsDraft ? String(roundIndexFromMeta(settingsDraft.wind, settingsDraft.kyoku)) : "0";

  const handleRoundChange = (value: string) => {
    const parsed = Number(value);
    const next = roundMetaFromIndex(Number.isFinite(parsed) ? parsed : 0);
    onUpdateSettingsDraft(next);
  };

  const handleNumberChange = (field: "honba" | "riichiSticks", value: string) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    onUpdateSettingsDraft({ [field]: safe });
  };

  return (
    <aside className="right-tools">
      <div className="panel">
        {showButtons && (
          <div className="button-grid">
            <button type="button" onClick={onScreenCaptureToggle} disabled={screenCaptureDisabled}>
              {screenCaptureActive ? "共有終了" : "手牌読込"}
            </button>
            <button type="button" onClick={onUndo} disabled={undoDisabled}>
              元に戻す
            </button>
            <button type="button" onClick={onRyukyoku} disabled={ryukyokuDisabled}>
              流局
            </button>
            <button type="button" onClick={onLogExport}>
              ログ出力
            </button>
            <button type="button" onClick={onLogClear}>
              ログクリア
            </button>
            <button type="button" onClick={onClearHands} disabled={initialLocked}>
              配牌クリア
            </button>
            <button type="button" onClick={onOpenRuleSettings}>
              ルール
            </button>
            <button
              type="button"
              onClick={() => {
                setLogDetailOpen(true);
              }}
            >
              ログ詳細
            </button>
          </div>
        )}

        <div className="info compact">
          <div className="settings-wrap">
            <div className="log-title-grid">
              <label className="log-title-row">
                <span className="log-title-label">タイトル1 :</span>
                <input
                  className="log-title-input"
                  value={logTitle[0] ?? ""}
                  onChange={(event) => onUpdateLogTitle(0, event.target.value)}
                  placeholder="例: Mリーグ"
                />
              </label>
              <label className="log-title-row">
                <span className="log-title-label">タイトル2 :</span>
                <input
                  className="log-title-input"
                  value={logTitle[1] ?? ""}
                  onChange={(event) => onUpdateLogTitle(1, event.target.value)}
                  placeholder="例: 2026/02/19 第1試合"
                />
              </label>
            </div>

            <div className="settings-grid settings-grid-compact">
              <label className="settings-field">
                <span>局</span>
                <select
                  className="settings-select"
                  value={roundValue}
                  onChange={(event) => handleRoundChange(event.target.value)}
                  disabled={!settingsDraft}
                >
                  {roundOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span>本場</span>
                <input
                  className="settings-input"
                  type="number"
                  min={0}
                  value={settingsDraft?.honba ?? 0}
                  onChange={(event) => handleNumberChange("honba", event.target.value)}
                  disabled={!settingsDraft}
                />
              </label>
              <label className="settings-field">
                <span>供託</span>
                <input
                  className="settings-input"
                  type="number"
                  min={0}
                  value={settingsDraft?.riichiSticks ?? 0}
                  onChange={(event) => handleNumberChange("riichiSticks", event.target.value)}
                  disabled={!settingsDraft}
                />
              </label>
            </div>
          </div>

          <div className="dora-display">
            <div className="dora-tiles">
              {Array.from({ length: 5 }, (_, idx) => {
                const indicator = doraDisplayTiles[idx] ?? "";
                const revealed = idx < doraRevealedCount && Boolean(indicator);
                const src = revealed ? getTileSrc(indicator) : null;
                return (
                  <button
                    key={`panel-dora-${idx}`}
                    type="button"
                    onClick={() => onPickDora(idx)}
                    className={`picker-tile dora-tile ${src ? "" : "dora-tile-back"}`}
                    style={src ? { backgroundImage: `url(${src})` } : undefined}
                  />
                );
              })}
            </div>
          </div>

          {tenpaiChecking && <div>聴牌判定中...</div>}
          {tenpaiError && <div>{tenpaiError}</div>}

          <div className="action-log">
            {visibleActionLog.length === 0 ? (
              <div>ログなし</div>
            ) : (
              visibleActionLog.map((line, idx) => <div key={`log-${idx}`}>{line}</div>)
            )}
          </div>
        </div>
      </div>

      {logDetailOpen && (
        <div className="log-detail-backdrop" onClick={() => setLogDetailOpen(false)} role="presentation">
          <div className="log-detail-modal" onClick={(event) => event.stopPropagation()} role="presentation">
            <div className="log-detail-title">ログ詳細</div>
            <div className="log-detail-toolbar">
              {(["all", "ui", "error", "system"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`log-detail-filter log-detail-filter-${kind} ${logDetailFilter === kind ? "active" : ""}`}
                  onClick={() => setLogDetailFilter(kind)}
                >
                  {kind === "all" ? "すべて" : LOG_KIND_LABEL[kind]}
                </button>
              ))}
            </div>
            <div className="log-detail-list">
              {filteredDetailLog.length === 0 ? (
                <div>ログなし</div>
              ) : (
                filteredDetailLog.map((line, idx) => (
                  <div key={`log-detail-${idx}`} className="log-detail-line">
                    <span className={`log-detail-kind log-detail-kind-${line.kind}`}>
                      {LOG_KIND_LABEL[line.kind]}
                    </span>
                    <span className="log-detail-text">{line.text}</span>
                  </div>
                ))
              )}
            </div>
            <div className="log-detail-actions">
              <button type="button" className="picker-close" onClick={() => setLogDetailOpen(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
