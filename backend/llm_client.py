"""外部 LLM 的最小 HTTP 边界。

会议数据仅由 Worker 在收到 ``consent`` 后传入本模块；本模块不读取本地
数据库，因此不会绕过 UI 的用户确认流程。
"""

import json
import urllib.error
import urllib.request

from .config import SETTINGS


def complete(payload, prompt, json_mode=False):
    """调用 OpenAI/Claude 兼容端点并提取常见的文本字段。"""
    api_format = (payload.get("format") or "openai").lower()
    endpoint = payload["endpoint"].rstrip("/")
    body = {
        "model": payload["model"],
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    headers = {"Content-Type": "application/json", "User-Agent": "Brevia/1.0"}
    if api_format in {"anthropic", "claude"}:
        if not endpoint.endswith("/v1/messages"):
            endpoint += "/v1/messages"
        body = {
            "model": payload["model"],
            "max_tokens": 2048,
            "messages": [{"role": "user", "content": prompt}],
        }
        if payload.get("api_key"):
            headers.update(
                {
                    "anthropic-version": "2023-06-01",
                    "x-api-key": payload["api_key"],
                    "Authorization": f"Bearer {payload['api_key']}",
                }
            )
    elif payload.get("api_key"):
        headers["Authorization"] = f"Bearer {payload['api_key']}"
    request = urllib.request.Request(
        endpoint, json.dumps(body).encode(), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(
            request,
            timeout=int(payload.get("timeout", SETTINGS["llm"]["timeout_seconds"])),
        ) as response:
            data = json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise ValueError(
            f"LLM request failed ({error.code}): {detail[:500]}"
        ) from error
    content = data.get("message", {}).get("content")
    if not content and data.get("choices"):
        content = data["choices"][0].get("message", {}).get("content")
    if not content and isinstance(data.get("content"), list):
        content = "".join(
            item.get("text", "")
            for item in data["content"]
            if item.get("type", "text") == "text"
        )
    return content or data.get("output_text") or json.dumps(data, ensure_ascii=False)
