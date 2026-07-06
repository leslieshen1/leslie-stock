// 雷司令投资笔记:类型与 Upstash 键空间。
// 商品内容(文章 md)绝不进 git(repo 是 PUBLIC)——全部存 Upstash,经 admin API 从本地私有目录同步。
// 解锁模型:兑换码(小红书自动发货)→ 激活绑定设备(≤3 台)→ 按篇拉取,码维度日限频防爬库。

export type NoteMeta = { id: string; t: string; free?: boolean };
export type Section = { key: string; icon: string; t: string; blurb: string; items: NoteMeta[] };
export type Toc = { name: string; tagline: string; sections: Section[]; updatedAt?: number };

export type CodeRec = {
  createdAt: number;
  activatedAt?: number;
  devices: string[];            // deviceId 列表,≤MAX_DEVICES
  reads?: Record<string, number>; // 日期 → 当日阅读次数(限频)
};

export const NK = {
  toc: "sg:note:toc",
  art: (id: string) => `sg:note:art:${id}`, // {md: string, free?: boolean}
  code: (c: string) => `sg:note:code:${c}`,
};

export const MAX_DEVICES = 3;
export const DAILY_READS = 300; // 人读不到,爬全库会撞

// 兑换码:LSN-XXXXX-XXXXX,字母表去 0/O/1/I/L 防抄错
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function genCode(): string {
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  const pick = (b: number) => ALPHABET[b % ALPHABET.length];
  const s = Array.from(buf, pick).join("");
  return `LSN-${s.slice(0, 5)}-${s.slice(5)}`;
}

export function normCode(raw: string): string {
  return raw.toUpperCase().replace(/\s/g, "").trim();
}

export function todayStr(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // 北京日
}
