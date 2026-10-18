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
