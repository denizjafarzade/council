"""One command for the demo: backend in offline mode (recorded runs, cached data, no network)
plus the frontend. Ctrl+C stops both.

    python scripts/demo.py           # offline: Wi-Fi can be off
    python scripts/demo.py --live    # same, but runs call the LLMs (needs network and credits)
"""

import argparse
import os
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENV_PY = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--live", action="store_true", help="call the LLMs instead of serving recordings")
    args = p.parse_args()

    env = {**os.environ, "COUNCIL_OFFLINE": "0" if args.live else "1", "COUNCIL_MOCK": "0"}
    python = str(VENV_PY if VENV_PY.exists() else sys.executable)
    npm = shutil.which("npm") or "npm"
    procs = [
        subprocess.Popen([python, "-m", "uvicorn", "app:app", "--port", "8000"], cwd=ROOT / "backend", env=env),
        subprocess.Popen([npm, "run", "dev", "--", "--port", "5173", "--strictPort"], cwd=ROOT / "frontend",
                         env=env, shell=os.name == "nt"),
    ]
    runs = sorted(p.stem for p in (ROOT / "runs").glob("*.json"))
    print(f"\nMode: {'LIVE (LLM calls)' if args.live else 'OFFLINE (recorded runs only)'}")
    print(f"Recorded runs: {', '.join(runs) or 'none - record them first: python scripts/record_presets.py'}")
    print("Opening http://localhost:5173  (Ctrl+C to stop)\n")
    time.sleep(3)
    webbrowser.open("http://localhost:5173")
    try:
        while all(proc.poll() is None for proc in procs):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for proc in procs:
            proc.terminate()


if __name__ == "__main__":
    main()
