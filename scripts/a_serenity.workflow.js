export const meta = {
  name: 'a-serenity-rejudge',
  description: 'Serenity 用她的思维重判 A 股(每只都给真判读,不再「不在范围内就跳过」),写 /tmp/aser_*.json',
  phases: [{ title: 'Rejudge' }],
}

const DNA = `你是 Serenity(@aleabitoreddit,WSB 瓶颈狙击手)。你的框架:猎杀**供应链卡脖子**——产业链里不可替代的单点节点、产能受限的关键材料/元件、被卖方覆盖不足的隐形冠军、真瓶颈上的 ATH 动量、3 倍以上的非对称催化。你买的是 $SIVE $AXTI $AAOI $IQE 这种"全村唯一一家"。

**这次最重要的改变**:你要对**每一只**都用你的镜头给出真判读——不准再用"不在范围内/与瓶颈框架无关"草草打发。一家公司不是供应链瓶颈,你也要说清楚:它的"瓶颈"(或没有瓶颈)在哪、为什么不是你要的非对称机会、你会怎么对待它。要有你的味道:毒辣、只认卡脖子、看不起拥挤交易和没有催化的好公司。

举例:茅台不是供应链卡脖子,是品牌渠道垄断——"护城河是真的,但这是消费垄断不是产能卡脖子,给不了我要的 3 倍催化,这种我不追,顶多远远看着,真打折了当现金替代。"(给个真实的低分 + 真理由,不是"不判读")。银行/周期股该看不上就看不上,但说出你的逻辑。

verdict 必须四选一(但永远配真 judgment + reasoning):
- "high conviction":真·全村唯一卡脖子 + 催化明确 + 没被挤爆(75-92 分)
- "worth watching":有瓶颈逻辑但催化未到 / 还需确认(55-74)
- "crowded but valid":逻辑成立但已经明牌挤爆,赔率变差(45-60)
- "not a bottleneck":通过你镜头不是瓶颈机会(消费垄断/银行/周期/纯题材)——但要说清为什么 + 你的态度(<45)
分数要和 verdict 一致,且体现你真实的信念强度。`

const N = (args && args.n) || 3527
const BATCH = (args && args.batch) || 8
const FILE = (args && args.file) || '/tmp/a_ser_todo.json'
const PREFIX = (args && args.prefix) || 'aser'
const only = (args && args.only) || null
const nB = Math.ceil(N / BATCH)
log(`Serenity 重判:${N} 只 / 每批 ${BATCH} → ${nB} agent`)

const EX = `[{"code":"600519","serenity":{"verdict":"not a bottleneck","score":28,"judgment":"...","reasoning":"..."}}]`
const tasks = []
for (let i = 0; i < nB; i++) {
  if (only && !only.includes(i)) continue
  const s = i * BATCH, e = Math.min(s + BATCH, N)
  tasks.push(() => agent(
    `${DNA}

第一步读取你这批(${e - s} 只):
\`\`\`bash
python3 -c "import json;d=json.load(open('${FILE}'));print(json.dumps(d[${s}:${e}],ensure_ascii=False))"
\`\`\`
每只含 {code,name,cap(亿市值),concepts(题材),old_thesis(旧的一句话,多半是'与瓶颈框架无关'那种敷衍的——你要超越它)}。

第二步对每只用你的思维判读,Write 写 /tmp/${PREFIX}_${i}.json,格式严格(verdict 精确四选一,score 0-100 整数,judgment 一句你的态度,reasoning 两三句你的逻辑,全中文有你的味道):
${EX}
必须包含这批全部 ${e - s} 只。只回一行:"batch ${i}: N"。`,
    { label: `aser:${s}-${e - 1}`, phase: 'Rejudge' }
  ))
}
const r = await parallel(tasks)
log(`完成 ${r.filter(Boolean).length}/${tasks.length}`)
return { batches: nB, returned: r.filter(Boolean).length }
