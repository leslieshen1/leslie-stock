"""002428 云南锗业 v4 — 用 verified 公告数据重写 thesis。

校正 v3 里的 shallow claims：
- ❌ 6 英寸良率 70%+ → 公司公告未披露具体数字（"逐步提升"）
- ❌ 订单排到 2027 → 公司从未披露订单期限
- ❌ 客户华为 + 中际旭创 → 公司从未具体披露客户名
- ⚠️ 15→45 万片已扩产 → 实际 2026-04 才开工，18 个月（2027-10 完工）

新增 verified 数据（from 公告 PDF）：
- ✅ 2026-04 启动「高品质磷化铟单晶片建设项目」，新增 30 万片，2027-10 完工
- ✅ 鑫耀 2024 亏损 3,242 万 → 2025 1-9 月盈利 1,960 万（拐点）
- ✅ 鑫耀股权激励 50 人（含董事陈飞宏），2025-2027 业绩对赌
- ✅ 2025-02-04 商务部对 InP 出口管制
- ✅ Omdia/Yole 报告：InP 缺口 70%+（投资者引用，公司未否认）
- ✅ 同步在做砷化镓 70 万片 6 寸扩建（湖北黄冈新厂）
- ✅ 2025 实产 InP 10.01 万片 / 2026 计划 18 万片

数据源（巨潮公告）：
- 2025 年报 (1225152695.pdf, 183K chars)
- 股权激励暨增资公告 (1224776533.pdf)
- 子公司增资公告 (1224776528.pdf)
- IR 记录 2026-05-11 (1225291589.pdf)
- IR 记录 2026-05-13 业绩说明会 (1225304445.pdf)
"""
from __future__ import annotations

import json
from datetime import datetime

from db import connect


THESIS_V4 = """\
中国唯一规模化量产 InP（磷化铟）衬底（子公司云南鑫耀），AI 光通信卡脖子环节 A 股唯一纯标。

【官方公告 verified】
• 现产能 15 万片/年（2-4 英寸）；2025 实产 10.01 万片；2026 计划 18 万片（2-6 寸，以 3-4 寸为主）。
• 2026-04 启动「高品质磷化铟单晶片建设项目」，新增 30 万片/年（含 6000 片 6 寸），18 月建设期，2027-10 完工后达 45 万片/年（4 寸折算）。
• 鑫耀财务拐点：2024 全年亏损 3,242 万 → 2025 1-9 月盈利 1,960 万（已超去年全年扭亏）。
• 鑫耀股权激励 50 人（含上市公司董事陈飞宏），授予价 1.37 元/注册资本，锁定 6 年，2025-2027 业绩对赌。
• 2025-02-04 商务部 + 海关总署对 InP 实施出口管制，公司按规定办理许可方可出口。
• 同步在做砷化镓 70 万片 6 寸生产线（湖北黄冈新厂），2025-11 已设立控股孙公司。

【市场背景（公司 IR 引用）】
• Omdia/Yole 报告：InP 全球供需缺口 70%+（投资者业绩说明会原话引用，公司未否认）。
• 全球竞争格局：日本住友 + 美国 AXT + JX 日矿日石 + 德国费里伯格四家国际厂商，国内除鑫耀外公司明确指出无其他规模化竞争对手。

【待 verify（公司公告未具体披露）】
• 客户名（华为 / 中际旭创 / 光迅）— 公司只说"批量化向下游客户供货"。
• 6 寸良率具体数字 — 公司只说"良率逐步提升"。
• 国际三巨头垄断份额 90%+ — 公司只说"国际知名企业"。
• 订单 backlog 期限 — 公司从未披露订单覆盖期。

【估值锚】
当前 585 亿市值，PB 39.8（极高）。化合物半导体材料业务占比待年报营收拆分核算，但锗系列 + InP 双引擎且 InP 处于产能爬坡 + 业绩拐点初期。市场仍按"锗资源股 + 概念股"定价，未充分计入 2027 年 45 万片满产后 InP 主营贡献。"""


SIGNALS_V4 = [
    {"name": "L4 chokepoint", "hit": True, "evidence": "InP 衬底 = AI 800G/1.6T DFB/EML 激光器底层材料，国内除鑫耀无规模化替代"},
    {"name": "产能扩张可验证", "hit": True, "evidence": "2026-04 启动 30 万片项目（公告 2025-058 + IR 2026-05-11），18 月建设期"},
    {"name": "财务拐点", "hit": True, "evidence": "鑫耀 2024 亏 3,242 万 → 2025 1-9 月盈利 1,960 万（公告 2025-060 披露）"},
    {"name": "国家战略", "hit": True, "evidence": "2025-02-04 商务部对 InP 出口管制（年报披露）"},
    {"name": "管理层 skin in the game", "hit": True, "evidence": "鑫耀股权激励 50 人含上市公司董事陈飞宏，6 年锁定 + 2025-2027 对赌"},
    {"name": "全球缺口", "hit": True, "evidence": "Omdia/Yole 70%+ 缺口（业绩说明会投资者引用，公司未否认）"},
]


RED_FLAGS_V4 = [
    "PB 39.8 极高估值，已部分 price in 预期",
    "InP 良率具体数字未披露，扩产爬坡是否顺利不可独立验证",
    "客户名未披露，无法 cross-check 下游需求强度",
    "扩产项目 18 月建设期 + 客户认证数月-1 年，2027-10 完工后到实际放量再有时滞",
    "出口管制双刃剑：保护国内但限制海外（日韩台陆光模块需求）",
    "鑫耀股权激励仅占 0.9237%，激励力度有限",
    "化合物半导体材料业务在 2025 年报营收占比仍偏小（占比待精确核算）",
]


def main():
    code, market = "002428", "a"

    with connect(readonly=False) as conn:
        stock = conn.execute(
            "SELECT id FROM stocks WHERE code=? AND market=?", (code, market)
        ).fetchone()
        if not stock:
            print(f"❌ {code}/{market} 不在 DB")
            return
        stock_id = stock["id"]

        # 检查 v4 是否已存在
        existing = conn.execute("""
            SELECT id FROM analyses
            WHERE stock_id=? AND framework='serenity' AND version='v4'
        """, (stock_id,)).fetchone()

        if existing:
            print(f"⚠ v4 已存在 (id={existing['id']})，删除后重写...")
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
            "v4",
            90,  # 微降 2 分（去掉了 shallow claims 的过度乐观）
            "🎯🏆 中国版 $AXTI · InP 衬底 — 鑫耀拐点已确认 + 30 万片扩产中",
            4,
            "Layer 4 — 磷化铟衬底（A 股唯一规模化纯标 · 鑫耀业绩拐点 + 2027-10 达 45 万片）",
            THESIS_V4,
            json.dumps(SIGNALS_V4, ensure_ascii=False),
            sum(1 for s in SIGNALS_V4 if s["hit"]),
            json.dumps(RED_FLAGS_V4, ensure_ascii=False),
            "claude-sonnet-4.5",  # 数据是 LLM-aided extraction from 公告
            "manual_v4_verified_2026_05_28",
            0,
            now,
        ))
        analysis_id = cur.lastrowid
        conn.commit()

        print(f"✅ v4 写入 (id={analysis_id})")
        print(f"   score 90（vs v3 92，微降 2 分去掉 shallow claims 的过度乐观）")
        print(f"   signals_hit: {sum(1 for s in SIGNALS_V4 if s['hit'])}/6")
        print(f"   red_flags: {len(RED_FLAGS_V4)} 条")

        # 列出当前所有版本
        print("\n当前 002428 评分版本:")
        rows = conn.execute("""
            SELECT version, score, verdict_label, created_at
            FROM analyses WHERE stock_id=? AND framework='serenity'
            ORDER BY created_at
        """, (stock_id,)).fetchall()
        for r in rows:
            d = dict(r)
            print(f"  {d['version']:<4} {d['score']:>3}  {d['verdict_label'][:55]}  {d['created_at'][:10]}")


if __name__ == "__main__":
    main()
