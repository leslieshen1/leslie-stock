"""Gmail SMTP 邮件发送器。

环境变量（.env）:
- EMAIL_FROM
- EMAIL_PASSWORD  (Gmail 应用专用密码，不是你的 Google 主密码)
- EMAIL_TO
- EMAIL_SMTP_HOST  默认 smtp.gmail.com
- EMAIL_SMTP_PORT  默认 587
"""
from __future__ import annotations

import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from dotenv import load_dotenv

# 加载 .env
ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")


def send_briefing(subject: str, markdown_body: str, html_body: str | None = None,
                  to: str | None = None) -> bool:
    """发送一封邮件（同时包含 markdown 和 HTML 版本）。

    Args:
        subject: 主题
        markdown_body: markdown 内容（plain text fallback）
        html_body: HTML 内容（可选，没有就从 markdown 简单渲染）
        to: 目标地址，默认从 .env 读 EMAIL_TO
    """
    from_addr = os.getenv("EMAIL_FROM")
    password = os.getenv("EMAIL_PASSWORD")
    to_addr = to or os.getenv("EMAIL_TO")
    smtp_host = os.getenv("EMAIL_SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("EMAIL_SMTP_PORT", "587"))

    if not all([from_addr, password, to_addr]):
        raise RuntimeError(
            "缺少邮件配置。请在 .env 设置 EMAIL_FROM / EMAIL_PASSWORD / EMAIL_TO\n"
            "Gmail 用户：去 https://myaccount.google.com/apppasswords 申请应用专用密码"
        )

    if html_body is None:
        html_body = _markdown_to_simple_html(markdown_body)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg.attach(MIMEText(markdown_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(from_addr, password)
        server.sendmail(from_addr, [to_addr], msg.as_string())

    return True


def _markdown_to_simple_html(md: str) -> str:
    """极简 Markdown → HTML（不依赖 markdown 包）。"""
    import re
    lines = md.split("\n")
    out: list[str] = []
    in_code = False
    in_list = False
    in_table = False

    for line in lines:
        if line.startswith("```"):
            in_code = not in_code
            out.append("<pre>" if in_code else "</pre>")
            continue
        if in_code:
            out.append(_html_escape(line))
            continue

        # 标题
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            level = len(m.group(1))
            out.append(f"<h{level}>{_inline_md(m.group(2))}</h{level}>")
            continue

        # 表格（简化）
        if "|" in line and "---" in line:
            in_table = True
            continue
        if "|" in line and line.strip().startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            tag = "th" if not in_table else "td"
            in_table = True
            out.append("<tr>" + "".join(f"<{tag}>{_inline_md(c)}</{tag}>" for c in cells) + "</tr>")
            continue
        elif in_table:
            out.append("</table>")
            in_table = False

        # 列表
        if re.match(r"^[-*]\s+", line):
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{_inline_md(line.lstrip('-* '))}</li>")
            continue
        elif in_list:
            out.append("</ul>")
            in_list = False

        # 空行
        if not line.strip():
            out.append("<br>")
            continue

        # 普通段落
        out.append(f"<p>{_inline_md(line)}</p>")

    if in_list:
        out.append("</ul>")
    if in_table:
        out.append("</table>")

    body = "\n".join(out)
    # 在表格开始处插入 <table> 标签
    body = re.sub(r"(<tr>)", r"<table border='1' cellpadding='6' style='border-collapse:collapse'>\1", body, count=1)

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
body {{ font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.6; max-width: 800px; margin: 24px auto; padding: 0 16px; color: #1a1a1a; }}
h1, h2, h3 {{ border-bottom: 1px solid #eee; padding-bottom: 6px; }}
code, pre {{ background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: "SF Mono", Monaco, monospace; }}
pre {{ padding: 12px; overflow-x: auto; }}
table {{ margin: 12px 0; }}
th {{ background: #f5f5f5; }}
li {{ margin: 4px 0; }}
.green {{ color: #10b981; }}
.red {{ color: #ef4444; }}
.yellow {{ color: #f59e0b; }}
</style></head>
<body>
{body}
</body></html>"""


def _inline_md(s: str) -> str:
    """处理行内 markdown：**bold**、`code`、emoji 等。"""
    import re
    s = _html_escape(s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = s.replace("🟢", "<span class='green'>🟢</span>")
    s = s.replace("🔴", "<span class='red'>🔴</span>")
    s = s.replace("🟡", "<span class='yellow'>🟡</span>")
    return s


def _html_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


if __name__ == "__main__":
    # 测试发送（需要 .env 配置）
    sample = """# 测试简报

这是 Leslie-stock 系统的测试邮件。

## 持仓总览

| 股票 | 仓位 | 当日 |
|---|---|---|
| 🐧 腾讯 | 12% | +0.55% 🟢 |
| 🍶 茅台 | 5%  | +0.22% |

**今日无重大异动。**
"""
    try:
        send_briefing("【Leslie-stock 测试】简报", sample)
        print("✅ 测试邮件已发送")
    except Exception as e:
        print(f"❌ 发送失败: {e}")
