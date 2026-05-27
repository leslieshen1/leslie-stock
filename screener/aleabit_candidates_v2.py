"""扩展版粗筛：覆盖所有 AI / 半导体 / 制造 / 材料 / 能源 相关 A 股。

目标：从 5,504 只 A 股里筛出 400-700 只值得跑 LLM 的候选。
剩下 ~4,800 只批量预标 not_aleabit_territory（无 LLM 成本）。

输出：
- data/aleabit_candidates_v2.json — 待 LLM 评估的候选
- data/aleabit_excluded.json — 明显不在射程的批量列表
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent.parent
UNIVERSE = ROOT / "data" / "universe.parquet"

# 扩展关键词（按主题分桶）— 比 v1 宽 4x
THEMES = {
    "Layer4_关键金属（稀有/战略）": [
        # 稀有金属
        r"稀土", r"钨业", r"钨钼", r"锡业", r"钼", r"锗业", r"铟", r"镓", r"钽业", r"铌",
        r"银锡", r"锌锗", r"锂能", r"五矿稀", r"洛阳钼", r"金钼",
        r"华锡", r"驰宏锌", r"东方钽", r"章源钨", r"翔鹭钨", r"江钨", r"厦钨",
        r"中钨", r"赣锋锂", r"天齐锂",
        # 黄金/铜/铝
        r"黄金", r"铜业", r"铝业", r"铅锌", r"白银", r"矿业", r"金属",
        # 镁、钛、钒
        r"镁", r"钛业", r"钒", r"宝钛", r"西部材料",
    ],
    "Layer4_半导体材料": [
        r"硅材料", r"硅片", r"硅产业", r"沪硅", r"光刻胶", r"光刻", r"光罩",
        r"电子气", r"靶材", r"江丰", r"有研新材", r"CMP", r"抛光",
        r"清溢", r"南大光电", r"安集", r"鼎龙", r"雅克", r"晶华微",
        r"硅宝", r"晶瑞电材", r"飞凯材料", r"沪佳",
        r"立昂微", r"中环", r"超声电子", r"上海合晶", r"凯立新材",
        r"瑞华泰", r"派瑞", r"晶导微", r"沃尔核",
    ],
    "Layer3_光通信/激光（CPO 相关）": [
        r"光迅科技", r"中际旭创", r"新易盛", r"华工科技", r"剑桥科技", r"太辰光",
        r"天孚通信", r"光库科技", r"博创科技", r"联特科技", r"亨通光电",
        r"长芯博创", r"长光华芯", r"源杰科技", r"仕佳光子", r"福晶科技",
        r"锐科激光", r"帝尔激光", r"英诺激光", r"联赢激光", r"德龙激光",
        r"光弘科技", r"长飞光纤", r"中天科技", r"光峰科技",
        r"科华", r"光线", r"光库", r"昇辉",
    ],
    "Layer3_机器人核心部件（humanoid）": [
        r"绿的谐波", r"双环传动", r"丰立智能", r"贝斯特", r"五洲新春",
        r"恒立液压", r"汇川技术", r"鸣志电器", r"步科股份", r"昊志机电",
        r"中大力德", r"国茂股份", r"巨轮智能", r"减速器", r"丝杠", r"伺服",
        r"谐波", r"行星滚珠", r"柯力传感", r"奥比中光", r"康斯特",
        r"埃斯顿", r"埃夫特", r"拓斯达", r"克来机电", r"机器人$",
        r"江苏雷利", r"鼎智科技", r"机器人", r"控制", r"自动化", r"工业机器人",
        r"传感器", r"伺服电机",
    ],
    "Layer3_Power semi（SiC/GaN/800VDC）": [
        r"碳化硅", r"三安光电", r"天科合达", r"露笑科技", r"晶盛机电",
        r"斯达半导", r"宏微科技", r"东微半导", r"扬杰科技", r"士兰微",
        r"新洁能", r"华润微", r"时代电气", r"功率半导",
        r"瀚川智能", r"芯导科技", r"派瑞股份", r"功率",
        r"晶圆", r"芯片", r"半导体",
    ],
    "Layer2_HBM/封装/存储": [
        r"长电科技", r"通富微电", r"华天科技", r"甬矽电子", r"晶方科技",
        r"兆易创新", r"北京君正", r"深科技", r"佰维存储", r"江波龙",
        r"澜起科技", r"国芯科技", r"东芯股份", r"普冉股份",
        r"聚辰股份", r"恒玄科技",
        r"存储", r"内存", r"DRAM", r"封测", r"封装",
    ],
    "Layer3_军工/UAV（中国防务）": [
        r"航天彩虹", r"中无人机", r"中航沈飞", r"洪都航空", r"航天电器",
        r"航天电子", r"北斗星通", r"航天发展", r"航天工程", r"中航光电",
        r"中航电测", r"航天宏图", r"中天火箭", r"中航高科",
        r"中兵红箭", r"内蒙一机", r"江龙船艇",
        r"航天", r"航空", r"国防", r"兵器", r"军工", r"舰船", r"导弹",
    ],
    "Layer4_电池/humanoid 化学品": [
        r"天赐材料", r"新宙邦", r"多氟多", r"永太科技", r"江苏国泰",
        r"璞泰来", r"杉杉股份", r"中科电气", r"贝特瑞",
        r"恩捷股份", r"星源材质", r"嘉元科技", r"诺德股份",
        r"电解液", r"隔膜", r"正极", r"负极", r"铜箔", r"电池材料",
    ],
    "Layer3_半导体设备": [
        r"北方华创", r"中微公司", r"盛美上海", r"长川科技", r"华峰测控",
        r"芯源微", r"拓荆科技", r"精测电子", r"华海清科", r"至纯科技",
        r"万业企业", r"晶盛机电",
        r"刻蚀", r"薄膜", r"清洗", r"量测", r"ALD", r"PVD", r"CVD",
    ],
    "Layer4_玻璃基板/CoWoS-S/先进封装": [
        r"沃格光电", r"凯盛科技", r"南玻", r"东旭光电", r"力诺特玻",
        r"福光股份", r"水晶光电", r"玻璃基板",
    ],
    "Layer3_PCB/连接器": [
        r"沪电股份", r"深南电路", r"生益电子", r"鹏鼎控股", r"东山精密",
        r"立讯精密", r"沃尔核材", r"金信诺", r"超华科技", r"PCB", r"连接器",
        r"印制电路",
    ],
    "Layer3_AI 服务器/液冷": [
        r"工业富联", r"浪潮信息", r"中科曙光", r"紫光股份", r"宝信软件",
        r"高澜股份", r"申菱环境", r"英维克", r"液冷", r"数据中心",
        r"服务器",
    ],
    "Layer3_光伏材料（与 AI 数据中心电力相关）": [
        r"通威", r"隆基", r"晶澳", r"天合", r"协鑫", r"福斯特", r"福莱特",
        r"硅料", r"硅烷", r"组件",
    ],
    "Layer3_新能源车/humanoid 共性部件": [
        r"宁德时代", r"比亚迪", r"亿纬锂能", r"国轩高科", r"欣旺达",
        r"先导智能", r"杭可科技", r"动力电池", r"驱动",
    ],
}

# 排除关键词（即使名称匹配上面也要剔除）
EXCLUDE_KWS = [
    r"南方航空", r"东方航空", r"中国国航", r"春秋航空", r"吉祥航空", r"华夏航空",
    r"航空发展",
    r"卫星化学",
    r"航天信息",
    r"硅宝科技$",
]
WHITELIST = ["300024"]

# 明显不在 aleabit 射程的行业关键词（用于批量预标）
NOT_TERRITORY_KWS = [
    # 医药生物
    r"医药", r"药业", r"生物", r"医疗", r"疫苗", r"中药", r"健康",
    r"药", r"医", r"血液", r"血制品", r"基因", r"细胞", r"创新药",
    # 消费品
    r"白酒", r"啤酒", r"葡萄酒", r"乳业", r"调味", r"食品", r"饮料",
    r"零食", r"火腿", r"水产", r"茶", r"奶", r"豆", r"米", r"面",
    r"服装", r"鞋业", r"皮革", r"化妆品", r"日化", r"洗涤",
    r"家具", r"家居", r"建材", r"装饰", r"卫浴",
    # 金融
    r"银行", r"证券", r"保险", r"信托", r"金融", r"租赁",
    # 地产
    r"地产", r"置业", r"控股", r"投资", r"房产", r"商业",
    # 传媒
    r"传媒", r"影视", r"出版", r"广告", r"游戏", r"娱乐", r"动漫", r"院线",
    # 餐饮酒店
    r"酒店", r"餐饮", r"旅游", r"景区",
    # 教育
    r"教育", r"培训", r"出版",
    # 物流
    r"物流", r"快递", r"航运", r"港口", r"高速", r"铁路",
    # 农业
    r"农业", r"林业", r"渔业", r"养殖", r"种业", r"种子", r"饲料", r"化肥", r"农药",
    # 公用事业
    r"水务", r"环保", r"水利", r"燃气", r"热力",
    # 化工（非半导体相关）
    r"化纤", r"塑料", r"橡胶", r"轮胎", r"涂料", r"染料", r"农化",
    # 钢铁
    r"钢铁", r"特钢", r"水泥",
]


def main():
    df = pd.read_parquet(UNIVERSE)
    a = df[df["market"] == "A"].copy()
    a["mcap_yi"] = a["market_cap"] / 1e8
    print(f"A 股总计：{len(a)} 只")

    # 第一步：把所有 A 股都标 mcap_yi
    # 我们要全 5,504 只都进 final，分为 4 类：
    # A. candidates（值得跑 LLM 评估）
    # B. excluded_obvious_non（明显不在射程）
    # C. excluded_micro（市值过小或过大，不在 sweet spot）
    # D. unknown（不在 A/B/C 任何一类，待人工 review）

    # 市值过滤：15-2000 亿 RMB（极宽，覆盖所有大中小盘）
    a_inrange = a[(a["mcap_yi"] >= 15) & (a["mcap_yi"] <= 2000)].copy()
    print(f"市值 15-2000 亿过滤后：{len(a_inrange)} 只")

    excl_pat = re.compile("|".join(EXCLUDE_KWS))
    not_territory_pat = re.compile("|".join(NOT_TERRITORY_KWS))

    candidates: dict[str, dict] = {}
    excluded_non_territory: list[dict] = []

    # 1. 先按 themes 匹配（候选）
    for theme, kws in THEMES.items():
        pat = re.compile("|".join(kws))
        matched = a_inrange[a_inrange["name"].str.contains(pat, na=False, regex=True)]
        for _, row in matched.iterrows():
            code = row["code"]
            name = row["name"]
            if excl_pat.search(name) and code not in WHITELIST:
                continue
            if code not in candidates:
                candidates[code] = {
                    "code": code,
                    "name": name,
                    "market_cap_yi": round(row["mcap_yi"], 1),
                    "pe_ttm": float(row["pe_ttm"]) if pd.notna(row.get("pe_ttm")) else None,
                    "pb": float(row["pb"]) if pd.notna(row.get("pb")) else None,
                    "themes": [theme],
                    "expected_layer": int(theme.split("_")[0][-1]) if "Layer" in theme else 3,
                }
            elif theme not in candidates[code]["themes"]:
                candidates[code]["themes"].append(theme)

    # 2. WHITELIST 强制加入
    for code in WHITELIST:
        if code not in candidates:
            row = a_inrange[a_inrange["code"] == code]
            if len(row) > 0:
                row = row.iloc[0]
                candidates[code] = {
                    "code": code,
                    "name": row["name"],
                    "market_cap_yi": round(row["mcap_yi"], 1),
                    "pe_ttm": float(row["pe_ttm"]) if pd.notna(row.get("pe_ttm")) else None,
                    "pb": float(row["pb"]) if pd.notna(row.get("pb")) else None,
                    "themes": ["whitelist"],
                    "expected_layer": 3,
                }

    candidate_codes = set(candidates.keys())

    # 3. 剩余 A 股按 NOT_TERRITORY_KWS 批量预标
    for _, row in a.iterrows():
        code = row["code"]
        if code in candidate_codes:
            continue
        name = row["name"]
        if not_territory_pat.search(name):
            excluded_non_territory.append({
                "code": code,
                "name": name,
                "market_cap_yi": round(row["mcap_yi"], 1) if pd.notna(row.get("market_cap")) else None,
                "pe_ttm": float(row["pe_ttm"]) if pd.notna(row.get("pe_ttm")) else None,
                "pb": float(row["pb"]) if pd.notna(row.get("pb")) else None,
                "reason": "name matches obvious non-AI territory keywords",
            })

    # 4. 剩下的 = unknown（不在 candidates，也没匹配到 not_territory keywords）
    matched_codes = candidate_codes | {x["code"] for x in excluded_non_territory}
    unknown = a[~a["code"].isin(matched_codes)]
    print()
    print(f"📊 分类结果：")
    print(f"  Candidates (待 LLM 评估)：{len(candidates)} 只")
    print(f"  Excluded (明显不在射程)：{len(excluded_non_territory)} 只")
    print(f"  Unknown (待人工 review)：{len(unknown)} 只")
    print(f"  总和：{len(candidates) + len(excluded_non_territory) + len(unknown)} = {len(a)} ✓")

    # 输出
    cand_path = ROOT / "data" / "aleabit_candidates_v2.json"
    excl_path = ROOT / "data" / "aleabit_excluded.json"
    unknown_path = ROOT / "data" / "aleabit_unknown.json"

    with open(cand_path, "w", encoding="utf-8") as f:
        json.dump(list(candidates.values()), f, ensure_ascii=False, indent=2)
    with open(excl_path, "w", encoding="utf-8") as f:
        json.dump(excluded_non_territory, f, ensure_ascii=False, indent=2)

    unknown_list = []
    for _, row in unknown.iterrows():
        unknown_list.append({
            "code": row["code"],
            "name": row["name"],
            "market_cap_yi": round(row["mcap_yi"], 1) if pd.notna(row.get("market_cap")) else None,
        })
    with open(unknown_path, "w", encoding="utf-8") as f:
        json.dump(unknown_list, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 输出：")
    print(f"  {cand_path}")
    print(f"  {excl_path}")
    print(f"  {unknown_path}")


if __name__ == "__main__":
    main()
