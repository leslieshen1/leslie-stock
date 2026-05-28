# 我不是股神 · Not a Stock Guru

> **AI 驱动的全景股票可视化平台。**
> **你不是股神，但股神陪你一起看股票。**

段永平 + 巴菲特 + Serenity (@aleabitoreddit) 三方框架，A 股 / 港股 / 美股 / 加密。

---

## 🎯 是什么

一个**个人投资 dashboard**：

- 🤖 **AI 帮你看市场** — Claude 按段巴 + Serenity 框架打分 5,500+ A 股
- 🔍 **全市场扫描** — 70+ Serenity 评分高分股一目了然
- 📊 **产业链热力图** — AI / humanoid / 国防 / 稀有金属 / 生物医药 5 个产业链可切换
- ⭐ **个人观察列表** — 从扫描结果里点 ☆ 加入
- 💎 **三视角分析** — 段巴 BG + Serenity 瓶颈 + 综合判断

**这不是投资建议**。这是一个把"AI 当分析师助手"的私人工具。

---

## 🏗️ 架构

```
data/leslie.db   ←──  SoT（SQLite single source of truth）
       ↓
       ├── stocks (5,510 只)
       ├── analyses (5,519 条评分，多框架多版本)
       ├── runs (评分任务追溯，含成本)
       ├── prices (日线行情)
       └── events (新闻 / 公告)
```

- **Python pipeline**：fetcher → screener → scorer → SQLite
- **Web (Next.js)**：dashboard 读 SQLite export 的 JSON manifest
- **部署**：Vercel（read-only mode），自部署亦可

---

## 📐 三方框架

| 框架 | 来源 | 重点 |
|---|---|---|
| **段巴 BG** | 段永平 + 巴菲特 | 商业模式 / 护城河 / 管理层 / 财务 / 估值 / 能力圈 |
| **Serenity 瓶颈** | @aleabitoreddit | AI capex 供应链关键节点（chokepoint） |
| **综合判断** | 自动 | 两个分数都高 = 重仓；只 BG 高 = 长持；只瓶颈高 = thesis trade |

---

## 🚀 开发

```bash
# Python env
uv sync

# 初始化 DB
uv run python -m scripts.init_db

# 从 v1 baseline 导入历史评分
uv run python -m scripts.import_legacy_to_db

# Web dev
cd web && npm run dev
```

### 增量评分 pipeline

```bash
# 1. dry-run 看预算
uv run python -m screener.scan_v2 --framework bg \
    --baseline-framework serenity --baseline-score-min 60

# 2. 切批 + 创建 run（写 DB pending）
... --execute --scope bg_60plus

# 3. 跑 batch（spawn agent / API）
#    → /tmp/scan_runs/N/result_*.json

# 4. 写回 DB
uv run python -m screener.import_results --run-id N

# 5. 更新 web view
uv run python -m scripts.export_manifests

# 6. deploy
cd web && vercel deploy --prod --yes
```

---

## 🎨 路线图

- [ ] 行情接入（akshare → prices 表）
- [ ] Per-industry LAYERS（修 heatmap 跨产业链语义）
- [ ] 给 60+ 标的全跑段巴 BG 评分（让三方真三方）
- [ ] 新闻 → 事件驱动重评分
- [ ] 价格 alert（Telegram / email）

---

## ⚠️ 免责声明

- 评分基于公开方法论的**风格 / 框架复刻**
- 不构成任何投资建议
- 数据基于公开来源，**没有保证准确性**
- 任何投资决策请基于你自己的研究

---

**v0.5** · 2026-05 · Leslie · [@leslie_bit](https://x.com/leslie_bit)
