export const meta = {
  name: 'a-panel-coverage',
  description: 'A股四方判读:对 /tmp/a_panel_todo.json 的 A 股生成 巴菲特/段永平/德鲁肯米勒/情绪(保留现有 Serenity),写 /tmp/a_batch_*.json',
  phases: [{ title: 'Analyze', detail: '每 agent 一批,读切片→四方判读→写 batch' }],
}

const DNA = `你在为产品「我不是股神 · Not a Stock God」生成四位投资大师对一批 **A 股(中国大陆股票)** 的判读。全部中文。第五位 Serenity(卡脖子狙击手)已有判读,不要生成,但下面会给你 Serenity 的结论作上下文,你的四方要和它形成真实分歧。

A 股特别背景(务必带入):政策敏感(产业政策/集采/监管能一夜改变逻辑);散户主导、波动大、题材轮动极快;国企看政策+分红、民企看老板+增长;警惕讲故事/蹭题材/老千股;消费/制造龙头(茅台/宁德/比亚迪等)有真护城河。要诚实有区分度,题材股/周期股/银行该打低分就打低分,绝不注水。

四位大师(每位:0-100 分 + 精确 verdict + judgment 一句 + reasoning 两三句):
- buffett 巴菲特:买公司不买股票,宽护城河 + ≥30% 安全边际 + 能力圈。A 股消费龙头可能是宽护城河;银行/周期看估值;贵的好公司只观察。verdict ∈ {"伟大生意·合理价买入","伟大生意·太贵观察","平庸生意·无宽护城河","长期不可预测·避开","价值陷阱·避开"}
- duan 段永平:中国顶级价投,熟悉这些公司。看商业模式 + 本分文化,看懂了贵也敢重仓,Stop Doing(不碰看不懂的/不投机/不蹭题材)。最毒辣识别讲故事的公司。verdict ∈ {"顶级好生意·重仓","好生意·等合理价","商业模式一般·不值得","文化不本分·避开"}
- druckenmiller 德鲁肯米勒:自上而下看产业政策顺风(新能源/AI/半导体国产替代/出海)+ 资金动量,不看估值骑最强的马,政策/趋势转向就砍或空。verdict ∈ {"顺风重仓","趋势在·标准仓","逆流·不碰","趋势已转·砍或空"}
- sentiment 情绪面:A 股散户主导,情绪/资金/拥挤度极关键。题材冰点+资金进就反向埋伏,过热拥挤+全民追就见顶警惕。verdict ∈ {"情绪顺风·顺势","冰点+资金进·反向埋伏","过热拥挤·见顶警惕","无情绪无资金·没戏"}

分数必须与 verdict 一致(伟大生意·合理价买入→75+;价值陷阱·避开→<35;顶级好生意·重仓→78+;not 等)。四人之间 + 与 Serenity 之间要有真实分歧。`

const N = (args && args.n) || 3527
const BATCH = (args && args.batch) || 8
const FILE = (args && args.file) || '/tmp/a_panel_todo.json'
const PREFIX = (args && args.prefix) || 'a_batch'
const only = (args && args.only) || null
const nBatches = Math.ceil(N / BATCH)
log(`A股四方:${N} 只 / 每批 ${BATCH} → ${nBatches} agent · ${FILE}`)

const EXAMPLE = `[{"code":"600519","panel":{"buffett":{"verdict":"伟大生意·太贵观察","score":68,"judgment":"...","reasoning":"..."},"duan":{"verdict":"顶级好生意·重仓","score":82,"judgment":"...","reasoning":"..."},"druckenmiller":{"verdict":"趋势在·标准仓","score":55,"judgment":"...","reasoning":"..."},"sentiment":{"verdict":"过热拥挤·见顶警惕","score":48,"judgment":"...","reasoning":"..."}},"divergence":"段永平和Serenity一个看生意一个看瓶颈都不否定,但巴菲特嫌贵、情绪面嫌挤——分歧在'好公司'与'好价格'。"}]`

const tasks = []
for (let i = 0; i < nBatches; i++) {
  if (only && !only.includes(i)) continue
  const start = i * BATCH
  const end = Math.min(start + BATCH, N)
  tasks.push(() => agent(
    `${DNA}

第一步,读取你这一批的股票(${end - start} 只):
\`\`\`bash
python3 -c "import json; d=json.load(open('${FILE}')); print(json.dumps(d[${start}:${end}], ensure_ascii=False))"
\`\`\`
每只含 {code,name,cap(亿RMB市值),sector,layer,concepts(题材),ser_score(Serenity分),ser_verdict,ser_thesis(Serenity一句话,是很好的生意摘要)}。用 ser_thesis + concepts + 你对这家中国公司的了解判读。

第二步,对每只生成 巴菲特/段永平/德鲁肯米勒/情绪 四方(不含 Serenity)+ divergence(一句话点出四方之间及与 Serenity 的分歧本质)。

第三步,用 Write 工具写到 /tmp/${PREFIX}_${i}.json,JSON 数组,格式严格如下(verdict 用精确字符串,score 0-100 整数,字段名用 code):
${EXAMPLE}
必须包含这一批全部 ${end - start} 只。合法 JSON、中文直接写。

只返回一行:"batch ${i}: N stocks"。`,
    { label: `a-panel:${start}-${end - 1}`, phase: 'Analyze' }
  ))
}

const results = await parallel(tasks)
const ok = results.filter(Boolean).length
log(`完成:${ok}/${tasks.length} 批返回`)
return { batches: nBatches, returned: ok }
