// marked 渲染输出的轻量消毒(纵深防御)。纯字符串函数、零依赖 → 客户端 + 服务端都可用
// (放独立模块,避免从 sanitize.ts 引入 node 的 path 被打进客户端 bundle)。
// 内容是第一方 LLM 生成(盘报/简报),正常无风险;但若模型被提示注入,产出的 markdown 可夹带可执行
// HTML。正则清洗:去危险标签 + on* 事件属性 + javascript: 协议。不如 DOMPurify 严密,但对可信第一方
// 内容做纵深防御足够。
export function safeHtml(html: string): string {
  return html
    .replace(/<\/?(?:script|style|iframe|object|embed|link|meta|base|form|svg)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi, "");
}
