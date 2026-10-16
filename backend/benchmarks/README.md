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
