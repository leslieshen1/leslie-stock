"""盘前 AI 卡三连发(横/方/竖)—— 每天 20:30 北京随盘前报告自动出,落 ~/Downloads。

无人值守的全自动链:
  ① spec 自动推导:复用 share_card.gather(真盘前,盘口不符自动降级)→
     指数四档 + 主题分桶(半导体光通信/太空/币圈,不足额自动换 Megacaps)+
     规则标题 + 页脚接市场日历(今天的 CPI/财报)
  ② ai_card 三画幅生成(1536x1024 / 1024x1024 / 1024x1536),节流间隔 60s
  ③ 自质检:成图回传 gpt-5.5(同通道,多模态)逐字核对 —— 不过关在文件名标 .CHECK
     (Claude 在窗口时仍以人工逐位质检为准)

用法: uv run python scripts/premarket_ai_cards.py [--dry]   # --dry 只打印 spec 不生图
"""
from __future__ import annotations
import argparse
import base64
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from share_card import gather, fp, q  # noqa: E402
from ai_card import compile_prompt, gen_image, composite_logo, all_texts, KEY, BASE, ASSETS, OUT_DIR  # noqa: E402

THEMES = [
    ("chip", "Semis & optical", ["AAOI", "AXTI", "MRVL", "SMCI", "NVTS", "ARM", "MU", "ACMR", "TSM", "AMD"]),
    ("rocket", "Space", ["ASTS", "LUNR"]),
    ("bitcoin", "Crypto names", ["MSTR", "COIN"]),
]
SIZES = [("", "1536x1024")]  # 只出横版(16:9 位)


def headline(idx: dict, card_type: str) -> str:
    g = lambda s: idx.get(s, {}).get("pct") or 0
    qq, sp, dw, ru = g("QQQ"), g("SPY"), g("DIA"), g("IWM")
    sess = "pre-market" if card_type == "premarket" else "tape"
    if qq > 0 and sp > 0 and dw > 0 and ru > 0:
        return "Green across the board, tech out front." if qq >= ru else "Green across the board, small caps lead."
    if qq < 0 and sp < 0 and dw < 0 and ru < 0:
        return f"Red {sess}: risk-off everywhere."
    if qq < -0.3 and (dw > 0 or ru > 0):
        return "Tech under pressure, value holds up."
    if qq > 0.3 and dw < 0:
        return "Tech leads while value lags."
    return "A split tape under the surface."


def build_spec(ctx: dict) -> dict:
    et = datetime.now(timezone(timedelta(hours=-4)))
    title_kind = {"premarket": "Pre-Market", "close": "Close", "intraday": "Intraday"}[ctx["type"]]
    # 主题面板:每桶取 |pct| 最大的 2-3 只;不足 2 只的桶丢弃
    by_sym = {r["sym"]: r for r in ctx["megaDown"] + ctx["megaUp"] + ctx["semiDown"] + ctx["semiUp"]}
    # gather 只带回 mega/semi 的 top movers;主题桶直接重查这些缓存,缺的跳过
    panels = []
    for icon, title, syms in THEMES:
        # 桶里缺的票直接补抓(gather 只带回 mega/semi 的 top movers)
        for sym in syms:
            if sym not in by_sym:
                r = q(sym)
                if r["pct"] is not None:
                    by_sym[sym] = r
        items = [(s, by_sym[s]["pct"]) for s in syms if s in by_sym and by_sym[s]["pct"] is not None]
        items.sort(key=lambda x: -abs(x[1]))
        items = items[:3]
        if len(items) >= 2:
            panels.append({"icon": icon, "title": title,
                           "items": [f"${s} {fp(p)}" for s, p in items]})
    # 不足三个面板 → 用 Megacaps 补位
    if len(panels) < 3:
        megas = sorted(ctx["megaDown"] + ctx["megaUp"], key=lambda r: -abs(r["pct"] or 0))[:3]
        panels.append({"icon": "bolt", "title": "Megacaps",
                       "items": [f"${r['sym']} {fp(r['pct'])}" for r in megas]})
    panels = panels[:3]

    # 页脚:今天的重磅(宏观带时间 + 盘后财报),拼一行
    bits, hl = [], ""
    today = et.date()
    for e in ctx.get("next", []):
        try:
            d = datetime.strptime(e["date"], "%Y-%m-%d").date()
        except Exception:
            continue
        if d != today:
            continue
        t = str(e.get("timeET") or "")
        if e["kind"] == "macro" and ":" in t:
            name = "CPI" if "CPI" in e["title"] else ("PPI" if "PPI" in e["title"] else
                   ("FOMC" if "美联储" in e["title"] else e["title"]))
            bits.append(f"{name} {t} ET")
        elif e["kind"] == "earnings" and t == "盘后" and e.get("sym"):
            bits.append(f"${e['sym']} after the close")
            hl = f"${e['sym']}"
    text = "Today: " + " · ".join(bits[:2]) if bits else "Full briefing on AInvest"
    qq = ctx["idx"].get("QQQ", {}).get("pct") or 0
    return {
        "slug": f"{ctx['type']}-{et.strftime('%b%d').lower()}",
        "mood": "bullish" if qq > 0.4 else "bearish" if qq < -0.4 else "neutral",
        "title": f"{title_kind} · {ctx['date']} · ET",
        "headline": headline(ctx["idx"], ctx["type"]),
        "indexes": [[n, fp(ctx["idx"].get(s, {}).get("pct"))]
                    for s, n in [("QQQ", "Nasdaq 100"), ("IWM", "Russell 2000"), ("SPY", "S&P 500"), ("DIA", "Dow")]],
        "panels": panels,
        "footer": {"icon": "clock" if hl else "calendar", "text": text, "highlight": hl},
    }


def self_verify(png: Path, expected: list[str]) -> bool | None:
    """成图回传 gpt-5.5 逐字核对。True=过 / False=有错 / None=核对通道不可用。"""
    try:
        b64 = base64.b64encode(png.read_bytes()).decode()
        body = {"model": "gpt-5.5", "stream": True,
                "input": [{"role": "user", "content": [
                    {"type": "input_image", "image_url": f"data:image/png;base64,{b64}"},
                    {"type": "input_text", "text":
                     "Compare the text in this image against this expected list. Reply ONLY a JSON object "
                     '{"ok": true/false, "mismatches": ["..."]}. Expected strings:\n'
                     + "\n".join(f"- {t}" for t in expected)},
                ]}]}
        req = urllib.request.Request(f"{BASE}/v1/responses", data=json.dumps(body).encode(),
                                     headers={"Authorization": f"Bearer {KEY}",
                                              "Content-Type": "application/json",
                                              "Accept": "text/event-stream"}, method="POST")
        from ai_card import sse_events
        texts = []
        with urllib.request.urlopen(req, timeout=300) as resp:
            for ev in sse_events(resp):
                if ev.get("type") == "response.output_item.done":
                    item = ev.get("item", {})
                    if item.get("type") == "message":
                        for part in item.get("content", []):
                            if part.get("type") == "output_text":
                                texts.append(part.get("text", ""))
        raw = "\n".join(texts)
        m = raw[raw.index("{"): raw.rindex("}") + 1]
        v = json.loads(m)
        if not v.get("ok"):
            print(f"   自检不过: {v.get('mismatches')}")
        return bool(v.get("ok"))
    except Exception as e:
        print(f"   (自检通道不可用: {str(e)[:80]})")
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--type", default="premarket", choices=["premarket", "close", "intraday"])
    args = ap.parse_args()

    print("① 抓真盘前 + 推导 spec …")
    ctx = gather(args.type)
    spec = build_spec(ctx)
    print(json.dumps(spec, ensure_ascii=False, indent=1))
    # spec 存档(可追溯)
    arch = Path(__file__).parent.parent / "data" / "cards" / f"{spec['slug']}.ai.json"
    arch.parent.mkdir(parents=True, exist_ok=True)
    arch.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.dry:
        return

    date_tag = datetime.now(timezone(timedelta(hours=-4))).strftime("%Y%m%d")
    expected = all_texts(spec)
    for i, (suffix, size) in enumerate(SIZES):
        if i:
            time.sleep(60)  # 节流
        s = {**spec, "slug": spec["slug"] + suffix, "size": size}
        prompt = compile_prompt(s)
        raw = Path(f"/tmp/ai_card_{s['slug']}_raw.png")
        ok = False
        for attempt in range(1, 4):
            print(f"🖼  {size} 第 {attempt} 发…")
            if gen_image(prompt, [ASSETS / f"aime-{s['mood']}.png"], size, raw):
                ok = True
                break
            time.sleep(45 * attempt)
        if not ok:
            print(f"   ❌ {size} 三发失败,跳过")
            continue
        out = OUT_DIR / f"AInvest_ai_{s['slug']}_{date_tag}.png"
        composite_logo(raw, out, size)
        time.sleep(30)
        verdict = self_verify(out, expected)
        if verdict is False:
            bad = out.with_name(out.stem + ".CHECK.png")
            out.rename(bad)
            print(f"⚠ {bad.name}(自检发现错字,发布前人工核)")
        else:
            print(f"✅ {out.name}" + ("(自检通过)" if verdict else "(自检通道不可用,发布前过目)"))


if __name__ == "__main__":
    main()
