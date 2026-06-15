export const meta = {
  name: 'a-industry-classify',
  description: 'A股产业板块归类:用 opus 对 /tmp/a_ind_todo.json 的 A 股按公司主业判一个产业板块,写 /tmp/aind_*.json',
  phases: [{ title: 'Classify' }],
}

const TAX = `半导体、消费电子、电子元件、计算机软件、通信、创新药生物药、医疗器械、中药医药商业、电力设备、光伏风电储能、汽车整车、汽车零部件、机械设备、国防军工、基础化工、新材料、有色金属、钢铁、煤炭、石油石化、电力公用事业、银行、证券保险、房地产、建筑建材、食品饮料、农林牧渔、家用电器、轻工纺服、商贸零售、交通运输、传媒互联网、环保、综合`

const N = (args && args.n) || 5510
const BATCH = (args && args.batch) || 60
const FILE = (args && args.file) || '/tmp/a_ind_todo.json'
const PREFIX = (args && args.prefix) || 'aind'
const only = (args && args.only) || null
const nB = Math.ceil(N / BATCH)
log(`A股产业板块:${N} 只 / 每批 ${BATCH} → ${nB} agent`)

const tasks = []
for (let i = 0; i < nB; i++) {
  if (only && !only.includes(i)) continue
  const s = i * BATCH, e = Math.min(s + BATCH, N)
  tasks.push(() => agent(
    `你是中国 A 股研究员,给一批 A 股按**公司主营业务**各归入一个产业板块。用你对这些中国公司的了解判断(不要被题材概念带偏:比亚迪是汽车整车不是半导体,东方财富是证券保险,隆基是光伏)。

板块只能从这个清单里选一个(选最贴主业的):${TAX}

第一步读取你这批(${e - s} 只):
\`\`\`bash
python3 -c "import json;d=json.load(open('${FILE}'));print(json.dumps(d[${s}:${e}],ensure_ascii=False))"
\`\`\`
每只含 {code,name,cap(亿市值),concepts(题材,仅供参考)}。靠 name + 你的知识定主业。

第二步用 Write 写 /tmp/${PREFIX}_${i}.json,格式严格:JSON 数组 [{"code":"600519","ind":"食品饮料"},...],ind 必须是清单里的词,包含这批全部 ${e - s} 只。
只回一行:"batch ${i}: N"。`,
    { label: `aind:${s}-${e - 1}`, phase: 'Classify' }
  ))
}
const r = await parallel(tasks)
log(`完成 ${r.filter(Boolean).length}/${tasks.length}`)
return { batches: nB, returned: r.filter(Boolean).length }
