"""工作组件的线程安全共享状态与协议辅助工具。"""

import threading
from functools import wraps


SCHEMA_VERSION = 1

# 能承担「多语言混说」的模型类型：这些模型按整段音频自行判断语言（或使用跨语言联合
# 训练的统一分词器），逐语言微调的模型在混说输入上会串语言。整句识别的语言校验与精修
# 选模型共用同一判断。
# - qwen3 / whisper：LLM 或编码解码结构，按整段判断语言。
# - nemo-transducer：Parakeet TDT，25 欧洲语言联合训练的统一 SentencePiece 分词器，
#   官方明确支持「自动检测语言、无需提示」。
MULTILINGUAL_MODEL_KINDS = {"qwen3", "whisper", "nemo-transducer"}

# 整句识别模型的候选优先级字段（`models.json`）。前后端都按它排序，因此「候选模型的
# 先后」也只有一处定义；缺字段的排在最后。
REFINED_PRIORITY_FIELD = "refined_priority"
DEFAULT_REFINED_PRIORITY = 99


def refined_models_in_priority_order(catalog):
    """清单里可选用的整句识别模型，按 ``refined_priority`` 排序。

    退役模型不在其中：清单保留它的条目只是为了让历史会议的 ``refined_model_id`` 仍能
    解析，它的本地文件已在启动时清掉，选出来只会拿着一个加载不了的 id 往下走。
    """
    refined = [
        model
        for model in catalog
        if "refined" in model.get("stages", []) and not model.get("retired")
    ]
    return sorted(
        refined,
        key=lambda model: (
            model.get(REFINED_PRIORITY_FIELD, DEFAULT_REFINED_PRIORITY),
            model["id"],
        ),
    )


def model_supports_language(model, language):
    """模型能否承担该语言的整句识别。

    具体语言只认 ``languages`` 里显式列出的代码（外加 ``all`` 这种显式通配）。
    **``multilingual`` 不再被当作通配符**：它的含义是「这个模型是广谱多语种模型」，
    被 ``auto`` 用 ``MULTILINGUAL_MODEL_KINDS`` 判断，而不是「支持任何具体语言代码」。
    早期把 ``multilingual`` 当通配符时，Parakeet（25 种欧洲语言、不含中日韩）会被
    判成支持中文，前端于是把它列进中文会议的识别模型下拉——用户选得出、结果全是垃圾。
    语言覆盖必须与 ``languages`` 严格一致。
    """
    if language == "auto":
        return model["kind"] in MULTILINGUAL_MODEL_KINDS
    return bool({language, "all"} & set(model.get("languages", [])))


def default_refined_model_for_language(models, language, is_ready=None):
    """按清单的 ``default_for_languages`` 返回该语言的默认识别模型 id。

    「语言 → 默认模型」的规则只在这里实现一次，``models.json`` 是唯一事实来源：前端
    (``app.js``) 与后端 (``WorkerSessionMixin``) 都读 ``default_for_languages`` 与
    ``refined_priority``，不再各写一份硬编码。

    选择顺序（前后端一致）：
    1. 清单里声明该语言的模型（按 ``refined_priority``）；
    2. 没有声明的语言回落到第一个支持该语言的模型；
    3. 若 ``is_ready`` 给出且第 1/2 步选中的模型不可用，则改选第一个**已安装**且支持
       该语言的模型，全都没有时仍返回第 1/2 步的结果。

    第 3 步是必要的：没有它，后端会把「用户没装的模型」当成默认值送给加载器，于是
    精修老会议时弹出一个用户从没选过的几 GB 下载——而前端在同一条路径上会回落到
    已安装的模型，两端因此对同一个语言给出不同的模型。传入 ``is_ready`` 让这一层
    与前端行为一致。

    Args:
        models: ``ModelManager`` 实例（用其 catalog），或模型字典的可迭代对象。
        language: 会议语言代码，或 ``"auto"``（多语言混说）。
        is_ready: 可选的「该模型是否已安装」判据，通常是 ``ModelManager.is_ready``。
            省略时不做安装态兜底。

    Returns:
        模型 id；清单里没有任何模型支持该语言时返回 ``None``，由调用方按自己的默认
        常量处理。
    """
    catalog = models.catalog.values() if hasattr(models, "catalog") else models
    refined = refined_models_in_priority_order(catalog)
    declared = next(
        (model for model in refined if language in (model.get("default_for_languages") or [])),
        None,
    ) or next(
        (model for model in refined if model_supports_language(model, language or "auto")),
        None,
    )
    if declared is None:
        return None
    if is_ready is None or is_ready(declared["id"]):
        return declared["id"]
    installed = next(
        (
            model
            for model in refined
            if model_supports_language(model, language or "auto") and is_ready(model["id"])
        ),
        None,
    )
    return (installed or declared)["id"]


class ModelNotInstalled(RuntimeError):
    """模型文件不在本地（或缺失必要文件）。

    这是**跨进程协议的一部分**：``WorkerCore.response`` 会把它序列化成结构化的
    ``error_code`` / ``error_models``，主进程据此触发"先下载再重试"，而不是去正则解析
    人类可读的报错文本。以前 ``Model X is not installed`` 只是普通 RuntimeError，
    协议层只剩字符串，于是 main.js 用正则反解模型 id——任何措辞改动都会静默破坏整条
    下载链路（见 electron/main-logic.js 的 workerError）。

    Args:
        models: 缺失的模型 id 列表。
    """

    code = "model_not_installed"

    def __init__(self, models):
        self.models = list(models)
        label = "Model" if len(self.models) == 1 else "Models"
        verb = "is" if len(self.models) == 1 else "are"
        super().__init__(f"{label} {', '.join(self.models)} {verb} not installed")


def missing_models(manager, model_ids):
    """返回其中尚未就绪的模型 id（保持入参顺序、去重）。"""
    seen = []
    for model_id in model_ids:
        if model_id and not manager.is_ready(model_id) and model_id not in seen:
            seen.append(model_id)
    return seen


class TaskCancelled(Exception):
    """任务在安全检查点收到取消请求。"""


class TaskControl:
    """长时任务的暂停与取消状态。"""

    def __init__(self):
        self.paused = threading.Event()
        self.cancelled = threading.Event()


def require(payload, *names):
    """检查 payload 必需字段，缺失时抛出 ValueError。"""
    missing = [name for name in names if name not in payload]
    if missing:
        raise ValueError(f"Missing fields: {', '.join(missing)}")


def synchronized_recording(method):
    """序列化活动录音状态的所有变更操作。"""

    @wraps(method)
    def synchronized(self, *args, **kwargs):
        with self.state.lock:
            return method(self, *args, **kwargs)

    return synchronized


def managed_task(task):
    """注册一个长时运行任务，并在完成后始终释放其注册记录。"""

    def decorate(method):
        @wraps(method)
        def managed(self, payload, *args, **kwargs):
            meeting_id = payload.get("meeting_id")
            if not meeting_id:
                return method(self, payload, *args, **kwargs)
            control = self.tasks.begin(task, meeting_id)
            try:
                return method(self, payload, control, *args, **kwargs)
            finally:
                self.tasks.finish(task, meeting_id, control)

        return managed

    return decorate


class WorkerState:
    """拥有活动录音标识，保护在一个可重入锁后。"""

    def __init__(self):
        self.lock = threading.RLock()
        self._active = None

    @property
    def active(self):
        with self.lock:
            return self._active

    @active.setter
    def active(self, meeting_id):
        with self.lock:
            self._active = meeting_id

    def require(self, meeting_id):
        """验证目标会议为当前活动会议。"""
        with self.lock:
            if meeting_id != self._active:
                raise ValueError("Meeting is not active")


class TaskRegistry:
    """同步暂停控制并拒绝重复的长时运行任务。"""

    def __init__(self):
        self._controls = {}
        self._lock = threading.Lock()

    def begin(self, task, meeting_id):
        """启动任务并返回其暂停控制事件；已运行时抛出异常。"""
        key = (task, meeting_id)
        with self._lock:
            if task == "summary.generate" and any(
                running_task == task for running_task, _meeting_id in self._controls
            ):
                raise ValueError("A meeting summary is already running")
            if key in self._controls:
                raise ValueError("Task is already running")
            control = TaskControl()
            self._controls[key] = control
            return control

    def finish(self, task, meeting_id, control=None):
        """结束任务并移除其注册记录。"""
        key = (task, meeting_id)
        with self._lock:
            if control is None or self._controls.get(key) is control:
                self._controls.pop(key, None)

    def set_paused(self, task, meeting_id, paused):
        """设置任务的暂停状态并返回控制事件。"""
        key = (task, meeting_id)
        with self._lock:
            control = self._controls.get(key)
            if not control:
                raise ValueError("Task is not running")
            control.paused.set() if paused else control.paused.clear()
        return control

    def cancel(self, task, meeting_id):
        """请求运行中的任务在下一个安全检查点停止。"""
        key = (task, meeting_id)
        with self._lock:
            control = self._controls.get(key)
            if not control:
                raise ValueError("Task is not running")
            control.cancelled.set()
            control.paused.clear()
        return control

    def cancel_for_meeting(self, meeting_id):
        """请求该会议的所有后台任务在下一个安全检查点停止，返回取消的任务名列表。"""
        with self._lock:
            keys = [key for key in self._controls if key[1] == meeting_id]
        for task, mid in keys:
            with self._lock:
                control = self._controls.get((task, mid))
                if control:
                    control.cancelled.set()
                    control.paused.clear()
        return [task for task, _mid in keys]

    def has_for_meeting(self, meeting_id):
        """返回该会议是否存在运行中的长任务。"""
        with self._lock:
            return any(mid == meeting_id for _task, mid in self._controls)

    def has_any(self):
        """返回是否存在任何运行中的长任务。"""
        with self._lock:
            return bool(self._controls)
