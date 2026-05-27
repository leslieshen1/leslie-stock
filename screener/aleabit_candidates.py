"""按 Serenity / aleabit 框架粗筛 A 股候选 → 输出待 GLM 精分析名单。

Serenity 偏好：
- 市值 sweet spot：$500M-$5B（A 股语境放宽到 30-500 亿 RMB）
- Layer 3-4：关键工艺 / 原材料 chokepoint
- 主战场：AI 光通信、Humanoid 供应链、Power Semi、HBM、关键金属

输出：data/aleabit_candidates.json
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent.parent
UNIVERSE = ROOT / "data" / "universe.parquet"
OUT_PATH = ROOT / "data" / "aleabit_candidates.json"

# 精准关键词（按主题分桶）
# 注意：尽量用细分词（如"减速器"而非"机器人"），避开模糊大词
THEMES = {
    "Layer4_关键金属（稀有/战略）": {
        "kws": [
            r"稀土", r"钨业", r"钨钼", r"锡业", r"钼", r"锗业", r"铟", r"镓", r"钽业", r"铌",
            r"银锡", r"锌锗", r"锂能", r"五矿稀", r"洛阳钼", r"金钼",
            r"华锡", r"驰宏锌", r"东方钽", r"章源钨", r"翔鹭钨", r"江钨", r"厦钨",
            r"中钨", r"赣锋锂", r"天齐锂",
        ],
        "must_layer": 4,
    },
    "Layer4_半导体材料": {
        "kws": [
            r"硅材料", r"硅片", r"硅产业", r"沪硅", r"光刻胶", r"光刻",
            r"电子气", r"靶材", r"江丰", r"有研新材", r"CMP", r"抛光",
            r"清溢", r"南大光电", r"安集", r"鼎龙", r"雅克",
            r"硅宝", r"晶瑞电材", r"飞凯材料", r"晶华微", r"沪佳",
            r"立昂微", r"中环",
        ],
        "must_layer": 4,
    },
    "Layer3_光通信/激光（CPO 相关）": {
        "kws": [
            r"光迅科技", r"中际旭创", r"新易盛", r"华工科技", r"剑桥科技", r"太辰光",
            r"天孚通信", r"光库科技", r"博创科技", r"联特科技", r"亨通光电",
            r"长芯博创", r"长光华芯", r"源杰科技", r"仕佳光子", r"福晶科技",
            r"锐科激光", r"帝尔激光", r"英诺激光", r"联赢激光", r"德龙激光",
            r"光弘科技", r"长飞光纤", r"中天科技", r"光峰科技",
        ],
        "must_layer": 3,
    },
    "Layer3_机器人核心部件（humanoid）": {
        "kws": [
            r"绿的谐波", r"双环传动", r"丰立智能", r"贝斯特", r"五洲新春",
            r"恒立液压", r"汇川技术", r"鸣志电器", r"步科股份", r"昊志机电",
            r"中大力德", r"国茂股份", r"巨轮智能", r"减速器", r"丝杠", r"伺服",
            r"谐波", r"行星滚珠", r"柯力传感", r"奥比中光", r"康斯特",
            r"埃斯顿", r"埃夫特", r"拓斯达", r"克来机电", r"机器人$",
            r"江苏雷利", r"鼎智科技",
        ],
        "must_layer": 3,
    },
    "Layer3_Power semi（SiC/GaN/800VDC）": {
        "kws": [
            r"碳化硅", r"三安光电", r"天科合达", r"露笑科技", r"晶盛机电",
            r"斯达半导", r"宏微科技", r"东微半导", r"扬杰科技", r"士兰微",
            r"新洁能", r"华润微", r"时代电气", r"功率半导",
            r"瀚川智能", r"芯导科技", r"派瑞股份",
        ],
        "must_layer": 3,
    },
    "Layer2_HBM/封装/存储": {
        "kws": [
            r"长电科技", r"通富微电", r"华天科技", r"甬矽电子", r"晶方科技",
            r"兆易创新", r"北京君正", r"深科技", r"佰维存储", r"江波龙",
            r"澜起科技", r"国芯科技", r"东芯股份", r"普冉股份",
            r"聚辰股份", r"恒玄科技",
        ],
        "must_layer": 2,
    },
    "Layer3_军工/UAV（中国防务）": {
        "kws": [
            r"航天彩虹", r"中无人机", r"中航沈飞", r"洪都航空", r"航天电器",
            r"航天电子", r"北斗星通", r"航天发展", r"航天工程", r"中航光电",
            r"中航电测", r"航天宏图", r"中天火箭", r"中航高科",
            r"中兵红箭", r"内蒙一机", r"江龙船艇",
        ],
        "must_layer": 3,
    },
    "Layer4_电池/humanoid 化学品": {
        "kws": [
            r"天赐材料", r"新宙邦", r"多氟多", r"永太科技", r"江苏国泰",
            r"璞泰来", r"杉杉股份", r"中科电气", r"贝特瑞",
            r"恩捷股份", r"星源材质", r"嘉元科技", r"诺德股份",
        ],
        "must_layer": 3,
    },
    "Layer3_半导体设备": {
        "kws": [
            r"北方华创", r"中微公司", r"盛美上海", r"长川科技", r"华峰测控",
            r"芯源微", r"拓荆科技", r"精测电子", r"华海清科", r"至纯科技",
            r"万业企业", r"晶盛机电",
        ],
        "must_layer": 3,
    },
    "Layer4_玻璃基板/CoWoS-S/先进封装": {
        "kws": [
            r"沃格光电", r"凯盛科技", r"南玻", r"东旭光电", r"力诺特玻",
            r"福光股份", r"水晶光电",
        ],
        "must_layer": 4,
    },
}

# 排除关键词（明显误匹配）
EXCLUDE_KWS = [
    r"南方航空", r"东方航空", r"中国国航", r"春秋航空", r"吉祥航空", r"华夏航空",
    r"航空发展", r"卫星化学",   # 化工，非卫星
    r"航天信息",   # 软件，不是 UAV
    r"机器人", # 太泛, 留 "300024 机器人" 单独白名单
]

# 白名单（即使被排除，也加回）
WHITELIST = ["300024"]  # 沈阳新松机器人，A 股工业机器人龙头

def main():
    df = pd.read_parquet(UNIVERSE)
    a = df[df["market"] == "A"].copy()
    a["mcap_yi"] = a["market_cap"] / 1e8

    # 市值过滤：15-1000 亿 RMB（约 $2B-$140B）— 比 aleabit 美股 $500M-$5B sweet spot
    # 略宽，以适应 A 股流动性折扣 + 国资规模偏大的语境
    a = a[(a["mcap_yi"] >= 15) & (a["mcap_yi"] <= 1000)]
    print(f"市值 15-1000 亿过滤后：{len(a)} 只\n")

    candidates: dict[str, dict] = {}
    excl_pat = re.compile("|".join(EXCLUDE_KWS))

    for theme, conf in THEMES.items():
        kws = conf["kws"]
        layer = conf["must_layer"]
        pat = re.compile("|".join(kws))
        matched = a[a["name"].str.contains(pat, na=False, regex=True)]
        for _, row in matched.iterrows():
            code = row["code"]
            name = row["name"]
            # 排除（除非在白名单）
            if excl_pat.search(name) and code not in WHITELIST:
                continue
            # 已有 candidates 就保留更具体的 theme
            if code not in candidates:
                candidates[code] = {
                    "code": code,
                    "name": name,
                    "market_cap_yi": round(row["mcap_yi"], 1),
                    "pe_ttm": row.get("pe_ttm"),
                    "pb": row.get("pb"),
                    "themes": [theme],
                    "expected_layer": layer,
                }
            else:
                if theme not in candidates[code]["themes"]:
                    candidates[code]["themes"].append(theme)

    # 把白名单中没匹配上的强制加入
    for code in WHITELIST:
        if code not in candidates:
            row = a[a["code"] == code]
            if len(row) > 0:
                row = row.iloc[0]
                candidates[code] = {
                    "code": code,
                    "name": row["name"],
                    "market_cap_yi": round(row["mcap_yi"], 1),
                    "pe_ttm": row.get("pe_ttm"),
                    "pb": row.get("pb"),
                    "themes": ["whitelist"],
                    "expected_layer": 3,
                }

    print(f"精筛后候选：{len(candidates)} 只\n")

    # 按 theme 分组打印
    by_theme: dict[str, list] = {}
    for c in candidates.values():
        for t in c["themes"]:
            by_theme.setdefault(t, []).append(c)

    for theme in THEMES.keys():
        lst = by_theme.get(theme, [])
        lst.sort(key=lambda x: -(x["market_cap_yi"] or 0))
        print(f"=== {theme}（{len(lst)} 只）===")
        for c in lst:
            pe = c["pe_ttm"]
            pe_str = f"PE {pe:>5.1f}" if pe and pe > 0 else "PE   —  "
            print(f"  {c['code']}  {c['name']:<10}  {c['market_cap_yi']:>6.1f} 亿  {pe_str}")
        print()

    OUT_PATH.parent.mkdir(exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        # JSON 不能直接 dump Series，做下转换
        clean = {}
        for code, c in candidates.items():
            clean[code] = {
                **c,
                "pe_ttm": float(c["pe_ttm"]) if pd.notna(c.get("pe_ttm")) else None,
                "pb": float(c["pb"]) if pd.notna(c.get("pb")) else None,
            }
        json.dump(list(clean.values()), f, ensure_ascii=False, indent=2)
    print(f"\n✅ 候选写入 {OUT_PATH}")


if __name__ == "__main__":
    main()
