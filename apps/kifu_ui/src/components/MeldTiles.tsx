import type { CSSProperties } from "react";
import type { MeldLike, Seat, TileStr } from "../ui/types";

export type MeldTilesProps = {
  meld: MeldLike;
  owner: Seat;
  tileToAsset: (tile: string) => string | null;
  tileBack: string;
  tilePlaceholder: string;
  meldTileWidth: number;
  meldTileHeight: number;
  calledIndexFor: (by: Seat, from: Seat | undefined, size: number) => number | null;
};

export const MeldTiles = ({
  meld,
  owner,
  tileToAsset,
  tileBack,
  tilePlaceholder,
  meldTileWidth,
  meldTileHeight,
  calledIndexFor
}: MeldTilesProps) => {
  const meldOwner = meld.by ?? owner;
  const isKakan = meld.kind === "KAKAN";
  const baseTiles = isKakan ? meld.tiles.slice(0, 3) : meld.tiles;
  const extraTile = isKakan && meld.tiles.length > 3 ? meld.tiles[meld.tiles.length - 1] : null;
  const calledIndex = calledIndexFor(meldOwner, meld.calledFrom, baseTiles.length) ?? -1;

  const renderMeldTile = (tile: TileStr, tileIdx: number) => {
    const sideways = tileIdx === calledIndex;
    const renderTileElement = (value: TileStr, keySuffix: string, rotated: boolean) => {
      const wrapStyle: CSSProperties = {
        width: rotated ? meldTileHeight : meldTileWidth,
        height: rotated ? meldTileWidth : meldTileHeight,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center"
      };
      const imgStyle: CSSProperties = {
        width: meldTileWidth,
        height: meldTileHeight,
        transform: rotated ? "rotate(90deg)" : "none"
      };
      if (value === tilePlaceholder || value === tileBack) {
        return (
          <span
            key={`meld-${owner}-${tileIdx}-${keySuffix}`}
            className={value === tileBack ? "tile-back" : "tile-placeholder"}
            style={wrapStyle}
          />
        );
      }
      const src = tileToAsset(value);
      if (src) {
        return (
          <span
            key={`meld-${owner}-${tileIdx}-${keySuffix}`}
            className="meld-tile-wrap"
            style={wrapStyle}
          >
            <img className="meld-tile-img" src={src} alt={value} style={imgStyle} />
          </span>
        );
      }
      return (
        <span
          key={`meld-${owner}-${tileIdx}-${keySuffix}`}
          className="meld-tile-wrap"
          style={wrapStyle}
        >
          {value}
        </span>
      );
    };
    if (isKakan && extraTile && tileIdx === calledIndex) {
      const stackStyle: CSSProperties = {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0,
        width: Math.max(meldTileWidth, meldTileHeight)
      };
      return (
        <span key={`meld-${owner}-${tileIdx}`} className="meld-kakan-stack" style={stackStyle}>
          {renderTileElement(extraTile, "kakan", sideways)}
          {renderTileElement(tile, "base", sideways)}
        </span>
      );
    }
    return renderTileElement(tile, "normal", sideways);
  };

  return (
    <div className="meld-row">
      {baseTiles.map((tile, tileIdx) => renderMeldTile(tile, tileIdx))}
    </div>
  );
};
