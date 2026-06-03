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
    # 解析:  prep_us_run.py <N> [--master KEY] [output1 output2 ...]
    args = sys.argv[1:]
    n, master, outs = 400, None, []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--master":
            master = args[i + 1]; i += 2
        elif a.isdigit():
            n = int(a); i += 1
        else:
            outs.append(a); i += 1

    # 入库上一批:--master 模式用 merge 落库(append 一方),否则全 panel 落库
    for out in outs:
        if Path(out).exists():
            if master:
                subprocess.run([sys.executable, str(ROOT / "scripts" / "ingest_one_master.py"), out, master])
            else:
                subprocess.run([sys.executable, str(ROOT / "scripts" / "ingest_us_panel.py"), out])
    # 入库后刷新 scan 用的五方摘要(圆点/分歧列读它)
    if outs:
        subprocess.run([sys.executable, str(ROOT / "scripts" / "build_panel_summary.py")])

    us = json.load(open(US, encoding="utf-8"))["stocks"]
    dbs = json.load(open(DB, encoding="utf-8"))["stocks"] if DB.exists() else {}

    if master:
        # 已有 panel 但缺这个股神的票(按市值序)
        todo = [s for s in us if s["sym"] in dbs and master not in (dbs[s["sym"]].get("panel") or {})][:n]
        have = sum(1 for v in dbs.values() if master in (v.get("panel") or {}))
        scope = f"[{master}] 已覆盖 {have}/{len(dbs)} · 还缺 {len(dbs)-have}"
    else:
        done = set(dbs)
        todo = [s for s in us if s["sym"] not in done][:n]
        scope = f"覆盖 {len(done)}/{len(us)} · 剩 {len(us)-len(done)}"

    shutil.rmtree(RUN, ignore_errors=True)
    RUN.mkdir(parents=True)
    for i, s in enumerate(todo):
        json.dump({k: s.get(k) for k in FIELDS}, open(RUN / f"{i}.json", "w"), ensure_ascii=False)

    print(f"{scope} | 本批 {len(todo)} 只"
          + (f" ({todo[0]['sym']}..{todo[-1]['sym']})" if todo else " (全部完成)"))
    print(f"COUNT={len(todo)}")


if __name__ == "__main__":
    main()
