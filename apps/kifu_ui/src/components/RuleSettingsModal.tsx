type RuleSettingsModalProps = {
  open: boolean;
  ruleDisplay: string;
  kiriageEnabled: boolean;
  akaEnabled: boolean;
  onChangeRuleDisplay: (value: string) => void;
  onChangeKiriage: (enabled: boolean) => void;
  onChangeAkaEnabled: (enabled: boolean) => void;
  onClose: () => void;
};

export const RuleSettingsModal = ({
  open,
  ruleDisplay,
  kiriageEnabled,
  akaEnabled,
  onChangeRuleDisplay,
  onChangeKiriage,
  onChangeAkaEnabled,
  onClose
}: RuleSettingsModalProps) => {
  if (!open) return null;
  return (
    <div className="rule-settings-backdrop" onClick={onClose} role="presentation">
      <div className="rule-settings-modal" onClick={(e) => e.stopPropagation()} role="presentation">
        <div className="win-options-title">ルール設定</div>
        <label className="log-title-row">
          <span className="log-title-label">ルール :</span>
          <input
            type="text"
            value={ruleDisplay}
            onChange={(e) => onChangeRuleDisplay(e.target.value)}
            className="log-title-input"
            placeholder="例: 般南喰赤"
          />
        </label>
        <label className="win-option">
          <input type="checkbox" checked={kiriageEnabled} onChange={(e) => onChangeKiriage(e.target.checked)} />
          <span>切り上げ満貫</span>
        </label>
        <label className="win-option">
          <input type="checkbox" checked={akaEnabled} onChange={(e) => onChangeAkaEnabled(e.target.checked)} />
          <span>赤あり</span>
        </label>
        <div className="win-options-actions">
          <button className="picker-close" type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
