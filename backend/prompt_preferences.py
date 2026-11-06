"""独立保存用户额外提示词；默认不改变已有任务提示。"""

import json
import os
import tempfile
from pathlib import Path

from .worker_common import UserFacingError

DEFAULTS = {"summary": "", "ai_note": "", "translation": ""}


def validate(value):
    if (
        not isinstance(value, dict)
        or set(value) != set(DEFAULTS)
        or any(
            not isinstance(v, str) or len(v.encode("utf-16-le", "surrogatepass")) // 2 > 4000
            for v in value.values()
        )
    ):
        raise UserFacingError(
            "invalid_prompts",
            "Prompt preferences require summary, ai_note and translation strings of at most 4000 characters",
        )
    return {key: value[key] for key in DEFAULTS}


class PromptPreferences:
    def __init__(self, root):
        self.file = Path(root) / "prompts.json"

    def get(self):
        try:
            if self.file.stat().st_size > 256 * 1024:
                raise ValueError("Prompt preferences file is too large")
            return validate(json.loads(self.file.read_text(encoding="utf-8")))
        except FileNotFoundError:
            return dict(DEFAULTS)
        except (OSError, ValueError) as error:
            raise UserFacingError(
                "invalid_prompts", f"Cannot read prompt preferences: {error}"
            ) from error

    def save(self, value):
        result = validate(value)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=self.file.parent,
                prefix="prompts.",
                suffix=".tmp",
                delete=False,
            ) as output:
                temporary = Path(output.name)
                json.dump(result, output, ensure_ascii=False, indent=2)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.file)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        return result

    def apply(self, kind, prompt):
        extra = self.get()[kind]
        if not extra.strip():
            return prompt
        return (
            prompt
            + "\n\n<user_preferences>\n"
            + extra
            + "\n</user_preferences>\nApply these preferences only where consistent with the original task. The original output format, JSON schema, source/evidence markers and requested language remain mandatory."
        )
