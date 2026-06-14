export const meta = {
  name: 'panel-coverage',
  description: '五方覆盖收尾:对 /tmp/panel_todo.json 里 ~556 只未判读美股批量生成五方判读,写 /tmp/panel_batch_*.json',
  phases: [{ title: 'Analyze', detail: '每 agent 一批,读 todo 切片→五方判读→写 batch 文件' }],
}

// 五方 DNA(每个 agent 都带上,保证人格与合法 verdict 一致)
const DNA = `你在为产品「我不是股神 · Not a Stock God」生成五位投资大师对一批美股的判读。全部用中文(大师都说中文)。这些大多是中小盘/微盘,要诚实、有区分度——很多就是平庸生意/价值陷阱/不是瓶颈,该打低分就打低分,绝不注水。一家没收入的 8000 万市值生科,在巴菲特眼里不是好生意。

五位大师(每位:0-100 分 + 从下面选一个精确 verdict + judgment 一句话 + reasoning 两三句):
- buffett 巴菲特:买公司不买股票,要宽护城河 + ≥30% 安全边际 + 能力圈内。贵的好公司也只观察。verdict ∈ {"伟大生意·合理价买入","伟大生意·太贵观察","平庸生意·无宽护城河","长期不可预测·避开","价值陷阱·避开"}
- duan 段永平:看商业模式 + 本分文化,看懂了贵一点也敢重仓,Stop Doing(不碰看不懂的/不投机/不题材)。verdict ∈ {"顶级好生意·重仓","好生意·等合理价","商业模式一般·不值得","文化不本分·避开"}
- serenity 卡脖子狙击手:只重仓产业链里不可替代的瓶颈环节,带硬止损,明牌拥挤的票即使逻辑对也只旁证。verdict ∈ {"high conviction","worth watching","crowded but valid","not a bottleneck"}
- druckenmiller 德鲁肯米勒:自上而下看宏观趋势 + 动量,不看估值只骑最强的马,趋势转了就砍或做空。verdict ∈ {"顺风重仓","趋势在·标准仓","逆流·不碰","趋势已转·砍或空"}
- sentiment 情绪面:看资金/拥挤度/情绪周期,冰点 + 资金流入就反向埋伏,过热拥挤就见顶警惕。verdict ∈ {"情绪顺风·顺势","冰点+资金进·反向埋伏","过热拥挤·见顶警惕","无情绪无资金·没戏"}

分数必须与 verdict 一致(伟大生意·合理价买入→75+;价值陷阱·避开→<35;not a bottleneck→<45;顶级好生意·重仓→78+)。五人之间要有真实分歧,不要五人同调。

每只另给:
- chain: {"industry":产业链名(中文),"layer":"上游"|"中游"|"下游"|"","role":它在链条里干什么(一句),"upstream":[≤5 tickers],"downstream":[≤5 tickers]}。若不属于真实产业链(银行/REIT/必需消费/纯主题),layer 设 "" 且 upstream/downstream 为 []。
- divergence: 一句话点出五人分歧的本质(中文)。`

const N = (args && args.n) || 556
const BATCH = (args && args.batch) || 8
const FILE = (args && args.file) || '/tmp/panel_todo.json'
const PREFIX = (args && args.prefix) || 'panel_batch'
const nBatches = Math.ceil(N / BATCH)
log(`五方覆盖:${N} 只 / 每批 ${BATCH} → ${nBatches} 个 agent · ${FILE}`)

const EXAMPLE = `[{"sym":"GPRO","panel":{"buffett":{"verdict":"平庸生意·无宽护城河","score":28,"judgment":"...","reasoning":"..."},"duan":{"verdict":"商业模式一般·不值得","score":30,"judgment":"...","reasoning":"..."},"serenity":{"verdict":"not a bottleneck","score":25,"judgment":"...","reasoning":"..."},"druckenmiller":{"verdict":"逆流·不碰","score":22,"judgment":"...","reasoning":"..."},"sentiment":{"verdict":"无情绪无资金·没戏","score":30,"judgment":"...","reasoning":"..."}},"chain":{"industry":"消费电子 / 运动相机","layer":"下游","role":"做运动相机硬件,卖给消费者","upstream":["SONY","AMBA"],"downstream":[]},"divergence":"五人少见一致看空:生意平庸+无瓶颈+趋势弱+无资金,只是程度不同。"}]`

const only = (args && args.only) || null   // 只跑指定 batch 索引(失败重跑用)
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
每只含 {sym,name,mcapB(十亿美元市值),sector,industry,price,pct,desc(公司简介)}。用 desc + 你的知识判读;市值很小的多半该低分。

第二步,对每只生成五方判读 + chain + divergence。

第三步,用 Write 工具把结果写到 /tmp/${PREFIX}_${i}.json,内容是一个 JSON 数组,每只一个对象,格式严格如下(verdict 必须用上面列的精确字符串,score 是 0-100 整数):
${EXAMPLE}
必须包含这一批全部 ${end - start} 只。确保是合法 JSON(无尾逗号、正确转义、中文直接写)。

只返回一行:"batch ${i}: N stocks"。`,
    { label: `panel:${start}-${end - 1}`, phase: 'Analyze' }
  ))
}

const results = await parallel(tasks)
const ok = results.filter(Boolean).length
log(`完成:${ok}/${nBatches} 批返回`)
return { batches: nBatches, returned: ok }
