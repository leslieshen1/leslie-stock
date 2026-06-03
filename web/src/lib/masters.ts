// 股神注册表(前端展示子集)。规范源在 data/masters.json。
// 加一个股神:这里加一条(顺序即面板/筛选里的顺序),panel 里的 key 与之对应。
export type MasterGroup = "value" | "alpha" | "flow";
export type Master = { key: string; name: string; school: string; group: MasterGroup };

export const MASTERS: Master[] = [
  { key: "buffett", name: "巴菲特", school: "价值 · 护城河", group: "value" },
  { key: "duan", name: "段永平", school: "价值 · 商业模式", group: "value" },
  { key: "serenity", name: "Serenity", school: "alpha · 供应链瓶颈", group: "alpha" },
  { key: "druckenmiller", name: "德鲁肯米勒", school: "alpha · 宏观流动性", group: "alpha" },
  { key: "sentiment", name: "情绪资金面", school: "盘口 · 资金流", group: "flow" },
];
