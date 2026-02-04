from pathlib import Path
import base64
import contextlib
import io
import tempfile

import streamlit as st
from PIL import Image

from mahjong.constants import EAST, NORTH, SOUTH, WEST
from mj.models.tehai.myyolo import MYYOLO
from mj.machi import machi_hai_13
from mj.calcHand import analyze_hand
from mj.utils import print_hand_result

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_WEIGHTS = (
    REPO_ROOT / "mj" / "models" / "tehai" / "weights" / "best.pt"
    if (REPO_ROOT / "mj/models/tehai/weights/best.pt").exists()
    else Path("best.pt")
)

CANDIDATES = [
    REPO_ROOT / "apps" / "assets" / "tiles",
    REPO_ROOT / "assets" / "tiles",
]
TILES_DIR = next((p for p in CANDIDATES if p.exists()), CANDIDATES[0])
CONF_WARN_THRESHOLD = 0.90


def _img_b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def _resolve_weights(weight_choice: str, weights_local_file) -> str:
    if weight_choice == "local":
        if weights_local_file is None:
            st.error("ローカルの重み .pt を選択してください。")
            st.stop()
        with tempfile.NamedTemporaryFile(suffix=".pt", delete=False) as wtmp:
            wtmp.write(weights_local_file.read())
            return wtmp.name
    return str(DEFAULT_WEIGHTS)


def _run_pipeline(img_path: str, weights: str):
    tile_infos, tile_names = MYYOLO(model_path=weights, image_path=img_path)
    shape = machi_hai_13(tile_names)
    return tile_infos, tile_names, shape


def _render_tile_row(tile_names, tile_infos=None, height_px: int = 35, limit: int | None = None):
    st.markdown(
        f"""
        <style>
        .tile-row {{ display:flex; flex-wrap:nowrap; overflow-x:auto; gap:0.2rem; padding:0.3rem 0; }}
        .tile     {{ display:flex; flex-direction:column; align-items:center; }}
        .tile img {{ height:{height_px}px; width:auto; display:block; }}
        .tile-warn{{ font-size:0.75rem; opacity:0.85; margin-top:0.1rem; }}
        </style>
        """,
        unsafe_allow_html=True,
    )

    names = tile_names[:limit] if limit else tile_names
    row_html = ['<div class="tile-row">']
    for i, name in enumerate(names):
        p = TILES_DIR / f"{name}.png"
        if p.exists():
            b64 = _img_b64(p)
            row_html.append(
                f'<div class="tile"><img src="data:image/png;base64,{b64}" alt="{name}" title="{name}"/>'
            )
        else:
            row_html.append(
                f'<div class="tile" style="height:{height_px}px;justify-content:center;"><div>{name}</div>'
            )
        conf_val = 1.0
        if tile_infos and i < len(tile_infos):
            try:
                conf_val = float(tile_infos[i].get("conf", 1.0))
            except Exception:
                conf_val = 1.0
        if conf_val < CONF_WARN_THRESHOLD:
            row_html.append('<div class="tile-warn">⚠️</div>')
        row_html.append("</div>")
    row_html.append("</div>")
    st.markdown("".join(row_html), unsafe_allow_html=True)


def _wind_label(wind: int) -> str:
    return {EAST: "東", SOUTH: "南", WEST: "西", NORTH: "北"}[wind]


def render():
    st.set_page_config(layout="wide", page_title="Mahjong Analyzer (IMG)")

    left, right = st.columns([7, 8], gap="large")

    with left:
        ucol, wcol = st.columns([1, 1])
        with ucol:
            uploaded = st.file_uploader("解析対象画像（.png / .jpg）", type=["png", "jpg"], label_visibility="visible")
        with wcol:
            weight_choice = st.radio("重み（YOLOvXXm）", ["default", "local"], index=0, horizontal=True)
            weights_local_file = None
            if weight_choice == "local":
                weights_local_file = st.file_uploader("重み（.pt）", type=["pt"], label_visibility="collapsed")

        with st.expander("詳細設定", expanded=False):
            c1, c2, c3 = st.columns([1, 1, 2])
            with c1:
                player_wind = st.selectbox("自風", [EAST, SOUTH, WEST, NORTH], index=0, format_func=_wind_label)
            with c2:
                round_wind = st.selectbox("場風", [EAST, SOUTH, WEST, NORTH], index=0, format_func=_wind_label)
            with c3:
                doras_text = st.text_input("ドラ・裏ドラ（例: to,8m）", value="")

            b1, b2, b3, b4 = st.columns(4)
            with b1:
                is_tsumo = st.checkbox("ツモ", value=True)
            with b2:
                has_aka = st.checkbox("赤", value=True)
            with b3:
                is_riichi = st.checkbox("立直", value=False)
            with b4:
                is_ippatsu = st.checkbox("一発", value=False)

            r1, r2, r3, r4 = st.columns(4)
            with r1:
                is_rinshan = st.checkbox("嶺上開花", value=False)
            with r2:
                is_chankan = st.checkbox("搶槓", value=False)
            with r3:
                is_hotei = st.checkbox("河底撈魚", value=False)
            with r4:
                is_haitei = st.checkbox("海底摸月", value=False)

            r5, r6, r7, r8 = st.columns(4)
            with r5:
                is_wriichi = st.checkbox("W立直", value=False)
            with r6:
                is_tenho = st.checkbox("天和", value=False)
            with r7:
                is_renho = st.checkbox("人和", value=False)
            with r8:
                is_chiho = st.checkbox("地和", value=False)

            r9, r10 = st.columns(2)
            with r9:
                kyoutaku = st.number_input("供託", min_value=0, step=1, value=0)
            with r10:
                honba = st.number_input("積み", min_value=0, step=1, value=0)

        if not TILES_DIR.exists():
            st.warning(f"タイル画像フォルダが見つかりません: {TILES_DIR.resolve()}")

    with right:
        run = st.button("▶ 解析する", type="primary", use_container_width=True, disabled=(uploaded is None), key="run_btn")

        if uploaded is None:
            st.info("左カラムで画像を選択してください。")
            return

        _l, img_col, _r = st.columns([1, 4, 1])
        with img_col:
            img = Image.open(uploaded).convert("RGB")
            st.image(img, caption="", use_container_width=True)

        if not run:
            return

        weights_to_use = _resolve_weights(weight_choice, weights_local_file)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            img.save(tmp.name)
            tmp_path = tmp.name

        with st.spinner("解析中…"):
            tile_infos, tile_names, shape = _run_pipeline(tmp_path, weights_to_use)

        col_det, col_wait = st.columns([8, 3], gap="large")
        with col_det:
            st.subheader("検出結果")
            if not tile_names:
                st.warning("牌が検出できませんでした。重みや画像を確認してください。")
            else:
                _render_tile_row(tile_names, tile_infos, height_px=35, limit=14)

        with col_wait:
            st.subheader("待ち")
            waits = []
            if isinstance(shape, (list, tuple, set)):
                waits = [str(x).strip() for x in shape if str(x).strip()]
            if waits:
                _render_tile_row(waits, None, height_px=35)
            else:
                st.write(shape if isinstance(shape, str) else f"待ち：{shape}")

        if isinstance(shape, (list, tuple, set)) and len(shape) > 0:
            st.subheader("待ち牌ごとのアガリ結果")
            for name in waits:
                try:
                    h2, a2, cfg2 = analyze_hand(
                        tiles=tile_names,
                        win=name,
                        has_aka=has_aka,
                        melds=[],
                        doras=[s.strip() for s in doras_text.split(",") if s.strip()],
                        is_riichi=is_riichi,
                        is_ippatsu=is_ippatsu,
                        is_tsumo=is_tsumo,
                        player_wind=player_wind,
                        round_wind=round_wind,
                        is_rinshan=is_rinshan,
                        is_chankan=is_chankan,
                        is_hotei=is_hotei,
                        is_haitei=is_haitei,
                        is_wriichi=is_wriichi,
                        is_tenho=is_tenho,
                        is_renho=is_renho,
                        is_chiho=is_chiho,
                        kyoutaku=kyoutaku,
                        honba=honba
                    )
                    buf = io.StringIO()
                    with contextlib.redirect_stdout(buf):
                        print_hand_result(h2, a2, cfg2, is_tsumo=is_tsumo)
                    st.expander(f"{name} のアガリ結果", expanded=False).code(buf.getvalue(), language="text")
                except Exception as e:
                    st.warning(f"{name} の結果計算でエラー: {e}")


if __name__ == "__main__":
    render()
