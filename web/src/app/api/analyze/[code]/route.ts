import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { LESLIE_STOCK_ROOT, ANALYSES_DIRECTORY, loadAnalysis } from "@/lib/data";
import { safeCode, safeMarket } from "@/lib/sanitize";

type Status = "ok" | "pending" | "absent";

function lockPath(code: string, market: string): string {
  return path.join(ANALYSES_DIRECTORY, `${code}_${market}.lock`);
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const { code } = await ctx.params;
  const url = new URL(req.url);
  const c = safeCode(code);
  const m = safeMarket(url.searchParams.get("market") || "a");
  if (!c || !m) {
    return NextResponse.json({ status: "absent" as Status }, { status: 400 });
  }

  const data = loadAnalysis(c, m);
  if (data) {
    return NextResponse.json({ status: "ok" as Status, data });
  }
  if (fs.existsSync(lockPath(c, m))) {
    return NextResponse.json({ status: "pending" as Status });
  }
  return NextResponse.json({ status: "absent" as Status }, { status: 404 });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const { code } = await ctx.params;
  const url = new URL(req.url);
  const c = safeCode(code);
  const m = safeMarket(url.searchParams.get("market") || "a");
  if (!c || !m) {
    return NextResponse.json({ status: "absent" as Status }, { status: 400 });
  }
  const force = url.searchParams.get("force") === "1";

  // 云端部署：只读 cache，不能 spawn Python
  // 通过 VERCEL / READ_ONLY 环境变量检测
  const readOnly = !!process.env.VERCEL || process.env.READ_ONLY === "1";

  if (readOnly) {
    const cached = loadAnalysis(c, m);
    if (cached) {
      return NextResponse.json({ status: "ok" as Status, data: cached });
    }
    return NextResponse.json(
      {
        status: "absent" as Status,
        message:
          "云端只读模式：实时分析在本地 Claude 对话里跑。这只股票还没有缓存分析。",
      },
      { status: 404 }
    );
  }

  // 本地：可以 spawn Python 子进程跑新分析
  const lock = lockPath(c, m);

  if (fs.existsSync(lock)) {
    return NextResponse.json({ status: "pending" as Status });
  }

  if (!force) {
    const cached = loadAnalysis(c, m);
    if (cached) {
      return NextResponse.json({ status: "ok" as Status, data: cached });
    }
  }

  fs.mkdirSync(ANALYSES_DIRECTORY, { recursive: true });
  fs.writeFileSync(lock, new Date().toISOString());

  const args = ["run", "python", "-m", "screener.analyze_one", c, m, "--quiet"];
  if (force) args.push("--force");

  const uvBin = process.env.UV_BIN || "/opt/homebrew/bin/uv";

  const logFile = path.join(ANALYSES_DIRECTORY, `${c}_${m}.log`);
  const out = fs.openSync(logFile, "w");
  const err = fs.openSync(logFile, "a");

  const child = spawn(uvBin, args, {
    cwd: LESLIE_STOCK_ROOT,
    detached: true,
    stdio: ["ignore", out, err],
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`,
    },
  });

  child.on("exit", () => {
    try {
      fs.unlinkSync(lock);
    } catch {
      /* ignore */
    }
  });
  child.unref();

  return NextResponse.json({ status: "started" as const, pid: child.pid });
}
