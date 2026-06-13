"""国会交易管线 —— 众议院官方 PTR(周期交易报告)→ congress.json。

数据源(全部公开官方/社区,不碰任何商业接口):
  ① 申报索引  disclosures-clerk.house.gov/public_disc/financial-pdfs/{YEAR}FD.zip
              → {YEAR}FD.txt(Prefix Last First Suffix FilingType StateDst Year FilingDate DocID)
  ② 交易明细  .../ptr-pdfs/{YEAR}/{DocID}.pdf —— 电子申报(8位 200x DocID)有文本层,
              pdftotext -layout 后逐行状态机解析:资产名 (TICKER) [ST] + 买卖(P/S) + 日期 + 金额区间
  ③ 党派/照片 unitedstates/congress-legislators 名册 → (姓,州) 映射党派 + bioguide
              → unitedstates.github.io/images/congress/225x275/{bioguide}.jpg

诚实边界(我不是股神铁律):
  - 只做「交易」(PTR 是硬数据),不模拟持仓市值/收益率(金额是宽区间,跟单净值是营销话术)
  - 披露本身滞后(交易后最多 45 天才申报)—— 前端注明,不写 "real time"
  - 只解析电子版普通股([ST]);国债/期权/基金/扫描件跳过,宁缺毋假

用法:
  uv run python scripts/build_congress.py              # 默认近两年(2025+2026)
  uv run python scripts/build_congress.py --years 2026 # 只跑某年
"""
from __future__ import annotations
import argparse
import io
import json
import re
import subprocess
import unicodedata
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
CACHE = ROOT / "data" / "congress-cache"          # PDF 缓存(gitignore),跑一次永久复用
CACHE.mkdir(parents=True, exist_ok=True)

HFD = "https://disclosures-clerk.house.gov/public_disc"
ROSTER = "https://unitedstates.github.io/congress-legislators/legislators-current.json"
PHOTO = "https://unitedstates.github.io/images/congress/225x275/{bg}.jpg"
UA = {"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"}

AMT = {"1,001": (1001, 15000), "15,001": (15001, 50000), "50,001": (50001, 100000),
       "100,001": (100001, 250000), "250,001": (250001, 500000), "500,001": (500001, 1000000),
       "1,000,001": (1000001, 5000000), "5,000,001": (5000001, 25000000),
       "25,000,001": (25000001, 50000000)}
SIDE = {"P": "buy", "S": "sell", "S (partial)": "sell", "E": "exchange"}
CORE = re.compile(r"(S \(partial\)|P|S|E)\s+(\d{2}/\d{2}/\d{4})\s+\d{2}/\d{2}/\d{4}\s+\$([\d,]+)")
TICK = re.compile(r"\(([A-Z][A-Z.\-]{0,5})\)\s*\[(ST|OP|OL|OT|CS|RP|AB|PS|OI|GS|EF|MF)\]")


# ---------- ① 申报索引 ----------
def load_index(year: str) -> list[dict]:
    raw = requests.get(f"{HFD}/financial-pdfs/{year}FD.zip", headers=UA, timeout=30).content
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        txt = z.read(f"{year}FD.txt").decode("utf-8", "ignore")
    rows = []
    for ln in txt.splitlines()[1:]:
        c = ln.split("\t")
        if len(c) < 9 or c[4] != "P":          # 只要 PTR
            continue
        doc = c[8].strip()
        if not (len(doc) == 8 and doc.startswith("20")):   # 只要电子版
            continue
        rows.append({"prefix": c[0], "last": c[1].strip(), "first": c[2].strip(),
                     "suffix": c[3].strip(), "statedst": c[5].strip(),
                     "year": year, "filed": c[7].strip(), "doc": doc})
    return rows


# ---------- ② PTR 明细解析 ----------
def fetch_pdf(year: str, doc: str) -> Path | None:
    p = CACHE / f"{year}_{doc}.pdf"
    if p.exists() and p.stat().st_size > 2000:
        return p
    try:
        r = requests.get(f"{HFD}/ptr-pdfs/{year}/{doc}.pdf", headers=UA, timeout=25)
        if r.status_code == 200 and r.content[:4] == b"%PDF":
            p.write_bytes(r.content)
            return p
    except Exception:
        pass
    return None


def parse_ptr(pdf: Path) -> list[dict]:
    txt = subprocess.run(["pdftotext", "-layout", str(pdf), "-"],
                         capture_output=True, text=True, timeout=30).stdout
    lines = txt.splitlines()
    out = []
    for i, ln in enumerate(lines):
        m = CORE.search(ln)
        if not m:
            continue
        side_raw, date, amt = m.groups()
        tk = atype = None
        for j in range(i, min(i + 3, len(lines))):      # ticker 在本行或后两行
            tm = TICK.search(lines[j])
            if tm:
                tk, atype = tm.groups()
                break
        if not tk or atype != "ST":                      # 只要普通股
            continue
        lo, hi = AMT.get(amt, (None, None))
        try:
            iso = datetime.strptime(date, "%m/%d/%Y").strftime("%Y-%m-%d")
        except ValueError:
            continue
        out.append({"ticker": tk, "side": SIDE.get(side_raw, "?"),
                    "date": iso, "lo": lo, "hi": hi})
    return out


# ---------- ③ 党派 / 照片 ----------
HISTORICAL = "https://unitedstates.github.io/congress-legislators/legislators-historical.json"


def _fold(s: str) -> str:
    """重音归一:Sánchez→sanchez,匹配 PTR 里的纯 ASCII 名。"""
    return "".join(c for c in unicodedata.normalize("NFKD", s.lower())
                   if not unicodedata.combining(c))


def load_roster() -> dict:
    PARTY = {"Democrat": "D", "Republican": "R", "Independent": "I"}
    idx = {}

    def ingest(leg, current):
        for x in leg:
            t = x["terms"][-1]
            rec = {"party": PARTY.get(t["party"], "?"), "bg": x["id"]["bioguide"],
                   "full": x["name"].get("official_full") or f"{x['name']['first']} {x['name']['last']}",
                   "current": current}
            last, st = _fold(x["name"]["last"]), t["state"]
            idx.setdefault((last, st), rec)                      # 现任优先(先 ingest)
            idx.setdefault(("~" + last.split()[-1], st), rec)    # 末名兜底(复姓)
    ingest(requests.get(ROSTER, headers=UA, timeout=20).json(), True)
    try:    # 历史名册兜底:已故/离任议员(Connolly/Mark Green/Sherrill…)
        ingest(requests.get(HISTORICAL, headers=UA, timeout=30).json(), False)
    except Exception:
        pass
    return idx


def match_member(last: str, state: str, roster: dict) -> dict | None:
    last = _fold(last)
    return (roster.get((last, state))
            or roster.get(("~" + last.split()[-1], state))
            or roster.get(("~" + last, state)))


# ---------- 聚合 ----------
def fmt_amt(lo, hi):
    k = lambda v: f"${v // 1000}K" if v < 10**6 else f"${v / 10**6:g}M"
    return f"{k(lo)}-{k(hi)}" if lo else "?"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", nargs="+", default=["2025", "2026"])
    args = ap.parse_args()

    print(f"① 申报索引 {args.years} …")
    filings = []
    for y in args.years:
        idx = load_index(y)
        filings += idx
        print(f"   {y}: {len(idx)} 份电子 PTR")
    print(f"② 下载+解析 {len(filings)} 份 PTR(缓存复用)…")

    def work(f):
        pdf = fetch_pdf(f["year"], f["doc"])
        if not pdf:
            return f, []
        try:
            return f, parse_ptr(pdf)
        except Exception:
            return f, []

    with ThreadPoolExecutor(max_workers=16) as ex:
        results = list(ex.map(work, filings))
    print(f"③ 党派/照片名册 …")
    roster = load_roster()

    # 按议员聚合
    members: dict[tuple, dict] = {}
    unmatched = set()
    for f, trades in results:
        if not trades:
            continue
        state = f["statedst"][:2]
        key = (f["last"].lower(), state)
        rec = match_member(f["last"], state, roster)
        if key not in members:
            party = rec["party"] if rec else "?"
            full = rec["full"] if rec else f"{f['first']} {f['last']} {f['suffix']}".strip()
            if not rec:
                unmatched.add(f"{f['last']},{state}")
            members[key] = {"name": full, "party": party, "state": state,
                            "district": f["statedst"], "bioguide": rec["bg"] if rec else None,
                            "photo": PHOTO.format(bg=rec["bg"]) if rec else None,
                            "current": rec["current"] if rec else True, "trades": []}
        for t in trades:
            members[key]["trades"].append({**t, "filed": f["filed"]})

    # 每人:去重、按日期排序、统计
    today = et_today = datetime.now(timezone(timedelta(hours=-4))).strftime("%Y-%m-%d")
    out = []
    for m in members.values():
        seen, uniq = set(), []
        for t in sorted(m["trades"], key=lambda x: x["date"], reverse=True):
            if t["date"] > today:                      # 申报笔误:未来日期,丢弃
                continue
            sig = (t["ticker"], t["side"], t["date"], t["lo"])
            if sig in seen:
                continue
            seen.add(sig)
            uniq.append({"ticker": t["ticker"], "side": t["side"], "date": t["date"],
                         "size": fmt_amt(t["lo"], t["hi"]), "lo": t["lo"]})
        if not uniq:
            continue
        tick_freq = defaultdict(int)
        for t in uniq:
            tick_freq[t["ticker"]] += 1
        top = sorted(tick_freq, key=lambda k: -tick_freq[k])[:6]
        m["trades"] = uniq[:60]
        m["n_trades"] = len(uniq)
        m["last_date"] = uniq[0]["date"]
        m["latest"] = uniq[0]            # 卡片用:最新一笔
        m["top_tickers"] = top
        # 详情页稳定路由 id:bioguide 优先,否则 区+末名
        m["id"] = m["bioguide"] or re.sub(r"[^a-z0-9]", "", f"{m['district']}{m['name'].split()[-1]}".lower())
        out.append(m)

    # 排序:最近交易优先,同日活跃度优先
    out.sort(key=lambda m: (m["last_date"], m["n_trades"]), reverse=True)
    et = datetime.now(timezone(timedelta(hours=-4)))
    payload = {"updated": et.strftime("%Y-%m-%d"), "source": "U.S. House Clerk PTR filings",
               "n_members": len(out), "n_trades": sum(m["n_trades"] for m in out),
               "members": out}
    (PUB / "congress.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"✅ congress.json — {len(out)} 位议员 · {payload['n_trades']} 笔股票交易 · 更新 {payload['updated']}")
    if unmatched:
        print(f"   ⚠ 党派未匹配({len(unmatched)}): {', '.join(sorted(unmatched)[:8])}")
    print("   榜首 5 位:")
    for m in out[:5]:
        lt = m["latest"]
        print(f"     {m['name'][:22]:22s} {m['party']} {m['state']} · {m['n_trades']:2d}笔 · "
              f"近 {lt['side']} {lt['ticker']} {lt['size']} {lt['date']}")


if __name__ == "__main__":
    main()
