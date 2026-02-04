from pathlib import Path
import sys

import streamlit as st

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

st.set_page_config(layout="wide", page_title="Mahjong Analyzer")

with st.sidebar:
    choice = st.radio(
        "メニュー",
        ["画像 (png, jpg)", "動画 (mp4, mov, avi)", "牌譜記録ツール"],
        index=0,
        help="解析対象か牌譜記録ツールを選択してください",
    )
if choice == "画像 (png, jpg)":
    from src import tehai_analyzer_img as page
elif choice == "動画 (mp4, mov, avi)":
    from src import tehai_analyzer_mov as page

page.render()
