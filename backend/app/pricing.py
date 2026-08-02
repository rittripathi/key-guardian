"""Rough USD cost estimation from a provider response body."""

import json

# USD per 1K tokens: (prompt, completion)
PRICES: dict[str, tuple[float, float]] = {
    "gpt-4o": (0.0025, 0.01),
    "gpt-4o-mini": (0.00015, 0.0006),
    "gpt-4.1": (0.002, 0.008),
    "gpt-4.1-mini": (0.0004, 0.0016),
    "gpt-4-turbo": (0.01, 0.03),
    "gpt-3.5-turbo": (0.0005, 0.0015),
    "o3-mini": (0.0011, 0.0044),
    "claude-3-5-sonnet": (0.003, 0.015),
    "claude-3-5-haiku": (0.0008, 0.004),
    "claude-3-opus": (0.015, 0.075),
    "claude-sonnet-4": (0.003, 0.015),
    "text-embedding-3-small": (0.00002, 0.0),
    "text-embedding-3-large": (0.00013, 0.0),
}

# Charged when the model is unknown and tokens are reported
FALLBACK = (0.001, 0.003)
# Charged when we cannot parse usage at all but the call succeeded
FLAT_UNKNOWN_CALL = 0.002


def lookup(model: str) -> tuple[float, float]:
    if not model:
        return FALLBACK
    name = model.lower()
    if name in PRICES:
        return PRICES[name]
    # match the longest known prefix, e.g. "gpt-4o-2024-08-06" -> "gpt-4o"
    best: tuple[float, float] | None = None
    best_len = 0
    for known, price in PRICES.items():
        if name.startswith(known) and len(known) > best_len:
            best, best_len = price, len(known)
    return best or FALLBACK


def parse_usage(body: bytes) -> tuple[str, int, int]:
    """Extract (model, prompt_tokens, completion_tokens) from an OpenAI/Anthropic body."""
    if not body:
        return "", 0, 0
    text = body.strip()

    # SSE stream: the usage block rides on one of the last data: frames
    if text.startswith(b"data:") or b"\ndata:" in text:
        model, pt, ct = "", 0, 0
        for line in text.splitlines():
            if not line.startswith(b"data:"):
                continue
            chunk = line[5:].strip()
            if not chunk or chunk == b"[DONE]":
                continue
            try:
                obj = json.loads(chunk)
            except ValueError:
                continue
            model = obj.get("model") or model
            usage = obj.get("usage") or (obj.get("message") or {}).get("usage") or {}
            pt = usage.get("prompt_tokens") or usage.get("input_tokens") or pt
            ct = usage.get("completion_tokens") or usage.get("output_tokens") or ct
        return model or "", int(pt or 0), int(ct or 0)

    try:
        obj = json.loads(text)
    except ValueError:
        return "", 0, 0
    if not isinstance(obj, dict):
        return "", 0, 0

    usage = obj.get("usage") or {}
    return (
        str(obj.get("model") or ""),
        int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
        int(usage.get("completion_tokens") or usage.get("output_tokens") or 0),
    )


def estimate_cost(model: str, prompt_tokens: int, completion_tokens: int, status_code: int) -> float:
    if status_code >= 400:
        return 0.0
    if not prompt_tokens and not completion_tokens:
        return FLAT_UNKNOWN_CALL
    p_in, p_out = lookup(model)
    return round((prompt_tokens / 1000.0) * p_in + (completion_tokens / 1000.0) * p_out, 6)
