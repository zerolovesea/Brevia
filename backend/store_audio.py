"""Focused storage responsibility component."""

import base64
import json
import struct
import sys
import wave
from array import array

from .config import SETTINGS
from .store_base import synchronized_storage_files


class AudioStoreMixin:
    @synchronized_storage_files
    def append_audio(
        self,
        meeting_id,
        track,
        pcm_base64,
        sample_rate=SETTINGS["audio"]["sample_rate"],
    ):
        """把一帧 base64 PCM16 追加到会议音轨。

        Args:
            meeting_id: 正在录制的会议 UUID。
            track: ``mic`` 或 ``system``。
            pcm_base64: 小端 PCM16 字节的 base64 表示；空字符串用于 flush。
            sample_rate: 本帧样本率，同一音轨录制期间不可变化。

        Returns:
            该音轨目前累计写入的样本数。
        """
        if track not in {"mic", "system"}:
            raise ValueError("Invalid audio track")
        pcm = base64.b64decode(pcm_base64, validate=True)
        if len(pcm) % 2:
            raise ValueError("PCM16 audio has an invalid byte length")
        manifest = self.read_manifest(meeting_id)
        state = manifest["tracks"].setdefault(
            track, {"sample_rate": sample_rate, "samples": 0, "chunks": []}
        )
        if state["sample_rate"] != sample_rate:
            raise ValueError("Sample rate changed during recording")
        chunk_samples = sample_rate * SETTINGS["audio"]["chunk_seconds"]
        offset = 0
        while offset < len(pcm):
            chunk_index = state["samples"] // chunk_samples
            in_chunk = state["samples"] % chunk_samples
            take = min((chunk_samples - in_chunk) * 2, len(pcm) - offset)
            name = f"{track}-{chunk_index:05d}.wav"
            path = self.meetings_dir / meeting_id / "audio" / name
            frame = pcm[offset : offset + take]
            if not path.exists():
                with wave.open(str(path), "wb") as output:
                    output.setnchannels(1)
                    output.setsampwidth(2)
                    output.setframerate(sample_rate)
                    output.writeframes(frame)
            else:
                with path.open("r+b") as output:
                    output.seek(0, 2)
                    output.write(frame)
                    size = output.tell()
                    output.seek(4)
                    output.write(struct.pack("<I", size - 8))
                    output.seek(40)
                    output.write(struct.pack("<I", size - 44))
            if name not in state["chunks"]:
                state["chunks"].append(name)
            state["samples"] += take // 2
            offset += take
        self.write_manifest(meeting_id, manifest)
        return state["samples"]

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
        exports = self.meetings_dir / meeting_id / "exports"
        files["playback"].update(
            {
                "vocals": str(exports / "separated-vocals.wav")
                if (exports / "separated-vocals.wav").exists()
                else None,
                "accompaniment": str(exports / "separated-accompaniment.wav")
                if (exports / "separated-accompaniment.wav").exists()
                else None,
            }
        )
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
