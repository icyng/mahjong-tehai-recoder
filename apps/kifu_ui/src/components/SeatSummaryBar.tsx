import type { SeatSummaryItem, TileStr } from "../ui/types";

export type SeatSummaryBarProps = {
  items: SeatSummaryItem[];
  tileToAsset: (tile: string) => string | null;
  remainingCountForDisplay: (tile: TileStr) => number;
};

export const SeatSummaryBar = ({ items, tileToAsset, remainingCountForDisplay }: SeatSummaryBarProps) => (
  <div className="seat-summary-bar">
    <div className="seat-summary-row">
      {items.map((item) => (
        <div key={`seat-summary-${item.seat}`} className="seat-summary">
          <div className="seat-summary-body">
            <div className="seat-summary-avatar-col">
              <div className="seat-summary-avatar-box">
                <div className="seat-summary-avatar">
                  <svg className="avatar-icon" viewBox="0 0 64 64" role="img" aria-label="player">
                    <circle cx="32" cy="22" r="12" />
                    <path d="M12 54c0-10 9-18 20-18s20 8 20 18v4H12z" />
                  </svg>
                </div>
                {item.statusLabel && (
                  <div className={`seat-summary-status ${item.statusClass}`}>{item.statusLabel}</div>
                )}
              </div>
            </div>
            <div className="seat-summary-info">
              <div className="seat-summary-name-row">
                <span className="seat-summary-wind-label">{item.windLabel} :</span>
                <input
                  className="seat-summary-name-input"
                  value={item.name}
                  onChange={(e) => item.onNameChange(e.target.value)}
                />
              </div>
              <div className="seat-summary-points-row">
                <input
                  className="seat-summary-points-input"
                  type="number"
                  value={item.points}
                  onChange={(e) => item.onPointsChange(Number(e.target.value))}
                />
                <span className="points-unit">点</span>
              </div>
              {item.waits.length ? (
                <div className="seat-summary-waits">
                  <span className="waits-tiles">
                    {item.waits.map((tile, idx) => {
                      const src = tileToAsset(tile);
                      const count = remainingCountForDisplay(tile);
                      return (
                        <span key={`wait-${item.seat}-${idx}`} className="waits-tile">
                          {src ? (
                            <img className="waits-tile-img" src={src} alt={tile} />
                          ) : (
                            <span className="waits-tile-placeholder" />
                          )}
                          <span className="waits-count">{count}</span>
                        </span>
                      );
                    })}
                  </span>
                </div>
              ) : (
                <div className="seat-summary-waits empty" />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);
