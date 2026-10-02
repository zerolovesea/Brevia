"""有界双轨缓冲、动态回声对齐，以及单轨识别/回放共用的混音。"""

import time
import wave

import numpy as np


class AlignedAudioMixer:
    def __init__(self, sample_rate=16000, max_delay_ms=500):
        self.rate = sample_rate
        self.limit = round(max_delay_ms * sample_rate / 1000)
        self.window = sample_rate * 2
        self.buffers = {track: np.empty(0, np.float32) for track in ("mic", "system")}
        self.starts = {track: 0 for track in self.buffers}
        self.ends = {track: None for track in self.buffers}
        self.last_seen = {track: time.monotonic() for track in self.buffers}
        self.cursor = None
        self.emitted = False
        self.delay = 0
        self.echo = False

    def accept(self, track, samples, start_ms):
        samples = np.asarray(samples, dtype=np.float32)
        if not len(samples):
            return []
        start = round(start_ms * self.rate / 1000)
        end = self.ends[track]
        if end is None:
            self.starts[track] = start
            end = start
        # IPC 毫秒时间戳的舍入不应插入/删除样本；真正的采集中断才补静音。
        gap = start - end
        if gap > self.rate // 1000:
            # 不为长暂停分配大数组：结束旧窗口，后续从新的时间点恢复。
            if gap > self.rate * 5:
                result = self.flush()
                self.__init__(self.rate, self.limit * 1000 / self.rate)
                return result + self.accept(track, samples, start_ms)
            samples = np.concatenate((np.zeros(gap, np.float32), samples))
        elif gap < -self.rate // 1000:
            samples = samples[min(len(samples), -gap):]
        self.buffers[track] = np.concatenate((self.buffers[track], samples))
        self.ends[track] = end + len(samples)
        self.last_seen[track] = time.monotonic()
        if self.cursor is None:
            self.cursor = start
        elif not self.emitted:
            self.cursor = min(self.cursor, start)
        return self._drain()

    def _read(self, track, start, count):
        result = np.zeros(count, np.float32)
        offset = start - self.starts[track]
        lo, hi = max(0, -offset), min(count, len(self.buffers[track]) - offset)
        if hi > lo:
            result[lo:hi] = self.buffers[track][offset + lo:offset + hi]
        return result

    def _estimate(self, mic, system):
        power = float(np.linalg.norm(mic) * np.linalg.norm(system))
        if power < len(mic) * 1e-6:
            self.echo = False
            return
        size = 1 << (2 * len(mic) - 1).bit_length()
        correlation = np.fft.irfft(np.fft.rfft(mic, size) * np.fft.rfft(system, size).conj(), size)
        limit = min(self.limit, len(mic) // 3)
        lags = np.arange(-limit, limit + 1)
        scores = np.abs(correlation[lags % size]) / power
        best = int(np.argmax(scores))
        self.echo = bool(scores[best] >= 0.35)
        if self.echo:
            self.delay = int(lags[best])

    def _drain(self, final=False, include_tail=True):
        result = []
        if self.cursor is None:
            return result
        known = [end for end in self.ends.values() if end is not None]
        newest = max(known)
        available = min(known) if len(known) == 2 else self.cursor
        # 一轨停流超过两秒就按静音补齐，始终只输出 mix，恢复后仍能参与混音。
        stalled = time.monotonic() - min(self.last_seen.values()) > 2
        # 突发 IPC 批次也要等对轨；仅实际停流或超过采集端 15 秒队列上限才补零。
        if final or (stalled and newest - available > self.window) or newest - available > self.rate * 15:
            available = newest
        if final and include_tail:
            available = max(
                (self.ends["mic"] or newest) + max(0, -self.delay),
                (self.ends["system"] or newest) + max(0, self.delay),
            )
        while available - self.cursor >= self.window or (final and available > self.cursor):
            count = min(self.window, available - self.cursor)
            mic = self._read("mic", self.cursor, count)
            system = self._read("system", self.cursor, count)
            if count >= self.rate:
                self._estimate(mic, system)
            if final and include_tail:
                available = max(
                    (self.ends["mic"] or newest) + max(0, -self.delay),
                    (self.ends["system"] or newest) + max(0, self.delay),
                )
            # 只延迟较早的一轨，不提前切掉本机发言；历史参考保留一个最大延迟。
            mic = self._read("mic", self.cursor - max(0, -self.delay), count)
            system = self._read("system", self.cursor - max(0, self.delay), count)
            if self.echo:
                energy = float(np.dot(system, system))
                if energy > count * 1e-6:
                    gain = float(np.dot(mic, system)) / energy
                    # ponytail: 对齐后的单抽头回声削减；复杂房间混响需 WebRTC AEC。
                    # 减掉系统参考的投影，保留不相关的本机发言，避免反相人声抵消。
                    mic = mic - np.clip(gain, -4, 4) * system
            mixed = mic + system
            peak = float(np.abs(mixed).max()) if count else 0
            if peak > 1:
                mixed /= peak
            result.append((mixed, round(self.cursor * 1000 / self.rate)))
            self.emitted = True
            self.cursor += count
            for track in self.buffers:
                remove = max(0, min(len(self.buffers[track]), self.cursor - self.limit - self.starts[track]))
                self.buffers[track] = self.buffers[track][remove:]
                self.starts[track] += remove
        return result

    def flush(self, include_tail=True):
        return self._drain(final=True, include_tail=include_tail)


def mix_wav_files(mic_path, system_path, destination, max_delay_ms=500, progress=None):
    """流式生成对齐后的派生 WAV，原始音轨不改写。"""
    with wave.open(str(mic_path)) as mic, wave.open(str(system_path)) as system:
        if mic.getparams()[:3] != system.getparams()[:3] or mic.getnchannels() != 1 or mic.getsampwidth() != 2:
            raise ValueError("Audio track format mismatch")
        rate = mic.getframerate()
        total = max(mic.getnframes(), system.getnframes())
        mixer = AlignedAudioMixer(rate, max_delay_ms)
        with wave.open(str(destination), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(rate)

            def write(windows):
                for samples, _ in windows:
                    output.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())

            for offset in range(0, total, rate):
                for track, recording in (("mic", mic), ("system", system)):
                    data = np.frombuffer(recording.readframes(rate), dtype="<i2").astype(np.float32) / 32768
                    write(mixer.accept(track, data, offset * 1000 / rate))
                if progress:
                    progress(min(total, offset + rate), total)
            write(mixer.flush())
