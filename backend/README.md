# Brevia Worker

桌面主进程通过 stdin/stdout JSONL 驱动此常驻 Python Worker。数据默认写入
`~/brevia`，开发和测试可用 `BREVIA_DATA_DIR` 覆盖。

```bash
/opt/anaconda3/bin/python3.12 -m pip install -r backend/requirements.txt
python3 -m unittest backend.test_worker backend.test_sentence
python3 -m backend.worker
npm run test:model
npm run test:diarization
```

模型下载、会议、音频、逐字稿、导出与总结均使用同一 command/event
协议；Worker 不监听网络端口。单轨录音在会后精修时使用 sherpa-onnx
Pyannote segmentation + 3D-Speaker ERes2Net 完成本地说话人聚类，参数位于
`settings.json` 的 `diarization`。

Windows 普通包使用 CPU；CUDA 包检测到可用 NVIDIA 驱动和显卡后使用 CUDA，
无可用显卡时使用 CPU。也可用 `BREVIA_ASR_BACKEND=cpu|cuda|coreml` 显式覆盖。
Windows 通过 Sherpa CUDA 构件和驱动检测能力，不依赖另外安装 Python `onnxruntime`。
Apple Silicon 的语音识别使用 MLX；Sherpa 没有 MPS provider，显式 `mps` 回退 CPU。

## 精修诊断与复用

Windows 的长录音分析使用 `brevia-worker.exe --diarization` 显式 JSONL 入口。
启动/导入阶段 60 秒内未就绪则报错并保留已有逐字稿，不再拆小块或逐块重复启动失败的路径。
已经开始推理的超时仍保留缩块重试。分块隔离继续用于回收 Sherpa 原生缓冲。

`logs/brevia.log` 记录分析入口、加载模型、分割、声纹提取和每 5 秒的等待状态，
以及 ASR 模型、后端、线程数、加载和累计解码耗时；精修卡保持原有显示。

长录音成功分析后在音频旁写入 `*.diarization.json` 派生缓存。
音频/模型文件大小或修改时间、语音区间、分析参数及后端变化时失效；损坏和降级结果不复用。
缓存保留原始声纹，重新精修时仍按当前人数、声纹库和锁定信息计算归属。
删除该文件只会让下次重新分析，不影响录音与逐字稿。

离线线程默认仍最多 4 个，实时识别预算保持不变。Windows 同机比较后再选择线程数：

```powershell
python -m backend.bench_refinement --wav sample.wav --language zh --threads 2
python -m backend.bench_refinement --wav sample.wav --language zh --threads 4
python -m backend.bench_refinement --wav sample.wav --language zh --threads 8
```

基准可用 `BREVIA_OFFLINE_THREADS` 覆盖离线线程，不会提高实时识别线程预算。
尚未取得 Windows 同机数据，因此没有提高默认线程数或移除进程回收。

## Windows CUDA 语音版

Release workflow 同时生成普通 CPU 包和 `Brevia-<版本>-x64-cuda-setup.exe`。
CUDA 版使用独立 `cuda.yml` 更新通道，两种安装包是同一应用的替代安装，不能并存。
语音识别、说话人分析使用 Sherpa 1.13.8 CUDA 12.8/cuDNN 9；纪要与翻译的 llama 仍使用 AVX2 CPU 构件。
CUDA 用户态 DLL 随包分发，无需单独安装 Toolkit，但需要支持 CUDA 12.8 的 NVIDIA 驱动。
GPU 不支持的 ONNX 运算仍可能由 CPU 执行，实际收益取决于模型与显卡。

官方依据：[Sherpa CUDA wheel 安装](https://k2-fsa.github.io/sherpa/onnx/python/install.html)、
[ONNX Runtime CUDA 依赖](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)。

本地构建必须在 Windows x64 / Python 3.12 上执行，先安装项目开发工具：

```powershell
python -m pip install -r backend/requirements-build.txt
python -m pip uninstall -y sherpa-onnx sherpa-onnx-core sherpa-onnx-bin
python -m pip install -r backend/requirements-cuda.txt
$env:BREVIA_BUILD_CUDA = "1"
npm run pack:backend
python backend/diagnose_windows_bundle.py --runtime backend/runtime --cuda
npm run package:win -- --config.win.artifactName='Brevia-${version}-x64-cuda-setup.${ext}' --config.extraMetadata.breviaRuntime=cuda --config.generateUpdatesFilesForAllChannels=false --config.publish.channel=cuda
python backend/diagnose_windows_bundle.py --runtime dist/win-unpacked/resources/backend/runtime --packaged --cuda
```

上述打包检查在无 GPU 的托管 runner 上验证 DLL、CPU 回退和真实 60 秒分割/声纹链路。
有 NVIDIA GPU 时必须另外运行以下命令，要求驱动与 CUDA EP 可加载并实际执行推理：

```powershell
python backend/diagnose_windows_bundle.py --runtime dist/win-unpacked/resources/backend/runtime --packaged --cuda --gpu
```

切回 CPU 构建前清除 `BREVIA_BUILD_CUDA`，并重新安装普通 Sherpa wheel，避免混用运行库。

录音链路：原始 PCM 落盘 → `SentenceVAD` → 磁盘暂存语音段 → 单线程
`RefinedASR` → `transcript.final` + `transcript.settled`（翻译入口）。不再产生
`transcript.partial` / `transcript.refined`。升级时会删除旧数据库的
`streaming_model_id` 与 `power_saving` 列（见 `store_base.py` 的
`_drop_retired_columns`），会议只保留 `refined_model_id`。

暂停和语言切换提交末句；停止等待队列排空再更新会议状态。队列只持有音频路径，
成功或失败均清理临时段文件，原始录音始终保留。失败会报告具体时间区间，
可用会后精修重试。VAD 参数沿用 `settings.json` / 高级设置的 `vad` 项。
连续语音的硬切上限取「语言级配置」与识别模型容量（`RefinedASR.max_speech_seconds`，
如 FunASR Nano 为 22 s）的较小值；每个语音段开头回补 300 ms 原始音频
（`SentenceVAD.speech_pad_ms`，参照 Meetily 的 pre_speech_pad），避免段首丢字。

```bash
python backend/bench_live.py --language zh --output /tmp/brevia-vad.json
python backend/bench_live.py --language en --gaps
```

历史 VAD 基准结果保存在 `dev` 分支。
