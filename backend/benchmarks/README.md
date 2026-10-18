# Benchmark audio

`python -m backend.bench_refinement` reuses the 14.6-second, 16 kHz mono PCM WAV
at `../fixtures/example-zh.wav`. Use `--wav` to choose a different recording;
no separate copy of the example audio is maintained.

模型默认按当前平台、会议语言和已安装状态选择；macOS 使用 MLX，Windows 使用 ONNX。
MLX 不提供 Sherpa 原生识别器，因此只输出公共解码接口与精修链路的计时，省略
`bare-sherpa` 对照。开发环境的基础模型默认读取 `backend/bundled-models`，可用
`BREVIA_BUNDLED_MODELS_DIR` 覆盖。`npm run test:model` 在模型不附带测试音频时复用项目样例。

`bench_live.py` 与 `bench_asr_models.py` 在 Windows 用系统 API 读取峰值工作集；
Windows 不提供 `resource` 的子进程累计 CPU 指标，翻译结果的该项显示为 `null`。

历史 VAD 基准结果保存在 `dev` 分支。

## Windows 分析入口基线

`bench_diarization` 对真实冻结入口或源码入口测量，不通过会议导入流程跳过说话人分析。
工具将 scratch 数据与应用数据分开；模型目录仅供子进程只读使用，不执行模型清理。
输入要求为 16 kHz 单声道 PCM16 WAV，当前一次最多测量 60 秒。

```powershell
python -m backend.bench_diarization --worker backend/runtime/brevia-worker/brevia-worker.exe --wav backend/fixtures/example-zh.wav --models-root backend/bundled-models --output-dir artifacts/cold-entry --repeat 3 --threads 4
```

省略 `--worker` 时测量当前 Python 源码入口。输出目录必须为空；每轮写入 `native.log`、
`resources.jsonl`，总结果写入 `report.json`。报告包含入口到就绪、加载和分析各阶段时间，
以及进程树工作集、私有提交量、私有工作集、线程和句柄。工作集含共享页面，求和不等于
整机实际物理占用；不可读取的指标保持 `null`，不当作零值。取消或分析失败后同样回收子树。

默认样例只有约 14.6 秒，只用于入口和资源基线，不证明长会议质量、持续内存稳定性或
实时字幕延迟。私有提交量与工作集要分开比较，不把文件大小或加载超时值视作模型内存及推理成本。

Windows backend validation 工作流构建实际 Windows CPU worker，运行原生自检与入口基线，
上传诊断和运行时产物。它不发布安装包，不替代 Razer Book 13 上的同机质量及长会议验收。

## 有界分析会话实验

`bench_diarization --session-chunks 3 --repeat 1` 在同一真实入口内初始化一次，
重复相同输入三次，验证结果哈希一致、正常 shutdown 和进程树回收；它不启用生产复用策略，
也不替代长会议或泄露验收。Windows CI 对新冻结程序执行此检查。

生产复用仍默认关闭。仅 Windows 设置 `BREVIA_ANALYSIS_BUDGET` 为实测预算 JSON 文件路径后，
精修任务才使用有界会话；配置错误会明确失败，不静默忽略。配置字段为
`process_soft_bytes`、`tree_soft_bytes`、`tree_hard_bytes`、`minimum_available_bytes`、
`minimum_total_bytes` 和 `max_chunks`（1～10）。软 / 硬阈值使用 Windows Private Bytes；
树范围是当前 refinement worker 及其后代，系统保留量使用整机可用物理内存。
这些字段均以字节计，必须按设备和模型验证后设置，不提供未经标定的默认值。

软阈值与块数上限在接收当前结果后回收，硬阈值、崩溃和超时作废当前会话。
当前块最多重试一次，整个精修任务最多异常恢复两次；启动、协议、低内存及清理故障不重试。
取消会主动回收进程；暂停阻止下一块并释放空闲模型。正常退出最多等待 5 秒后强制回收，
Windows Job Object 在父进程异常结束时终止分析子树。分析退出后才继续聚类和 ASR。

默认逐块隔离与实验复用共用进程所有权和清理机制。Windows 通过
`PROC_THREAD_ATTRIBUTE_JOB_LIST` 在创建时将进程加入 Job，且仅继承独立的三个标准流句柄，
不再先启动后按 PID 纳管。正常关闭确认整个 Job 为空，再释放进程、线程和 Job 句柄。
终止、等待、管道线程或句柄清理失败均为不可重试错误；仍继续尝试其余资源的清理，
保留未清理成功的所有者，并阻止同一 worker 的后续任务创建分析进程。
只有再次清理并确认释放，或重启 worker 后才能开始新的分析；当前失败任务不自动降级或恢复。
冻结运行时自检同时覆盖两种模式的正常处理，以及模型加载后进入原生分析时的父端强退。

当前保护尚未覆盖 Electron / 日常 worker 兄弟进程、系统提交上限与 GPU 共享内存；
因此实验预算不能作为整机完整资源调度或发布验收结论。
