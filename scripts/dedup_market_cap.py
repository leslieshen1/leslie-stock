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


def dedup_us() -> float:
    p = PUB / "us-stocks.json"
    d = json.loads(p.read_text(encoding="utf-8"))
    rows = d.get("stocks", [])
    for r in rows:
        r.pop("capDup", None)  # 清旧标记(幂等)

    # 仅在 country==US 内分组(外国 ADR 本就不进美股聚合,country 过滤已挡)
    groups: dict[str, list] = defaultdict(list)
    for r in rows:
        if r.get("country") != "United States":
            continue
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

    # 债券/票据/ETN 等非股权工具:同样不计入股权市值聚合(复用 capDup 标记)
    debt, debt_cap = [], 0.0
    for r in rows:
        if r.get("country") != "United States" or r.get("capDup"):
            continue
        if DEBT_RE.search(str(r.get("name", ""))):
            r["capDup"] = True
            debt_cap += float(r.get("mcapB") or 0)
            debt.append((r.get("sym"), r.get("name"), float(r.get("mcapB") or 0)))

    p.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
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
