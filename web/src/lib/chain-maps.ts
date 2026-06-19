// 明星产业链「关系图」手工策展数据(英伟达另在 NvidiaChain.tsx)。
// 公司全部已核对在库(A股 /api/a-market · 美股 us-stocks),按各链真实供应链结构排:上游 → 核心 → 下游。
// cn:true = A股(代码走 a-market 取实时涨跌、region=CN);否则美股(items/market、region=US)。
// 名单从各链公开供应链结构手挑龙头(非 placement 自动分类——那个太脏),tie=与该环节/核心的关系。

export type CNode = { t: string; name: string; cn?: boolean };
export type CGroup = { tie: string; tieEn: string; core?: boolean; nodes: CNode[] };
export type ChainMapDef = { flow: string; flowEn: string; groups: CGroup[] };

const A = (t: string, name: string): CNode => ({ t, name, cn: true });
const U = (t: string, name: string): CNode => ({ t, name });

export const CHAIN_MAPS: Record<string, ChainMapDef> = {
  // ===== 人形机器人 =====
  humanoid: {
    flow: "稀土永磁 → 减速器/丝杠 → 伺服电机 → 传感器 → 灵巧手 → 整机",
    flowEn: "Magnets → reducers/screws → servos → sensors → hands → robot",
    groups: [
      { tie: "永磁材料 · 关节磁钢", tieEn: "Magnets · joint magnets", nodes: [A("300748", "金力永磁"), A("000970", "中科三环"), A("300224", "正海磁材")] },
      { tie: "减速器 · 关节的命门", tieEn: "Reducers · the joint chokepoint", nodes: [A("688017", "绿的谐波"), A("002472", "双环传动"), A("002896", "中大力德")] },
      { tie: "丝杠 · 直线驱动", tieEn: "Screws · linear drive", nodes: [A("601100", "恒立液压"), A("603009", "北特科技"), A("300580", "贝斯特")] },
      { tie: "伺服 · 电机 · 力量来源", tieEn: "Servo · motors · the muscle", nodes: [A("300124", "汇川技术"), A("603728", "鸣志电器"), A("002979", "雷赛智能")] },
      { tie: "传感器 · 力 / 视觉感知", tieEn: "Sensors · force / vision", nodes: [A("603662", "柯力传感"), A("688322", "奥比中光")] },
      { tie: "灵巧手 · 执行总成", tieEn: "Dexterous hands · actuators", nodes: [A("003021", "兆威机电"), A("002050", "三花智控"), A("601689", "拓普集团")] },
      { tie: "整机 · 总成 · 链主", tieEn: "Robot makers · the core", core: true, nodes: [U("TSLA", "特斯拉 Optimus"), A("002747", "埃斯顿")] },
    ],
  },

  // ===== 光伏 · 储能 =====
  "solar-storage": {
    flow: "硅料硅片 → 电池组件 → 逆变器 → 储能电芯 → 辅材",
    flowEn: "Polysilicon → cells/modules → inverters → storage cells → materials",
    groups: [
      { tie: "硅料 · 硅片 · 上游", tieEn: "Polysilicon · wafers", nodes: [A("600438", "通威股份"), A("002129", "TCL中环"), A("688303", "大全能源")] },
      { tie: "电池 · 组件 · 链主", tieEn: "Cells · modules · the core", core: true, nodes: [A("601012", "隆基绿能"), A("002459", "晶澳科技"), A("688223", "晶科能源"), A("688472", "阿特斯")] },
      { tie: "逆变器 · 储能变流", tieEn: "Inverters · PCS", nodes: [A("300274", "阳光电源"), A("300763", "锦浪科技"), A("688390", "固德威")] },
      { tie: "储能电芯 · 电池", tieEn: "Storage cells", nodes: [A("300750", "宁德时代"), A("300014", "亿纬锂能"), A("002594", "比亚迪")] },
      { tie: "辅材 · 玻璃 / 胶膜", tieEn: "Glass / film", nodes: [A("601865", "福莱特"), A("603806", "福斯特")] },
    ],
  },

  // ===== 新能源车 =====
  ev: {
    flow: "锂钴资源 → 四大材料 → 动力电芯 → 三电 → 整车 → 补能",
    flowEn: "Lithium → materials → cells → e-drive → carmakers → charging",
    groups: [
      { tie: "锂 · 钴资源 · 上游", tieEn: "Lithium · cobalt", nodes: [A("002460", "赣锋锂业"), A("002466", "天齐锂业"), A("603799", "华友钴业")] },
      { tie: "正负极 / 电解液 / 隔膜", tieEn: "Cathode / anode / electrolyte / separator", nodes: [A("300073", "当升科技"), A("603659", "璞泰来"), A("002709", "天赐材料"), A("002812", "恩捷股份")] },
      { tie: "动力电芯 · 链主", tieEn: "Battery cells · the core", core: true, nodes: [A("300750", "宁德时代"), A("002594", "比亚迪"), A("300014", "亿纬锂能"), A("002074", "国轩高科")] },
      { tie: "三电 · 电机电控", tieEn: "E-drive · motor / control", nodes: [A("300124", "汇川技术"), A("002050", "三花智控")] },
      { tie: "整车 · 下游买家", tieEn: "Carmakers · downstream", nodes: [A("002594", "比亚迪"), U("TSLA", "特斯拉"), U("LI", "理想"), U("NIO", "蔚来"), U("XPEV", "小鹏"), A("601127", "赛力斯")] },
      { tie: "充电 · 补能", tieEn: "Charging", nodes: [A("300001", "特锐德")] },
    ],
  },

  // ===== 稀有 · 战略金属 =====
  "rare-metals": {
    flow: "稀土锂矿 → 冶炼 → 磁材深加工 → 新能源/机器人/军工",
    flowEn: "Mines → smelting → magnets → EV / robots / defense",
    groups: [
      { tie: "稀土矿 · 上游", tieEn: "Rare-earth mines", nodes: [A("600111", "北方稀土"), A("000831", "中国稀土"), A("600392", "盛和资源")] },
      { tie: "锂 / 钴 / 钼 资源", tieEn: "Lithium / cobalt / moly", nodes: [A("002460", "赣锋锂业"), A("603799", "华友钴业"), A("603993", "洛阳钼业")] },
      { tie: "冶炼 · 钨 / 钛", tieEn: "Smelting · tungsten / titanium", nodes: [A("600549", "厦门钨业"), A("600456", "宝钛股份")] },
      { tie: "磁材深加工 · 链主", tieEn: "Magnets · the value-add core", core: true, nodes: [A("300748", "金力永磁"), A("000970", "中科三环"), A("300224", "正海磁材")] },
    ],
  },

  // ===== 国防 · 军工 =====
  defense: {
    flow: "特种材料 → 航发 → 军用电子 → 武器/UAV → 整机平台",
    flowEn: "Materials → engines → electronics → weapons → platforms",
    groups: [
      { tie: "特种材料 · 钛/碳纤维/超导", tieEn: "Titanium / carbon fiber / superconductor", nodes: [A("688122", "西部超导"), A("600456", "宝钛股份"), A("300699", "光威复材")] },
      { tie: "航空发动机 · 心脏", tieEn: "Aero engines · the heart", nodes: [A("600893", "航发动力"), A("000738", "航发控制")] },
      { tie: "军用电子 · 芯片/红外", tieEn: "Mil-electronics · chips / IR", nodes: [A("002049", "紫光国微"), A("688002", "睿创微纳"), A("002214", "大立科技")] },
      { tie: "武器 · 无人机", tieEn: "Weapons · UAV", nodes: [A("002025", "航天电器"), A("002389", "航天彩虹")] },
      { tie: "整机平台 · 主战装备 · 链主", tieEn: "Platforms · the core", core: true, nodes: [A("600760", "中航沈飞"), A("000768", "中航西飞"), A("600038", "中直股份"), A("600150", "中国船舶")] },
    ],
  },
};
