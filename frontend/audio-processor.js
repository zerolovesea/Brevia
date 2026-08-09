// AudioWorklet 处理器：替代已废弃的 ScriptProcessorNode,在独立音频线程中实时捕获音频。
// 它只做纯粹的数据搬运——累积样本并计算电平,回传主线程;暂停/静音等状态判断仍留在主线程,
// 以保持与旧实现完全一致的语义并避免跨线程状态竞争。
// process() 每次仅处理 128 帧,逐块回传会产生海量消息,因此累积到 BLOCK_SIZE 再一次性回传,
// 消息频率与旧的 4096 帧 ScriptProcessor 保持一致。
const BLOCK_SIZE = 4096;

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BLOCK_SIZE);
    this.filled = 0; // 当前缓冲区已累积的样本数
  }

  // 处理一块音频(Web Audio 标准为 128 帧),累积到 BLOCK_SIZE 后回传主线程。
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length || !input[0]) return true;

    const samples = input[0]; // 取单声道
    for (let i = 0; i < samples.length; i += 1) {
      this.buffer[this.filled] = samples[i];
      this.filled += 1;
      if (this.filled === BLOCK_SIZE) {
        this.flush();
        this.filled = 0;
      }
    }
    return true; // 返回 true 保持处理器存活
  }

  // 计算原始电平并回传累积的样本块。以 Transferable 方式转移 buffer,避免跨线程复制开销。
  flush() {
    const power = this.buffer.reduce((total, sample) => total + sample * sample, 0) / BLOCK_SIZE;
    const level = Math.min(1, Math.sqrt(power) * 8);
    const out = new Float32Array(this.buffer); // 复制一份用于转移,原缓冲区继续复用
    this.port.postMessage({ samples: out, level }, [out.buffer]);
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
