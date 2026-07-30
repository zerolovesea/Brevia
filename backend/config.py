"""读取随应用发布的后端运行参数。"""

import json
from pathlib import Path


SETTINGS = json.loads(Path(__file__).with_name("settings.json").read_text())
