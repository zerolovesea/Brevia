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

语音推理默认自动选择 CPU/CUDA，也可用 `BREVIA_ASR_BACKEND=cpu|cuda|coreml`
覆盖。Sherpa 没有 MPS provider；`mps` 会安全回退 CPU，Metal 仅用于 llama.cpp。

录音链路：原始 PCM 落盘 → `SentenceVAD` → 磁盘暂存语音段 → 单线程
`RefinedASR` → `transcript.final` + `transcript.settled`（翻译入口）。不再产生
`transcript.partial` / `transcript.refined`。旧数据库的 `streaming_model_id`
列保留兼容，新会议写入当前离线识别模型 ID，不再作为下载要求。

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

[本次架构基准](benchmarks/vad-2026-09-05/REPORT.md)
