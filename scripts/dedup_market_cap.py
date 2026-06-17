#!/usr/bin/env python3
"""市值聚合去重(数据管线步骤)。

一家公司若有多个上市类别(双重股权 GOOGL/GOOG、存托凭证 GOOGM/GOOGN、优先股…),
Nasdaq 每个类别都按"全公司市值"报,直接求和会把一家公司算好几次,板块/热力图市值虚高。

本步骤给两类"不该进股权市值聚合"的行打 `capDup: true` 标记:
  ① 重复上市的副类股(双重股权/存托凭证)—— 同一家公司算多次
  ② 债券/票据/STRATS/ETN 等非股权工具 —— 本质是债,不是股权市值
标记后:行本身保留(搜索/个股详情照常各显示自己的市值),只在"市值求和/加权"的
消费端(/api/sector-sessions、/api/heatmap)按 !capDup 排除。

纯机械:只按"同公司多类别"和"名字写明是债券/票据"两条客观规则,不替数据做估值/私有等主观判断
(教训:SPCX 是已上市真公司,曾被误当私有代理排除,已纠正——别拿旧认知覆盖数据集)。
幂等可重跑。每次 refresh 在 build_json 之后跑一遍(build_json 从库派生会覆盖标记)。

范围(按 美股↔A股↔港股 一起查 2026-06-17):
  · 美股 us-stocks.json —— 双重股权/存托重复(Alphabet 被算 4 次)+ 债券/票据混入
  · A股 aleabit_manifest.json —— 同名多票 = 0,无需去重(本脚本仅复核打印)
  · 港股 —— 无批量市值数据集(只在个股 /api/quote 层),无聚合可重复
"""
import json
import re
from pathlib import Path
from collections import defaultdict

PUB = Path(__file__).resolve().parent.parent / "web" / "public" / "data"


def norm_name(nm: str) -> str:
    """公司名归一:砍掉类别/存托凭证/公司形式后缀,留下可比的主体名。"""
    x = (nm or "").lower()
    x = re.split(r"\b(depositary|depository)\b", x)[0]  # 砍存托凭证尾巴
    x = re.sub(
        r"\b(class [a-z]|series [a-z]|common stock|ordinary shares?|"
        r"new york registry shares?|american depositary.*|representing.*)\b",
        " ", x)
    x = re.sub(r"\b(inc|corp|corporation|company|co|ltd|limited|plc|n\.?v|s\.?a|holdings?|the|l\.?p|lp)\b", " ", x)
    x = re.sub(r"[^a-z0-9 ]", " ", x)
    return re.sub(r"\s+", " ", x).strip()


def sym_root(sym: str) -> str:
    return re.sub(r"[^A-Za-z]", "", (sym or "").upper())[:4]


def is_secondary(nm: str) -> int:
    """副类(优先股/存托/Class B+/票据/权证)→ 1,普通股/Class A → 0。用来优先保普通股为主类。"""
    return 1 if re.search(r"depositary|depository|preferred|series [a-z]|class [b-z]|warrant|\bnotes?\b|\bright|\bunit", (nm or "").lower()) else 0


# 债券/票据/ETN 等非股权工具:有"市值"和板块标签,但本质是债不是股权,不该进股权市值聚合。
DEBT_RE = re.compile(r"\bnotes?\b|\bdebentures?\b|subordinated|\bSTRATS\b|\bETN\b|exchange[- ]traded note", re.I)

# 分类修正(AI 审定 top200):Nasdaq 的 sector/industry 字段不少错位/陈旧,按公司真实业务覆盖。
# 值=(sector, industry)。只收高把握的错;长尾待 step② / 全量。改 industry 同时惠及 scan/搜索/详情。
CLASSIFY_FIX: dict[str, tuple[str, str]] = {
    "SPCX": ("Industrials", "Aerospace"),                                  # SpaceX:航天≠"数据处理软件"
    "QCOM": ("Technology", "Semiconductors"),                              # 高通≠"广播电视"
    "GE":   ("Industrials", "Aerospace"),                                  # GE Aerospace≠"消费电子"
    "GEV":  ("Industrials", "Industrial Machinery/Components"),            # GE Vernova:电力设备(原空白)
    "PANW": ("Technology", "Computer Software: Prepackaged Software"),     # Palo Alto:安全软件≠"电脑外设"
    "FTNT": ("Technology", "Computer Software: Prepackaged Software"),     # Fortinet 同上
    "NEE":  ("Utilities", "Electric Utilities: Central"),                  # NextEra:电力≠"EDP Services"
    "DASH": ("Consumer Discretionary", "Computer Software: Programming Data Processing"),  # DoorDash:互联网
    "UBER": ("Technology", "Computer Software: Programming Data Processing"),               # Uber:互联网平台
    "ABNB": ("Consumer Discretionary", "Computer Software: Programming Data Processing"),   # Airbnb:互联网平台
    "GD":   ("Industrials", "Aerospace"),                                  # 通用动力:国防≠"海运"
    "NOC":  ("Industrials", "Aerospace"),                                  # 诺斯罗普:国防
    "LMT":  ("Industrials", "Aerospace"),                                  # 洛马
    "TDG":  ("Industrials", "Aerospace"),                                  # TransDigm:航空件
    "HWM":  ("Industrials", "Aerospace"),                                  # Howmet:航空≠"金属加工"
    "DIS":  ("Communication Services", "Services-Misc. Amusement & Recreation"),
    "NFLX": ("Communication Services", "Services-Misc. Amusement & Recreation"),  # 流媒体归媒体娱乐
    "WBD":  ("Communication Services", "Services-Misc. Amusement & Recreation"),
    "MSI":  ("Technology", "Computer Communications Equipment"),           # 摩托罗拉系统:通信设备≠"广播电视"
    "V":    ("Finance", "Business Services"),                              # Visa:金融(支付),非可选消费
    "MA":   ("Finance", "Business Services"),                              # 万事达 同上
    "AXP":  ("Finance", "Finance: Consumer Services"),                     # 运通:金融
    "PYPL": ("Finance", "Business Services"),                              # PayPal:支付
    "GPN":  ("Finance", "Business Services"),                              # Global Payments:支付
    "MSCI": ("Finance", "Finance: Consumer Services"),                     # MSCI:金融数据
    "ETN":  ("Industrials", "Industrial Machinery/Components"),            # 伊顿:工业(电气),非科技
    "WMT":  ("Consumer Staples", "Department/Specialty Retail Stores"),    # 沃尔玛:必需消费
    "PM":   ("Consumer Staples", "Tobacco"),                              # 菲莫:烟草≠"医疗"
    "MO":   ("Consumer Staples", "Tobacco"),                              # 奥驰亚:烟草
    "TMO":  ("Health Care", "Medical/Dental Instruments"),                # 赛默飞:医疗器械/生命科学
    "DHR":  ("Health Care", "Medical/Dental Instruments"),                # 丹纳赫 同上
    "ISRG": ("Health Care", "Medical/Dental Instruments"),                # 直觉手术
    "MDT":  ("Health Care", "Medical/Dental Instruments"),                # 美敦力
    "ABT":  ("Health Care", "Medical/Dental Instruments"),                # 雅培:器械/诊断为主
    "CVS":  ("Health Care", "Medical Specialities"),                      # CVS:医疗服务
    "MCK":  ("Health Care", "Medical Specialities"),                      # 麦肯森:医药分销
    "EMR":  ("Industrials", "Industrial Machinery/Components"),            # 艾默生:工业自动化≠"消费电子"
    "HPE":  ("Technology", "Computer Manufacturing"),                      # HPE:服务器硬件
    "PH":   ("Industrials", "Industrial Machinery/Components"),            # 派克汉尼汾≠"金属加工"
    "APH":  ("Technology", "Electronic Components"),                       # 安费诺:连接器
    "GLW":  ("Technology", "Electronic Components"),                       # 康宁:材料/元件
}


# 科技板块内细分主题(前端展开"科技"时看):sym→子桶,其余按 industry 兜底。
# 只拆科技(用户:热门的拆,其他没必要)。半导体进一步拆成 AI算力/存储/光模块/设备。
TECH_SUB_FIX: dict[str, str] = {}
for _grp, _syms in {
    "AI算力": "NVDA AMD",
    "存储": "MU WDC SNDK STX",
    "光模块": "COHR LITE FN AAOI POET",
    "半导体设备": "LRCX AMAT KLAC TER ENTG ONTO COHU ASML",
}.items():
    for _s in _syms.split():
        TECH_SUB_FIX[_s] = _grp


def tech_sub(s: dict) -> str:
    if s.get("sym") in TECH_SUB_FIX:
        return TECH_SUB_FIX[s["sym"]]
    ind = (s.get("industry") or "").lower()
    if "semiconductor" in ind:
        return "半导体(其他)"
    if "prepackaged" in ind:
        return "软件"
    if "programming data" in ind:
        return "互联网平台"
    if any(k in ind for k in ("computer manufacturing", "electronic components", "communications equipment", "computer peripheral")):
        return "硬件电子"
    return "其他科技"


# 个别票的子板块直接指定(行业字段不够准时)
SUB_OVERRIDE = {
    "V": "支付", "MA": "支付", "AXP": "支付", "PYPL": "支付", "COIN": "支付", "FI": "支付", "GPN": "支付",
    "SPGI": "金融数据", "MCO": "金融数据", "ICE": "金融数据", "CME": "金融数据", "MSCI": "金融数据", "NDAQ": "金融数据",
}


def assign_sub(s: dict):
    """给任意一只票分配子板块(按大板块分派 + industry 关键词 + sym 覆盖)。返回 None=不细分。"""
    if s.get("sym") in SUB_OVERRIDE:
        return SUB_OVERRIDE[s["sym"]]
    sec = s.get("sector")
    ind = (s.get("industry") or "").lower()
    def h(*ks: str) -> bool:
        return any(k in ind for k in ks)
    if sec == "Technology":
        return tech_sub(s)
    if sec == "Finance":
        if h("major banks", "banks"): return "银行"
        if h("investment banker", "brokers"): return "投行券商"
        if h("investment managers"): return "资管/PE"
        if h("insur"): return "保险"
        if h("consumer services", "finance: "): return "金融数据"
        if h("business services"): return "支付"
        return "其他金融"
    if sec == "Health Care":
        if h("pharmaceutical"): return "制药"
        if h("biological", "laboratory analyt"): return "生物科技"
        if h("medical/dental", "electromedical", "instruments", "specialties"): return "医疗器械"
        if h("medical special", "hospital", "nursing", "health"): return "医疗服务"
        if h("drug stores", "other pharma"): return "医药分销"
        return "其他医疗"
    if sec == "Industrials":
        if h("aerospace", "military"): return "航空国防"
        if h("railroad", "freight", "trucking", "marine transport", "courier", "transportation", "air "): return "运输物流"
        if h("engineering", "construction &"): return "建筑工程"
        if h("machinery", "metal fabrication", "electrical products", "industrial", "equipment", "pumps"): return "机械装备"
        if h("commercial services", "environmental", "business services", "office equipment"): return "商业服务"
        return "其他工业"
    if sec == "Consumer Discretionary":
        if h("auto manufacturing", "motor vehicle"): return "汽车"
        if h("restaurant", "hotel", "resort", "amusement", "marine transport", "casino"): return "餐饮酒店旅游"
        if h("catalog"): return "电商"
        if h("retail", "stores", "shoe", "apparel", "clothing", "building materials", "auto & home"): return "零售品牌"
        return "其他可选消费"
    if sec == "Consumer Staples":
        if h("tobacco"): return "烟草"
        if h("beverage"): return "饮料"
        if h("food"): return "食品"
        if h("cosmetic", "package goods", "soap"): return "日化"
        return "其他必需消费"
    if sec == "Energy":
        if h("integrated"): return "综合油气"
        if h("production", "oil & gas"): return "油气开采"
        if h("natural gas", "pipeline"): return "中游管输"
        if h("field machinery", "oil and gas field"): return "油服设备"
        return "其他能源"
    if sec == "Utilities":
        if h("electric", "power"): return "电力"
        if h("gas", "water"): return "燃气水务"
        return "其他公用"
    if sec in ("Telecommunications", "Communication Services"):
        if h("amusement", "cable", "recreation", "broadcast", "advertis", "publish"): return "媒体娱乐"
        return "电信运营"
    if sec in ("Basic Materials", "Materials"):
        if h("chemical"): return "化工"
        if h("metal", "mining", "precious", "steel", "gold", "copper"): return "金属矿业"
        return "其他材料"
    return None  # 地产(全 REIT)/ 其他 不细分


# 英文 GICS sector → 中文大板块(尾巴小盘用;AI 已判的直接用 AI 的大板块)
SEG_ZH = {
    "Technology": "科技", "Finance": "金融", "Financial Services": "金融",
    "Health Care": "医疗", "Healthcare": "医疗", "Consumer Discretionary": "可选消费",
    "Consumer Staples": "必需消费", "Industrials": "工业", "Energy": "能源",
    "Utilities": "公用事业", "Telecommunications": "通信媒体", "Communication Services": "通信媒体",
    "Real Estate": "地产", "Basic Materials": "材料", "Materials": "材料", "Miscellaneous": "其他",
}
def seg_zh(sector) -> str:
    return SEG_ZH.get(str(sector), "其他")


# AI 判读结果(scripts/ai_sectors.json,classify-us-sectors workflow 产出):sym→{seg,sub,sub2}
def load_ai() -> dict:
    p = Path(__file__).resolve().parent / "ai_sectors.json"
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


# 第二子板块人工覆盖:分类 AI(训练截止较早)不知道的近期并购/业务变动,在此手填(列表,可多个)。
# 例:SpaceX 已并入 xAI(AI算力)+ 收购 Cursor(软件)→ 横跨多块,但 AI 判不出。
SUB2_OVERRIDE: dict[str, list] = {
    "SPCX": ["AI算力", "软件"],  # xAI 合并 + 收购 Cursor(2026,AI 不知道)
}


def dedup_us() -> float:
    p = PUB / "us-stocks.json"
    d = json.loads(p.read_text(encoding="utf-8"))
    rows = d.get("stocks", [])
    for r in rows:
        r.pop("capDup", None)  # 清旧标记(幂等)

    # 全部美股上市票按公司名分组去重(不限注册地;海外注册的双重股权也一并合并)
    groups: dict[str, list] = defaultdict(list)
    for r in rows:
        n = norm_name(r.get("name"))
        if n:
            groups[n].append(r)

    flagged, dup_cap = [], 0.0
    for g in groups.values():
        if len(g) < 2:
            continue
        g.sort(key=lambda r: (is_secondary(r.get("name")), -float(r.get("mcapB") or 0)))  # 普通股优先,再按市值
        primary = g[0]
        proot = sym_root(primary.get("sym"))
        for r in g[1:]:
            # 副类必须与主类共享 symbol 前缀(≥3 字符)才算重复,防误并两家不同公司
            if proot and len(proot) >= 3 and sym_root(r.get("sym")).startswith(proot[:3]):
                r["capDup"] = True
                dup_cap += float(r.get("mcapB") or 0)
                flagged.append((r.get("sym"), primary.get("sym"), r.get("name"), float(r.get("mcapB") or 0)))

    # 分类修正:按 CLASSIFY_FIX 覆盖错位的 sector/industry(惠及板块热力 + scan/搜索/详情)
    fixed = 0
    for r in rows:
        fx = CLASSIFY_FIX.get(r.get("sym"))
        if fx:
            r["sector"], r["industry"] = fx
            fixed += 1

    # 每只票打 大板块(seg)/主子板块(sub)/第二子板块(sub2)。
    # ≥$1B 用 AI 判读(ai_sectors.json);尾巴小盘用规则(seg_zh + assign_sub)。不限注册地。
    AI = load_ai()
    ai_hit = 0
    for r in rows:
        for k in ("seg", "sub", "sub2"):
            r.pop(k, None)
        if r.get("capDup") or not r.get("sector"):
            continue
        a = AI.get(r.get("sym"))
        if a and a.get("seg") and a.get("sub"):
            r["seg"], r["sub"] = a["seg"], a["sub"]
            # 第二子板块(可多个):人工 override 优先,否则用 AI 判的单个;去掉与主子板块重复的、去重
            ov = SUB2_OVERRIDE.get(r.get("sym"))
            raw = ov if ov is not None else ([a["sub2"]] if a.get("sub2") else [])
            subs2, seen = [], set()
            for x in raw:
                if x and x != a["sub"] and x not in seen:
                    subs2.append(x); seen.add(x)
            if subs2:
                r["sub2"] = subs2
            ai_hit += 1
        else:
            r["seg"] = seg_zh(r["sector"])
            s2 = assign_sub(r)
            if s2:
                r["sub"] = s2
    print(f"[US] 分类:AI 判读命中 {ai_hit} 只,其余尾巴用规则;第二子板块 {sum(1 for r in rows if r.get('sub2'))} 只")

    # 债券/票据/ETN 等非股权工具:同样不计入股权市值聚合(复用 capDup 标记)
    debt, debt_cap = [], 0.0
    for r in rows:
        if r.get("capDup"):
            continue
        if DEBT_RE.search(str(r.get("name", ""))):
            r["capDup"] = True
            debt_cap += float(r.get("mcapB") or 0)
            debt.append((r.get("sym"), r.get("name"), float(r.get("mcapB") or 0)))

    p.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    # 精简分类表给详情页用(sym→大板块/主子板块/第二子板块),省得详情页解析 1.3MB us-stocks
    cls = {r["sym"]: {"seg": r.get("seg"), "sub": r.get("sub"), "sub2": r.get("sub2")} for r in rows if r.get("seg")}
    (PUB / "us-class.json").write_text(json.dumps(cls, ensure_ascii=False), encoding="utf-8")
    print(f"[US] 双重股权/存托重复: {len(flagged)} 行,剔除 ${dup_cap/1000:.2f}T")
    for sym, prim, nm, cap in sorted(flagged, key=lambda x: -x[3])[:8]:
        print(f"    {sym:7} ← 主类 {prim:11} ${cap/1000:6.2f}T  {str(nm)[:36]}")
    print(f"[US] 债券/票据非股权工具: {len(debt)} 行,剔除 ${debt_cap/1000:.3f}T —— 核对有无误伤真公司:")
    for sym, nm, cap in sorted(debt, key=lambda x: -x[2])[:14]:
        print(f"    {sym:7} ${cap/1000:6.3f}T  {str(nm)[:50]}")
    print(f"[US] 分类修正(CLASSIFY_FIX): {fixed} 只覆盖了错位的 sector/industry")
    return dup_cap + debt_cap


def check_a():
    p = PUB / "aleabit_manifest.json"
    rows = json.loads(p.read_text(encoding="utf-8"))
    byname = defaultdict(list)
    for r in (rows if isinstance(rows, list) else []):
        nm = (r.get("name") or "").strip()
        if nm:
            byname[nm].append(r)
    dups = {k: v for k, v in byname.items() if len(v) > 1}
    if dups:
        print(f"[A] ⚠ 出现同名多票 {len(dups)} 组,需补去重逻辑:", list(dups)[:8])
    else:
        print("[A] 同名多票 = 0,无需去重(港股无批量集,无聚合)")


if __name__ == "__main__":
    dedup_us()
    check_a()
    print("done.")
