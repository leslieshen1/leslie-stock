import { ImageResponse } from "next/og";
import { loadUsPanel } from "@/lib/us-panel";
import { loadAnalysis } from "@/lib/data";
import { loadFundamentals } from "@/lib/fundamentals";
import { safeCode } from "@/lib/sanitize";

// 个股分享卡(OG 图)。一个路由覆盖全部个股:发链接到 X/微信/Telegram,预览自动是这张卡。
// 成本:只在"被分享"时由平台爬虫抓一次,边缘缓存兜住(下面 CDN 头),不在用户浏览路径上 → 极低。
// 中文:Satori 默认字体不含 CJK → 运行时按"卡上实际出现的字"去 Google Fonts 抓子集字体(几个字、很小)。
export const dynamic = "force-dynamic";

const C = { bg: "#0B0E11", text: "#E6EDF3", muted: "#8B98A5", coral: "#FF7A45" };

async function loadFont(text: string): Promise<{ name: string; data: ArrayBuffer; weight: 400; style: "normal" }[] | undefined> {
  try {
    const uniq = encodeURIComponent([...new Set(text.split(""))].join(""));
    const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@700&text=${uniq}`;
    // IE11 UA → Google Fonts 返回 woff(非 woff2),Satori 能用
    const css = await (await fetch(cssUrl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko" } })).text();
    const url = css.match(/src:\s*url\(([^)]+\.(?:woff|ttf|otf))\)/)?.[1];
    if (!url) return undefined;
    const data = await (await fetch(url)).arrayBuffer();
    return [{ name: "Noto", data, weight: 400, style: "normal" }];
  } catch {
    return undefined;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = safeCode(url.searchParams.get("code") || "") || "";
    const mraw = (url.searchParams.get("market") || "a").toLowerCase();
    const m = (["a", "hk", "us", "kr"].includes(mraw) ? mraw : "a") as "a" | "hk" | "us" | "kr";

    const panel = code ? loadUsPanel(code, m) : null;
    const initial = panel ? null : code ? loadAnalysis(code, m === "kr" ? "us" : m) : null;
    const fund = code ? loadFundamentals(code) : null;
    const name = panel?.name || initial?.name || code || "我不是股神";
    const sector = panel?.sector || panel?.chain?.industry || initial?.sector || "";
    const mkt = m === "a" ? "A 股" : m === "hk" ? "港股" : m === "kr" ? "韩股" : "美股";
    const price = fund?.px != null ? `${m === "us" ? "$" : m === "hk" ? "HK$" : "¥"}${fund.px}` : "";

    const text =
      `${name}${code}${sector}${mkt}${price}我不是股神NotaStockGod五方独立判读聪明钱持仓段永平巴菲特非投资建议AI模拟stockgod.xyz0123456789$¥.%·/ `;
    const fonts = await loadFont(text);

    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: C.bg, padding: "62px 72px", justifyContent: "space-between", fontFamily: "Noto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", fontSize: 32, color: C.coral, fontWeight: 700 }}>我不是股神</div>
            <div style={{ display: "flex", fontSize: 26, color: C.muted, border: `2px solid #2a2f37`, borderRadius: 12, padding: "6px 18px" }}>{mkt}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 92, fontWeight: 700, color: C.text, lineHeight: 1.05 }}>{name}</div>
            <div style={{ display: "flex", alignItems: "baseline", marginTop: 18 }}>
              <div style={{ display: "flex", fontSize: 40, color: C.muted }}>{code}</div>
              {sector ? <div style={{ display: "flex", fontSize: 30, color: C.coral, marginLeft: 26 }}>{sector}</div> : <div style={{ display: "flex" }} />}
              {price ? <div style={{ display: "flex", fontSize: 52, fontWeight: 700, color: C.text, marginLeft: "auto" }}>{price}</div> : <div style={{ display: "flex" }} />}
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 34, color: C.text }}>五方独立判读 · 聪明钱持仓 · 段永平 / 巴菲特 DNA</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24, color: C.muted }}>
            <div style={{ display: "flex" }}>stockgod.xyz</div>
            <div style={{ display: "flex" }}>AI 模拟 · 非投资建议</div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        fonts,
        headers: {
          "cache-control": "public, max-age=0, must-revalidate",
          "Vercel-CDN-Cache-Control": "max-age=86400, stale-while-revalidate=604800", // 生成一次缓存 1 天,基本零成本
        },
      },
    );
  } catch {
    // 任何失败 → 退回站点静态卡,绝不让分享预览开天窗
    return Response.redirect(new URL("/og.jpg", req.url), 302);
  }
}
