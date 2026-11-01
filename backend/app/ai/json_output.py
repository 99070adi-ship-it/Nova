import json
import re

_THINK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_FENCE = re.compile(r"^```(?:json|JSON)?\s*(.*?)\s*```$", re.DOTALL)


def clean_model_text(text: str | None) -> str:
    """What the model actually said, without a reasoning model's <think> block or a Markdown code fence around the answer."""
    out = _THINK.sub("", text or "").strip()
    if out.lower().startswith("<think>"):  # an unterminated reasoning block: nothing usable follows it
        return ""
    fenced = _FENCE.match(out)
    return fenced.group(1).strip() if fenced else out


def parse_model_json(text: str | None):
    """Parses JSON a model was asked to return, tolerating a code fence, a reasoning block, or a sentence before/after the
    object. Raises json.JSONDecodeError (a ValueError) when no JSON value can be recovered. The result is still untrusted data: callers validate it."""
    cleaned = clean_model_text(text)
    if not cleaned:
        raise json.JSONDecodeError("empty model output", "", 0)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    # Find the first balanced {...} or [...] and try that.
    for opener, closer in (("{", "}"), ("[", "]")):
        start = cleaned.find(opener)
        while start != -1:
            depth, in_str, escaped = 0, False, False
            for i in range(start, len(cleaned)):
                ch = cleaned[i]
                if in_str:
                    if escaped:
                        escaped = False
                    elif ch == "\\":
                        escaped = True
                    elif ch == '"':
                        in_str = False
                elif ch == '"':
                    in_str = True
                elif ch == opener:
                    depth += 1
                elif ch == closer:
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(cleaned[start : i + 1])
                        except json.JSONDecodeError:
                            break
            start = cleaned.find(opener, start + 1)
    raise json.JSONDecodeError("no JSON in model output", cleaned, 0)
