// 单股神补跑 workflow。加股神时:Workflow({scriptPath: 此文件, args:{dir,count,name,prompt,verdicts}})
// args 由主循环从 data/masters.json 取对应 master 的字段传入。每个 agent 只跑这一个股神,
// 输出 {sym,verdict,score,judgment,reasoning},再用 ingest_one_master.py 把它 append 进每只票的 panel。
export const meta = {
  name: 'us-one-master',
  description: '单股神补跑·按一个 master 给一批票打分(append,不重跑别人)',
  phases: [{ title: '补跑' }],
}

const { dir, count, name, prompt, verdicts = [] } = args
const vlist = verdicts.join(' / ')

const SCHEMA = {
  type: 'object',
  properties: {
    sym: { type: 'string' },
    verdict: { type: 'string' },
    score: { type: 'number' },
    judgment: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['sym', 'verdict', 'score', 'judgment', 'reasoning'],
}

const idxs = Array.from({ length: count }, (_, i) => i)
const results = await parallel(idxs.map((i) => () =>
  agent(
    `用 Read 工具读取文件:\n${dir}/${i}.json\n那是一只股票(sym/name/sector/industry/mcapB/price)。前提:这家公司的生意/产业链/财务你都已看懂,禁止用"看不懂/能力圈外"当结论,必须对生意本身下实质判断。\n\n你只代表【${name}】一个人的视角,不参考、不折中别人:\n${prompt}\n\n输出严格符合 schema 的对象:sym=文件里的 sym;verdict 从 {${vlist}} 里选;score 0-100(${name}对这只票的信念);judgment 一句话(${name}口吻);reasoning 2-3 句(只落在 ${name} 关心的东西)。真实了解就深入答,确实不了解就如实说明并给低 score,绝不编造。`,
    { label: `${name}#${i}`, phase: '补跑', schema: SCHEMA }
  )
))
return results.filter(Boolean)
