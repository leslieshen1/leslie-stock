import fs from "fs";
import path from "path";

// 紧凑基本面记录(短 key,来自 fetchers/fundamentals.py 的 Yahoo .info 抽取)
export type Fundamentals = {
  pe?: number; fpe?: number; ps?: number; evE?: number; evR?: number;
  peg?: number; pb?: number; gm?: number; om?: number; pm?: number;
  roe?: number; roa?: number; de?: number; divY?: number;
  revG?: number; earnG?: number; fcf?: number; beta?: number;
  reco?: string; tgt?: number; px?: number; wkHi?: number; wkLo?: number; mcapB?: number;
};

// 读 us-fundamentals.json —— mtime 模块缓存:1.3M 文件每次个股页渲染都重解析会阻塞事件循环;
// 按文件 mtime 缓存解析结果,文件没变就直接复用(serverless 上文件不可变 → 每实例只解析一次),
// 文件一更新(mtime 变)自动重读 → 既快又不会读到旧数据。
let _fundCache: { mtime: number; map: Record<string, Fundamentals> } | null = null;
export function loadFundamentals(code: string): Fundamentals | null {
  try {
    const p = path.join(process.cwd(), "public", "data", "us-fundamentals.json");
    const mtime = fs.statSync(p).mtimeMs;
    if (!_fundCache || _fundCache.mtime !== mtime) {
      _fundCache = { mtime, map: (JSON.parse(fs.readFileSync(p, "utf-8")).stocks || {}) as Record<string, Fundamentals> };
    }
    const map = _fundCache.map;
    return map[code] || map[code.toUpperCase()] || null;
  } catch {
    return null;
  }
}
