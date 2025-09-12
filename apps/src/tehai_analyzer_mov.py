from __future__ import annotations
from pathlib import Path
import tempfile, time, threading, queue, io, contextlib, base64
from typing import Sequence

import cv2
import numpy as np
import streamlit as st
from PIL import Image

from mahjong.constants import EAST, SOUTH, WEST, NORTH
from mj.models.tehai.myyolo import MYYOLO
from mj.machi import machi_hai_13
from mj.calcHand import analyze_hand
from mj.utils import print_hand_result

# ===================== 共通設定 =====================
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
CONF_WARN_THRESHOLD = 0.8

# ===================== ユーティリティ =====================
def _img_b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")

@st.cache_resource(show_spinner=False)
def _warmup_model(weights_path: str):
    # 軽いダミー画像で YOLO を一度起動して初期化コストを前倒し
    tmp = np.zeros((64, 64, 3), dtype=np.uint8)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as t:
        Image.fromarray(tmp).save(t.name)
        _ = MYYOLO(model_path=weights_path, image_path=t.name)

# 画像→推論（フレームはRGB想定）
def _detect_from_ndarray(frame_rgb: np.ndarray, weights_path: str):
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        Image.fromarray(frame_rgb).save(tmp.name)
        img_path = tmp.name
    tile_infos, tile_names = MYYOLO(model_path=weights_path, image_path=img_path)
    shape = machi_hai_13(tile_names)
    return tile_infos, tile_names, shape

# タイル列描画（比率維持・横スクロール）
def _draw_tile_row(tile_names: Sequence[str], tile_infos: Sequence[dict] | None = None, height_px: int = 40, target_container=None):
    css = f"""
    <style>
    .tile-row {{ display:flex; flex-wrap:nowrap; overflow-x:auto; gap:0.2rem; padding:0.3rem 0; }}
    .tile     {{ display:flex; flex-direction:column; align-items:center; }}
    .tile img {{ height:{height_px}px; width:auto; display:block; }}
    .tile-warn{{ font-size:0.75rem; opacity:0.85; margin-top:0.1rem; }}
    </style>
    """
    row_html = ['<div class="tile-row">']
    for i, name in enumerate(tile_names):
        p = TILES_DIR / f"{name}.png"
        if p.exists():
            b64 = _img_b64(p)
            row_html.append(f'<div class="tile"><img src="data:image/png;base64,{b64}" alt="{name}" title="{name}"/>')
        else:
            row_html.append(f'<div class="tile" style="height:{height_px}px;justify-content:center;"><div>{name}</div>')
        conf_val = 1.0
        if tile_infos and i < len(tile_infos):
            try:
                conf_val = float(tile_infos[i].get("conf", 1.0))
            except Exception:
                conf_val = 1.0
        if conf_val < CONF_WARN_THRESHOLD:
            row_html.append('<div class="tile-warn">⚠️</div>')
        row_html.append('</div>')
    row_html.append('</div>')

    html = css + "".join(row_html)
    (target_container or st).markdown(html, unsafe_allow_html=True)

# ===================== 非同期ワーカー =====================
class FrameGrabber:
    """動画→最新フレーム(RGB)を常に1枚だけキューに保持するスレッド。
    Streamlit API には触らない。メインスレッドが参照できるように last_frame を保持。
    """
    def __init__(self, path: str, target_width: int, out_queue: queue.Queue):
        self.path = path
        self.target_width = target_width
        self.q = out_queue
        self.cap = None
        self.stop_evt = threading.Event()
        self.ready = threading.Event()
        self.opened = False
        self.last_frame = None  # ★ 追加：直近フレームを保持（表示用）

    def start(self):
        self.t = threading.Thread(target=self._run, daemon=True)
        self.t.start()
        return self

    def _open_capture(self):
        # FFMPEG 優先→フォールバック
        cap = cv2.VideoCapture(self.path, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            cap = cv2.VideoCapture(self.path)
        return cap

    def _run(self):
        self.cap = self._open_capture()
        if not self.cap or not self.cap.isOpened():
            self.opened = False
            self.ready.set()
            return
        self.opened = True
        self.ready.set()

        while not self.stop_evt.is_set():
            ok, frame_bgr = self.cap.read()
            if not ok:
                break
            h, w = frame_bgr.shape[:2]
            scale = self.target_width / max(1, w)
            if scale != 1.0:
                frame_bgr = cv2.resize(frame_bgr, (int(w*scale), int(h*scale)), interpolation=cv2.INTER_AREA)
            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

            # 直近フレームを保持（メインスレッドが参照）
            self.last_frame = frame_rgb

            # 最新のみ（古いものを捨てる）
            try:
                while True:
                    self.q.get_nowait()
            except queue.Empty:
                pass
            try:
                self.q.put_nowait(frame_rgb)
            except queue.Full:
                pass

        if self.cap is not None:
            try:
                self.cap.release()
            except Exception:
                pass
            self.cap = None

    def stop(self):
        self.stop_evt.set()
        if hasattr(self, "t"):
            self.t.join(timeout=1.0)

class InferWorker:
    """フレームキューを監視して一定間隔で推論→結果キューへ（Streamlit 触らない）"""
    def __init__(self, frame_q: queue.Queue, result_q: queue.Queue, weights_path: str, interval_ms: int):
        self.frame_q = frame_q
        self.result_q = result_q
        self.weights_path = weights_path
        self.interval = max(10, interval_ms) / 1000.0
        self.stop_evt = threading.Event()

    def start(self):
        self.t = threading.Thread(target=self._run, daemon=True)
        self.t.start()
        return self

    def _run(self):
        last_t = 0.0
        # モデルを先にウォームアップ（初回を速く）
        try:
            _warmup_model(self.weights_path)
        except Exception:
            pass

        while not self.stop_evt.is_set():
            now = time.time()
            if now - last_t < self.interval:
                time.sleep(0.005)
                continue
            try:
                frame = self.frame_q.get(timeout=0.05)
            except queue.Empty:
                continue
            last_t = now
            t0 = time.time()
            try:
                infos, names, shape = _detect_from_ndarray(frame, self.weights_path)
                waits = [str(x).strip() for x in shape] if isinstance(shape, (list, tuple, set)) else []
                infer_ms = int((time.time() - t0) * 1000)
                # 最新だけ保持
                while True:
                    try:
                        self.result_q.get_nowait()
                    except queue.Empty:
                        break
                self.result_q.put({
                    "frame": frame,
                    "infos": infos,
                    "names": names,
                    "waits": waits,
                    "infer_ms": infer_ms,
                })
            except Exception as e:
                # 失敗も通知
                while True:
                    try:
                        self.result_q.get_nowait()
                    except queue.Empty:
                        break
                self.result_q.put({"error": f"Infer error: {e}"})

    def stop(self):
        self.stop_evt.set()
        if hasattr(self, "t"):
            self.t.join(timeout=1.0)

# ===================== メインレンダラ =====================
def render():
    st.set_page_config(layout="wide", page_title="Mahjong Analyzer (Video)")

    # 左右
    left, right = st.columns([7, 8], gap="large")

    with left:
        # 動画 & 重み
        ucol, wcol = st.columns(2)
        with ucol:
            src_choice = st.radio("動画ソース", ["upload", "local"], index=0, horizontal=True)
            uploaded_video = None
            video_path = None
            if src_choice == "upload":
                uploaded_video = st.file_uploader("解析対象動画（.mp4 / .mov / .avi）", type=["mp4", "mov", "avi"])
                if uploaded_video is not None:
                    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tfile:
                        tfile.write(uploaded_video.read())
                        video_path = tfile.name
            else:
                video_path = st.text_input("ローカル動画のフルパス（例: /Users/you/video.mp4）")
            if video_path:
                st.session_state["ui_video_path"] = video_path
        with wcol:
            weight_choice = st.radio("重み（YOLOvXXm）", ["default", "local"], index=0, horizontal=True)
            weights_local_file = None
            if weight_choice == "local":
                weights_local_file = st.file_uploader("pt形式ファイル", type=["pt"], label_visibility="visible")

        with st.expander("詳細設定", expanded=False):
            # 1行：自風・場風・ドラ
            c1, c2, c3 = st.columns([1, 1, 2])
            with c1:
                player_wind = st.selectbox("自風", [EAST, SOUTH, WEST, NORTH], index=2,
                                           format_func=lambda w: {EAST:"東",SOUTH:"南",WEST:"西",NORTH:"北"}[w])
            with c2:
                round_wind = st.selectbox("場風", [EAST, SOUTH, WEST, NORTH], index=0,
                                          format_func=lambda w: {EAST:"東",SOUTH:"南",WEST:"西",NORTH:"北"}[w])
            with c3:
                doras_text = st.text_input("ドラ・裏ドラ（例: to,8m）", value="to,8m")

            # 2行：基本フラグ
            b1, b2, b3, b4 = st.columns(4)
            with b1:
                is_tsumo = st.checkbox("ツモ", value=True)
            with b2:
                has_aka = st.checkbox("赤", value=True)
            with b3:
                is_riichi = st.checkbox("立直", value=False)
            with b4:
                is_ippatsu = st.checkbox("一発", value=False)

            # 3行：役フラグ
            r1, r2, r3, r4 = st.columns(4)
            with r1:
                is_rinshan = st.checkbox("嶺上開花", value=False)
            with r2:
                is_chankan = st.checkbox("搶槓", value=False)
            with r3:
                is_hotei = st.checkbox("河底撈魚", value=False)
            with r4:
                is_haitei = st.checkbox("海底摸月", value=False)

            # 4行：役フラグ
            r5, r6, r7, r8 = st.columns(4)
            with r5:
                is_wriichi = st.checkbox("W立直", value=False)
            with r6:
                is_tenho = st.checkbox("天和", value=False)
            with r7:
                is_renho = st.checkbox("人和", value=False)
            with r8:
                is_chiho = st.checkbox("地和", value=False)

            # 5行：供託・積み
            n1, n2 = st.columns(2)
            with n1:
                kyoutaku = st.number_input("供託", min_value=0, step=1, value=0)
            with n2:
                honba = st.number_input("積み", min_value=0, step=1, value=0)

            # リアルタイム解析パラメータ
            ncol1, ncol2 = st.columns(2)
            with ncol1:
                interval_ms = st.slider("推論周期(ms)", 50, 1000, 200, step=50, help="0.5秒なら 500ms を指定")
            with ncol2:
                target_width = st.slider("解析時リサイズ幅", 320, 1280, 640, step=80)

        if not TILES_DIR.exists():
            st.warning(f"タイル画像フォルダが見つかりません: {TILES_DIR.resolve()}")

    with right:
        # 上部コントロール
        c_run, c_stop, c_snap = st.columns([1, 1, 1])
        have_path = bool(st.session_state.get("ui_video_path"))
        start = c_run.button("▶ 再生/解析開始", width='stretch', disabled=(not have_path))
        stop  = c_stop.button("⏹ 停止", width='stretch')
        snap  = c_snap.button("📸 スナップ", width='stretch', disabled=(not st.session_state.get("last_tiles")))

        # プレビュー（中央寄せ）
        _l, img_col, _r = st.columns([1, 2, 1])
        frame_holder = img_col.empty()

        # 結果 2 列
        col_det, col_wait = st.columns([3, 1], gap="large")
        det_holder = col_det.container()
        wait_holder = col_wait.container()
        result_holder = st.container()

        # ---- セッション状態（ワーカーとキュー） ----
        ss = st.session_state
        ss.setdefault("grabber", None)
        ss.setdefault("inferer", None)
        ss.setdefault("frame_q", queue.Queue(maxsize=1))
        ss.setdefault("result_q", queue.Queue(maxsize=1))
        ss.setdefault("last_frame", None)
        ss.setdefault("last_tiles", [])
        ss.setdefault("last_infos", [])
        ss.setdefault("last_waits", [])
        ss.setdefault("last_infer_ms", None)
        ss.setdefault("running", False)

        # 重み決定
        weights_to_use = str(DEFAULT_WEIGHTS)
        if weight_choice == "local" and weights_local_file is not None:
            if "mov_weights_tmp" not in ss or ss["mov_weights_tmp"] is None:
                with tempfile.NamedTemporaryFile(suffix=".pt", delete=False) as wtmp:
                    wtmp.write(weights_local_file.read())
                    ss["mov_weights_tmp"] = wtmp.name
            weights_to_use = ss["mov_weights_tmp"]

        # Start: スレッド起動
        if start and have_path:
            # 既存停止
            try:
                if ss["inferer"] is not None:
                    ss["inferer"].stop()
            except Exception:
                pass
            try:
                if ss["grabber"] is not None:
                    ss["grabber"].stop()
            except Exception:
                pass
            ss["inferer"] = None
            ss["grabber"] = None
            # キューをリセット
            ss["frame_q"] = queue.Queue(maxsize=1)
            ss["result_q"] = queue.Queue(maxsize=1)
            ss["last_frame"] = None
            ss["last_tiles"] = []
            ss["last_infos"] = []
            ss["last_waits"] = []
            ss["last_infer_ms"] = None

            # 起動
            ss["grabber"] = FrameGrabber(ss["ui_video_path"], target_width, ss["frame_q"]).start()
            ss["grabber"].ready.wait(timeout=3.0)
            if not ss["grabber"].opened:
                st.error("動画を開けませんでした。パス/コーデック(FFmpeg)をご確認ください。")
                ss["running"] = False
            else:
                ss["inferer"] = InferWorker(ss["frame_q"], ss["result_q"], weights_to_use, interval_ms=interval_ms).start()
                ss["running"] = True

        # Stop: スレッド停止
        if stop and ss["running"]:
            ss["running"] = False
            try:
                if ss["inferer"] is not None:
                    ss["inferer"].stop()
            finally:
                ss["inferer"] = None
            try:
                if ss["grabber"] is not None:
                    ss["grabber"].stop()
            finally:
                ss["grabber"] = None

        # ---- 結果キューをポーリング（メインスレッドのみで session_state を更新） ----
        try:
            msg = ss["result_q"].get_nowait()
        except queue.Empty:
            msg = None
        if msg is not None:
            if "error" in msg:
                det_holder.error(msg["error"])  # 目に見えるエラー表示
            else:
                ss["last_frame"] = msg["frame"]
                ss["last_tiles"] = msg["names"]
                ss["last_infos"] = msg["infos"]
                ss["last_waits"] = msg["waits"]
                ss["last_infer_ms"] = msg["infer_ms"]

        # ---- 画面描画 ----
        frame = ss.get("last_frame")
        # まだ推論結果がなくてもプレビューだけは流したい → grabber の last_frame を表示
        if frame is None and ss.get("grabber") is not None:
            frame = ss["grabber"].last_frame

        if frame is not None:
            frame_holder.image(frame, width='stretch')  # 比率維持・横幅フィット
        else:
            frame_holder.info("待機中… 左で動画と重みを選び、開始してください。")

        names, infos = ss.get("last_tiles", []), ss.get("last_infos", [])
        det_ms = ss.get("last_infer_ms")
        if names:
            det_holder.caption(f"検出結果（{len(names)}枚）" + (f"｜{det_ms} ms" if det_ms is not None else ""))
            _draw_tile_row(names[:14], infos[:14], height_px=35, target_container=det_holder)
        else:
            det_holder.info("—")

        waits = ss.get("last_waits", [])
        wait_holder.subheader("待ち")
        if waits:
            _draw_tile_row(waits, None, height_px=35, target_container=wait_holder)
        else:
            wait_holder.write("—")

        # スナップ（必要ならここで analyze_hand を呼ぶ）
        if snap and names and waits:
            result_holder.subheader("待ち牌ごとのアガリ結果（スナップ）")
            for name in waits:
                try:
                    h2, a2, cfg2 = analyze_hand(
                        tiles=names,
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
                    result_holder.expander(f"{name} のアガリ結果", expanded=False).code(buf.getvalue(), language="text")
                except Exception as e:
                    result_holder.warning(f"{name} の結果計算でエラー: {e}")

        # UI 自動更新（200ms）
        if hasattr(st, "autorefresh"):
            st.autorefresh(interval=200, key="rt_ref")
        elif ss.get("running"):
            time.sleep(0.2)
            st.rerun()


# 単体実行も可
if __name__ == "__main__":
    render()
