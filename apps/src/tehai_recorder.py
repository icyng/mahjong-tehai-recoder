from __future__ import annotations

import argparse
import os
import signal
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
API_DIR = REPO_ROOT / "apps" / "kifu_api"
UI_DIR = REPO_ROOT / "apps" / "kifu_ui"


def _run_api() -> subprocess.Popen:
    cmd = [
        "uv",
        "run",
        "--project",
        str(REPO_ROOT),
        "uvicorn",
        "app.main:app",
        "--reload",
        "--host",
        "0.0.0.0",
        "--port",
        "8000",
    ]
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{REPO_ROOT}:{env.get('PYTHONPATH','')}".rstrip(":")
    return subprocess.Popen(cmd, cwd=str(API_DIR), env=env)


def _run_ui() -> subprocess.Popen:
    cmd = ["npm", "run", "dev", "--", "--host"]
    return subprocess.Popen(cmd, cwd=str(UI_DIR))


def _terminate(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        proc.terminate()
    else:
        proc.send_signal(signal.SIGTERM)


def _wait_all(processes: list[subprocess.Popen]) -> None:
    try:
        for proc in processes:
            proc.wait()
    except KeyboardInterrupt:
        for proc in processes:
            _terminate(proc)
        for proc in processes:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="tehai_recorder",
        description="Launcher for Kifu API and UI.",
    )
    parser.add_argument("mode", nargs="?", help="api | ui | dev")
    args = parser.parse_args()

    if args.mode == "api":
        _wait_all([_run_api()])
        return 0
    if args.mode == "ui":
        _wait_all([_run_ui()])
        return 0
    if args.mode == "dev":
        processes = [_run_api(), _run_ui()]
        _wait_all(processes)
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
