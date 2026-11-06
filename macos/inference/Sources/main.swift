import Foundation
import MLX
import MLXAudioSTT

// 模型库的诊断可能写 stdout，协议独占复制的文件描述符。
let protocolOutput = FileHandle(fileDescriptor: dup(STDOUT_FILENO), closeOnDealloc: true)
dup2(STDERR_FILENO, STDOUT_FILENO)
func emit(_ value: [String: Any]) {
  do {
    var data = try JSONSerialization.data(withJSONObject: value)
    data.append(10)
    try protocolOutput.write(contentsOf: data)
  } catch { exit(1) }
}

struct InputError: LocalizedError {
  let errorDescription: String?
  init(_ message: String) { errorDescription = message }
}

var model: (any STTGenerationModel)?
var options: [String: Any] = [:]
while let line = readLine() {
  var requestID: Any = NSNull()
  do {
    guard line.utf8.count <= 32 * 1024 * 1024,
      let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
      let id = request["id"], let command = request["type"] as? String,
      let payload = request["payload"] as? [String: Any]
    else { throw InputError("Invalid inference command") }
    requestID = id
    var result: [String: Any]
    switch command {
    case "asr.load":
      guard let path = payload["path"] as? String,
        FileManager.default.fileExists(atPath: path + "/config.json")
      else { throw InputError("Select an installed model directory") }
      let families = [
        "qwen3": "qwen3_asr", "nemo-transducer": "parakeet",
        "funasr-nano": "fun_asr_nano", "fireredasr2": "fireredasr2", "whisper": "whisper",
      ]
      guard let family = families[payload["kind"] as? String ?? ""] else {
        throw InputError("Unsupported MLX model family")
      }
      model = nil
      Memory.clearCache()
      model = try await STT.loadModel(modelRepo: path, modelType: family)
      options = payload
      result = ["max_speech_seconds": 20]
    case "asr.decode":
      guard let model else { throw InputError("Load a model first") }
      guard (payload["sample_rate"] as? Int ?? 16000) == 16000,
        let encoded = payload["pcm"] as? String, let data = Data(base64Encoded: encoded),
        !data.isEmpty, data.count % 2 == 0, data.count <= 16000 * 2 * 60 * 10
      else { throw InputError("Expected bounded mono 16 kHz PCM16") }
      let samples: [Float] = data.withUnsafeBytes { bytes in
        stride(from: 0, to: data.count, by: 2).map {
          Float(Int16(littleEndian: bytes.loadUnaligned(fromByteOffset: $0, as: Int16.self)))
            / 32768
        }
      }
      let audio = MLXArray(samples)
      let language = options["language"] as? String
      let words = options["hotwords"] as? [String] ?? []
      let params = STTGenerateParameters(
        maxTokens: 512, language: language == "auto" ? nil : language, chunkDuration: 20,
        initialPrompt: options["kind"] as? String == "whisper" ? words.joined(separator: ", ") : nil
      )
      let stream: AsyncThrowingStream<STTGeneration, Error>
      if let fun = model as? FunASRNanoModel {
        stream = fun.generateStream(audio: audio, generationParameters: params, hotwords: words)
      } else if let qwen = model as? Qwen3ASRModel {
        stream = qwen.generateStream(
          audio: audio, maxTokens: 512, context: words.joined(separator: ","),
          language: params.language, chunkDuration: 20)
      } else {
        stream = model.generateStream(audio: audio, generationParameters: params)
      }
      var transcript = ""
      var alignment: [[String: Any]] = []
      for try await event in stream {
        switch event {
        case .token(let value):
          transcript += value
          emit(["type": "asr.partial", "payload": ["id": id, "text": transcript]])
        case .result(let output):
          transcript = output.text
          // 只有 Parakeet 的对齐来自音频，其他模型的估计时间不能当成原话引用。
          if options["kind"] as? String == "nemo-transducer" {
            for segment in output.segments ?? [] {
              for token in segment["tokens"] as? [[String: Any]] ?? [] {
                if let start = token["start"] as? Double, let end = token["end"] as? Double,
                  let text = token["text"] as? String
                {
                  alignment.append([
                    "text": text, "start_ms": Int((start * 1000).rounded()),
                    "end_ms": Int((end * 1000).rounded()),
                  ])
                }
              }
            }
          }
        case .info: break
        }
      }
      Memory.clearCache()
      result = [
        "text": transcript.trimmingCharacters(in: .whitespacesAndNewlines), "words": alignment,
      ]
    default: throw InputError("Unknown inference command")
    }
    emit(["id": id, "ok": true, "result": result])
  } catch {
    emit(["id": requestID, "ok": false, "error": error.localizedDescription])
  }
}
