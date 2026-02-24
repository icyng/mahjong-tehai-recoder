import { MeldTiles } from "./MeldTiles";
import type { Seat, TileStr } from "../ui/types";

type CallPickerOption = {
  type: "CHI" | "PON" | "KAN";
  by: Seat;
  from: Seat;
  tile: TileStr;
  meldTiles: TileStr[];
  label: string;
};

type CallPickerModalProps = {
  open: boolean;
  options: CallPickerOption[];
  onSelect: (index: number) => void;
  onClose: () => void;
  tileToAsset: (tile: string) => string | null;
  tileBack: TileStr;
  tilePlaceholder: TileStr;
  meldTileWidth: number;
  meldTileHeight: number;
  calledIndexFor: (by: Seat, from: Seat | undefined, size: number) => number | null;
};

export const CallPickerModal = ({
  open,
  options,
  onSelect,
  onClose,
  tileToAsset,
  tileBack,
  tilePlaceholder,
  meldTileWidth,
  meldTileHeight,
  calledIndexFor
}: CallPickerModalProps) => {
  if (!open) return null;
  return (
    <div className="call-picker-backdrop" onClick={onClose} role="presentation">
      <div className="call-picker-modal" onClick={(e) => e.stopPropagation()} role="presentation">
        <div className="call-picker-title">鳴き候補</div>
        <div className="call-picker-options">
          {options.map((option, idx) => (
            <button key={`call-option-${idx}`} className="call-picker-option" type="button" onClick={() => onSelect(idx)}>
              <div className="call-picker-label">{option.label}</div>
              <div className="call-picker-tiles">
                <MeldTiles
                  meld={{
                    kind: option.type,
                    tiles: option.meldTiles,
                    by: option.by,
                    calledFrom: option.from,
                    calledTile: option.tile
                  }}
                  owner={option.by}
                  tileToAsset={tileToAsset}
                  tileBack={tileBack}
                  tilePlaceholder={tilePlaceholder}
                  meldTileWidth={meldTileWidth}
                  meldTileHeight={meldTileHeight}
                  calledIndexFor={calledIndexFor}
                />
              </div>
            </button>
          ))}
        </div>
        <div className="call-picker-actions">
          <button className="picker-close" type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
