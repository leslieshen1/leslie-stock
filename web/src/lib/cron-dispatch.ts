// Vercel Cron → 准点派发 GitHub workflow,绕开 GitHub 自家 schedule 在本仓库
// 数小时延迟 / 常丢的老毛病。报告仍在 GitHub 上用 gpt-5.5 生成,只是触发器换成准点的。
//
// 鉴权:Vercel 给 cron 请求自动带 Authorization: Bearer ${CRON_SECRET}。
// 派发:用 GH_DISPATCH_TOKEN(细粒度 PAT,仅本 repo 的 Actions:write)调 GitHub API。
// 两个 env 没配 → 503(优雅降级,不误触发)。

const REPO = "leslieshen1/leslie-stock";

export async function dispatchWorkflow(req: Request, workflow: string): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, error: "CRON_SECRET 未配置" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return Response.json({ ok: false, error: "GH_DISPATCH_TOKEN 未配置" }, { status: 503 });

  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "content-type": "application/json",
          "user-agent": "stockgod-cron",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );
    if (r.status === 204) return Response.json({ ok: true, workflow, dispatched: true });
    const detail = (await r.text()).slice(0, 300);
    return Response.json({ ok: false, workflow, status: r.status, detail }, { status: 502 });
  } catch (e) {
    return Response.json({ ok: false, workflow, error: String(e).slice(0, 200) }, { status: 502 });
  }
}
