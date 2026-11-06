# macOS 原生推理

`bash macos/inference/build.sh` 构建 `dist/native/engines/`。此目录整体随应用打包，包含原生执行文件、动态库、Metal 资源和许可证；模型权重继续由模型管理器下载。构建使用 Xcode、Metal Toolchain、CMake、Node 和 SwiftPM，无 Python 构建或运行步骤。

- `brevia-inference`：sherpa-onnx 的 ONNX 转写、Silero VAD、ERes2Net 声纹、Pyannote 分段，以及 llama.cpp 的 GGUF 对话和翻译。miniaudio + stb_vorbis 为系统解码器补充旧版 macOS 的 Ogg/Vorbis 支持；官方 libogg、libopus、libopusfile 静态链接提供 Ogg/Opus，未启用 HTTP、编码工具或神经网络扩展。Opus 中间输出固定为双声道，再交给 miniaudio 转换目标格式，避免串联 Ogg 切换声道导致缓冲区格式不一致。
- `brevia-mlx`：Swift MLX 的 FunASR Nano、Qwen3 ASR、Parakeet、FireRedASR2 和 Whisper；直接使用现有本地 MLX 权重目录。

依赖版本固定，原生归档校验 SHA256，Swift 依赖由 `Package.resolved` 固定。构建仅将完整的新目录替换到输出位置，避免残留旧运行组件。原生库只使用系统路径或同目录相对路径；依赖名统一为符号链接指向的实体文件名，以满足 Hardened Runtime 的库名校验。Swift 兼容库与 Metal 资源一并复制。

## 子进程协议

stdin/stdout 每行一个 JSON；诊断仅写 stderr。请求为 `{id,type,payload}`；终态为 `{id,ok:true,result}` 或 `{id,ok:false,error}`。每个进程串行处理请求，调用方按模型用途使用独立进程；取消时终止该进程并重新创建，不能把旧进程响应复用到新任务。

| type              | payload                                                                                            | result                                 |
| ----------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `asr.load`        | `path,kind,files?,language?,hotwords?,threads?`                                                    | `max_speech_seconds`                   |
| `asr.decode`      | `pcm,sample_rate?`                                                                                 | `text,words:[{text,start_ms,end_ms}]`  |
| `vad.load`        | ONNX 文件 `path`，可选 `threshold,min_silence_duration,min_speech_duration,max_speech_duration`    | `{}`                                   |
| `vad.feed`        | `pcm,sample_rate?`                                                                                 | `[{pcm,start_ms,end_ms}]`              |
| `vad.flush`       | `{}`                                                                                               | `[{pcm,start_ms,end_ms}]`              |
| `speaker.embed`   | ONNX 文件 `path,pcm,sample_rate?,threads?`                                                         | `embedding`                            |
| `speaker.diarize` | `segmentation_path,embedding_path,pcm,num_speakers?,threshold?,min_duration_on?,min_duration_off?` | `segments:[{start_ms,end_ms,speaker}]` |
| `llama.load`      | GGUF 文件 `path,context_size?,threads?,gpu_layers?`                                                | `{}`                                   |
| `llama.generate`  | `prompt,chat?,max_tokens?,temperature?,top_k?,top_p?,stop_tokens?,enable_thinking?`                | `text`                                 |
| `audio.decode`    | `source,destination,sample_rate?,channels?`                                                        | WAV 文件 `path`                        |

`pcm` 为 base64 的单声道 16 kHz PCM16LE，单次最多 10 分钟。`asr.decode` 的时间相对本次音频；VAD 的时间相对最近一次 `vad.load` 或 `vad.reset` 后的累计样本。VAD 按 512 样本处理，`with_state:true` 将 feed/flush 结果改为 `{segments,speech_detected,current_segment_start}`，当前段起点单位为样本，无语音时为 -1。`vad.flush` 补足 V5 前瞻后截到真实长度；继续喂音频前调用 `vad.reset`。VAD 原始分段不猜测暂停或硬切原因，业务层统一保留前垫和重叠音频。没有模型真实对齐时 `words` 为空。Swift Parakeet 对齐补丁仅让上游已计算的 token 暴露到通用结果中。

生成期间发送 `{type:'llama.partial',payload:{id,text}}` 或 `{type:'asr.partial',payload:{id,text}}`，`text` 为累计文本。GGUF 每次生成清空 KV；相同模型配置重复 `llama.load` 复用已加载模型。`chat:true` 使用模型模板，默认关闭支持 `enable_thinking` 的 Qwen 模型思考输出。上下文不足明确报错。ONNX 同步解码不伪造部分结果。

## 实际模型验收

```sh
node macos/inference/smoke.cjs
BREVIA_TEST_LLM=qwen3.5-4b-q4km node macos/inference/smoke.cjs
BREVIA_TEST_MLX=1 BREVIA_TEST_MODEL=qwen3-asr-0.6b-mlx node macos/inference/smoke.cjs
BREVIA_TEST_MLX=1 BREVIA_TEST_MODEL=funasr-nano-mlx node macos/inference/smoke.cjs
BREVIA_TEST_MLX=1 BREVIA_TEST_MODEL=parakeet-tdt-0.6b-v3-mlx node macos/inference/smoke.cjs
```

前两个位置参数可指定模型目录和引擎目录。验收直接加载已安装权重，覆盖样例转写、VAD、512 维声纹、说话人分段、真实 GGUF 生成、停止词和 Parakeet 对齐，不下载模型或使用替身。
