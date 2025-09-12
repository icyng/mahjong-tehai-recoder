import streamlit as st

st.set_page_config(layout="wide", page_title="Mahjong Analyzer")

with st.sidebar:
    choice = st.radio(
        "解析対象メディア",
        ["画像 (png, jpg)", "動画 (mp4, mov, avi)"],
        index=0,
        help="画像と動画のどちらを解析対象とするかを選んでください",
    )

# --- ページ切替（関数呼び出し） ---
# 依存モジュールを遅延インポート（起動時の無駄なロードを避ける）
if choice == "画像 (png, jpg)":
    from src import tehai_analyzer_img as page
else:
    from src import tehai_analyzer_mov as page

# 各デモは render() を公開している想定
page.render()
