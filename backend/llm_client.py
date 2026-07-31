"""外部 LLM 的最小 HTTP 边界。

会议数据仅由 Worker 在收到 ``consent`` 后传入本模块；本模块不读取本地
数据库，因此不会绕过 UI 的用户确认流程。
"""

import json
import urllib.request

from .config import SETTINGS


def complete(payload, prompt, json_mode=False):
    """调用 OpenAI/Claude 兼容端点并提取常见的文本字段。"""
    body = {"model": payload["model"], "messages": [{"role": "user", "content": prompt}], "stream": False}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    headers = {"Content-Type": "application/json"}
    if payload.get("format") == "claude":
        body = {"model": payload["model"], "max_tokens": 2048, "messages": [{"role": "user", "content": prompt}]}
        headers.update({"anthropic-version": "2023-06-01", "x-api-key": payload.get("api_key", "")})
    elif payload.get("api_key"):
        headers["Authorization"] = f"Bearer {payload['api_key']}"
    request = urllib.request.Request(payload["endpoint"], json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=int(payload.get("timeout", SETTINGS["llm"]["timeout_seconds"]))) as response:
        data = json.loads(response.read())
    return data.get("message", {}).get("content") or data.get("choices", [{}])[0].get("message", {}).get("content") or (data.get("content") or [{}])[0].get("text") or json.dumps(data, ensure_ascii=False)
