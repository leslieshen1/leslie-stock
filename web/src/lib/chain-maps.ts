// 明星产业链「关系图」手工策展数据 —— 知名公司为中心的供应链(英伟达另在 NvidiaChain.tsx,带 ADR/海外标灰特例)。
// 不是行业板块链;是「某个明星公司 + 它的上游供应商 / 下游客户 / 同场对手」。公司全部已核对在库。
// cn:true = A股(代码走 a-market 取实时涨跌、region=CN);否则美股(items/market、region=US)。core=链主(高亮)。

export type CNode = { t: string; name: string; cn?: boolean };
export type CGroup = { tie: string; tieEn: string; core?: boolean; nodes: CNode[] };
export type ChainMapDef = { flow: string; flowEn: string; groups: CGroup[] };

const A = (t: string, name: string): CNode => ({ t, name, cn: true });
const U = (t: string, name: string): CNode => ({ t, name });

export const CHAIN_MAPS: Record<string, ChainMapDef> = {
  // ===== SpaceX · 商业航天 =====
  spacex: {
    flow: "航天材料 / 部件 → SpaceX → 商业航天同侪 → 卫星应用",
    flowEn: "Aerospace materials → SpaceX → space peers → satellite apps",
    groups: [
      { tie: "上游 · 钛 / 碳纤维 / 结构件", tieEn: "Titanium / carbon fiber / structures", nodes: [U("HWM", "Howmet 航空结构"), U("ATI", "ATI 钛"), U("HXL", "Hexcel 碳纤维")] },
      { tie: "上游 · 航电 · 精密部件", tieEn: "Avionics · precision parts", nodes: [U("HEI", "Heico"), U("TDG", "TransDigm")] },
      { tie: "SpaceX · 火箭 / 飞船 / 星链 · 链主", tieEn: "SpaceX · rockets / Starship / Starlink", core: true, nodes: [U("SPCX", "SpaceX")] },
      { tie: "商业航天 · 发射 / 月球同侪", tieEn: "Commercial space peers", nodes: [U("RKLB", "Rocket Lab"), U("LUNR", "Intuitive Machines"), U("RDW", "Redwire")] },
      { tie: "卫星互联网 / 对地观测 · 下游", tieEn: "Satellite internet / EO · downstream", nodes: [U("ASTS", "AST SpaceMobile"), U("PL", "Planet Labs"), U("BKSY", "BlackSky"), U("IRDM", "Iridium"), U("GSAT", "Globalstar")] },
      { tie: "防务发射巨头 · 同场竞技", tieEn: "Defense launch giants · rivals", nodes: [U("BA", "波音"), U("LMT", "洛克希德"), U("NOC", "诺斯罗普"), U("RTX", "RTX"), U("LHX", "L3Harris")] },
    ],
  },

  // ===== 苹果 Apple(供应链:谁造 iPhone)=====
  apple: {
    flow: "芯片 / 屏 / 存储 → 中国果链组装 → 苹果",
    flowEn: "Chips / display / memory → China assembly → Apple",
    groups: [
      { tie: "主芯片 · 台积电独家代工 A/M 系列", tieEn: "SoC · TSMC sole foundry", nodes: [U("TSM", "台积电")] },
      { tie: "射频 · 基带 · 无线", tieEn: "RF · baseband · wireless", nodes: [U("AVGO", "博通"), U("QCOM", "高通"), U("SWKS", "Skyworks"), U("QRVO", "Qorvo")] },
      { tie: "存储 · 屏幕", tieEn: "Memory · display", nodes: [U("MU", "美光"), A("000725", "京东方")] },
      { tie: "中国果链 · 组装 / 声学 / 玻璃 / 光学", tieEn: "China assembly / acoustics / glass / optics", nodes: [A("002475", "立讯精密"), A("002241", "歌尔股份"), A("300433", "蓝思科技"), A("002456", "欧菲光")] },
      { tie: "苹果 · 链主(最大买家)", tieEn: "Apple · the core buyer", core: true, nodes: [U("AAPL", "苹果")] },
    ],
  },

  // ===== 特斯拉 Tesla(电动车 + 机器人)=====
  tesla: {
    flow: "电池 / 锂 → 中国零部件 → 智驾芯片 → 特斯拉 → 对手 / Optimus",
    flowEn: "Battery / lithium → China parts → AI chips → Tesla → rivals / Optimus",
    groups: [
      { tie: "动力电池 · 锂资源", tieEn: "Battery · lithium", nodes: [A("300750", "宁德时代"), A("002460", "赣锋锂业"), A("002466", "天齐锂业")] },
      { tie: "中国链 · 热管理 / 结构件", tieEn: "China parts · thermal / structures", nodes: [A("002050", "三花智控"), A("601689", "拓普集团"), A("603305", "旭升集团")] },
      { tie: "智驾芯片 · FSD / Dojo", tieEn: "AI chips · FSD / Dojo", nodes: [U("NVDA", "英伟达"), U("TSM", "台积电")] },
      { tie: "特斯拉 · 链主", tieEn: "Tesla · the core", core: true, nodes: [U("TSLA", "特斯拉")] },
      { tie: "电动车对手 · 同场竞技", tieEn: "EV rivals", nodes: [A("002594", "比亚迪"), U("LI", "理想"), U("NIO", "蔚来"), U("XPEV", "小鹏"), U("RIVN", "Rivian"), U("LCID", "Lucid")] },
      { tie: "Optimus 机器人 · 补能", tieEn: "Optimus robot · charging", nodes: [A("688017", "绿的谐波"), A("003021", "兆威机电"), A("300001", "特锐德")] },
    ],
  },
};
