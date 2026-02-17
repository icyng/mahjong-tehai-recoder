import type { CSSProperties, MouseEvent } from "react";
import type { Seat, SeatBlockItem, TileStr } from "../ui/types";
import { MeldTiles } from "./MeldTiles";

export type SeatBlockProps = {
  item: SeatBlockItem;
  onHandTileClick: (seat: Seat, tile: TileStr, index: number, event?: MouseEvent) => void;
  onHandTileContextMenu?: (seat: Seat, tile: TileStr, index: number, event: MouseEvent) => void;
  onImportImage?: (seat: Seat) => void;
  importDisabled?: boolean;
  onDrawTileClick?: (seat: Seat) => void;
  showDrawPlaceholder?: boolean;
  tileToAsset: (tile: string) => string | null;
  tileBack: string;
  tilePlaceholder: string;
  tileWidth: number;
  tileHeight: number;
  meldTileWidth: number;
  meldTileHeight: number;
  calledIndexFor: (by: Seat, from: Seat | undefined, size: number) => number | null;
};

export const SeatBlock = ({
  item,
  onHandTileClick,
  onHandTileContextMenu,
  onImportImage,
  importDisabled,
  onDrawTileClick,
  showDrawPlaceholder,
  tileToAsset,
  tileBack,
  tilePlaceholder,
  tileWidth,
  tileHeight,
  meldTileWidth,
  meldTileHeight,
  calledIndexFor
}: SeatBlockProps) => {
  const renderTileImage = (
    tile: string,
    idx: number,
    onClick?: (event: MouseEvent) => void,
    onContextMenu?: (event: MouseEvent) => void,
    size: { w: number; h: number } = { w: tileWidth, h: tileHeight }
  ) => {
    if (!tile) return null;
    if (tile === tilePlaceholder || tile === tileBack) {
      return (
        <span
          key={`${tile}-${idx}`}
          className={`${tile === tileBack ? "tile-back" : "tile-placeholder"}${onClick ? " tile-clickable" : ""}`}
          style={{ width: size.w, height: size.h }}
          onClick={onClick}
          onContextMenu={onContextMenu}
        />
      );
    }
    const src = tileToAsset(tile);
    const style: CSSProperties = {
      width: `${size.w}px`,
      height: `${size.h}px`,
      cursor: onClick ? "pointer" : "default"
    };
    if (src) {
      return (
        <img
          key={`${tile}-${idx}`}
          src={src}
          alt={tile}
          style={style}
          onClick={onClick}
          onContextMenu={onContextMenu}
        />
      );
    }
    return (
      <span
        key={`${tile}-${idx}`}
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={onClick ? "tile-clickable" : ""}
      >
        {tile}
      </span>
    );
  };

  const renderHandRow = () => {
    const tiles = item.player.hand ?? [];
    const hasAny = tiles.some((tile) => tile);
    if (!hasAny && !item.player.drawnTile) return <span>なし</span>;
    return (
      <span>
        {tiles.map((tile, idx) =>
          tile
            ? renderTileImage(
                tile,
                idx,
                item.clickable ? (event) => onHandTileClick(item.seat, tile, idx, event) : undefined,
                onHandTileContextMenu
                  ? (event) => onHandTileContextMenu(item.seat, tile, idx, event)
                  : undefined
              )
            : null
        )}
        {item.player.drawnTile ? (
          <span className="drawn-tile">
            {renderTileImage(
              item.player.drawnTile,
              tiles.length,
              item.clickable
                ? (event) => onHandTileClick(item.seat, item.player.drawnTile ?? "", tiles.length, event)
                : undefined,
              onHandTileContextMenu
                ? (event) => onHandTileContextMenu(item.seat, item.player.drawnTile ?? "", tiles.length, event)
                : undefined
            )}
          </span>
        ) : showDrawPlaceholder ? (
          <span className="drawn-tile">
            {renderTileImage(
              tilePlaceholder,
              tiles.length,
              onDrawTileClick ? () => onDrawTileClick(item.seat) : undefined
            )}
          </span>
        ) : null}
      </span>
    );
  };

  const renderMelds = () => {
    if (!item.player.melds.length) {
      return <div className="meld-empty"></div>;
    }
    return (
      <>
        {[...item.player.melds].reverse().map((meld, idx) => (
          <MeldTiles
            key={`meld-${item.seat}-${idx}`}
            meld={meld}
            owner={item.seat}
            tileToAsset={tileToAsset}
            tileBack={tileBack}
            tilePlaceholder={tilePlaceholder}
            meldTileWidth={meldTileWidth}
            meldTileHeight={meldTileHeight}
            calledIndexFor={calledIndexFor}
          />
        ))}
      </>
    );
  };

  const renderDiscardRow = () => {
    const tiles = item.player.discards ?? [];
    if (!tiles.length) return <span className="discard-empty">河</span>;
    const riichiIndex = item.riichiIndex;
    const renderDiscardTile = (tile: TileStr, idx: number) => {
      const sideways = riichiIndex !== null && riichiIndex === idx;
      const wrapStyle: CSSProperties = {
        width: sideways ? meldTileHeight : meldTileWidth,
        height: sideways ? meldTileWidth : meldTileHeight,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center"
      };
      const imgStyle: CSSProperties = {
        width: meldTileWidth,
        height: meldTileHeight,
        transform: sideways ? "rotate(90deg)" : "none"
      };
      if (tile === tilePlaceholder || tile === tileBack) {
        return (
          <span
            key={`discard-${item.seat}-${idx}`}
            className={tile === tileBack ? "tile-back" : "tile-placeholder"}
            style={wrapStyle}
          />
        );
      }
      const src = tileToAsset(tile);
      if (src) {
        return (
          <span key={`discard-${item.seat}-${idx}`} className="discard-tile-wrap" style={wrapStyle}>
            <img className="discard-tile-img" src={src} alt={tile} style={imgStyle} />
          </span>
        );
      }
      return (
        <span key={`discard-${item.seat}-${idx}`} className="discard-tile-wrap" style={wrapStyle}>
          {tile}
        </span>
      );
    };
    return <span className="discard-row">{tiles.map((tile, idx) => renderDiscardTile(tile, idx))}</span>;
  };

  const hasHeaderActions = Boolean(onImportImage) || item.actions.length > 0;

  return (
    <div className={`seat-block${item.isTurn ? " is-turn" : ""}${item.isEditable ? " is-editable" : ""}`}>
      <div className="seat-title-row">
        <div>
          <span>{item.seatLabel}</span>
        </div>
        {hasHeaderActions && (
          <div className="seat-title-actions">
            {onImportImage && (
              <button
                className="action-button import-button"
                type="button"
                onClick={() => onImportImage(item.seat)}
                disabled={importDisabled}
              >
                画像読込
              </button>
            )}
            {item.actions.map((action) => (
              <button
                key={`${item.seat}-${action.key}`}
                className="action-button"
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="hand-row">
        <div className="hand-tiles">{renderHandRow()}</div>
        <div className="melds-inline">{renderMelds()}</div>
      </div>
      <div className="discard-block">{renderDiscardRow()}</div>
    </div>
  );
};
