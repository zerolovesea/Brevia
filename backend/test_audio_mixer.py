"""Waveform regressions: echo removal must never retime the playback signal."""
import unittest
from pathlib import Path

import numpy as np

from .audio_io import read_mono_wav
from .audio_mixer import AlignedAudioMixer


class AudioMixerTest(unittest.TestCase):
    @staticmethod
    def mix(mic, system, chunk=2731):
        mixer, output = AlignedAudioMixer(), []
        for offset in range(0, max(len(mic), len(system)), chunk):
            for track, audio in (("mic", mic), ("system", system)):
                output.extend(mixer.accept(track, audio[offset:offset + chunk], offset / 16))
        output.extend(mixer.flush())
        position = 0
        for samples, start in output:
            assert start == round(position / 16)
            position += len(samples)
        assert mixer.flush() == []
        return np.concatenate([samples for samples, _ in output])

    @staticmethod
    def delayed(audio, milliseconds):
        delay = round(milliseconds * 16)
        if delay < 0:
            return np.pad(audio[-delay:], (0, -delay))
        return np.pad(audio, (delay, 0))[:len(audio)]

    def test_long_and_multiple_echo_paths_keep_original_playback_clock(self):
        speech, _ = read_mono_wav(Path(__file__).parent / 'fixtures' / 'example-zh.wav')
        system = speech * .4
        for paths in (((120, .7),), ((700, .7),), ((1400, .7),), ((-300, .7),), ((120, .7), (280, .5))):
            with self.subTest(paths=paths):
                mic = sum(gain * self.delayed(system, delay) for delay, gain in paths)
                mixed = self.mix(mic, system)
                self.assertEqual(len(mixed), len(system))
                reduction = 10 * np.log10(np.sum(mic ** 2) / max(np.sum((mixed - system) ** 2), 1e-20))
                self.assertGreater(reduction, 15)

    def test_abrupt_delay_changes_do_not_repeat_or_skip_dry_audio(self):
        system = np.random.default_rng(41).normal(0, .05, 16000 * 8).astype(np.float32)
        mic = np.zeros_like(system)
        for start in range(0, len(system), 16000):
            delay = 120 if start // 16000 % 2 == 0 else 700
            mic[start:start + 16000] = self.delayed(system, delay)[start:start + 16000] * .7
        mixed = self.mix(mic, system)
        np.testing.assert_allclose(mixed, system, atol=1e-6)
        # Neither IPC batching nor final flush may change the output waveform.
        np.testing.assert_array_equal(mixed, self.mix(mic, system, chunk=len(system)))

    def test_double_talk_retains_local_speech(self):
        rng = np.random.default_rng(82)
        system = rng.normal(0, .05, 16000 * 6).astype(np.float32)
        local = rng.normal(0, .03, len(system)).astype(np.float32)
        mic = local + .7 * self.delayed(system, 700) + .4 * self.delayed(system, 120)
        residual = self.mix(mic, system) - system
        self.assertGreater(np.corrcoef(residual, local)[0, 1], .99)
        self.assertAlmostEqual(float(np.dot(residual, local) / np.dot(local, local)), 1, places=2)

    def test_unrelated_tracks_and_single_track_pass_through(self):
        rng = np.random.default_rng(83)
        system = rng.normal(0, .05, 16000 * 5 + 123).astype(np.float32)
        mic = rng.normal(0, .03, len(system)).astype(np.float32)
        np.testing.assert_allclose(self.mix(mic, system), mic + system, atol=1e-7)
        np.testing.assert_array_equal(self.mix(mic, np.zeros_like(mic)), mic)
        np.testing.assert_array_equal(self.mix(np.zeros_like(system), system), system)

    def test_first_window_still_arrives_within_two_seconds(self):
        mixer = AlignedAudioMixer()
        audio = np.zeros(2 * 16000, np.float32)
        self.assertEqual(mixer.accept('mic', audio, 0), [])
        ready = mixer.accept('system', audio, 0)
        self.assertEqual(len(ready), 1)
        self.assertEqual(ready[0][1], 0)
        self.assertEqual(len(ready[0][0]), 24000)


if __name__ == '__main__':
    unittest.main()
