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
};
