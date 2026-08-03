# Brevia Worker

桌面主进程通过 stdin/stdout JSONL 驱动此常驻 Python Worker。数据默认写入
`~/brevia`，开发和测试可用 `BREVIA_DATA_DIR` 覆盖。

```bash
/opt/anaconda3/bin/python3.12 -m pip install -r backend/requirements.txt
python3 -m unittest backend.test_worker
python3 -m backend.worker
npm run test:model
npm run test:diarization
```

模型下载、会议、音频、逐字稿、术语、导出与总结均使用同一 command/event
协议；Worker 不监听网络端口。单轨录音在会后精修时使用 sherpa-onnx
Pyannote segmentation + 3D-Speaker ERes2Net 完成本地说话人聚类，参数位于
`settings.json` 的 `diarization`。
