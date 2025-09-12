from pathlib import Path
import tempfile, io, contextlib
import base64

import streamlit as st
from PIL import Image

from mahjong.constants import EAST, SOUTH, WEST, NORTH
from mj.models.tehai.myyolo import MYYOLO
from mj.machi import machi_hai_13
from mj.calcHand import analyze_hand
from mj.utils import print_hand_result

# ========== 設定 ==========
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

# ========== 推論 ==========
def _run_pipeline(img_path: str, weights: str):
    tile_infos, tile_names = MYYOLO(model_path=weights, image_path=img_path)
    shape = machi_hai_13(tile_names)
    return tile_infos, tile_names, shape

# ========== UI ==========
def render():

    st.set_page_config(layout="wide")

    left, right = st.columns([7,8], gap="large")

    with left:
        # 画像アップロード と 重み選択 を横並び
        ucol, wcol = st.columns([1, 1])
        with ucol:
            uploaded = st.file_uploader("解析対象画像（.png / .jpg）", type=["png", "jpg"], label_visibility="visible")
        with wcol:
            weight_choice = st.radio("重み（YOLOvXXm）", ["default", "local"], index=0, horizontal=True)
            weights_local_file = None
            if weight_choice == "local":
                weights_local_file = st.file_uploader("重み（.pt）", type=["pt"], label_visibility="collapsed")

        # すべて詳細設定内に格納（基本/役/供託など）
        with st.expander("詳細設定", expanded=False):
            # 1行目：自風・場風・ドラ（3カラム）
            c1, c2, c3 = st.columns([1, 1, 2])
            with c1:
                player_wind = st.selectbox(
                    "自風", [EAST, SOUTH, WEST, NORTH], index=0,
                    format_func=lambda w: {EAST:"東",SOUTH:"南",WEST:"西",NORTH:"北"}[w]
                )
            with c2:
                round_wind = st.selectbox(
                    "場風", [EAST, SOUTH, WEST, NORTH], index=0,
                    format_func=lambda w: {EAST:"東",SOUTH:"南",WEST:"西",NORTH:"北"}[w]
                )
            with c3:
                doras_text = st.text_input("ドラ・裏ドラ（例: to,8m）", value="")

            # 2行目：基本フラグ（4カラム）
            b1, b2, b3, b4 = st.columns(4)
            with b1:
                is_tsumo = st.checkbox("ツモ", value=True)
            with b2:
                has_aka = st.checkbox("赤", value=True)
            with b3:
                is_riichi = st.checkbox("立直", value=False)
            with b4:
                is_ippatsu = st.checkbox("一発", value=False)

            # 3行目：役フラグ（4カラム）
            r1, r2, r3, r4 = st.columns(4)
            with r1:
                is_rinshan = st.checkbox("嶺上開花", value=False)
            with r2:
                is_chankan = st.checkbox("搶槓", value=False)
            with r3:
                is_hotei = st.checkbox("河底撈魚", value=False)
            with r4:
                is_haitei = st.checkbox("海底摸月", value=False)

            # 4行目：役フラグ（4カラム）
            r5, r6, r7, r8 = st.columns(4)
            with r5:
                is_wriichi = st.checkbox("W立直", value=False)
            with r6:
                is_tenho = st.checkbox("天和", value=False)
            with r7:
                is_renho = st.checkbox("人和", value=False)
            with r8:
                is_chiho = st.checkbox("地和", value=False)

            # 5行目：供託・積み（4カラム中2つ使用）
            r9, r10 = st.columns(2) 
            with r9: 
                kyoutaku = st.number_input("供託", min_value=0, step=1, value=0) 
            with r10: 
                honba = st.number_input("積み", min_value=0, step=1, value=0)

        if not TILES_DIR.exists():
            st.warning(f"タイル画像フォルダが見つかりません: {TILES_DIR.resolve()}")

    with right:
        # 解析ボタンは右カラムの最上部
        run = st.button("▶ 解析する", type="primary", use_container_width=True,disabled=(uploaded is None), key="run_btn")

        if uploaded is None:
            st.info("左カラムで画像を選択してください。")
        else:
            # ===== プレビュー画像を中央寄せ（1:2:1 の3カラムで中央に表示） =====
            _l, img_col, _r = st.columns([1, 4, 1])
            with img_col:
                img = Image.open(uploaded).convert("RGB")
                st.image(img, caption="", use_container_width=True)

            if run:
                # 重みの実パスを決定
                weights_to_use = str(DEFAULT_WEIGHTS)
                if weight_choice == "local":
                    if weights_local_file is None:
                        st.error("ローカルの重み .pt を選択してください。")
                        st.stop()
                    with tempfile.NamedTemporaryFile(suffix=".pt", delete=False) as wtmp:
                        wtmp.write(weights_local_file.read())
                        weights_to_use = wtmp.name

                with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                    img.save(tmp.name)
                    tmp_path = tmp.name

                with st.spinner("解析中…"):
                    tile_infos, tile_names, shape = _run_pipeline(tmp_path, weights_to_use)

                # 共通CSS（牌比率維持）
                st.markdown(
                    """
                    <style>
                    .tile-row { display:flex; flex-wrap:nowrap; overflow-x:auto; gap:0.2rem; padding:0.3rem 0; }
                    .tile     { display:flex; flex-direction:column; align-items:center; }
                    .tile img { height:35px; width:auto; display:block; }  /* 比率維持 */
                    .tile-warn{ font-size:0.75rem; opacity:0.85; margin-top:0.1rem; }
                    </style>
                    """,
                    unsafe_allow_html=True,
                )

                # ===== 検出結果 と 待ち牌 を横並び（このブロックだけ2カラム） =====
                col_det, col_wait = st.columns([8,3], gap="large")

                # 左：検出結果
                with col_det:
                    st.subheader("検出結果")
                    if not tile_names:
                        st.warning("牌が検出できませんでした。重みや画像を確認してください。")
                    else:
                        row_html = ['<div class="tile-row">']
                        for i, name in enumerate(tile_names[:14]):
                            p = TILES_DIR / f"{name}.png"
                            if p.exists():
                                b64 = base64.b64encode(p.read_bytes()).decode("ascii")
                                row_html.append(f'<div class="tile"><img src="data:image/png;base64,{b64}" alt="{name}" title="{name}"/>')
                            else:
                                row_html.append(f'<div class="tile" style="height:35px;justify-content:center;"><div>{name}</div>')
                            try:
                                conf_val = float(tile_infos[i].get("conf", 0.0)) if i < len(tile_infos) else 0.0
                            except Exception:
                                conf_val = 0.0
                            if conf_val < CONF_WARN_THRESHOLD:
                                row_html.append('<div class="tile-warn">⚠️</div>')
                            row_html.append('</div>')
                        row_html.append('</div>')
                        st.markdown("".join(row_html), unsafe_allow_html=True)

                # 右：待ち牌（13枚時）
                with col_wait:
                    st.subheader("待ち")
                    waits = []
                    if isinstance(shape, (list, tuple, set)):
                        waits = [str(x).strip() for x in shape if str(x).strip()]
                    if waits:
                        row2 = ['<div class="tile-row">']
                        for name in waits:
                            ip = TILES_DIR / f"{name}.png"
                            if ip.exists():
                                row2.append(
                                    f'<div class="tile"><img src="data:image/png;base64,{base64.b64encode(ip.read_bytes()).decode("ascii")}" alt="{name}" title="{name}"/></div>'
                                )
                            else:
                                row2.append(f'<div class="tile" style="height:35px;justify-content:center;"><div>{name}</div></div>')
                        row2.append('</div>')
                        st.markdown("".join(row2), unsafe_allow_html=True)
                    else:
                        st.write(shape if isinstance(shape, str) else f"待ち：{shape}")

                # ===== ここから列の外（全幅）でアガリ結果を表示 =====
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
                            )
                            buf = io.StringIO()
                            with contextlib.redirect_stdout(buf):
                                print_hand_result(h2, a2, cfg2, is_tsumo=is_tsumo)
                            st.expander(f"{name} のアガリ結果", expanded=False).code(buf.getvalue(), language="text")
                        except Exception as e:
                            st.warning(f"{name} の結果計算でエラー: {e}")

if __name__ == "__main__":
    st.set_page_config(layout="wide", page_title="Mahjong Analyzer (IMG)")
    render()