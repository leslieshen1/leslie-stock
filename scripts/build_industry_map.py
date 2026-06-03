"""数据驱动的产业链地图。读 us-analyses(美股五方)+ aleabit_manifest(A股),
把每只已分析的票按关键词归类到「产业 + 该产业的层级」,产出 industry-map.json:

  { "industries": [{id,name,desc,layers:[{id,name,summary}]}...],
    "placement": { ticker: { industryId: layerId } } }

热力图前端读它来:画产业 tab、画每条链的层级、把节点摆进对应层。
加新大类 = 在 CHAINS 配置里加一条(含 layers + 关键词),重跑即可。

现有 4 条链(humanoid/defense/rare-metals/biotech)的手工摆放从 industry-chains.ts
继承为「种子」(质量高、不被覆盖),其余由关键词自动归类。AI 链不在这里(用 L0-L7)。

用法: python scripts/build_industry_map.py
"""
from __future__ import annotations
import json, re
from pathlib import Path

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
US = PUB / "us-analyses.json"
MANIFEST = PUB / "aleabit_manifest.json"
TS = ROOT / "web" / "src" / "lib" / "industry-chains.ts"
OUT = PUB / "industry-map.json"


# ============================================================
# 产业链配置:每条链 = {name, desc, kw(入链关键词), layers:[{id,name,summary,kw}]}
# layers 顺序 = 上游→下游;kw 命中第一个 layer 即归该层,都不中归 default(最后给的兜底层)
# ============================================================
CHAINS: dict = {
    "rare-metals": {
        "name": "稀有 / 战略金属", "desc": "矿山 → 冶炼 → 深加工 → 应用",
        "kw": ["稀土", "锗", "锡矿", "钨", "钽", "铟", "镓", "钼", "铂", "铂族", "黄金", "白银",
               "稀有金属", "战略金属", "小金属", "钴", "镍", "锂矿", "矿业", "有色", "贵金属"],
        "layers": [
            {"id": "RM-U", "name": "上游 · 矿山", "summary": "稀土/锗/钨/锡/钼/铜钴/金 资源",
             "kw": ["矿", "矿业", "矿山", "采选", "资源", "开采"]},
            {"id": "RM-M", "name": "中游 · 冶炼提纯", "summary": "粗炼→高纯",
             "kw": ["冶炼", "提纯", "高纯", "电解", "湿法", "火法", "锌锗", "钴业"]},
            {"id": "RM-D", "name": "下游 · 深加工", "summary": "合金/化合物/单晶/衬底/靶材",
             "kw": ["合金", "化合物", "单晶", "衬底", "靶材", "深加工", "磁材", "永磁", "粉末", "inp", "磷化铟"]},
            {"id": "RM-A", "name": "应用 · 终端", "summary": "光通信衬底/红外/MRI/航发",
             "kw": ["光通信", "红外", "mri", "航发", "永磁电机"]},
        ],
        "default": "RM-D",
    },
    "humanoid": {
        "name": "人形机器人", "desc": "永磁 → 减速器 → 丝杠 → 伺服 → 传感器 → 整机",
        "kw": ["humanoid", "人形", "机器人", "减速器", "丝杠", "伺服", "灵巧手", "谐波",
               "rv 减速", "无框电机", "六维力", "optimus", "执行器"],
        "layers": [
            {"id": "HM-1", "name": "永磁材料", "summary": "钕铁硼/烧结永磁",
             "kw": ["永磁", "钕铁硼", "磁材", "稀土永磁"]},
            {"id": "HM-2", "name": "减速器", "summary": "谐波 + RV",
             "kw": ["减速器", "谐波", "rv 减速", "齿轮"]},
            {"id": "HM-3", "name": "丝杠 · 关节", "summary": "行星滚柱丝杠/关节模组",
             "kw": ["丝杠", "滚柱", "关节", "执行器", "模组"]},
            {"id": "HM-4", "name": "伺服 · 电机", "summary": "无框力矩/直驱电机 + 驱动器",
             "kw": ["伺服", "无框", "力矩电机", "直驱", "电机", "驱动器"]},
            {"id": "HM-5", "name": "传感器", "summary": "六维力/视觉/IMU/触觉",
             "kw": ["六维力", "传感器", "视觉", "imu", "触觉", "3d 视觉", "结构光"]},
            {"id": "HM-6", "name": "整机 · 总成", "summary": "Tesla/Figure/优必选",
             "kw": ["整机", "总成", "optimus", "人形机器人本体", "本体"]},
        ],
        "default": "HM-4",
    },
    "defense": {
        "name": "国防 / 军工", "desc": "特材 → 航发 → 军用电子 → 武器 → 整机",
        "kw": ["军工", "军用", "国防", "航发", "航天", "航空", "导弹", "雷达", "隐身", "无人机",
               "uav", "兵器", "舰", "潜艇", "战机", "总装", "惯导", "北斗", "民爆", "含能", "军品"],
        "layers": [
            {"id": "DF-M", "name": "特种材料", "summary": "钛合金/高温合金/隐身/复材",
             "kw": ["钛合金", "高温合金", "隐身", "吸波", "复合材料", "复材", "超导", "碳纤维"]},
            {"id": "DF-P", "name": "动力 · 航发", "summary": "航发整机/叶片/锻造",
             "kw": ["航发", "发动机", "叶片", "锻造", "锻件", "涡轮"]},
            {"id": "DF-E", "name": "军用电子", "summary": "雷达/T-R 芯片/IMU/特种 IC/红外",
             "kw": ["雷达", "t-r", "t/r", "imu", "惯导", "特种 ic", "红外", "探测", "军工芯片",
                    "fpga", "连接器", "微波", "毫米波", "射频"]},
            {"id": "DF-W", "name": "武器 · UAV", "summary": "导弹/无人机/含能/制导",
             "kw": ["导弹", "无人机", "uav", "含能", "制导", "弹", "民爆"]},
            {"id": "DF-S", "name": "整机 · 平台", "summary": "战机/直升机/舰船 总装",
             "kw": ["战机", "直升机", "运输机", "舰", "总装", "成飞", "西飞", "整机"]},
        ],
        "default": "DF-E",
    },
    "biotech": {
        "name": "生物医药", "desc": "试剂 → API → 创新药 → CRO/CDMO → 医械",
        "kw": ["医药", "创新药", "cro", "cdmo", "api", "原料药", "医械", "诊断", "ivd", "疫苗",
               "试剂", "培养基", "adc", "mrna", "抗体", "血制品", "血浆", "细胞", "测序", "影像",
               "内窥镜", "植入", "造影", "核药", "双抗", "生物", "制药", "药业"],
        "layers": [
            {"id": "BT-R", "name": "生物试剂 · 上游", "summary": "培养基/酶/抗体/重组蛋白",
             "kw": ["培养基", "酶", "重组蛋白", "试剂", "抗体原料", "层析", "生物试剂"]},
            {"id": "BT-A", "name": "API · 原料药", "summary": "甾体/维生素/造影剂/特色 API",
             "kw": ["原料药", "api", "甾体", "维生素", "造影剂", "特色原料"]},
            {"id": "BT-D", "name": "创新药 · 研发", "summary": "ADC/双抗/小分子/核药/血制品",
             "kw": ["创新药", "adc", "双抗", "单抗", "核药", "血制品", "血浆", "小分子", "新药", "细胞治疗"]},
            {"id": "BT-C", "name": "CRO / CDMO", "summary": "外包研发 + 外包生产",
             "kw": ["cro", "cdmo", "cxo", "外包", "一体化平台"]},
            {"id": "BT-V", "name": "医械 · 设备", "summary": "影像/植入/IVD/测序/内镜",
             "kw": ["影像", "ct", "mri", "超声", "植入", "ivd", "诊断", "测序", "内窥镜", "内镜", "医械", "器械"]},
        ],
        "default": "BT-D",
    },
    # ---------------- 新增大类 ----------------
    "ev": {
        "name": "新能源车", "desc": "锂电材料 → 电芯 → 三电 → 整车 → 补能",
        "kw": ["新能源车", "电动车", "锂电", "动力电池", "electric vehicle", " ev ", "整车",
               "充电桩", "三电", "锂电池", "正极", "负极", "电解液", "隔膜", "磷酸铁锂", "三元",
               "tesla", "byd", "比亚迪", "蔚来", "小鹏", "理想", "rivian", "lucid", "新能源汽车"],
        "layers": [
            {"id": "EV-1", "name": "上游锂电材料", "summary": "锂矿/正负极/电解液/隔膜",
             "kw": ["锂矿", "锂", "正极", "负极", "电解液", "隔膜", "磷酸铁锂", "三元", "前驱体", "碳酸锂", "lithium", "cathode"]},
            {"id": "EV-2", "name": "电芯 · 电池", "summary": "动力电池/电芯/PACK",
             "kw": ["动力电池", "电芯", "电池", "pack", "catl", "宁德", "battery", "储能电池"]},
            {"id": "EV-3", "name": "三电系统", "summary": "电机/电控/BMS",
             "kw": ["电机", "电控", "bms", "逆变", "驱动", "igbt", "碳化硅", "热管理", "电驱"]},
            {"id": "EV-4", "name": "整车", "summary": "新能源整车 OEM",
             "kw": ["整车", "新能源车", "电动车", "汽车", "automaker", "tesla", "byd", "比亚迪",
                    "蔚来", "小鹏", "理想", "rivian", "lucid"]},
            {"id": "EV-5", "name": "充电 · 补能", "summary": "充电桩/换电",
             "kw": ["充电桩", "充电", "换电", "charging", "超充"]},
        ],
        "default": "EV-1",
    },
    "solar-storage": {
        "name": "光伏 / 储能", "desc": "硅料 → 电池组件 → 逆变储能 → 风电",
        "kw": ["光伏", "solar", "储能", "energy storage", "逆变", "硅料", "硅片", "电池片",
               "组件", "异质结", "topcon", "perc", "风电", "光storage", "pv", "bess", "多晶硅"],
        "layers": [
            {"id": "SS-1", "name": "硅料 · 硅片", "summary": "多晶硅/单晶硅片",
             "kw": ["硅料", "多晶硅", "硅片", "polysilicon", "单晶硅", "切片"]},
            {"id": "SS-2", "name": "电池 · 组件", "summary": "电池片/组件/异质结/TOPCon",
             "kw": ["电池片", "组件", "光伏", "异质结", "topcon", "perc", "hjt", "光伏玻璃", "胶膜", "edpm"]},
            {"id": "SS-3", "name": "逆变 · 储能", "summary": "逆变器/储能系统/BESS",
             "kw": ["逆变器", "逆变", "储能", "energy storage", "bess", "储能系统", "pcs", "微逆"]},
            {"id": "SS-4", "name": "风电 · 其他", "summary": "风机/风电零部件",
             "kw": ["风电", "风机", "wind", "塔筒", "海上风电", "叶片"]},
        ],
        "default": "SS-2",
    },
    "consumer": {
        "name": "消费电子", "desc": "芯片 → 光声 → 显示 → 结构 → 组装 → 品牌",
        "kw": ["消费电子", "手机", "smartphone", "apple", "苹果", "可穿戴", "tws", "ar/vr",
               "面板", "摄像头", "声学", "无线耳机", "智能终端", "折叠屏", "果链", "wearable"],
        "layers": [
            {"id": "CE-1", "name": "核心芯片", "summary": "SoC/射频/存储/电源",
             "kw": ["soc", "处理器", "射频", "基带", "存储芯片", "电源管理", "mcu", "蓝牙芯片"]},
            {"id": "CE-2", "name": "光学 · 声学", "summary": "摄像头/镜头/CMOS/声学",
             "kw": ["摄像头", "光学", "镜头", "cmos", "声学", "扬声器", "麦克风", "马达", "潜望"]},
            {"id": "CE-3", "name": "显示 · 触控", "summary": "面板/OLED/盖板/触控",
             "kw": ["面板", "oled", "显示", "盖板", "触控", "lcd", "micro led", "玻璃"]},
            {"id": "CE-4", "name": "结构 · 电池", "summary": "结构件/连接器/散热/电池",
             "kw": ["结构件", "连接器", "散热", "电池", "金属外观", "fpc", "锂电"]},
            {"id": "CE-5", "name": "代工 · 组装", "summary": "代工/组装/ODM/EMS",
             "kw": ["代工", "组装", "foxconn", "富士康", "odm", "ems", "立讯", "组装厂"]},
            {"id": "CE-6", "name": "品牌 · 终端", "summary": "Apple/手机/可穿戴/AR",
             "kw": ["apple", "苹果", "手机", "smartphone", "可穿戴", "tws", "ar/vr", "耳机", "终端品牌"]},
        ],
        "default": "CE-2",
    },
}


def parse_curated_seed() -> dict:
    """从 industry-chains.ts 把现有手工 ticker→layer 解析为种子(不被自动归类覆盖)。"""
    txt = TS.read_text(encoding="utf-8")
    seed: dict = {}
    # 每个 *_TICKER_LAYER 块对应一个 industry
    blocks = {
        "rare-metals": "RARE_METALS_TICKER_LAYER",
        "humanoid": "HUMANOID_TICKER_LAYER",
        "defense": "DEFENSE_TICKER_LAYER",
        "biotech": "BIOTECH_TICKER_LAYER",
    }
    for ind, var in blocks.items():
        m = re.search(var + r"\s*:\s*Record<[^>]+>\s*=\s*\{(.*?)\n\};", txt, re.S)
        if not m:
            continue
        for tk, layer in re.findall(r'"([^"]+)":\s*"([^"]+)"', m.group(1)):
            seed.setdefault(tk, {})[ind] = layer
    return seed


def pick_layer(text: str, chain: dict) -> str:
    for layer in chain["layers"]:
        if any(k in text for k in layer["kw"]):
            return layer["id"]
    return chain["default"]


def classify(text: str, placement_entry: dict):
    """对一段文本,归类到所有命中的产业 + 各自层级(不覆盖已有种子)。"""
    for ind, chain in CHAINS.items():
        if ind in placement_entry:   # 种子已定,保留
            continue
        if any(k in text for k in chain["kw"]):
            placement_entry[ind] = pick_layer(text, chain)


def main():
    seed = parse_curated_seed()
    print(f"继承手工种子: {sum(len(v) for v in seed.values())} 条放置")
    placement: dict = {tk: dict(v) for tk, v in seed.items()}

    # A股 manifest
    man = json.load(open(MANIFEST, encoding="utf-8"))
    for e in man:
        code = e.get("code")
        if not code:
            continue
        text = f"{e.get('name','')} {e.get('thesis','')} {e.get('sector','')} {' '.join(e.get('concepts',[]))}".lower()
        classify(text, placement.setdefault(code, {}))

    # 美股 us-analyses
    us = json.load(open(US, encoding="utf-8")).get("stocks", {})
    for sym, v in us.items():
        ch = v.get("chain") or {}
        text = f"{v.get('name','')} {ch.get('industry','')} {ch.get('role','')} {v.get('sector','')}".lower()
        classify(text, placement.setdefault(sym, {}))

    # 去掉空 entry
    placement = {k: v for k, v in placement.items() if v}

    industries = [
        {"id": ind, "name": c["name"], "desc": c["desc"],
         "layers": [{"id": L["id"], "name": L["name"], "summary": L["summary"]} for L in c["layers"]]}
        for ind, c in CHAINS.items()
    ]
    OUT.write_text(json.dumps({"industries": industries, "placement": placement}, ensure_ascii=False), encoding="utf-8")

    # 统计
    from collections import Counter
    cnt = Counter()
    for v in placement.values():
        for ind in v:
            cnt[ind] += 1
    print(f"✓ industry-map.json: {len(placement)} 只票放置")
    for ind, c in CHAINS.items():
        print(f"  {c['name']}({ind}): {cnt[ind]} 只")


if __name__ == "__main__":
    main()
