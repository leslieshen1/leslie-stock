import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 显式把数据 JSON 打进对应 serverless 函数（nft 对 process.cwd() 下的单文件追踪不稳，
  // us-news/ 因动态路径被整目录追踪到了，但 us-fundamentals.json 这种单文件会漏 → 显式兜底）。
  outputFileTracingIncludes: {
    "/stock/[code]": [
      "./public/data/us-fundamentals.json",
      "./public/data/us-news/**",
      "./public/data/stock-type-map.json",
      "./public/data/earnings-calendar.json",
      "./public/data/us-options.json",
    ],
  },
};

export default nextConfig;
