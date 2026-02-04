from __future__ import annotations

from pathlib import Path
import base64
import functools
import http.server
import queue
import tempfile
import threading
import time
import urllib.parse
from typing import Sequence

import cv2
import numpy as np
import streamlit as st
import streamlit.components.v1 as components
from PIL import Image
from ultralytics import YOLO

from mj.models.tehai.myyolo import MYYOLO
from mj.machi import machi_hai_13

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
YOLO_CONF = 0.5
YOLO_IOU = 0.5
DEFAULT_UI_REFRESH_MS = 600


def _guess_video_format(path: str | None) -> str:
    if not path:
        return "video/mp4"
    suffix = Path(path).suffix.lower()
    if suffix == ".mov":
        return "video/quicktime"
    if suffix == ".avi":
        return "video/x-msvideo"
    return "video/mp4"


class _VideoServer:
    def __init__(self, root_dir: Path):
        handler = functools.partial(
            http.server.SimpleHTTPRequestHandler,
            directory=str(root_dir),
        )
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def stop(self) -> None:
        try:
            self.httpd.shutdown()
        except Exception:
            pass


def _ensure_video_url(path: str, ss: dict) -> str | None:
    video_path = Path(path)
    if not video_path.exists():
        return None
    root_dir = video_path.parent
    server = ss.get("video_server")
    if server is None or ss.get("video_server_root") != str(root_dir):
        if server is not None:
            try:
                server.stop()
            except Exception:
                pass
        server = _VideoServer(root_dir)
        ss["video_server"] = server
        ss["video_server_root"] = str(root_dir)
    filename = urllib.parse.quote(video_path.name)
    return f"http://127.0.0.1:{server.port}/{filename}"


def _render_video_player(
    url: str,
    *,
    running: bool,
    video_id: str,
    mime: str,
    height: int = 360,
) -> None:
    should_play = "true" if running else "false"
    autoplay = "autoplay muted" if running else ""
    html = f"""
    <style>
    .video-wrap {{
        width: 100%;
        display: flex;
        justify-content: center;
    }}
    .video-wrap video {{
        width: 100%;
        max-height: {height}px;
        background: #000;
        border-radius: 6px;
    }}
    </style>
    <div class="video-wrap">
      <video id="mj-video" playsinline {autoplay} controls>
        <source src="{url}" type="{mime}">
      </video>
    </div>
    <script>
      const video = document.getElementById("mj-video");
      const key = "mj_video_time_{video_id}";
      const saved = localStorage.getItem(key);
      const applySaved = () => {{
        if (saved && !isNaN(parseFloat(saved))) {{
          const savedTime = parseFloat(saved);
          if (Math.abs(video.currentTime - savedTime) > 0.1) {{
            video.currentTime = savedTime;
          }}
        }}
      }};
      if (video.readyState >= 1) {{
        applySaved();
      }} else {{
        video.addEventListener("loadedmetadata", applySaved, {{ once: true }});
      }}
      const shouldPlay = {should_play};
      if (shouldPlay) {{
        video.play().catch(() => {{ }});
      }} else {{
        video.pause();
      }}
      const saveTime = () => {{
        if (!isNaN(video.currentTime)) {{
          localStorage.setItem(key, video.currentTime.toString());
        }}
      }};
      video.addEventListener("timeupdate", saveTime);
      video.addEventListener("seeking", saveTime);
      video.addEventListener("seeked", saveTime);
      video.addEventListener("pause", saveTime);
      setInterval(saveTime, 200);
    </script>
    """
    components.html(html, height=height + 24, scrolling=False)


def _img_b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


@st.cache_resource(show_spinner=False)
def _load_model(weights_path: str) -> YOLO:
    return YOLO(weights_path)


def _detect_from_ndarray(frame_rgb: np.ndarray, model: YOLO):
    result = model.predict(
        source=frame_rgb,
        conf=YOLO_CONF,
        iou=YOLO_IOU,
        verbose=False,
    )[0]
    cls_names = model.names
    tile_infos = []
    for box in result.boxes:
        cls_name = cls_names[int(box.cls[0])]
        conf = float(box.conf[0])
        ltop = box.xyxy[0][0]
        tile_infos.append({"point": ltop, "conf": conf, "class": cls_name})
    tile_infos.sort(key=lambda x: x["point"])
    tile_names = [h["class"] for h in tile_infos]
    shape = machi_hai_13(tile_names)
    return tile_infos, tile_names, shape


def _detect_from_ndarray_fallback(frame_rgb: np.ndarray, weights_path: str):
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        Image.fromarray(frame_rgb).save(tmp.name)
        img_path = tmp.name
    tile_infos, tile_names = MYYOLO(model_path=weights_path, image_path=img_path)
    shape = machi_hai_13(tile_names)
    return tile_infos, tile_names, shape


def _draw_tile_row(
    tile_names: Sequence[str],
    tile_infos: Sequence[dict] | None = None,
    height_px: int = 40,
    target_container=None,
):
    css = f"""
    <style>
    .tile-row {{ display:flex; flex-wrap:nowrap; overflow-x:auto; gap:0.2rem; padding:0.3rem 0; }}
    .tile     {{ display:flex; flex-direction:column; align-items:center; }}
    .tile img {{ height:{height_px}px; width:auto; display:block; }}
    .tile-warn{{ font-size:0.75rem; opacity:0.85; margin-top:0.1rem; }}
    </style>
    """
    row_html = ["<div class=\"tile-row\">"]
    for i, name in enumerate(tile_names):
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

    html = css + "".join(row_html)
    (target_container or st).markdown(html, unsafe_allow_html=True)


class FrameGrabber:
    def __init__(self, path: str, target_width: int, out_queue: queue.Queue):
        self.path = path
        self.target_width = target_width
        self.q = out_queue
        self.cap = None
        self.stop_evt = threading.Event()
        self.ready = threading.Event()
        self.opened = False
        self.last_frame = None

    def start(self):
        self.t = threading.Thread(target=self._run, daemon=True)
        self.t.start()
        return self

    def _open_capture(self):
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
                frame_bgr = cv2.resize(frame_bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            self.last_frame = frame_rgb

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
    def __init__(self, frame_q: queue.Queue, result_q: queue.Queue, weights_path: str, interval_ms: int):
        self.frame_q = frame_q
        self.result_q = result_q
        self.weights_path = weights_path
        self.interval = max(10, interval_ms) / 1000.0
        self.stop_evt = threading.Event()
        self.model = None

    def start(self):
        self.t = threading.Thread(target=self._run, daemon=True)
        self.t.start()
        return self

    def _run(self):
        last_t = 0.0
        try:
            self.model = _load_model(self.weights_path)
        except Exception as e:
            self._push_result({"error": f"モデル読み込みに失敗: {e}"})
            return

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
                try:
                    infos, names, shape = _detect_from_ndarray(frame, self.model)
                except Exception:
                    infos, names, shape = _detect_from_ndarray_fallback(frame, self.weights_path)
                waits = [str(x).strip() for x in shape] if isinstance(shape, (list, tuple, set)) else []
                infer_ms = int((time.time() - t0) * 1000)
                self._push_result({
                    "frame": frame,
                    "infos": infos,
                    "names": names,
                    "waits": waits,
                    "infer_ms": infer_ms,
                })
            except Exception as e:
                self._push_result({"error": f"Infer error: {e}"})

    def _push_result(self, payload: dict) -> None:
        while True:
            try:
                self.result_q.get_nowait()
            except queue.Empty:
                break
        self.result_q.put(payload)

    def stop(self):
        self.stop_evt.set()
        if hasattr(self, "t"):
            self.t.join(timeout=1.0)


def _init_state(ss: dict) -> None:
    defaults = {
        "grabber": None,
        "inferer": None,
        "frame_q": queue.Queue(maxsize=1),
        "result_q": queue.Queue(maxsize=1),
        "last_frame": None,
        "last_tiles": [],
        "last_infos": [],
        "last_waits": [],
        "last_infer_ms": None,
        "running": False,
        "video_source_id": None,
        "video_url": None,
        "video_mime": "video/mp4",
        "video_server": None,
        "video_server_root": None,
        "show_preview": False,
        "mov_weights_tmp": None,
        "ui_video_path": None,
    }
    for key, value in defaults.items():
        ss.setdefault(key, value)


def _reset_results(ss: dict) -> None:
    ss["last_frame"] = None
    ss["last_tiles"] = []
    ss["last_infos"] = []
    ss["last_waits"] = []
    ss["last_infer_ms"] = None


def _stop_workers(ss: dict) -> None:
    for key in ("inferer", "grabber"):
        worker = ss.get(key)
        if worker is None:
            continue
        try:
            worker.stop()
        except Exception:
            pass
        ss[key] = None


def _resolve_weights(choice: str, weights_local_file, ss: dict) -> str:
    weights = str(DEFAULT_WEIGHTS)
    if choice == "local" and weights_local_file is not None:
        if ss.get("mov_weights_tmp") is None:
            with tempfile.NamedTemporaryFile(suffix=".pt", delete=False) as wtmp:
                wtmp.write(weights_local_file.read())
                ss["mov_weights_tmp"] = wtmp.name
        weights = str(ss["mov_weights_tmp"])
    return weights


def _update_video_url(ss: dict) -> None:
    if not ss.get("ui_video_path"):
        return
    source_id = f"path:{ss['ui_video_path']}"
    if ss.get("video_source_id") != source_id:
        url = _ensure_video_url(ss["ui_video_path"], ss)
        ss["video_url"] = url
        ss["video_mime"] = _guess_video_format(ss["ui_video_path"])
        ss["video_source_id"] = source_id


def render():
    st.set_page_config(layout="wide", page_title="Mahjong Analyzer (Video)")

    left, right = st.columns([7, 8], gap="large")

    with left:
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
                video_path = st.text_input("例（/Users/your/name/video.mp4）")
            if video_path:
                st.session_state["ui_video_path"] = video_path
        with wcol:
            weight_choice = st.radio("重み（YOLOvXXm）", ["default", "local"], index=0, horizontal=True)
            weights_local_file = None
            if weight_choice == "local":
                weights_local_file = st.file_uploader("pt形式ファイル", type=["pt"], label_visibility="visible")

        with st.expander("詳細設定", expanded=False):
            ncol1, ncol2 = st.columns(2)
            with ncol1:
                interval_ms = st.slider("推論周期(ms)", 50, 1000, 200, step=50, help="0.5秒なら 500ms を指定")
            with ncol2:
                target_width = st.slider("解析時リサイズ幅", 320, 1280, 640, step=80)
            ui_refresh_ms = st.slider(
                "UI更新周期(ms)",
                200,
                2000,
                DEFAULT_UI_REFRESH_MS,
                step=100,
                help="再生の滑らかさ優先なら大きめに",
            )

        if not TILES_DIR.exists():
            st.warning(f"タイル画像フォルダが見つかりません: {TILES_DIR.resolve()}")

    with right:
        c_run, c_stop = st.columns([1, 1])
        have_path = bool(st.session_state.get("ui_video_path"))
        start = c_run.button("▶ 再生/解析開始", use_container_width=True, disabled=(not have_path))
        stop = c_stop.button("⏹ 停止", use_container_width=True)

        video_holder = st.container()
        preview_holder = st.empty()

        col_det, col_wait = st.columns([3, 1], gap="large")
        det_holder = col_det.container()
        wait_holder = col_wait.container()

        ss = st.session_state
        _init_state(ss)
        weights_to_use = _resolve_weights(weight_choice, weights_local_file, ss)
        _update_video_url(ss)

        if start and have_path:
            _stop_workers(ss)
            _reset_results(ss)
            ss["frame_q"] = queue.Queue(maxsize=1)
            ss["result_q"] = queue.Queue(maxsize=1)
            ss["grabber"] = FrameGrabber(ss["ui_video_path"], target_width, ss["frame_q"]).start()
            ss["grabber"].ready.wait(timeout=3.0)
            if not ss["grabber"].opened:
                st.error("動画を開けませんでした。パス/コーデック(FFmpeg)をご確認ください。")
                ss["running"] = False
            else:
                ss["inferer"] = InferWorker(ss["frame_q"], ss["result_q"], weights_to_use, interval_ms=interval_ms).start()
                ss["running"] = True

        if stop and ss.get("running"):
            ss["running"] = False
            _stop_workers(ss)

        try:
            msg = ss["result_q"].get_nowait()
        except queue.Empty:
            msg = None
        if msg is not None:
            if "error" in msg:
                det_holder.error(msg["error"])
            else:
                ss["last_frame"] = msg["frame"]
                ss["last_tiles"] = msg["names"]
                ss["last_infos"] = msg["infos"]
                ss["last_waits"] = msg["waits"]
                ss["last_infer_ms"] = msg["infer_ms"]

        if ss.get("video_url"):
            with video_holder:
                _render_video_player(
                    ss["video_url"],
                    running=ss.get("running", False),
                    video_id=ss.get("video_source_id", "video"),
                    mime=ss.get("video_mime", "video/mp4"),
                    height=360,
                )
        else:
            video_holder.info("動画を読み込んでください。")

        ss["show_preview"] = st.checkbox(
            "解析フレームをプレビュー",
            value=ss["show_preview"],
        )
        frame = ss.get("last_frame")
        if frame is None and ss.get("grabber") is not None:
            frame = ss["grabber"].last_frame
        if ss["show_preview"]:
            if frame is not None:
                preview_holder.image(frame, use_container_width=True)
            else:
                preview_holder.info("プレビュー待機中…")

        names, infos = ss.get("last_tiles", []), ss.get("last_infos", [])
        det_ms = ss.get("last_infer_ms")
        if names:
            det_holder.caption(f"検出結果（{len(names)}枚）" + (f"｜{det_ms} ms" if det_ms is not None else ""))
            _draw_tile_row(names[:14], infos[:14], height_px=35, target_container=det_holder)
        else:
            det_holder.write("")

        waits = ss.get("last_waits", [])
        if waits:
            _draw_tile_row(waits, None, height_px=35, target_container=wait_holder)
        else:
            wait_holder.write("")

        if hasattr(st, "autorefresh") and ss.get("running"):
            st.autorefresh(interval=ui_refresh_ms, key="rt_ref")
        elif ss.get("running"):
            time.sleep(ui_refresh_ms / 1000.0)
            st.rerun()


if __name__ == "__main__":
    render()
