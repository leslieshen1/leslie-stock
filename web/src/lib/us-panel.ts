import fs from "node:fs";
import path from "node:path";

export type Stance = { verdict: string; score: number; judgment: string; reasoning: string };
export type UsPanel = {
  rank?: number;
  name?: string;
  mcapB?: number | null;
  sector?: string;
  panel: {
    buffett: Stance;
    duan: Stance;
    serenity: Stance;
    druckenmiller: Stance;
    sentiment: Stance;
  };
  chain: {
    industry: string;
    layer: string;
    role: string;
    upstream?: string[];
    downstream?: string[];
  };
  divergence: string;
};

export function loadUsPanel(sym: string): UsPanel | null {
  const s = sym.toUpperCase();
  const candidates = [
    path.join(process.cwd(), "public", "data", "us-panels", `${s}.json`),
    path.resolve(process.cwd(), "..", "web", "public", "data", "us-panels", `${s}.json`),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const j = JSON.parse(raw) as UsPanel;
      if (j.panel) return j;
    } catch {
      // try next
    }
  }
  return null;
}
