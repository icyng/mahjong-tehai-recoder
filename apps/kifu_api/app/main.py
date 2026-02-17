from __future__ import annotations

import io
from pathlib import Path
import json
from time import perf_counter
from typing import Dict, List, Optional

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError
import tempfile
from PIL import Image

from mahjong.constants import EAST, SOUTH, WEST, NORTH
from mahjong_runtime.calcHand import analyze_hand as calc_analyze_hand
from mahjong_runtime.machi import machi_hai_13
from mahjong_runtime.utils import ALL_TILES
from mahjong_runtime.toMelds import convert_to_melds

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

CAPTURE_DUMMY_TILES = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "E", "E", "S", "P"]


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


def _resolve_weights_path() -> Path:
    repo_root = _repo_root()
    candidates = [
        repo_root / "mahjong_runtime" / "weights" / "best.pt",
        # backward-compat for older layout
        repo_root / "mj" / "weights" / "best.pt",
        # backward-compat for older layout
        repo_root / "mj" / "models" / "tehai" / "weights" / "best.pt",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return Path("best.pt")


def _normalize_detected_tile(name: str) -> str:
    if not name:
        return ""
    text = str(name).strip()
    if " " in text:
        text = text.split()[-1]
    if "-" in text and len(text) > 2:
        text = text.split("-")[-1].strip()
    return HONOR_MAP_REVERSE.get(text, text)


def _safe_float(value) -> float | None:
    try:
        return float(value)
    except Exception:
        return None


def _run_tile_inference(image_path: str):
    from mahjong_runtime.myyolo import MYYOLO

    weights_path = _resolve_weights_path()
    if not weights_path.exists():
        return None, None, f"weights not found: {weights_path}"
    tile_infos, tile_names = MYYOLO(model_path=str(weights_path), image_path=image_path)
    return tile_infos, tile_names, None


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

    debug_lines: list[str] = []

    def debug_enabled() -> bool:
        return bool(payload.get("debug"))

    def debug_log(message: str) -> None:
        if debug_enabled():
            debug_lines.append(f"[analyze_hand] {message}")

    try:
        hand_tiles = normalize_tiles(payload.get("hand", []))
        win_tile = normalize_tile(payload.get("winTile"))
        melds_payload = payload.get("melds", [])
        all_tiles = [*hand_tiles, *([win_tile] if win_tile else [])]
        actions = []
        for meld in melds_payload:
            kind = meld.get("kind", "").lower()
            if kind in ("minkan", "ankan", "kakan", "shouminkan"):
                kind = "kan"
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
        debug_log(f"hand={hand_tiles} win={win_tile} melds={len(melds_payload)}")
        debug_log(f"actions={actions}")

        # validate tiles before scoring to avoid server error
        def _base_key(tile: str) -> str:
            if not tile:
                return ""
            if len(tile) == 2 and tile[0] == "0" and tile[1] in ("m", "p", "s"):
                return f"5{tile[1]}"
            return tile

        for t in all_tiles:
            if t not in ALL_TILES:
                return {"ok": False, "error": f"invalid tile: {t}", "debug": debug_lines if debug_enabled() else None}
        counts: dict[str, int] = {}
        red_counts: dict[str, int] = {}
        for t in all_tiles:
            base = _base_key(t)
            counts[base] = counts.get(base, 0) + 1
            if t in ("0m", "0p", "0s"):
                red_counts[t] = red_counts.get(t, 0) + 1
        for base, cnt in counts.items():
            if cnt > 4:
                return {
                    "ok": False,
                    "error": f"tile overflow: {base} x{cnt}",
                    "debug": debug_lines if debug_enabled() else None
                }
        for red, cnt in red_counts.items():
            if cnt > 1:
                return {
                    "ok": False,
                    "error": f"red overflow: {red} x{cnt}",
                    "debug": debug_lines if debug_enabled() else None
                }

        melds = convert_to_melds(actions) if actions else []
        is_riichi = bool(
            payload.get("riichi", False)
            or payload.get("is_riichi", False)
            or payload.get("is_daburu_riichi", False)
            or payload.get("is_open_riichi", False)
        )
        is_ippatsu = bool(payload.get("ippatsu", False) or payload.get("is_ippatsu", False))
        dora_indicators = normalize_tiles(payload.get("doraIndicators", []))
        ura_indicators = normalize_tiles(payload.get("uraDoraIndicators", []))
        if is_riichi:
            dora_indicators = [*dora_indicators, *ura_indicators]
        dora_tiles = [dora_from_indicator(t) for t in dora_indicators if t]
        seat_wind = payload.get("seatWind", "E")
        round_wind = payload.get("roundWind", "E")
        win_type = payload.get("winType", "ron")

        meld_tiles_for_calc: list[str] = []
        kan_count = 0
        for act in actions:
            target_tiles = act.get("target_tiles", [])
            if act.get("action_type") == "kan" and len(target_tiles) >= 4:
                kan_count += 1
            for info in target_tiles:
                tile = info.get("tile")
                if tile:
                    meld_tiles_for_calc.append(tile)
        hand_tiles_for_calc = hand_tiles
        tiles_for_calc = [*hand_tiles_for_calc, *meld_tiles_for_calc]
        expected_total = 14 + kan_count
        if win_tile and len(tiles_for_calc) < expected_total:
            tiles_for_calc.append(win_tile)
        debug_log(
            f"meld_tiles={len(meld_tiles_for_calc)} hand_tiles_for_calc={len(hand_tiles_for_calc)} "
            f"tiles_for_calc={len(tiles_for_calc)} expected_total={expected_total} has_aka={has_aka(all_tiles)}"
        )
        debug_log(f"hand_for_calc={hand_tiles_for_calc}")

        is_rinshan = bool(payload.get("is_rinshan", False))
        is_chankan = bool(payload.get("is_chankan", False))
        is_haitei = bool(payload.get("is_haitei", False))
        is_houtei = bool(payload.get("is_houtei", False))
        is_daburu_riichi = bool(payload.get("is_daburu_riichi", False))
        is_nagashi_mangan = bool(payload.get("is_nagashi_mangan", False))
        is_tenhou = bool(payload.get("is_tenhou", False))
        is_renhou = bool(payload.get("is_renhou", False))
        is_chiihou = bool(payload.get("is_chiihou", False))
        is_open_riichi = bool(payload.get("is_open_riichi", False))
        try:
            paarenchan = int(payload.get("paarenchan", 0) or 0)
        except (TypeError, ValueError):
            paarenchan = 0
        _, _, result = calc_analyze_hand(
            tiles=tiles_for_calc,
            win=win_tile,
            melds=melds,
            doras=dora_tiles,
            has_aka=has_aka(all_tiles),
            is_tsumo=win_type == "tsumo",
            is_riichi=is_riichi,
            is_ippatsu=is_ippatsu,
            is_rinshan=is_rinshan,
            is_chankan=is_chankan,
            is_haitei=is_haitei,
            is_houtei=is_houtei,
            is_daburu_riichi=is_daburu_riichi,
            is_nagashi_mangan=is_nagashi_mangan,
            is_tenhou=is_tenhou,
            is_renhou=is_renhou,
            is_chiihou=is_chiihou,
            is_open_riichi=is_open_riichi,
            paarenchan=paarenchan,
            player_wind=WIND_MAP.get(seat_wind, EAST),
            round_wind=WIND_MAP.get(round_wind, EAST),
            kyoutaku_number=payload.get("riichiSticks", 0),
            tsumi_number=payload.get("honba", 0),
        )

        if getattr(result, "error", None):
            return {
                "ok": False,
                "error": getattr(result, "error", ""),
                "debug": debug_lines if debug_enabled() else None
            }
        yaku_list = []
        if getattr(result, "yaku", None):
            for y in result.yaku:
                name = getattr(y, "name", None)
                if name is None:
                    yaku_list.append(str(y))
                    continue
                if "Dora" in name:
                    han_open = getattr(y, "han_open", None)
                    han_closed = getattr(y, "han_closed", None)
                    count = han_open if isinstance(han_open, int) else None
                    if isinstance(han_closed, int):
                        count = han_closed
                    if isinstance(count, int) and count > 1:
                        yaku_list.extend([name] * count)
                        continue
                yaku_list.append(name)
        return {
            "ok": True,
            "result": {
                "han": getattr(result, "han", 0),
                "fu": getattr(result, "fu", 0),
                "cost": getattr(result, "cost", None),
                "yaku": yaku_list,
            },
            "debug": debug_lines if debug_enabled() else None
        }
    except Exception as exc:  # pragma: no cover - guard for unexpected input
        return {"ok": False, "error": str(exc), "debug": debug_lines if debug_enabled() else None}


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
        if len(hand_tiles) > 13:
            hand_tiles = hand_tiles[:13]

        result = machi_hai_13(hand_tiles)
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


@app.post("/analysis/tiles-from-image")
async def tiles_from_image(image: UploadFile = File(...)) -> dict:
    tmp_path = ""
    try:
        if not image.filename:
            return {"ok": False, "error": "no image uploaded"}
        suffix = Path(image.filename).suffix or ".png"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(await image.read())
            tmp_path = tmp.name
        tile_infos, tile_names, error = _run_tile_inference(tmp_path)
        if error:
            return {"ok": False, "error": error}
        normalized = [_normalize_detected_tile(name) for name in tile_names if name]
        normalized = [t for t in normalized if t]
        safe_infos = []
        for info in tile_infos:
            safe_infos.append(
                {
                    "class": info.get("class"),
                    "conf": _safe_float(info.get("conf")),
                    "point": _safe_float(info.get("point")),
                }
            )
        return {"ok": True, "tiles": normalized, "raw": tile_names, "infos": safe_infos}
    except Exception as exc:  # pragma: no cover
        return {"ok": False, "error": str(exc)}
    finally:
        if tmp_path:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass


@app.post("/api/capture")
async def capture(image_file: UploadFile = File(..., alias="file")) -> dict:
    started = perf_counter()
    tmp_path = ""
    try:
        payload = await image_file.read()
        if not payload:
            return {"ok": False, "error": "no image uploaded"}

        with Image.open(io.BytesIO(payload)) as src_img:
            width, height = src_img.size
            rgb = src_img.convert("RGB")
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                rgb.save(tmp, format="JPEG", quality=90)
                tmp_path = tmp.name

        tile_infos, tile_names, error = _run_tile_inference(tmp_path)
        if error:
            return {
                "ok": True,
                "inference_seconds": round(perf_counter() - started, 3),
                "hand": {"tiles": CAPTURE_DUMMY_TILES},
                "debug": {
                    "image_size": {"width": width, "height": height},
                    "fallback": error,
                },
            }

        normalized = [_normalize_detected_tile(name) for name in tile_names if name]
        hand_tiles = [tile for tile in normalized if tile][:14]
        return {
            "ok": True,
            "inference_seconds": round(perf_counter() - started, 3),
            "hand": {"tiles": hand_tiles},
            "debug": {
                "image_size": {"width": width, "height": height},
                "raw_tiles": tile_names,
                "detections": len(tile_infos or []),
            },
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        if tmp_path:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass
