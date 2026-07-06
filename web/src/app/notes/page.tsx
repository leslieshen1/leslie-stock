import NotesClient from "./NotesClient";

// 雷司令投资笔记:小红书出售的投资知识库(兑换码解锁)。
// 纸感独立壳(站点导航/页脚已按 /notes 前缀全部退场);私域商品 noindex。
export const metadata = {
  title: "雷司令投资笔记",
  description: "囊括投资基本知识的随身笔记:交易规则 · K线 · 指标 · 基本面 · 心态与风险。",
  robots: { index: false, follow: false },
};

export default function NotesPage() {
  return <NotesClient />;
}
