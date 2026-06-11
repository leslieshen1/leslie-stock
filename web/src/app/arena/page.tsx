import { promises as fs } from "fs";
import path from "path";
import ArenaClient, { type Arena } from "./ArenaClient";

export const dynamic = "force-dynamic";

async function loadArena(): Promise<Arena | null> {
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
    return <main className="mx-auto max-w-5xl px-6 py-16 text-center text-muted">对决还没开赛 —— 等今晚收盘第一笔结账。</main>;
  return <ArenaClient arena={arena} />;
}
