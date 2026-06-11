"""从 aleabit_manifest.json 生成 pulse heatmap supplement。

策略：
- 取 score >= 50 且 verdict != not_aleabit_territory 的公司
- 智能归类到 industry（一个公司可多 tag）
- 智能归类到 Layer (L0-L7)
- 用 bottleneck_score 作为合成 heat 的代理（valuation/momentum/rsi/sentiment 都用同值）

输出：web/public/data/pulse-supplement.json
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
MANIFEST = ROOT / "data" / "aleabit_manifest.json"
OUT = ROOT / "web" / "public" / "data" / "pulse-supplement.json"


# 现有 COMPANIES 里已有的 ticker（避免重复）
def existing_tickers() -> set[str]:
    sc = ROOT / "web" / "src" / "lib" / "supply-chain.ts"
    txt = sc.read_text()
    return set(re.findall(r'c\("([^"]+)"', txt))


# Industry 关键词分类（一个公司可属多个 industry）
def classify_industries(name: str, thesis: str, layer_label: str, sector: str) -> list[str]:
    text = f"{name} {thesis} {layer_label} {sector}".lower()
    industries: list[str] = []

    # AI（AI 算力供应链）— 之前缺这个分类,导致 AI 相关标的全被漏掉
    if any(k in text for k in [
        "ai 芯片", "ai芯片", "gpu", "asic", "fpga", "hbm", "算力", "数据中心",
        "光模块", "光通信", "光器件", "cpo", "半导体", "晶圆", "封装", "封测",
        "服务器", "pcb", "ccl", "覆铜板", "交换机", "液冷", "eda", "存储",
        "ddr", "nand", "大模型", "推理", "cuda", "neocloud", "hyperscaler",
        "加速计算", "compute", "accelerat", "foundry", "semiconductor", "memory",
        "ai 应用", "ai算力", "data center", "电子特气", "光刻", "刻蚀", "硅片",
    ]):
        industries.append("AI")

    # humanoid（人形机器人）
    if any(k in text for k in [
        "humanoid", "机器人", "减速器", "丝杠", "伺服", "灵巧手",
        "稀土永磁", "钕铁硼", "谐波", "传感器", "电机控制",
        "humanoid 供应链", "人形",
    ]):
        industries.append("humanoid")

    # defense（国防/军工）
    if any(k in text for k in [
        "军工", "军用", "国防", "航发", "航天", "航空",
        "导弹", "雷达", "隐身", "uav", "无人机", "导航",
        "兵器", "舰", "潜艇", "战机", "总装", "imu",
        "惯导", "北斗", "特种 ic", "钽电容", "民爆",
        "信道模拟", "微波", "毫米波", "t/r", "射频前端",
    ]):
        industries.append("defense")

    # rare-metals（稀有/战略金属）
    if any(k in text for k in [
        "稀土", "锗", "锡", "钨", "钽", "铟", "镓",
        "钼", "铂", "铂族", "锌锗", "银锡", "黄金",
        "白银", "矿业", "稀有金属", "战略金属", "出口管制",
        "铜钴", "钴镍", "钒钛", "锆", "海绵锆", "金属粉",
    ]):
        industries.append("rare-metals")

    # biotech（生物医药）
    if any(k in text for k in [
        "医药", "创新药", "cro", "cdmo", "api",
        "医械", "诊断", "ivd", "疫苗", "试剂",
        "培养基", "adc", "mrna", "蛋白", "抗体",
        "原料药", "造影剂", "血制品", "血浆",
        "麻精", "甾体", "细胞", "外泌", "测序",
        "影像", "x 射线", "超声", "内窥镜", "植入",
        "聚乳酸", "p eek", "pla", "微球", "酶",
    ]):
        industries.append("biotech")

    return industries


# Layer 智能归类（基于 thesis / layer_label / sector）
def classify_layer(layer_num, layer_label: str, thesis: str, name: str, default: str = "L1") -> str:
    text = f"{name} {thesis} {layer_label}".lower()

    # L0 能源底座
    if any(k in text for k in [
        "核电", "核聚变", "smr", "燃气轮机", "电力", "电网",
        "ups", "hvdc", "储能", "氢能", "锂电铜箔", "电源管理",
        "数据中心电源", "ai 数据中心电力", "变压器", "数据中心 ups",
    ]):
        return "L0"

    # L1 EDA / 设备 / 材料
    if any(k in text for k in [
        "eda", "光刻", "刻蚀", "沉积", "量测", "靶材",
        "光刻胶", "电子特气", "湿电子化学品", "抛光",
        "硅片", "硅微粉", "石英", "靶材", "陶瓷",
        "半导体材料", "高纯", "前驱体", "微粉", "粉体",
        "稀土", "锡矿", "钨", "钽", "锗", "铟", "镓",
        "金属", "矿业", "稀有金属", "光学塑料", "coc",
        "氟化", "制冷剂", "光稳定剂",
    ]):
        return "L1"

    # L2 晶圆 / 封装 / HBM / 存储
    if any(k in text for k in [
        "封装", "cowos", "hbm", "晶圆代工", "晶圆", "封测",
        "存储", "ddr5", "cxl", "nor flash", "nand", "ssd",
        "ic 载板", "引线框架", "焊膜", "电子玻纤布",
    ]):
        return "L2"

    # L3 AI 芯片
    if any(k in text for k in [
        "gpu", "ai 芯片", "asic", "fpga", "soc", "cpu",
        "信号链", "模拟芯片", "射频芯片", "传感器芯片",
        "mcu", "存储主控", "cmos", "图像传感器",
    ]):
        return "L3"

    # L4 数据中心基建 / 服务器 / 光模块
    if any(k in text for k in [
        "服务器", "pcb", "光模块", "光器件", "光通信",
        "光纤", "液冷", "idc", "数据中心", "交换机",
        "网络", "电源 psu", "ai 服务器",
        "高速连接器", "ccl", "覆铜板",
    ]):
        return "L4"

    # L5 云 / 模型 / 数据
    if any(k in text for k in [
        "hyperscaler", "云服务", "数据库", "中间件",
        "信创 os", "数据集",
    ]):
        return "L5"

    # L6 AI 应用
    if any(k in text for k in [
        "ai 应用", "saas", "自动驾驶", "agent",
        "工业软件", "医疗 ai", "ai 算力一体机",
    ]):
        return "L6"

    # L7 端侧 / 入口（机器人 / 手机 / 眼镜）
    if any(k in text for k in [
        "机器人", "humanoid", "减速器", "丝杠",
        "伺服", "灵巧手", "ar/vr", "光波导",
        "手机", "智能终端", "汽车电子",
    ]):
        return "L7"

    # fallback by layer_num
    if layer_num == 1: return "L3"
    if layer_num == 2: return "L2"
    if layer_num == 3: return "L1"
    if layer_num == 4: return "L1"
    return default


US_ANALYSES = ROOT / "web" / "public" / "data" / "us-analyses.json"
IMAP = ROOT / "web" / "public" / "data" / "industry-map.json"


def load_placement() -> dict:
    """industry-map.json 的 placement = 每只票属于哪些产业链(权威归类源)。"""
    if not IMAP.exists():
        return {}
    return json.load(open(IMAP, encoding="utf-8")).get("placement", {})


def composite_score(panel: dict):
    vals = [m.get("score") for m in panel.values()
            if isinstance(m, dict) and isinstance(m.get("score"), (int, float))]
    return round(sum(vals) / len(vals)) if vals else None


def build_us_entries(existing: set, placement: dict) -> list:
    """把已五方分析、且属于某条产业链(industry-map)的美股补进热力图(银行/零售等不进)。"""
    if not US_ANALYSES.exists():
        return []
    data = json.load(open(US_ANALYSES, encoding="utf-8")).get("stocks", {})
    out = []
    for sym, v in data.items():
        if sym in existing:
            continue
        industries = list(placement.get(sym, {}).keys())
        if not industries:
            continue  # 不属于任何链的美股(银行/零售…)→ 留在 List,不进产业链图
        chain = v.get("chain") or {}
        name = v.get("name", sym)
        tier = chain.get("layer", "")
        tier_l = "L1" if "上游" in tier else "L3" if "中游" in tier else "L5" if "下游" in tier else "L4"
        layer = classify_layer(None, "", f"{chain.get('industry','')} {chain.get('role','')}", name, default=tier_l)
        # AI 标签:placement 没有 AI 链,用关键词分类补(美股半导体/光模块/服务器等进 AI 链)
        if "AI" in classify_industries(name, f"{chain.get('industry','')} {chain.get('role','')}", "", v.get("sector", "")):
            industries = sorted(set(industries) | {"AI"})
        score = composite_score(v.get("panel") or {}) or 60
        mcap = min(max(v.get("mcapB") or 1, 0.5), 4000)
        out.append({
            "ticker": sym, "name": name, "layer": layer,
            "segment": (chain.get("industry", "") or "")[:40], "region": "US",
            "marketCapB": round(mcap, 1),
            "moat": min(5, max(3, score // 20 + 1)),
            "valuationPct": score, "momentum20d": score,
            "rsi": min(80, max(40, score)), "sentiment": score,
            "industries": industries, "_serenity_score": score,
            "_verdict": "", "_thesis": (chain.get("role", "") or "")[:120],
        })
    return out


def main():
    if not MANIFEST.exists():
        print(f"❌ {MANIFEST} 不存在")
        return

    with open(MANIFEST, encoding="utf-8") as f:
        items = json.load(f)

    existing = existing_tickers()
    placement = load_placement()
    print(f"现有 supply-chain.ts 中已有 {len(existing)} 个 ticker · industry-map 放置 {len(placement)} 只")

    # 过滤：score >= 50 且 verdict != not_aleabit_territory 且 ticker 不重复
    kept = []
    skipped_existing = 0
    skipped_low_score = 0
    skipped_no_industry = 0

    for it in items:
        score = it.get("score", 0)
        verdict = it.get("verdict", "")
        if score < 50 or verdict == "not_aleabit_territory":
            skipped_low_score += 1
            continue
        code = it["code"]
        if code in existing:
            skipped_existing += 1
            continue

        # 归类 industry:industry-map 权威 placement ∪ 关键词分类(后者负责 "AI" 标签 ——
        # placement 没有 AI 链,只用它会把 AI 标签全丢光,AI 链一度只剩 119,2026-06-11 踩过)
        classified = classify_industries(it.get("name", ""), it.get("thesis", ""),
                                         it.get("layer_label", ""), it.get("sector", ""))
        industries = sorted(set(placement.get(code, {}).keys()) | set(classified))
        if not industries:
            skipped_no_industry += 1
            continue

        # 归类 layer
        layer = classify_layer(
            it.get("layer"),
            it.get("layer_label", ""),
            it.get("thesis", ""),
            it.get("name", ""),
        )

        # market_cap 转 USD billion（粗略 1 USD = 7.2 RMB）
        mcap_yi = it.get("market_cap_yi") or 0
        mcap_b = round(mcap_yi / 7.2 / 10, 1)  # 亿 RMB → $B

        kept.append({
            "ticker": code,
            "name": it.get("name", code),
            "layer": layer,
            "segment": it.get("layer_label", "").split("—")[-1].strip() or it.get("sector", ""),
            "region": "CN" if it["market"] == "a" else "HK" if it["market"] == "hk" else "US",
            "marketCapB": max(mcap_b, 0.5),  # 至少 $0.5B 避免太小
            "moat": min(5, max(3, score // 20 + 1)),  # score 60-79 → 4, 80+ → 5, 50-59 → 3
            # 用 score 同值填充各维度 → heat ≈ score
            "valuationPct": score,
            "momentum20d": score,
            "rsi": min(80, max(40, score)),
            "sentiment": score,
            # 标签
            "industries": industries,
            "_serenity_score": score,
            "_verdict": verdict,
            "_thesis": (it.get("thesis", "")[:120]),
        })

    # 补美股(已五方 + 属于某条链)
    us_entries = build_us_entries(existing | {k["ticker"] for k in kept}, placement)
    kept.extend(us_entries)

    print(f"\n过滤后：")
    print(f"  A股保留：{len(kept) - len(us_entries)} 只 + 美股补充：{len(us_entries)} 只")
    print(f"  保留：{len(kept)} 只")
    print(f"  跳过（已在 COMPANIES）：{skipped_existing}")
    print(f"  跳过（分数 < 50 或 not_territory）：{skipped_low_score}")
    print(f"  跳过（未归到任何 industry）：{skipped_no_industry}")
    print()

    # Industry 分布
    from collections import Counter
    ind_count = Counter()
    layer_count = Counter()
    for k in kept:
        for ind in k["industries"]:
            ind_count[ind] += 1
        layer_count[k["layer"]] += 1

    print(f"Industry 分布：")
    for ind, n in ind_count.most_common():
        print(f"  {ind}: {n}")
    print()
    print(f"Layer 分布：")
    for layer, n in sorted(layer_count.items()):
        print(f"  {layer}: {n}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(kept, f, ensure_ascii=False, indent=1)

    print(f"\n✅ 写入 {OUT}")
    print(f"   {len(kept)} 只公司，{OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
