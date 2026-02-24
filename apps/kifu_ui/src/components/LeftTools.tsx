import { Fragment } from "react";

type RemainingTile = {
  tile: string;
  count: number;
};

type LeftToolsProps = {
  wallRemaining: number;
  remainingTiles: RemainingTile[];
  onRemainingTileClick: (tile: string, count: number) => void;
  showRemaining: boolean;
  getTileSrc: (tile: string) => string | null;
};

const shouldInsertBreak = (tile: string): boolean => tile === "1p" || tile === "1s" || tile === "E";

export const LeftTools = ({
  wallRemaining,
  remainingTiles,
  onRemainingTileClick,
  showRemaining,
  getTileSrc
}: LeftToolsProps) => {
  return (
    <aside className="left-tools">
      <div className="panel">
        <div className="panel-title">山 : {wallRemaining}</div>
        {showRemaining && (
          <div className="remaining-grid">
            {remainingTiles.map(({ tile, count }) => {
              const src = getTileSrc(tile);
              const empty = count <= 0;
              return (
                <Fragment key={tile}>
                  {shouldInsertBreak(tile) && <div className="remaining-break" />}
                  <button
                    type="button"
                    className={`remaining-item${empty ? " empty" : ""}`}
                    onClick={() => onRemainingTileClick(tile, count)}
                    disabled={empty}
                  >
                    {src ? (
                      <img src={src} alt={tile} className="remaining-img" />
                    ) : (
                      <span className="remaining-tile">{tile}</span>
                    )}
                    <span className="remaining-count">{count}</span>
                  </button>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
