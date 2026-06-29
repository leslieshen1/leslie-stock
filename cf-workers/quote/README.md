# stockgod-quote · Cloudflare Worker

把 Vercel `/api/quote`(个股实时报价)搬到 Cloudflare Worker,省 Vercel 函数调用 / Origin Transfer / CPU(账单大头)。

- **逻辑**:美股→Nasdaq /info;A股/港股→腾讯(latin1 解码取数字,绕过 workerd 不支持 GBK);腾讯挂→Yahoo。与 Vercel 版输出完全一致(`{quotes:{SYM:{price,pct,session,prevClose}}, ts}`)。
- **缓存**:`caches.default` 按时段(任一市场开盘 20s / 全休市 600s + 长 SWR)。
- **CORS**:`Access-Control-Allow-Origin: *`,前端跨域可调。
- Vercel `/api/quote` **保留**:服务端内部调用(market / sector-sessions 的盘前 overlay)+ 前端兜底,不动。

---

## 部署(你来跑 —— 需要你的 Cloudflare 账号,我碰不了你的 token)

```bash
cd cf-workers/quote
npm install                 # 装 wrangler
npx wrangler login          # 浏览器登录你的 Cloudflare 账号(只这一步要你授权)
npx wrangler deploy         # 部署,输出地址 https://stockgod-quote.<你的子域>.workers.dev
```

### 部署后必做:实测 CF 出口能不能抓到上游(这是唯一不确定点)

```bash
# 把下面 URL 换成你 deploy 输出的地址
curl "https://stockgod-quote.<你的子域>.workers.dev/?syms=NVDA,AAPL,600519.SS,000858.SZ"
```

- 回出 4 只票的 price/pct = **通过** ✅(CF 出口能抓 Nasdaq + 腾讯)。
- 美股(NVDA/AAPL)空、A股(6005xx)有 = Nasdaq 拦了 CF IP → 见下方「降级」。
- 全空 = 出口被拦 → 暂时别切,回我。

连打两次同一 URL,第二次很快返回 = 边缘缓存生效。

---

## 切到 CF(实测通过后)

在 **Vercel → 项目 → Settings → Environment Variables** 加:

```
NEXT_PUBLIC_QUOTE_URL = https://stockgod-quote.<你的子域>.workers.dev
```

然后重新部署前端(`gh workflow run deploy.yml`)。前端 5 个轮询点(arena / 详情页页头价 + 估值 / 自选 / 产业链港台韩节点)就改打 CF,Vercel 的 quote 函数调用直接塌下去。

**回滚**:删掉这个 env 重新部署,前端立刻退回 Vercel `/api/quote`,零风险。

---

## 可选:挂自定义域(更稳)

`*.workers.dev` 的 Cache API 可用但不如 zone 稳,且个别网络会拦 `workers.dev`。若 `stockgod.xyz` 的 DNS 在 Cloudflare,可在 **Workers → 你的 Worker → Settings → Domains & Routes** 加 `quote.stockgod.xyz`,再把上面的 env 换成它。

## 降级(若 Nasdaq 拦 CF IP)

把 `src/index.ts` 的 `usQuote` 改成走 Yahoo(`yahooQuote`)或回 Vercel `/api/quote` 取美股,A股/港股继续走 CF 腾讯。或美股仍留 Vercel、只把 A股/港股切 CF(前端按后缀分流)。先实测再说,大概率不用。

## CF 免费额度

Workers 免费 10 万请求/天 + Cache API 免费。本站轮询量(月 ~百万级)在免费额度内,基本零成本。
