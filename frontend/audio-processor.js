// AudioWorklet 处理器：替代已废弃的 ScriptProcessorNode,在独立音频线程中实时捕获音频。
// 它只做纯粹的数据搬运——累积样本并计算电平,回传主线程;暂停/静音等状态判断仍留在主线程,
// 以保持与旧实现完全一致的语义并避免跨线程状态竞争。
// process() 每次仅处理 128 帧,逐块回传会产生海量消息,因此累积到 BLOCK_SIZE 再一次性回传。
// 8,192 帧在常见 48 kHz 输入下约为 170 ms，能将编码、IPC、落盘和 ASR 唤醒频率减半，
// 同时保持实时字幕所需的低延迟。
const BLOCK_SIZE = 8192;

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BLOCK_SIZE);
    this.filled = 0; // 当前缓冲区已累积的样本数
    this.port.onmessage = ({ data }) => {
      if (data?.type !== 'flush') return;
      this.flush();
      this.port.postMessage({ flushed: true });
    };
  }

  // 处理一块音频(Web Audio 标准为 128 帧),累积到 BLOCK_SIZE 后回传主线程。
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length || !input[0]) return true;

    const samples = input[0]; // 取单声道
    for (let i = 0; i < samples.length; i += 1) {
      this.buffer[this.filled] = samples[i];
      this.filled += 1;
      if (this.filled === BLOCK_SIZE) this.flush();
    }
    return true; // 返回 true 保持处理器存活
  }

  // 计算原始电平并回传累积的样本块。以 Transferable 方式转移 buffer,避免跨线程复制开销。
  flush() {
    if (!this.filled) return;
    const count = this.filled;
    const out = this.buffer.slice(0, count);
    const power = out.reduce((total, sample) => total + sample * sample, 0) / count;
    const level = Math.min(1, Math.sqrt(power) * 8);
    this.filled = 0;
    this.port.postMessage({ samples: out, level }, [out.buffer]);
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
