"""NDT LLM 统一调用 —— 优先 Claude Opus 4.8(/v1/messages),它过载(MODEL_BUSY/overloaded)或失败时
自动降级 gpt-5.5(/v1/responses 流式)。两条端点、两个 key、两套容量池,任一可用就有输出 → 一次过载
不再废掉整篇盘报 / 不再让 arena 整批回退规则。报告 + arena 共用。

env(调用时读,不在 import 时锁死):
  NDT_BASE_URL · NDT_CLAUDE_KEY(Claude 专用,gpt key 不带 Claude)· NDT_API_KEY(gpt-5.5)· NDT_REPORT_MODEL(覆盖 Claude 型号)
"""
import json
import os
import time

import requests


def _env():
    base = (os.environ.get("NDT_BASE_URL") or "https://api.nadoutong.org").rstrip("/")
    claude_key = os.environ.get("NDT_CLAUDE_KEY") or os.environ.get("NDT_API_KEY") or ""
    gpt_key = os.environ.get("NDT_API_KEY") or ""
    claude_model = os.environ.get("NDT_REPORT_MODEL", "claude-opus-4-8")
    return base, claude_key, gpt_key, claude_model


def _is_overload(e) -> bool:
    s = str(e).lower()
    return any(k in s for k in ("model_busy", "overload", "busy", "429", "rate_limit", "retryable"))


def _claude(system: str, user: str, max_tokens: int) -> str:
    """NDT Anthropic 端点。"""
    base, key, _, model = _env()
    if not key:
        raise RuntimeError("缺 NDT_CLAUDE_KEY")
    body = {"model": model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": user}]}
    if system:
        body["system"] = system
    r = requests.post(f"{base}/v1/messages",
                      headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                               "anthropic-version": "2023-06-01"},
                      json=body, timeout=180).json()
    if r.get("error"):
        raise RuntimeError(str(r["error"])[:200])
    text = "".join(p.get("text", "") for p in (r.get("content") or []) if p.get("type") == "text").strip()
    if not text:
        raise RuntimeError("Claude 空回复")
    return text


def _gpt(prompt: str) -> str:
    """NDT OpenAI 式 /v1/responses,必须 stream:true(非流式一律 MODEL_NOT_AVAILABLE)。"""
    base, _, key, _ = _env()
    if not key:
        raise RuntimeError("缺 NDT_API_KEY")
    out = []
    with requests.post(f"{base}/v1/responses",
                       headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                       json={"model": "gpt-5.5", "stream": True, "input": prompt},
                       stream=True, timeout=300) as r:
        r.raise_for_status()
        r.encoding = "utf-8"  # SSE 无 charset 头时 requests 按 Latin-1 解,中文必乱码
        for line in r.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                j = json.loads(data)
            except ValueError:
                continue
            if j.get("type") == "response.output_text.delta":
                out.append(j.get("delta") or "")
            elif j.get("type") in ("response.failed", "error"):
                raise RuntimeError(str(j)[:300])
    text = "".join(out).strip()
    if not text:
        raise RuntimeError("gpt 空回复")
    return text


def llm(user: str, system: str = "", max_tokens: int = 5000, claude_retries: int = 2) -> str:
    """优先 Claude Opus 4.8;过载退避重试 claude_retries 次,仍不行 → 降级 gpt-5.5。两条都挂才 raise。"""
    last = None
    for attempt in range(claude_retries + 1):
        try:
            return _claude(system, user, max_tokens)
        except Exception as e:
            last = e
            if not _is_overload(e) or attempt >= claude_retries:
                break  # 非过载错误(认证/请求问题)不浪费重试,直接试 gpt 兜底
            print(f"   ↻ Claude 过载,{8 * (attempt + 1)}s 后重试…")
            time.sleep(8 * (attempt + 1))
    try:
        print(f"   ⇣ Claude 不可用({str(last)[:70]}),降级 gpt-5.5…")
        return _gpt((system + "\n\n" + user) if system else user)
    except Exception as e2:
        raise RuntimeError(f"Claude+gpt 双挂:claude={str(last)[:140]} | gpt={str(e2)[:140]}")
