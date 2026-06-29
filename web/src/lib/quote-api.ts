// 个股报价 API 基址。默认走 Vercel /api/quote;配了 NEXT_PUBLIC_QUOTE_URL(指向 CF Worker)就走 CF,
// 省 Vercel 函数调用 / Origin Transfer。切换零代码改动:Vercel 加这个 env 重新部署即切,删掉即回退。
// 前端所有高频报价轮询(arena / 详情页 LivePrice+LiveValuation / 自选 / 产业链港台韩节点)统一走这里。
// 注:服务端内部调用(market / sector-sessions 的盘前 overlay)仍用同源 /api/quote,不走这里。
// 详见 cf-workers/quote/README.md。
export const QUOTE_URL = process.env.NEXT_PUBLIC_QUOTE_URL || "/api/quote";
