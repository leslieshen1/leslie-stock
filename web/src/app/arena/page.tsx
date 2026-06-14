import { promises as fs } from "fs";
import path from "path";
import ArenaClient, { type Arena } from "./ArenaClient";

export const dynamic = "force-dynamic";

async function loadArena(): Promise<Arena | null> {
  // 云引擎(GitHub Actions)收盘后直接 commit arena.json —— 这里优先实时读仓库,
  // 页面 2 分钟内自动更新,不依赖重新部署;读不到再回退构建时打包的本地文件。
  const token = process.env.ARENA_GH_TOKEN;
  if (token) {
    try {
      const r = await fetch(
        "https://api.github.com/repos/leslieshen1/leslie-stock/contents/web/public/data/arena.json?ref=main",
        {
          headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github.raw+json" },
          next: { revalidate: 120 },
        }
      );
      if (r.ok) return (await r.json()) as Arena;
    } catch { /* 回退本地 */ }
  }
  try {
    const p = path.join(process.cwd(), "public", "data", "arena.json");
    return JSON.parse(await fs.readFile(p, "utf-8"));
  } catch {
    return null;
  }
}

export default async function ArenaPage() {
  const arena = await loadArena();
  if (!arena)
    return <main className="mx-auto max-w-6xl px-6 py-16 text-center text-muted">对决还没开赛 —— 等今晚收盘第一笔结账。</main>;
  return <ArenaClient arena={arena} />;
}
