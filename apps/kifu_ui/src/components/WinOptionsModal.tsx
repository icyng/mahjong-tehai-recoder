import type { TileStr } from "../ui/types";
import type { WinOptionFlags } from "../lib/score_payload";

type WinOptionKey = keyof Omit<WinOptionFlags, "doraCount" | "uraCount" | "akaCount">;

const WIN_OPTION_FIELDS: { key: WinOptionKey; label: string }[] = [
  { key: "is_ippatsu", label: "一発" },
  { key: "is_rinshan", label: "嶺上開花" },
  { key: "is_chankan", label: "槍槓" },
  { key: "is_haitei", label: "ハイテイ" },
  { key: "is_houtei", label: "ホウテイ" },
  { key: "is_daburu_riichi", label: "ダブル立直" },
  { key: "is_nagashi_mangan", label: "流し満貫" },
  { key: "is_tenhou", label: "天和" },
  { key: "is_renhou", label: "人和" },
  { key: "is_chiihou", label: "地和" },
  { key: "is_open_riichi", label: "オープン立直" },
  { key: "paarenchan", label: "八連荘" }
];

type WinOptionsModalProps = {
  open: boolean;
  winType: "ron" | "tsumo" | null;
  options: WinOptionFlags;
  doraDisplayTiles: TileStr[];
  showUraIndicators: boolean;
  uraDisplayTiles: TileStr[];
  doraRevealedCount: number;
  getTileSrc: (tile: string) => string | null;
  onPickDora: (index: number) => void;
  onPickUra: (index: number) => void;
  onChange: (next: WinOptionFlags) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export const WinOptionsModal = ({
  open,
  winType,
  options,
  doraDisplayTiles,
  showUraIndicators,
  uraDisplayTiles,
  doraRevealedCount,
  getTileSrc,
  onPickDora,
  onPickUra,
  onChange,
  onConfirm,
  onCancel
}: WinOptionsModalProps) => {
  if (!open) return null;
  return (
    <div className="win-options-backdrop" onClick={onCancel} role="presentation">
      <div className="win-options-modal" onClick={(e) => e.stopPropagation()} role="presentation">
        <div className="win-options-title">
          {winType === "ron" ? "ロン" : winType === "tsumo" ? "ツモ" : "和了"}: 追加
        </div>
        <div className="win-options-grid">
          {WIN_OPTION_FIELDS.map((field) => (
            <label key={field.key} className="win-option">
              <input
                type="checkbox"
                checked={options[field.key]}
                onChange={(e) => onChange({ ...options, [field.key]: e.target.checked })}
              />
              <span>{field.label}</span>
            </label>
          ))}
        </div>
        <div className="win-options-ura">
          <div className="win-options-title">ドラ</div>
          <div className="dora-tiles">
            {Array.from({ length: 5 }, (_, idx) => {
              const displayTile = doraDisplayTiles[idx] ?? "";
              const revealed = idx < doraRevealedCount && displayTile;
              const src = revealed ? getTileSrc(displayTile) : null;
              return (
                <button
                  key={`win-dora-${idx}`}
                  type="button"
                  onClick={() => onPickDora(idx)}
                  className={`picker-tile dora-tile ${src ? "" : "dora-tile-back"}`}
                  style={src ? { backgroundImage: `url(${src})` } : undefined}
                >
                  {!src && ""}
                </button>
              );
            })}
          </div>
        </div>
        {showUraIndicators && (
          <div className="win-options-ura">
            <div className="win-options-title">裏ドラ</div>
            <div className="dora-tiles dora-tiles-ura">
              {Array.from({ length: 5 }, (_, idx) => {
                const displayTile = uraDisplayTiles[idx] ?? "";
                const revealed = idx < doraRevealedCount && displayTile;
                const src = revealed ? getTileSrc(displayTile) : null;
                return (
                  <button
                    key={`win-ura-${idx}`}
                    type="button"
                    onClick={() => onPickUra(idx)}
                    className={`picker-tile dora-tile ${src ? "" : "dora-tile-back"}`}
                    style={src ? { backgroundImage: `url(${src})` } : undefined}
                  >
                    {!src && ""}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="win-options-actions">
          <button className="picker-close" type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button className="picker-clear" type="button" onClick={onConfirm}>
            決定
          </button>
        </div>
      </div>
    </div>
  );
};
