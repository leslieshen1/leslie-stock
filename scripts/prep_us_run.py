"""一键:入库上一批输出 + 把下一批 N 只未覆盖股票写成单股文件 _us_run/{i}.json。

用法: python scripts/prep_us_run.py <N> [output1.json output2.json ...]
  - 先把传入的 workflow 输出文件逐个入库(调用 ingest_us_panel)。
  - 再按市值降序取未覆盖的前 N 只,清空 _us_run/ 重写 0..N-1.json。
  - 打印覆盖进度 + 本批首尾,供下一次 Workflow({scriptPath, args:{dir,count}}) 用。
"""
from __future__ import annotations
import json, os, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
US = ROOT / "web" / "public" / "data" / "us-stocks.json"
DB = ROOT / "web" / "public" / "data" / "us-analyses.json"
RUN = ROOT / "web" / "public" / "data" / "_us_run"
FIELDS = ("sym", "name", "sector", "industry", "mcapB", "price", "country")


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    for out in sys.argv[2:]:
        if Path(out).exists():
            subprocess.run([sys.executable, str(ROOT / "scripts" / "ingest_us_panel.py"), out])

    us = json.load(open(US, encoding="utf-8"))["stocks"]
    done = set(json.load(open(DB, encoding="utf-8"))["stocks"]) if DB.exists() else set()
    todo = [s for s in us if s["sym"] not in done][:n]

    shutil.rmtree(RUN, ignore_errors=True)
    RUN.mkdir(parents=True)
    for i, s in enumerate(todo):
        json.dump({k: s.get(k) for k in FIELDS}, open(RUN / f"{i}.json", "w"), ensure_ascii=False)

    pct = len(done) * 100 // len(us)
    print(f"覆盖 {len(done)}/{len(us)} ({pct}%) · 剩 {len(us)-len(done)} | 本批 {len(todo)} 只"
          + (f" ({todo[0]['sym']}..{todo[-1]['sym']})" if todo else " (全部完成)"))
    print(f"COUNT={len(todo)}")


if __name__ == "__main__":
    main()
