"""聚焦存储职责的组件。"""

import base64
import json
import struct
import sys
import time
import wave
from array import array

from .config import SETTINGS
from .store_base import synchronized_storage_files


AUDIO_MANIFEST_CHECKPOINT_SECONDS = 1


class AudioStoreMixin:
    @synchronized_storage_files
    def append_audio(
        self,
        meeting_id,
        track,
        pcm_base64,
        sample_rate=SETTINGS["audio"]["sample_rate"],
        start_ms=0,
    ):
        """把一帧 PCM16 追加到会议音轨。

        Args:
            meeting_id: 正在录制的会议 UUID。
            track: ``mic`` 或 ``system``。
            pcm_base64: 小端 PCM16 字节或其 base64 表示；空数据用于 flush。
            sample_rate: 本帧样本率，同一音轨录制期间不可变化。

        Returns:
            该音轨目前累计写入的样本数。
        """
        if track not in {"mic", "system"}:
            raise ValueError("Invalid audio track")
        pcm = (
            base64.b64decode(pcm_base64, validate=True)
            if isinstance(pcm_base64, str)
            else bytes(pcm_base64)
        )
        if len(pcm) % 2:
            raise ValueError("PCM16 audio has an invalid byte length")
        session = self._audio_sessions.get(meeting_id)
        if session is None:
            manifest = self.read_manifest(meeting_id)
            # 崩溃恢复时 manifest 至多落后一秒；以每个 WAV 的已更新头部为准，
            # 避免恢复录音时重叠或留下静音空洞。
            for track_state in manifest.get("tracks", {}).values():
                track_state["samples"] = sum(
                    self._wav_samples(self.meetings_dir / meeting_id / "audio" / name)
                    for name in track_state.get("chunks", [])
                )
            session = {"manifest": manifest, "writers": {}, "last_checkpoint": 0.0}
            self._audio_sessions[meeting_id] = session
        manifest = session["manifest"]
        state = manifest["tracks"].setdefault(
            track, {"sample_rate": sample_rate, "samples": 0, "chunks": []}
        )
        if state["sample_rate"] != sample_rate:
            raise ValueError("Sample rate changed during recording")
        chunk_samples = sample_rate * SETTINGS["audio"]["chunk_seconds"]

        def append_pcm(data):
            offset = 0
            while offset < len(data):
                chunk_index = state["samples"] // chunk_samples
                in_chunk = state["samples"] % chunk_samples
                take = min((chunk_samples - in_chunk) * 2, len(data) - offset)
                name = f"{track}-{chunk_index:05d}.wav"
                path = self.meetings_dir / meeting_id / "audio" / name
                frame = data[offset : offset + take]
                output = session["writers"].get(name)
                if output is None:
                    if not path.exists():
                        with wave.open(str(path), "wb") as created:
                            created.setnchannels(1)
                            created.setsampwidth(2)
                            created.setframerate(sample_rate)
                    output = path.open("r+b", buffering=0)
                    session["writers"][name] = output
                output.seek(0, 2)
                output.write(frame)
                size = output.tell()
                output.seek(4)
                output.write(struct.pack("<I", size - 8))
                output.seek(40)
                output.write(struct.pack("<I", size - 44))
                output.seek(0, 2)
                if name not in state["chunks"]:
                    state["chunks"].append(name)
                    # 新块必须立即登记；崩溃后才可发现它并从 WAV 头恢复准确时长。
                    session["last_checkpoint"] = 0.0
                state["samples"] += take // 2
                offset += take

        target_samples = round(max(0, start_ms) * sample_rate / 1000)
        while state["samples"] < target_samples:
            append_pcm(b"\0\0" * min(target_samples - state["samples"], chunk_samples))
        append_pcm(pcm)
        self.flush_audio(meeting_id)
        return state["samples"]

    @staticmethod
    def _wav_samples(path):
        try:
            with wave.open(str(path)) as recording:
                return recording.getnframes()
        except (OSError, wave.Error):
            return 0

    def recorded_duration_ms(self, meeting_id):
        """按 WAV 实际帧数计算已录时长，供崩溃恢复使用。"""
        audio = self.meetings_dir / meeting_id / "audio"
        durations = []
        for track in ("mic", "system"):
            total_ms = 0
            for path in sorted(audio.glob(f"{track}-*.wav")):
                try:
                    with wave.open(str(path)) as recording:
                        total_ms += round(recording.getnframes() * 1000 / recording.getframerate())
                except (OSError, wave.Error):
                    continue
            durations.append(total_ms)
        return max(durations, default=0)

    @synchronized_storage_files
    def flush_audio(self, meeting_id, force=False, close=False):
        """检查点录音清单，并可在结束会议前关闭缓存的 WAV 句柄。"""
        session = self._audio_sessions.get(meeting_id)
        if not session:
            return
        now = time.monotonic()
        if force or now - session["last_checkpoint"] >= AUDIO_MANIFEST_CHECKPOINT_SECONDS:
            self.write_manifest(meeting_id, session["manifest"])
            session["last_checkpoint"] = now
        if close:
            for output in session["writers"].values():
                output.close()
            self._audio_sessions.pop(meeting_id, None)

    @synchronized_storage_files
    def close_audio_sessions(self):
        """进程退出时释放仍在录制中的文件句柄。"""
        for session in self._audio_sessions.values():
            for output in session["writers"].values():
                output.close()
        self._audio_sessions.clear()

    def audio_files(self, meeting_id):
        """返回会议的分块录音列表及可播放的连续 WAV 路径。"""
        audio = self.meetings_dir / meeting_id / "audio"
        files = {
            track: [str(path) for path in sorted(audio.glob(f"{track}-*.wav"))]
            for track in ("mic", "system")
        }
        files["playback"] = {
            track: str(audio / f"playback-{track}.wav")
            if (audio / f"playback-{track}.wav").exists()
            else None
            for track in ("mic", "system", "mix")
        }
        return files

    def _build_playback(self, meeting_id, track):
        """按文件名顺序拼接一条音轨的 WAV 分块；没有分块时不创建文件。"""
        sources = self.audio_files(meeting_id)[track]
        if not sources:
            return
        destination = self.meetings_dir / meeting_id / "audio" / f"playback-{track}.wav"
        with (
            wave.open(sources[0]) as first,
            wave.open(str(destination), "wb") as output,
        ):
            output.setparams(first.getparams())
            output.writeframes(first.readframes(first.getnframes()))
            for source in sources[1:]:
                with wave.open(source) as recording:
                    if recording.getparams()[:3] != first.getparams()[:3]:
                        raise ValueError("Audio chunk format changed during recording")
                    output.writeframes(recording.readframes(recording.getnframes()))

    def _build_mix(self, meeting_id):
        """把麦克风和系统录音等比例混合为详情页默认回放文件。"""
        playback = self.audio_files(meeting_id)["playback"]
        if not playback["mic"] or not playback["system"]:
            return
        destination = self.meetings_dir / meeting_id / "audio" / "playback-mix.wav"
        with wave.open(playback["mic"]) as mic, wave.open(playback["system"]) as system:
            if mic.getparams()[:3] != system.getparams()[:3]:
                raise ValueError("Audio track format mismatch")
            with wave.open(str(destination), "wb") as output:
                output.setparams(mic.getparams())
                while True:
                    left, right = array("h"), array("h")
                    left.frombytes(mic.readframes(65536))
                    right.frombytes(system.readframes(65536))
                    if not left and not right:
                        break
                    if sys.byteorder != "little":
                        left.byteswap()
                        right.byteswap()
                    mixed = array(
                        "h",
                        (
                            (
                                (left[index] if index < len(left) else 0)
                                + (right[index] if index < len(right) else 0)
                            )
                            // 2
                            for index in range(max(len(left), len(right)))
                        ),
                    )
                    if sys.byteorder != "little":
                        mixed.byteswap()
                    output.writeframes(mixed.tobytes())

    @synchronized_storage_files
    def read_manifest(self, meeting_id):
        """读取录音恢复清单；文件尚不存在时返回空字典。"""
        session = getattr(self, "_audio_sessions", {}).get(meeting_id)
        if session:
            return json.loads(json.dumps(session["manifest"]))
        path = self.meetings_dir / meeting_id / "manifest.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    @synchronized_storage_files
    def write_manifest(self, meeting_id, data):
        """通过临时文件替换，原子地写入录音恢复清单。"""
        path = self.meetings_dir / meeting_id / "manifest.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        temporary.replace(path)

    @synchronized_storage_files
    def recoverable_meetings(self):
        """返回清单仍未关闭的会议，用于 Worker 崩溃后的恢复提示。"""
        recoverable = []
        for path in self.meetings_dir.glob("*/manifest.json"):
            try:
                manifest = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not manifest.get("closed"):
                recoverable.append(manifest)
        return recoverable
