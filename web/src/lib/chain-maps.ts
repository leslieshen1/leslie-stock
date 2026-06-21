// 明星产业链「关系图」手工策展数据 —— 知名公司为中心的供应链(英伟达另在 NvidiaChain.tsx,带 ADR/海外标灰特例)。
// 不是行业板块链;是「某个明星公司 + 它的上游供应商 / 下游客户 / 同场对手」。公司全部已核对在库。
// cn:true = A股(代码走 a-market 取实时涨跌、region=CN);否则美股(items/market、region=US)。core=链主(高亮)。

export type CNode = { t: string; name: string; cn?: boolean; label?: boolean; note?: string };
export type CGroup = { tie: string; tieEn: string; core?: boolean; nodes: CNode[] };
export type ChainMapDef = { flow: string; flowEn: string; groups: CGroup[] };

const A = (t: string, name: string): CNode => ({ t, name, cn: true });
const U = (t: string, name: string): CNode => ({ t, name });
// 非可点灰标签:私有公司(默认"未上市")或我们未覆盖的市场(传 note,如"港股·未覆盖")
const L = (name: string, note?: string): CNode => ({ t: "", name, label: true, note });

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

  // ===== 字节跳动 ByteDance(私有 · AI 生态)=====
  bytedance: {
    flow: "AI 算力 / 服务器 → 字节跳动(私有) → TikTok 云 / 互联网对手",
    flowEn: "AI compute / servers → ByteDance (private) → cloud / internet rivals",
    groups: [
      { tie: "AI 算力 · 进口 + 国产替代(被限购)", tieEn: "AI compute · imports + domestic", nodes: [U("NVDA", "英伟达"), A("688256", "寒武纪"), A("688041", "海光信息")] },
      { tie: "服务器 · 光模块", tieEn: "Servers · optics", nodes: [A("000977", "浪潮信息"), A("601138", "工业富联"), A("300308", "中际旭创")] },
      { tie: "字节跳动 · 抖音 / TikTok / 豆包 · 链主", tieEn: "ByteDance · Douyin / TikTok / Doubao", core: true, nodes: [L("字节跳动")] },
      { tie: "TikTok 美国云 · 合作", tieEn: "TikTok US cloud · partner", nodes: [U("ORCL", "甲骨文")] },
      { tie: "中国互联网巨头 · 对手", tieEn: "China internet giants · rivals", nodes: [U("BABA", "阿里巴巴"), U("BIDU", "百度"), U("PDD", "拼多多"), U("JD", "京东")] },
    ],
  },

  // ===== 物理 AI · 具身智能(机器人全产业链)—— 卖铲的吃饭最早,本体多在一级市场 =====
  "physical-ai": {
    flow: "底座 → 训练场 → 感知 → 关节 → 本体 → 下游 · 卖铲的吃饭最早",
    flowEn: "Compute → simulation → perception → joints → robots → apps",
    groups: [
      { tie: "① 底座 · 算力 / 芯片 / 系统(英伟达=铲王)", tieEn: "Compute / chips / systems", nodes: [
        U("NVDA", "英伟达"), A("601138", "工业富联"), A("000977", "浪潮信息"), A("603019", "中科曙光"), A("688256", "寒武纪"), A("688041", "海光信息"), A("300496", "中科创达"), U("BB", "黑莓 QNX"), U("QCOM", "高通"), U("MBLY", "Mobileye"),
        L("华为昇腾"), L("摩尔线程"), L("地平线", "港股·未覆盖"), L("黑芝麻", "港股·未覆盖")] },
      { tie: "② 训练场 · 世界模型 / 仿真 / 数据(壁垒最高)", tieEn: "World models / simulation / data", nodes: [
        U("NVDA", "英伟达 Cosmos/Isaac"), A("688507", "索辰科技"), A("688083", "中望软件"), A("301313", "凡拓数创"), A("300825", "阿尔特"),
        L("光轮智能 · 合成数据"), L("智元 Genie Sim"), L("五一视界 51WORLD", "港股·未覆盖"), L("Skild AI", "海外·未上市"), L("Applied Intuition", "海外·未上市")] },
      { tie: "③ 感知 · 视觉 / 激光雷达 / 力觉 / 触觉", tieEn: "Vision / lidar / force / tactile", nodes: [
        A("688322", "奥比中光"), A("688400", "凌云光"), A("688003", "天准科技"), U("HSAI", "禾赛"), A("603662", "柯力传感"),
        L("速腾聚创", "港股·未覆盖"), L("图达通"), L("帕西尼 · 电子皮肤"), L("坤维科技 · 六维力"), L("他山科技 · 触觉")] },
      { tie: "④ 关节 · 减速器 / 丝杠(落地最快)", tieEn: "Reducers / screws", nodes: [
        A("688017", "绿的谐波"), A("002472", "双环传动"), A("002896", "中大力德"), A("000837", "秦川机床"), A("603667", "五洲新春"), A("603009", "北特科技"), A("300100", "双林股份"), A("601100", "恒立液压"), A("001306", "夏厦精密"), L("来福谐波")] },
      { tie: "⑤ 关节 · 电机 / 总成 / 轴承", tieEn: "Motors / assembly / bearings", nodes: [
        A("300124", "汇川技术"), A("603728", "鸣志电器"), A("003021", "兆威机电"), A("002050", "三花智控"), A("601689", "拓普集团"), A("300718", "长盛轴承"), A("002046", "国机精工")] },
      { tie: "⑥ 本体 · 整机(最性感最挤 · 多为一级市场)", tieEn: "Humanoid bodies (mostly private)", nodes: [
        U("TSLA", "特斯拉 Optimus"), U("XPEV", "小鹏 IRON"), A("300607", "拓斯达"),
        L("宇树 Unitree", "拟上市"), L("智元 · 远征", "拟上市"), L("优必选 · Walker S", "港股·未覆盖"), L("傅利叶"), L("银河通用"), L("Figure AI"), L("波士顿动力"), L("Agility"), L("Apptronik"), L("1X · Neo"), L("星动纪元"), L("加速进化"), L("乐聚"), L("逐际动力"), L("云深处"), L("小米", "港股·未覆盖")] },
      { tie: "⑦ 下游 · 第一战场(车 / 工业 / 软件)", tieEn: "Downstream apps", nodes: [
        A("688165", "埃夫特"), A("688777", "中控技术"), A("600845", "宝信软件"), A("002415", "海康威视"),
        L("ABB / 发那科 / 库卡 / 安川", "海外工业机器人")] },
    ],
  },
};
