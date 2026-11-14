#!/usr/bin/env bash
# Run under dbus-run-session and xvfb-run with a private PulseAudio session.
set -euo pipefail
backend=${1:?specify cpu or cuda}
engines=/usr/lib/Brevia/engines
test "$(cat "$engines/mlx-backend")" = "$backend"
test -x "$engines/brevia-mlx-cpp"
if [[ "$backend" == cpu ]]; then
  echo '{"id":1,"type":"engine.check","payload":{"device":"cpu"}}' | "$engines/brevia-mlx-cpp" | jq -e '.ok and .result.value == 5'
elif [[ "$backend" == cuda ]]; then
  patchelf --print-needed "$engines/libmlx.so" | grep -Fx libcuda.so.1
  if compgen -G '/dev/nvidia[0-9]*' >/dev/null || [[ -e /dev/dxg ]] || nvidia-smi -L 2>/dev/null | grep -q '^GPU '; then
    echo '{"id":1,"type":"engine.check","payload":{"device":"gpu"}}' | "$engines/brevia-mlx-cpp" | jq -e '.ok and .result.value == 5'
  else
    echo 'CUDA linkage verified; GPU execution skipped (no NVIDIA device).'
  fi
else
  exit 2
fi
profile=$(mktemp -d)
export BREVIA_DATA_DIR="$profile"
brevia-desktop --background &
app=$!
cleanup() {
  kill "$app" 2>/dev/null || true
  wait "$app" 2>/dev/null || true
  rm -rf "$profile"
}
trap cleanup EXIT
for _ in $(seq 1 60); do
  brevia status --no-start | jq -e '.result.ready' >/dev/null && break
  sleep 1
done
brevia status --no-start | jq -e '.result.ready'
brevia models.list | jq -e '.ok'
pulseaudio --start
brevia devices.list | jq -e '.ok'
sink=$(pactl load-module module-null-sink sink_name=brevia_test)
pactl set-default-sink brevia_test
pactl set-default-source brevia_test.monitor
control() { brevia recording.control "$1" | jq -e '.result.confirmed'; }
control '{"action":"start","target":"computer","request_id":"test-start","title":"Linux capture","audio_tracks":["mic","system"]}'
paplay /usr/lib/Brevia/backend/fixtures/example-zh.wav &
play=$!
sleep 2
control '{"action":"pause","target":"computer","request_id":"test-pause"}'
control '{"action":"resume","target":"computer","request_id":"test-resume"}'
sleep 1
control '{"action":"stop","target":"computer","request_id":"test-stop"}'
kill "$play" 2>/dev/null || true
pactl unload-module "$sink"
# Seed meetings contain playback files. Check only raw chunks from this capture.
python3 - "$profile/meetings" <<'PYTHON'
import sys
import wave
from pathlib import Path

root = Path(sys.argv[1])
folders = {chunk.parent for chunk in root.glob("*/audio/mic-*.wav")}
assert len(folders) == 1, folders
audio = folders.pop()
for track in ("mic", "system"):
    samples = []
    for chunk in sorted(audio.glob(f"{track}-*.wav")):
        with wave.open(str(chunk)) as wav:
            assert (wav.getsampwidth(), wav.getnchannels(), wav.getframerate()) == (2, 1, 16000)
            samples.append(wav.readframes(wav.getnframes()))
    pcm = b"".join(samples)
    if not any(pcm):
        raise RuntimeError(f"{track} produced no nonzero PCM")
    print(f"{track}: verified {len(pcm) // 2} samples")
PYTHON
