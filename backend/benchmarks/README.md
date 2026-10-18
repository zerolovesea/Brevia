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
