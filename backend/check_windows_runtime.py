"""Frozen Windows smoke check: native DLLs and bundled ONNX VAD, no downloads."""

import json
import os
import re
import sys
from pathlib import Path


def main():
    import llama_cpp
    import numpy as np
    import sherpa_onnx

    from backend.asr import _windows_cuda_available, load_model_catalog, model_directory_name

    catalog = load_model_catalog()
    if os.environ.get('BREVIA_EXPECT_CUDA') == '0' and '+cuda' in sherpa_onnx.__version__:
        raise RuntimeError('CPU package must not contain a CUDA Sherpa wheel')
    if os.environ.get('BREVIA_EXPECT_CUDA') == '1':
        if '+cuda12.cudnn9' not in sherpa_onnx.__version__:
            raise RuntimeError(f'Wrong CUDA wheel: {sherpa_onnx.__version__}')
        internal = Path(sys.executable).parent / '_internal'
        for name in (
            'onnxruntime_providers_cuda.dll',
            'onnxruntime_providers_shared.dll',
            'cublas64_12.dll',
            'cublasLt64_12.dll',
            'cudart64_12.dll',
            'cudnn64_9.dll',
            'cudnn_ops64_9.dll',
            'cufft64_11.dll',
            'curand64_10.dll',
            'nvrtc64_120_0.dll',
        ):
            if not any(internal.rglob(name)):
                raise RuntimeError(f'CUDA runtime is missing {name}')
    gpu = os.environ.get('BREVIA_VALIDATE_GPU') == '1'
    if gpu:
        import ctypes

        if not _windows_cuda_available():
            raise RuntimeError('No working NVIDIA CUDA device/driver')
        # 在有 GPU 的机器上真实加载 EP，不能把缺 DLL 后的 CPU 回退当成 CUDA 通过。
        provider = next(internal.rglob('onnxruntime_providers_cuda.dll'))
        ctypes.WinDLL(str(provider))
    if any(model['runtime'] == 'mlx-audio' for model in catalog.values()):
        raise RuntimeError('Windows catalog must use Sherpa ONNX, not MLX')
    model = catalog['silero-vad']
    backend = Path(sys.executable).resolve().parent.parent.parent
    vad_path = (
        backend
        / 'bundled-models'
        / model_directory_name('silero-vad', model['revision'])
        / model['files'][0]
    )
    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = str(vad_path)
    config.sample_rate = 16000
    config.num_threads = 1
    config.provider = 'cuda' if gpu else 'cpu'
    detector = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=2)
    detector.accept_waveform(np.zeros(16000, dtype=np.float32))
    detector.flush()
    if not detector.empty():
        raise RuntimeError('Silence unexpectedly classified as speech')
    # Import alone does not catch llama backend initialization/DLL failures.
    llama_cpp.llama_backend_init()
    llama_cpp.llama_backend_free()
    # 校验实际 DLL 的编译能力，防止构建参数未生效或旧 wheel 被打进安装包。
    system_info = llama_cpp.llama_print_system_info().decode('utf-8')
    features = dict(re.findall(r'(\w+) = (\d+)', system_info))
    if features.get('AVX2') != '1' or any(
        name.startswith('AVX512') and enabled == '1' for name, enabled in features.items()
    ):
        raise RuntimeError(f'Windows llama runtime requires AVX2 without AVX512: {system_info}')
    result = {'asr': 'sherpa-onnx', 'vad': 'passed', 'llama': 'passed'}
    if gpu:
        result['gpu'] = 'passed'
    print(json.dumps(result))
