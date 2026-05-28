"""把 SQLite 导出成 web 端需要的 manifest JSON。

SoT = SQLite
View = JSON（兼容现有 web 端）

每次 SQLite 有变动，跑这个脚本，再 deploy。

Output:
- data/aleabit_manifest.json          兼容现有
- web/public/data/pulse-supplement.json 兼容现有
- web/data/aleabit_manifest.json       deploy 用
- web/data/analyses/*.json             兼容现有 stock detail page

深度分析过的票（有 v2+ 的）会额外注入：
- analyses_history: [{version, score, verdict_label, thesis, created_at}...]
- financials: 最近 8 季（如果 Tushare 缓存有）
- recent_events: 最近 1 年 alpha 公告（如果 Tushare 缓存有）
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

from db import connect

ROOT = Path(__file__).parent.parent
WEB_DATA = ROOT / "web" / "data"
WEB_PUBLIC_DATA = ROOT / "web" / "public" / "data"
DATA_DIR = ROOT / "data"

WEB_ANALYSES = WEB_DATA / "analyses"
DATA_ANALYSES = DATA_DIR / "analyses"


def export_aleabit_manifest():
    """生成 aleabit_manifest.json — 全市场 Serenity 评分 + 基础信息。"""
    with connect(readonly=True) as conn:
        rows = conn.execute("""
            SELECT s.code, s.name, s.market,
                   s.market_cap, s.market_cap_usd, s.sector,
                   a.score, a.verdict, a.verdict_label,
                   a.layer, a.signals_hit, a.thesis, a.pre_labeled
            FROM stocks s
            LEFT JOIN v_latest_analysis a
              ON a.stock_id = s.id AND a.framework = 'serenity'
            ORDER BY COALESCE(a.score, 0) DESC
        """).fetchall()

    records = []
    for r in rows:
        mcap_yi = (r["market_cap"] / 1e8) if r["market_cap"] else None
        thesis = r["thesis"] or ""
        if len(thesis) > 120:
            thesis = thesis[:120] + "…"
        records.append({
            "code": r["code"],
            "name": r["name"],
            "market": r["market"],
            "market_cap_yi": round(mcap_yi, 1) if mcap_yi else None,
            "sector": r["sector"] or "",
            "layer": r["layer"],
            "score": r["score"] or 0,
            "verdict": r["verdict"] or "unknown",
            "verdict_label": r["verdict_label"] or "",
            "signals_hit": r["signals_hit"] or 0,
            "thesis": thesis,
            "pre_labeled": bool(r["pre_labeled"]),
            "has_full_analysis": False,
        })

    out = DATA_DIR / "aleabit_manifest.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=1)

    web_out = WEB_DATA / "aleabit_manifest.json"
    web_out.parent.mkdir(parents=True, exist_ok=True)
    web_out.write_text(out.read_text(encoding="utf-8"), encoding="utf-8")

    return len(records)


def _stocks_with_deep_analysis(conn) -> set[int]:
    """找出有 v2+ 的票（即手动深度分析过的）— 这些票额外注入 history + 财务 + 公告。"""
    rows = conn.execute("""
        SELECT DISTINCT stock_id
        FROM analyses
        WHERE pre_labeled = 0 AND version != 'v1'
    """).fetchall()
    return {r["stock_id"] for r in rows}


def _fetch_financials_safe(code: str, market: str, quarters: int = 8) -> dict | None:
    """从 Tushare 缓存拉财务面（不触发新调用）。"""
    try:
        from fetchers.tushare_client import client, ts_code as to_ts
        ts = to_ts(code, market)
        end = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=quarters * 90 + 90)).strftime("%Y%m%d")
        fin_params = {"ts_code": ts, "start_date": start, "end_date": end}
        inc_params = {"ts_code": ts, "start_date": start, "end_date": end}
        fin = client._from_cache("fina_indicator", fin_params)
        inc = client._from_cache("income", inc_params)
        if fin is None or fin.empty:
            return None
        import pandas as pd
        if "ann_date" in fin.columns:
            fin = fin.sort_values(["end_date", "ann_date"], ascending=[False, False])
        else:
            fin = fin.sort_values("end_date", ascending=False)
        fin = fin.drop_duplicates(subset=["end_date"], keep="first").head(quarters)
        # merge with income
        if inc is not None and not inc.empty:
            if "ann_date" in inc.columns:
                inc = inc.sort_values(["end_date", "ann_date"], ascending=[False, False])
            inc = inc.drop_duplicates(subset=["end_date"], keep="first").head(quarters)
            merged = pd.merge(
                fin[["end_date", "roe", "netprofit_margin", "grossprofit_margin",
                     "debt_to_assets", "or_yoy"]],
                inc[["end_date", "revenue", "n_income"]],
                on="end_date", how="left"
            )
        else:
            merged = fin[["end_date", "roe", "netprofit_margin", "grossprofit_margin",
                          "debt_to_assets", "or_yoy"]].copy()
            merged["revenue"] = None
            merged["n_income"] = None

        out = []
        for _, r in merged.iterrows():
            def _v(x):
                if pd.isna(x): return None
                return round(float(x), 2)
            out.append({
                "period": str(r["end_date"]),
                "revenue": _v(r.get("revenue")),
                "n_income": _v(r.get("n_income")),
                "or_yoy": _v(r.get("or_yoy")),
                "net_margin": _v(r.get("netprofit_margin")),
                "gross_margin": _v(r.get("grossprofit_margin")),
                "roe": _v(r.get("roe")),
                "debt_to_assets": _v(r.get("debt_to_assets")),
            })
        return {"quarters": out}
    except Exception as e:
        return None


def _fetch_events_safe(code: str, market: str, days: int = 365) -> list | None:
    """从 Tushare 缓存拉公告 + alpha 分级（不触发新调用）。"""
    try:
        from fetchers.tushare_client import client, ts_code as to_ts
        from fetchers.announcements import classify_alpha, page_to_pdf_url
        ts = to_ts(code, market)
        end = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
        df = client._from_cache("anns_d", {"start_date": start, "end_date": end, "ts_code": ts})
        if df is None or df.empty:
            return None
        df = df.drop_duplicates(subset=["ann_date", "title"]).sort_values("ann_date", ascending=False)
        out = []
        for _, r in df.iterrows():
            tier, kw = classify_alpha(r["title"])
            if tier == 0:
                continue
            pdf_url = page_to_pdf_url(r["url"])
            out.append({
                "ann_date": str(r["ann_date"]),
                "title": r["title"],
                "tier": tier,
                "keyword": kw,
                "url": r["url"],
                "pdf_url": pdf_url,
            })
        return out
    except Exception as e:
        return None


def export_individual_analyses():
    """每只股票一份 JSON，兼容 /stock/[code] 详情页。

    深度分析过的票（有 v2+）额外注入 analyses_history + financials + recent_events。
    """
    WEB_ANALYSES.mkdir(parents=True, exist_ok=True)
    DATA_ANALYSES.mkdir(parents=True, exist_ok=True)

    with connect(readonly=True) as conn:
        deep_stocks = _stocks_with_deep_analysis(conn)
        stocks = conn.execute("""
            SELECT id, code, market, name, sector, industries,
                   market_cap, pe_ttm, pb
            FROM stocks
        """).fetchall()

        written = 0
        deep_count = 0
        for s in stocks:
            stock_id = s["id"]
            analyses = conn.execute("""
                SELECT framework, version, score, verdict, verdict_label,
                       layer, layer_label, thesis, signals, signals_hit,
                       red_flags, ai_relevance, bg_dimensions, bg_sell_triggers,
                       model, pre_labeled, created_at
                FROM v_latest_analysis
                WHERE stock_id = ?
            """, (stock_id,)).fetchall()

            # 全版本历史（按 framework 分组）
            history_rows = conn.execute("""
                SELECT framework, version, score, verdict_label, layer_label,
                       thesis, signals_hit, red_flags, model, pre_labeled,
                       created_at
                FROM analyses
                WHERE stock_id = ?
                ORDER BY framework, created_at
            """, (stock_id,)).fetchall()

            d = {
                "code": s["code"],
                "name": s["name"],
                "market": s["market"],
                "sector": s["sector"] or "",
                "concepts": [],
                "industry": None,
                "raw_quote": {
                    "code": s["code"], "name": s["name"],
                    "market_cap": s["market_cap"],
                    "pe_ttm": s["pe_ttm"],
                    "pb": s["pb"],
                },
                "overall_score": 0,
                "overall_grade": "—",
                "verdict": "",
                "llm_used": False,
                "llm_model": "",
                "dimensions": {},
                "sell_triggers": [],
                "updated_at": "",
            }

            for a in analyses:
                fwk = a["framework"]
                if fwk == "serenity":
                    d["aleabit"] = {
                        "supply_chain_layer": a["layer"],
                        "layer_label": a["layer_label"] or "",
                        "bottleneck_score": a["score"] or 0,
                        "verdict": a["verdict"] or "unknown",
                        "verdict_label": a["verdict_label"] or "",
                        "thesis": a["thesis"] or "",
                        "signals": json.loads(a["signals"]) if a["signals"] else [],
                        "signals_hit": a["signals_hit"] or 0,
                        "red_flags": json.loads(a["red_flags"]) if a["red_flags"] else [],
                        "ai_relevance": a["ai_relevance"] or "",
                        "pre_labeled": bool(a["pre_labeled"]),
                        "updated_at": a["created_at"],
                    }
                elif fwk == "bg":
                    d["overall_score"] = a["score"] or 0
                    d["overall_grade"] = a["verdict_label"] or ""
                    d["verdict"] = a["thesis"] or ""
                    d["llm_used"] = True
                    d["llm_model"] = a["model"] or ""
                    d["dimensions"] = json.loads(a["bg_dimensions"]) if a["bg_dimensions"] else {}
                    d["sell_triggers"] = json.loads(a["bg_sell_triggers"]) if a["bg_sell_triggers"] else []
                    d["updated_at"] = a["created_at"]

            # 深度分析过的票：注入多版本历史 + 财务 + 公告
            if stock_id in deep_stocks:
                history = []
                for h in history_rows:
                    hd = dict(h)
                    history.append({
                        "framework": hd["framework"],
                        "version": hd["version"],
                        "score": hd["score"],
                        "verdict_label": hd["verdict_label"] or "",
                        "layer_label": hd["layer_label"] or "",
                        "thesis": hd["thesis"] or "",
                        "signals_hit": hd["signals_hit"] or 0,
                        "red_flags": json.loads(hd["red_flags"]) if hd["red_flags"] else [],
                        "model": hd["model"] or "",
                        "pre_labeled": bool(hd["pre_labeled"]),
                        "created_at": hd["created_at"],
                    })
                d["analyses_history"] = history

                # 财务面（from Tushare cache）
                fin = _fetch_financials_safe(s["code"], s["market"])
                if fin:
                    d["financials"] = fin

                # 公告 alpha events
                events = _fetch_events_safe(s["code"], s["market"])
                if events:
                    d["recent_events"] = events

                deep_count += 1

            out_name = f"{s['code']}_{s['market']}.json"
            (DATA_ANALYSES / out_name).write_text(
                json.dumps(d, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
            # web 镜像
            (WEB_ANALYSES / out_name).write_text(
                json.dumps(d, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
            written += 1

    return written, deep_count


def export_top_serenity(n: int = 100):
    """Top N Serenity 评分，给首页 spotlight 用。"""
    with connect(readonly=True) as conn:
        rows = conn.execute("""
            SELECT s.code, s.name, s.market, s.market_cap, s.sector,
                   a.score, a.verdict, a.verdict_label, a.layer_label,
                   a.thesis, a.signals_hit
            FROM stocks s
            JOIN v_latest_analysis a
              ON a.stock_id = s.id AND a.framework = 'serenity'
            WHERE a.score >= 60
            ORDER BY a.score DESC, s.market_cap DESC
            LIMIT ?
        """, (n,)).fetchall()

    records = []
    for r in rows:
        mcap_yi = (r["market_cap"] / 1e8) if r["market_cap"] else None
        records.append({
            "code": r["code"],
            "name": r["name"],
            "market": r["market"],
            "market_cap_yi": round(mcap_yi, 1) if mcap_yi else None,
            "sector": r["sector"] or "",
            "score": r["score"],
            "verdict": r["verdict"],
            "verdict_label": r["verdict_label"],
            "layer_label": r["layer_label"] or "",
            "thesis": r["thesis"] or "",
            "signals_hit": r["signals_hit"] or 0,
        })

    out = DATA_DIR / "top_serenity.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=1)

    return len(records)


def main():
    print("📤 Exporting from SQLite...")
    manifest_n = export_aleabit_manifest()
    print(f"  ✓ aleabit_manifest.json: {manifest_n} 条")

    analyses_n, deep_n = export_individual_analyses()
    print(f"  ✓ data/analyses/*.json + web/data/analyses/*.json: {analyses_n} 个")
    print(f"    其中 {deep_n} 只有深度分析（multi-version + 财务 + 公告）")

    top_n = export_top_serenity()
    print(f"  ✓ top_serenity.json: {top_n} 条")

    print()
    print("✅ 完成")
    print(f"   SoT: data/leslie.db")
    print(f"   View: data/aleabit_manifest.json (+ web 镜像)")


if __name__ == "__main__":
    main()
