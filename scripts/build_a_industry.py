"""A 股真·产业板块 → a-industry.json {code: 行业名}。
之前列表「行业」用同花顺题材概念(昨日炸板/东方财富热股/ST股…噪声)。这里换成干净产业板块:
  ① 概念白名单(更专):把 manifest 里「真行业」概念(半导体/锂电/创新药…)映射到统一行业名,忽略所有噪声
  ② 新浪 49 行业(兜底):概念全是噪声的(如茅台:上证50/权重股)走新浪(酿酒→食品饮料)
静态,跑一次即可。用法: uv run python scripts/build_a_industry.py
"""
from __future__ import annotations
import json, re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
OUT = PUB / "a-industry.json"
H = {"Referer": "https://finance.sina.com.cn", "User-Agent": "Mozilla/5.0"}

# 统一产业板块(~22 个干净行业)
# ① 概念 → 统一行业(兜底用,新浪没覆盖才查)。只收真行业概念,噪声(昨日*/ST/大盘股…)不在内
CONCEPT_IND: list[tuple[str, str]] = [
    (r"半导体|第三代半导体|存储芯片|光刻机|功率半导体|MCU|GPU|芯片|EDA|先进封装|碳化硅|氮化镓|chiplet|HBM", "半导体"),
    (r"光通信|光模块|CPO|5G|通信技术|通信设备|卫星|北斗|物联网", "通信"),
    (r"消费电子|苹果概念|小米概念|AI眼镜|智能穿戴|OLED|折叠屏|MR概念|VR|PCB|MLCC|液冷|被动元件", "消费电子"),
    (r"算力|数据中心|人工智能|AI应用|信创|云计算|网络安全|大数据|数字货币|国产软件|操作系统|鸿蒙", "计算机/AI"),
    (r"麒麟电池|锂电池|固态电池|钠电池|储能|换电|充电桩|电池|动力电池|盐湖提锂|磷酸铁锂|光伏|HJT|钙钛矿|TOPCon|风电|绿电|氢能|核电|特高压|智能电网|发电", "电力设备/新能源"),
    (r"创新药|CXO|生物医药|生物制药|医美|减肥药|疫苗|中药|医疗器械|脑机接口|血制品", "医药生物"),
    (r"军工|航天|大飞机|无人机|导弹|低空经济|商业航天|国防", "国防军工"),
    (r"机器人|减速器|工业母机|人形机器人|机床|数控", "机械/机器人"),
    (r"稀土|永磁|小金属|稀有金属|稀缺资源|锂矿|钴|铜|铝|黄金|有色", "有色金属"),
    (r"汽车零部件|无人驾驶|智能汽车|车联网|一体化压铸|汽车电子|整车|新能源车", "汽车"),
    (r"白酒|食品|饮料|预制菜|调味品|乳业|啤酒|养殖|猪肉|种业|农业|宠物经济", "食品/农业"),
    (r"化工|新材料|化纤|钛白粉|氟化工|磷化工|涂料|塑料", "化工/材料"),
    (r"银行|券商|保险|金融科技|多元金融|互联网金融", "金融"),
    (r"房地产|物业|REITs|装配式建筑|建筑|建材|水泥", "地产建筑"),
    (r"游戏|影视|短剧|传媒|出版|广告营销|IP经济|院线", "传媒"),
    (r"钢铁|煤炭|石油|油气|燃气", "周期资源"),
    (r"家电|白色家电|小家电", "家电"),
    (r"纺织|服装|鞋帽|珠宝", "纺织服装"),
    (r"机场|航运|港口|物流|高速公路|铁路|快递", "交通运输"),
    (r"水务|环保|公用事业|垃圾发电", "公用环保"),
    (r"零售|百货|商业|免税|跨境电商|超市", "商贸零售"),
]

# ② 新浪全部 49 行业 → 统一行业名(优先级高于概念:它是核心主业,如比亚迪=汽车而非半导体概念)
SINA_NORM = {
    "电子器件": "半导体", "电子信息": "消费电子", "生物制药": "医药生物", "医疗器械": "医药生物",
    "化工行业": "化工/材料", "化纤行业": "化工/材料", "塑料制品": "化工/材料", "玻璃行业": "化工/材料",
    "造纸行业": "化工/材料", "印刷包装": "化工/材料", "农药化肥": "化工/材料", "陶瓷行业": "化工/材料",
    "机械行业": "机械/机器人", "仪器仪表": "机械/机器人", "纺织机械": "机械/机器人",
    "汽车制造": "汽车", "摩托车": "汽车", "酿酒行业": "食品/农业", "食品行业": "食品/农业",
    "农林牧渔": "食品/农业", "金融行业": "金融", "房地产": "地产建筑", "建筑建材": "地产建筑",
    "水泥行业": "地产建筑", "传媒娱乐": "传媒", "有色金属": "有色金属", "钢铁行业": "周期资源",
    "煤炭行业": "周期资源", "石油行业": "周期资源", "电力行业": "公用环保", "供水供气": "公用环保",
    "环保行业": "公用环保", "发电设备": "电力设备/新能源", "电器行业": "家电", "家电行业": "家电",
    "服装鞋类": "纺织服装", "纺织行业": "纺织服装", "交通运输": "交通运输", "公路桥梁": "交通运输",
    "商业百货": "商贸零售", "酒店旅游": "商贸零售", "物资外贸": "商贸零售", "飞机制造": "国防军工",
    "船舶制造": "国防军工", "家具行业": "家居", "综合行业": "其它", "其它行业": "其它",
    "次新股": "", "开发区": "",
}


# ③ 公司名兜底(很多大票概念全是噪声:隆基「上证50/大盘股」,但名字带行业词)
NAME_IND: list[tuple[str, str]] = [
    (r"银行", "金融"), (r"证券|期货|信托|保险|金控", "金融"),
    (r"医药|医疗|生物|制药|药业|健康", "医药生物"),
    (r"光伏|绿能|阳光电源|风电|储能|核电|电气", "电力设备/新能源"),
    (r"汽车", "汽车"), (r"半导体|芯片|微电子", "半导体"),
    (r"地产|置业|城建|控股集团", "地产建筑"), (r"传媒|影视|文化", "传媒"),
    (r"航空|航天|军|船舶", "国防军工"), (r"航运|港口|物流|机场|高速", "交通运输"),
    (r"钢铁|煤业|石油|石化", "周期资源"),
]
# ④ 个别名字也无行业词的知名票,手工兜底
MANUAL = {"300059": "金融", "600030": "金融", "300999": "食品/农业"}  # 东方财富/中信证券/金龙鱼


def name_industry(name: str) -> str:
    for pat, ind in NAME_IND:
        if re.search(pat, name or ""):
            return ind
    return ""


def concept_industry(concepts: list[str]) -> str:
    blob = " ".join(concepts or [])
    for pat, ind in CONCEPT_IND:
        if re.search(pat, blob):
            return ind
    return ""


def sina_map() -> dict[str, str]:
    r = requests.get("https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php", headers=H, timeout=15)
    r.encoding = "gbk"
    inds = re.findall(r'"(new_\w+)":"new_\w+,([^,]+),', r.text)

    def cons(node: str) -> list[str]:
        out = []
        for page in range(1, 60):
            u = ("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
                 f"Market_Center.getHQNodeData?page={page}&num=100&sort=symbol&asc=1&node={node}")
            try:
                rr = requests.get(u, headers=H, timeout=15); rr.encoding = "utf-8"
                rows = json.loads(rr.text or "[]")
            except Exception:
                break
            if not rows:
                break
            out += [re.sub(r"^(sh|sz|bj)", "", x["symbol"]) for x in rows if x.get("symbol")]
            if len(rows) < 100:
                break
        return out

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(lambda ni: (ni[1], cons(ni[0])), inds))
    code2 = {}
    for name, codes in sorted(results, key=lambda x: -len(x[1])):   # 大行业先,小行业覆盖
        norm = SINA_NORM.get(name, name)
        if not norm:
            continue
        for c in codes:
            code2[c] = norm
    return code2


def main():
    man = {x["code"]: x for x in json.loads((PUB / "aleabit_manifest.json").read_text(encoding="utf-8"))}
    print("新浪 49 行业兜底拉取中…")
    sina = sina_map()
    # 新浪「电子器件/电子信息」两个大类太宽(把光伏隆基、组装立讯都塞进半导体),
    # 这两类优先用概念细分(光伏→电力设备、组装→消费电子);其余新浪行业准、直接用
    AMBIG = {"半导体", "消费电子"}
    out = {}
    for code, x in man.items():
        s = sina.get(code, "")
        c = concept_industry(x.get("concepts") or [])
        nm = name_industry(x.get("name", ""))
        # 优先级:手工 > 公司名 > 新浪非模糊主业 > 概念 > 新浪模糊大类(电子)兜底
        ind = MANUAL.get(code) or nm or (s if s and s not in AMBIG else "") or c or s
        if ind:
            out[code] = ind
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    dist = Counter(out.values())
    print(f"✅ a-industry.json — {len(out)}/{len(man)} 只有行业 · {len(dist)} 个产业板块")
    for name, n in dist.most_common():
        print(f"     {name}: {n}")


if __name__ == "__main__":
    main()
