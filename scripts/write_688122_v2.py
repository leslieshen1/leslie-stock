"""688122 西部超导 v2 — 用年报 + 卖方研报 verified 数据重写 thesis。

v1 (82) thesis 太单薄（"高确信度"无细节）。v2 保持 82 分但 thesis 完全重写：
- ITER 国内唯一商业化 NbTi 全流程独家（真 chokepoint）
- 2026 是核聚变工程化拐点年（13 亿招标 + ITER 交付节点 + BEST 供货）
- 但 timing 风险：2025 H2 急剧失速 + 业绩 miss 民生预期 25%
- 控股股东减持 0.96%（soft negative）
- 等 Q1/Q2 2026 财报验证再考虑加分

数据源：
- 2025 年报 (1225162778.pdf, 228K chars)
- 业绩快报 2026-02-28 (1224987022.pdf)
- 减持公告 2026-04-15 (1225101381.pdf)
- 民生证券 2025-08 半年报点评
- 华源证券 2025 首次覆盖增持
- WebSearch findings
"""
from __future__ import annotations

import json
from datetime import datetime

from db import connect


THESIS_V2 = """\
中国唯一商业化 NbTi 低温超导线材供应商，国际上唯一 NbTi 锭棒 + 线材 + 磁体全流程企业 — Serenity Layer 4 真 chokepoint。但 2025 H2 急剧失速 + 业绩 miss 卖方预期 25%，timing 风险显著。

【三大业务结构（2025 年报 verified）】
• 高端钛合金 27.93 亿（56.3%）· +1.48% · 毛利 39.95%（+1.28pp）· 销量 8,070 吨 · 军机航空主导
• 超导产品 15.99 亿（32.2%）· +22.70% · 毛利 28.27%（-1.95pp）· 销量 2,909 吨（+24.13%）· ITER + 半导体 MCZ + MRI
• 高性能高温合金 5.71 亿（11.5%）· +74.65% 🔥 · 毛利 23.64%（+1.39pp）· 销量 2,317 吨（+93.35%）· 航空发动机

【核聚变 chokepoint 实锤】
• ITER 国际热核聚变实验堆 NbTi 超导线材唯一国内供应商
• CRAFT（聚变堆主机关键系统综合研究设施）已交付
• BEST 聚变项目批量供货中（2025 H2 进入）
• 单根长度 9 万米多芯 NbTi 超导线材（性能达 ITER 要求）
• MCZ 超导磁体已 export 韩国、芬兰半导体项目（出口管制下还能出货）
• 磁悬浮 400 米跑道 700 km/h 世界纪录用其超导磁体

【2026 拐点 catalysts】
• 2025-12 落地 13 亿核聚变平台招标（"板块爆发直接催化剂"）
• 2026 ITER 项目核心部件交付节点
• 定增项目：钛合金产能 → 1 万吨（vs 2025 销量 8,070 吨）· 高温合金产能 → 6,000 吨（vs 2025 销量 2,317 吨，+159% 空间）
• 卖方一致预期 2026 营收 +31% / 归母净利 +40%+

【⚠️ Timing 风险（决定 v2 不加分的原因）】
• 2025 H1 归母净利 +56.72% → 全年 +4.95% → **H2 急剧失速**
• 2025 全年扣非净利润 -3.42%（营收 +13.55% 但利润倒退 → 价格端被压）
• 业绩快报 miss 民生预期 25%（实际 8.4 亿 vs 预测 11.32 亿）
• 控股股东西北有色院减持 0.96%（2026-05-11 起）— 软利空但 insider sell 信号
• 钛合金（56% 大头）+1.48% 几乎停滞 — 军机需求节奏不稳
• 境外营收 -16.22% + 境外毛利率仅 4.95%（出口管制 + 价格战）

【待 verify 的关键 metrics（决定 v3 加分还是减分）】
• Q1/Q2 2026 财报：H2 失速是周期性回调还是趋势性？
• 13 亿核聚变招标中标份额 + 单价
• 定增扩产到位时间表 + 客户认证进度
• 钛合金军机需求是否回暖
• 海绵钛原材料价格趋势（成本占钛合金成本 59.4%）

【估值锚】
当前 428 亿市值，2025 PE ~51 / PB ~6 / ROE 12.17%（持平）。卖方 2026 PE 24-29X。不是印钞机 ROE 水平，但有 2026 拐点期权。"""


SIGNALS_V2 = [
    {"name": "L4 chokepoint", "hit": True, "evidence": "ITER 国内唯一 + NbTi 全流程国际独家（公司明确披露）"},
    {"name": "技术壁垒", "hit": True, "evidence": "张平祥院士团队 + 单根 9 万米 NbTi 多芯线 + Nb3Sn 12T 4.2K 临界电流密度 3000A/mm² 国际领先"},
    {"name": "下游验证", "hit": True, "evidence": "CRAFT 已交付 + BEST 批量供货 + MCZ 出口韩国/芬兰 + 磁悬浮 700 km/h 世界纪录"},
    {"name": "2026 拐点 catalysts", "hit": True, "evidence": "12 月 13 亿核聚变招标 + ITER 交付节点 + 定增钛合金 1 万吨 / 高温合金 6,000 吨"},
    {"name": "双增长引擎", "hit": True, "evidence": "超导销量 +24% + 高温合金销量 +93%（年报披露）"},
    {"name": "业绩兑现节奏", "hit": False, "evidence": "❌ 2025 H2 急剧失速（H1 +56% → 年 +4.95%）+ 业绩快报 miss 民生预期 25%"},
]


RED_FLAGS_V2 = [
    "2025 H2 急剧失速：H1 归母 +56.72% → 全年 +4.95%，原因未充分披露",
    "扣非净利润 -3.42%（vs 营收 +13.55%）— 真实经营利润倒退，价格端被压",
    "miss 卖方预期 25%（实际 8.4 亿 vs 民生预测 11.32 亿）",
    "控股股东西北有色院减持 0.96%（2026-05-11 启动）— 软 insider sell 信号",
    "钛合金占大头 56% 但增速仅 +1.48% — 军机需求节奏不稳",
    "境外营收 -16.22% 且毛利率仅 4.95% — 出口管制 + 价格战双杀",
    "ROE 12.17%（持平）— 不是 Serenity 该爱的『印钞机』水平，是『卷的 chokepoint』",
    "客户集中度高（前 5 大占比高）但未披露名（军工保密），需求节奏不可独立验证",
]


def main():
    code, market = "688122", "a"

    with connect(readonly=False) as conn:
        stock = conn.execute(
            "SELECT id FROM stocks WHERE code=? AND market=?", (code, market)
        ).fetchone()
        if not stock:
            print(f"❌ {code}/{market} 不在 DB")
            return
        stock_id = stock["id"]

        existing = conn.execute("""
            SELECT id FROM analyses
            WHERE stock_id=? AND framework='serenity' AND version='v2'
        """, (stock_id,)).fetchone()

        if existing:
            print(f"⚠ v2 已存在 (id={existing['id']})，删除后重写...")
            conn.execute("DELETE FROM analyses WHERE id=?", (existing["id"],))

        now = datetime.now().isoformat()
        cur = conn.execute("""
            INSERT INTO analyses (
                stock_id, framework, version, score, verdict_label,
                layer, layer_label, thesis, signals, signals_hit,
                red_flags, model, prompt_hash, pre_labeled, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            stock_id,
            "serenity",
            "v2",
            82,  # 持平 v1，但 thesis 完全重写
            "🎯 ITER 唯一商业化 NbTi 衬底 — 2026 拐点年但 H2 已失速",
            4,
            "Layer 4 — 低温超导（核聚变 + 半导体 + MRI · 真 chokepoint · 但 timing 风险）",
            THESIS_V2,
            json.dumps(SIGNALS_V2, ensure_ascii=False),
            sum(1 for s in SIGNALS_V2 if s["hit"]),
            json.dumps(RED_FLAGS_V2, ensure_ascii=False),
            "claude-sonnet-4.5",
            "manual_v2_verified_2026_05_28",
            0,
            now,
        ))
        analysis_id = cur.lastrowid
        conn.commit()

        print(f"✅ 688122 v2 写入 (id={analysis_id})")
        print(f"   score 82（vs v1 82 持平，thesis 完全重写）")
        print(f"   signals_hit: {sum(1 for s in SIGNALS_V2 if s['hit'])}/{len(SIGNALS_V2)}")
        print(f"   red_flags: {len(RED_FLAGS_V2)} 条")

        print("\n当前 688122 评分版本:")
        rows = conn.execute("""
            SELECT version, score, verdict_label, created_at
            FROM analyses WHERE stock_id=? AND framework='serenity'
            ORDER BY created_at
        """, (stock_id,)).fetchall()
        for r in rows:
            d = dict(r)
            print(f"  {d['version']:<4} {d['score']:>3}  {d['verdict_label'][:60]}  {d['created_at'][:10]}")


if __name__ == "__main__":
    main()
