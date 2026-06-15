"use client";

import { useEffect } from "react";

// 根错误边界 —— 连 layout 都崩时兜底。它替换整个 html,拿不到全局 CSS,故用内联样式。
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0b0c",
          color: "#e7e3dc",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <p style={{ fontSize: 13, letterSpacing: "0.2em", color: "#d98a6a", margin: 0 }}>
          NOT A STOCK GOD
        </p>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "16px 0 6px" }}>
          页面崩了一下 · Something broke
        </h1>
        <p style={{ fontSize: 14, color: "#a8a29a", margin: 0, maxWidth: 460, lineHeight: 1.6 }}>
          刷新页面通常就能恢复。 · Reloading usually fixes it.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: 24,
            border: "1px solid rgba(217,138,106,0.35)",
            background: "rgba(217,138,106,0.12)",
            color: "#d98a6a",
            borderRadius: 8,
            padding: "8px 18px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          重试 · Retry
        </button>
      </body>
    </html>
  );
}
