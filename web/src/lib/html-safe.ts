// marked 渲染输出的轻量消毒(纵深防御)。纯字符串函数、零依赖 → 客户端 + 服务端都可用
// (放独立模块,避免从 sanitize.ts 引入 node 的 path 被打进客户端 bundle)。
// 内容是第一方 LLM 生成(盘报/简报),正常无风险;但若模型被提示注入,产出的 markdown 可夹带可执行
// HTML。正则清洗:去危险标签 + on* 事件属性 + javascript: 协议。不如 DOMPurify 严密,但对可信第一方
// 内容做纵深防御足够。
export function safeHtml(html: string): string {
  return html
    // ① 成对去除危险元素(含内容,否则只去标签会把 <script> 里的文本留下)
    .replace(/<(script|style|iframe|object|embed|svg|form)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    // ② 去残余单个危险标签
    .replace(/<\/?(?:script|style|iframe|object|embed|link|meta|base|form|svg)\b[^>]*>/gi, "")
    // ② 只在「标签内部」清理 on* 事件属性 + javascript:/data: 协议 —— 用 <[^>]+> 框住,
    //    绝不碰标签外正文(否则正文里合法的 `onClick=`、代码块里的 `onload=` 会被误删,见审计回归 H1)。
    .replace(/<[^>]+>/g, (tag) => {
      let t = tag
        .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\s(?:href|src|xlink:href|formaction|action)\s*=\s*(?:"\s*(?:javascript|data):[^"]*"|'\s*(?:javascript|data):[^']*'|(?:javascript|data):[^\s>]+)/gi, "");
      // ③ <a> 外链强制 rel=noopener nofollow(防 window.opener 劫持 + 不给被注入的外链传递 SEO 权重)
      if (/^<a\b/i.test(t) && !/\brel\s*=/i.test(t)) t = t.replace(/^<a\b/i, '<a rel="noopener nofollow"');
      return t;
    });
}
