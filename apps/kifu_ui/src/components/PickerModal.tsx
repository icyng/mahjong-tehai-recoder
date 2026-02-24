type PickerKind = "hand" | "dora" | "ura" | "rinshan" | "draw";

type PickerModalProps = {
  open: boolean;
  kind: PickerKind;
  compact?: boolean;
  tileChoices: string[];
  anchorPosition?: "above" | "below" | null;
  isTileAvailable: (tile: string) => boolean;
  remainingCount: (tile: string) => number;
  tileToAsset: (tile: string) => string | null;
  onSelect: (tile: string | null) => void;
  onClose: () => void;
};

export const PickerModal = ({
  open,
  kind,
  compact = false,
  tileChoices,
  anchorPosition,
  isTileAvailable,
  remainingCount,
  tileToAsset,
  onSelect,
  onClose
}: PickerModalProps) => {
  if (!open) return null;
  const tiles = kind === "dora" || kind === "ura" ? [...tileChoices, "BACK"] : tileChoices;
  const anchorClass =
    anchorPosition === "above"
      ? "picker-backdrop picker-backdrop--above"
      : anchorPosition === "below"
      ? "picker-backdrop picker-backdrop--below"
      : "picker-backdrop";
  const showDoraGuide = kind === "dora";

  return (
    <div className={anchorClass} onClick={onClose} role="presentation">
      <div
        className={compact ? "picker-modal picker-modal--compact" : "picker-modal"}
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="picker-title">
          牌選択
          {showDoraGuide ? <span>（表示牌を選択してください）</span> : null}
        </div>
        <div className="picker-grid">
          {tiles.map((tile) => {
            const src = tile === "BACK" ? null : tileToAsset(tile);
            const disabled = tile === "BACK" ? false : !isTileAvailable(tile);
            const remaining = tile === "BACK" ? 0 : remainingCount(tile);
            return (
              <button
                key={tile}
                className={`picker-tile ${tile === "BACK" ? "back" : ""}`}
                style={src ? { backgroundImage: `url(${src})` } : undefined}
                onClick={() => onSelect(tile === "BACK" ? "BACK" : tile)}
                disabled={disabled}
                type="button"
              >
                {tile !== "BACK" && <span className="picker-count">{remaining}</span>}
              </button>
            );
          })}
        </div>
        <div className="picker-actions">
          <button className="picker-clear" onClick={() => onSelect(null)} type="button">
            空白に戻す
          </button>
          <button className="picker-close" onClick={onClose} type="button">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
