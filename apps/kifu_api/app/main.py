from __future__ import annotations

from pathlib import Path
import json
from typing import Dict, List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError

from mahjong.constants import EAST, SOUTH, WEST, NORTH
from mj.calcHand import analyze_hand as calc_analyze_hand
from mj.machi import machi_hai_13
from mj.utils import ALL_TILES
from mj.toMelds import convert_to_melds

HONOR_MAP = {
    "E": "to",
    "S": "na",
    "W": "sh",
    "N": "pe",
    "P": "hk",
    "F": "ht",
    "C": "ty",
}
HONOR_MAP_REVERSE = {v: k for k, v in HONOR_MAP.items()}

WIND_MAP = {
    "E": EAST,
    "S": SOUTH,
    "W": WEST,
    "N": NORTH,
}


class Tile(BaseModel):
    suit: str
    value: int
    red: Optional[bool] = False


class Step(BaseModel):
    index: int
    actor: str
    action: str
    tile: Optional[str] = None
    hands: Dict[str, List[str]]
    points: Dict[str, int]
    doraIndicators: List[str]
    note: Optional[str] = None


class Round(BaseModel):
    roundIndex: int
    wind: str
    kyoku: int
    honba: int
    riichiSticks: int
    dealer: str
    steps: List[Step]
    errors: List[dict]
    choices: List[dict]


class Kifu(BaseModel):
    gameId: str
    rounds: List[Round]


app = FastAPI(title="Kifu API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _sample_path() -> Path:
    return _repo_root() / "shared" / "sample_kifu.json"


def _load_sample() -> dict:
    path = _sample_path()
    if not path.exists():
        return {"gameId": "sample", "rounds": []}
    text = path.read_text(encoding="utf-8")
    return json.loads(text)


def _validate_kifu(data: dict) -> tuple[bool, list[str]]:
    try:
        # Pydantic v1
        Kifu.parse_obj(data)
        return True, []
    except ValidationError as exc:
        return False, [e.get("msg", "invalid") for e in exc.errors()]


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/kifu/sample")
def get_sample() -> dict:
    return _load_sample()


@app.post("/kifu/validate")
def validate_kifu(payload: dict) -> dict:
    ok, errors = _validate_kifu(payload)
    return {"ok": ok, "errors": errors}


@app.post("/analysis/hand")
def analyze_hand_api(payload: dict) -> dict:
    def normalize_tile(tile: str | None) -> str:
        if not tile:
            return ""
        return HONOR_MAP.get(tile, tile)

    def normalize_tiles(tiles: list[str]) -> list[str]:
        return [normalize_tile(t) for t in tiles if t]

    def has_aka(tiles: list[str]) -> bool:
        return any(t.startswith("0") for t in tiles if t)

    def dora_from_indicator(tile: str) -> str:
        if not tile:
            return ""
        t = normalize_tile(tile)
        if len(t) == 2 and t[1] in ("m", "p", "s"):
            n = 5 if t[0] == "0" else int(t[0])
            nxt = 1 if n == 9 else n + 1
            return f"{nxt}{t[1]}"
        honor_cycle = ["to", "na", "sh", "pe", "to"]
        dragon_cycle = ["hk", "ht", "ty", "hk"]
        if t in honor_cycle:
            return honor_cycle[honor_cycle.index(t) + 1]
        if t in dragon_cycle:
            return dragon_cycle[dragon_cycle.index(t) + 1]
        return t

    try:
        hand_tiles = normalize_tiles(payload.get("hand", []))
        win_tile = normalize_tile(payload.get("winTile"))
        melds_payload = payload.get("melds", [])
        meld_tile_count = sum(len(m.get("tiles", [])) for m in melds_payload if isinstance(m, dict))
        total_tiles = len(hand_tiles) + meld_tile_count + (1 if win_tile else 0)
        if win_tile and total_tiles > 14:
            # remove one instance of win tile if it's already inside the hand
            for i, t in enumerate(hand_tiles):
                if t == win_tile:
                    hand_tiles.pop(i)
                    break
        all_tiles = [*hand_tiles, *([win_tile] if win_tile else [])]
        actions = []
        for meld in melds_payload:
            kind = meld.get("kind", "").lower()
            if kind not in ("chi", "pon", "kan"):
                continue
            tiles = [normalize_tile(t) for t in meld.get("tiles", []) if t]
            called_tile = normalize_tile(meld.get("calledTile"))
            called_from = meld.get("calledFrom")
            target_tiles = []
            used_called = False
            for t in tiles:
                from_other = False
                if called_from and called_tile and t == called_tile and not used_called:
                    from_other = True
                    used_called = True
                target_tiles.append({"tile": t, "fromOther": from_other})
            if called_from and not used_called and target_tiles:
                target_tiles[0]["fromOther"] = True
            actions.append({"target_tiles": target_tiles, "action_type": kind})
            all_tiles.extend([t for t in tiles if t])

        # validate tiles before scoring to avoid server error
        def _base_key(tile: str) -> str:
            if not tile:
                return ""
            if len(tile) == 2 and tile[0] == "0" and tile[1] in ("m", "p", "s"):
                return f"5{tile[1]}"
            return tile

        for t in all_tiles:
            if t not in ALL_TILES:
                return {"ok": False, "error": f"invalid tile: {t}"}
        counts: dict[str, int] = {}
        red_counts: dict[str, int] = {}
        for t in all_tiles:
            base = _base_key(t)
            counts[base] = counts.get(base, 0) + 1
            if t in ("0m", "0p", "0s"):
                red_counts[t] = red_counts.get(t, 0) + 1
        for base, cnt in counts.items():
            if cnt > 4:
                return {"ok": False, "error": f"tile overflow: {base} x{cnt}"}
        for red, cnt in red_counts.items():
            if cnt > 1:
                return {"ok": False, "error": f"red overflow: {red} x{cnt}"}

        melds = convert_to_melds(actions) if actions else []
        dora_indicators = normalize_tiles(payload.get("doraIndicators", []))
        dora_tiles = [dora_from_indicator(t) for t in dora_indicators if t]
        seat_wind = payload.get("seatWind", "E")
        round_wind = payload.get("roundWind", "E")
        win_type = payload.get("winType", "ron")

        _, _, result = calc_analyze_hand(
            tiles=hand_tiles,
            win=win_tile,
            melds=melds,
            doras=dora_tiles,
            has_aka=has_aka(all_tiles),
            is_tsumo=win_type == "tsumo",
            is_riichi=payload.get("riichi", False),
            is_ippatsu=payload.get("ippatsu", False),
            player_wind=WIND_MAP.get(seat_wind, EAST),
            round_wind=WIND_MAP.get(round_wind, EAST),
            kyoutaku_number=payload.get("riichiSticks", 0),
            tsumi_number=payload.get("honba", 0),
        )

        yaku_list = []
        if getattr(result, "yaku", None):
            for y in result.yaku:
                name = getattr(y, "name", None)
                yaku_list.append(name if name is not None else str(y))
        return {
            "ok": True,
            "result": {
                "han": getattr(result, "han", 0),
                "fu": getattr(result, "fu", 0),
                "cost": getattr(result, "cost", None),
                "yaku": yaku_list,
            },
        }
    except Exception as exc:  # pragma: no cover - guard for unexpected input
        return {"ok": False, "error": str(exc)}


@app.post("/analysis/tenpai")
def analyze_tenpai(payload: dict) -> dict:
    def normalize_tile(tile: str | None) -> str:
        if not tile:
            return ""
        return HONOR_MAP.get(tile, tile)

    def normalize_tiles(tiles: list[str]) -> list[str]:
        return [normalize_tile(t) for t in tiles if t]

    def denormalize_tile(tile: str) -> str:
        if not tile:
            return ""
        return HONOR_MAP_REVERSE.get(tile, tile)

    def normalize_for_tenpai(tile: str) -> str:
        if not tile:
            return tile
        if len(tile) == 2 and tile[0] == "0" and tile[1] in ("m", "p", "s"):
            return f"5{tile[1]}"
        return tile

    try:
        hand_tiles = [normalize_for_tenpai(t) for t in normalize_tiles(payload.get("hand", []))]
        melds_payload = payload.get("melds", [])
        actions = []
        for meld in melds_payload:
            kind = meld.get("kind", "").lower()
            if kind not in ("chi", "pon", "kan"):
                continue
            tiles = [normalize_for_tenpai(normalize_tile(t)) for t in meld.get("tiles", []) if t]
            called_tile = normalize_for_tenpai(normalize_tile(meld.get("calledTile")))
            called_from = meld.get("calledFrom")
            target_tiles = []
            used_called = False
            for t in tiles:
                from_other = False
                if called_from and called_tile and t == called_tile and not used_called:
                    from_other = True
                    used_called = True
                target_tiles.append({"tile": t, "fromOther": from_other})
            if called_from and not used_called and target_tiles:
                target_tiles[0]["fromOther"] = True
            actions.append({"target_tiles": target_tiles, "action_type": kind})

        melds = convert_to_melds(actions) if actions else []
        combined_tiles = [*hand_tiles]
        for act in actions:
            for info in act.get("target_tiles", []):
                tile = info.get("tile")
                if tile:
                    combined_tiles.append(tile)
        if len(combined_tiles) > 13:
            combined_tiles = combined_tiles[:13]

        result = machi_hai_13(combined_tiles)
        if isinstance(result, str):
            if result == "agari":
                return {"ok": True, "status": "agari", "shanten": -1, "waits": []}
            if "shanten" in result:
                try:
                    value = int(result.split()[0])
                    return {"ok": True, "status": "shanten", "shanten": value, "waits": []}
                except ValueError:
                    return {"ok": True, "status": result, "waits": []}
            return {"ok": True, "status": result, "waits": []}
        waits = [denormalize_tile(tile) for tile in result]
        return {"ok": True, "status": "tenpai", "shanten": 0, "waits": waits}
    except Exception as exc:  # pragma: no cover - guard for unexpected input
        return {"ok": False, "error": str(exc)}
