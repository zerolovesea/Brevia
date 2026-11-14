cmake_minimum_required(VERSION 3.24)
project(brevia_mlx LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# 使用 wheel 的原生头文件和动态库。CUDA 用户态库由运行机器提供。
find_path(MLX_INCLUDE_DIR mlx/mlx.h REQUIRED)
find_library(MLX_LIBRARY mlx REQUIRED)
find_path(JSON_INCLUDE_DIR nlohmann/json.hpp REQUIRED)
find_path(BASE64_INCLUDE_DIR base64.hpp REQUIRED)
include(FetchContent)
# Only the Hugging Face tokenizer is used. Skip the SentencePiece and RWKV builds.
FetchContent_Declare(tokenizers GIT_REPOSITORY https://github.com/mlc-ai/tokenizers-cpp.git
  GIT_TAG c586c52f93f7b060753bd2388eb96a105cb7374d GIT_SUBMODULES ""
  SOURCE_SUBDIR brevia-no-cmake
  PATCH_COMMAND git restore --source=HEAD -- rust/src/lib.rs src/huggingface_tokenizer.cc
  COMMAND git apply --whitespace=nowarn ${CMAKE_CURRENT_SOURCE_DIR}/tokenizer-load.patch)
FetchContent_MakeAvailable(tokenizers)
configure_file(tokenizers.Cargo.lock "${tokenizers_SOURCE_DIR}/rust/Cargo.lock" COPYONLY)
find_program(CARGO_EXECUTABLE cargo REQUIRED)
set(tokenizer_lib "${CMAKE_CURRENT_BINARY_DIR}/cargo/release/${CMAKE_STATIC_LIBRARY_PREFIX}tokenizers_c${CMAKE_STATIC_LIBRARY_SUFFIX}")
add_custom_command(OUTPUT "${tokenizer_lib}"
  COMMAND ${CMAKE_COMMAND} -E env CARGO_TARGET_DIR=${CMAKE_CURRENT_BINARY_DIR}/cargo
          MACOSX_DEPLOYMENT_TARGET=${CMAKE_OSX_DEPLOYMENT_TARGET}
          ${CARGO_EXECUTABLE} build --locked --release
  WORKING_DIRECTORY "${tokenizers_SOURCE_DIR}/rust"
  DEPENDS "${tokenizers_SOURCE_DIR}/rust/src/lib.rs" "${tokenizers_SOURCE_DIR}/rust/Cargo.lock"
  VERBATIM)
add_custom_target(brevia-tokenizer DEPENDS "${tokenizer_lib}")
add_executable(brevia-mlx-cpp main.cpp Nano.cpp QwenDecoder.cpp QwenASR.cpp SpeechModel.cpp
  Whisper.cpp Parakeet.cpp FireRed.cpp "${tokenizers_SOURCE_DIR}/src/huggingface_tokenizer.cc")
add_dependencies(brevia-mlx-cpp brevia-tokenizer)
target_include_directories(brevia-mlx-cpp PRIVATE ${JSON_INCLUDE_DIR} ${BASE64_INCLUDE_DIR}
  ${MLX_INCLUDE_DIR} ${tokenizers_SOURCE_DIR}/include ../../macos/inference)
target_link_libraries(brevia-mlx-cpp PRIVATE "${MLX_LIBRARY}" "${tokenizer_lib}" ${CMAKE_DL_LIBS})
target_link_options(brevia-mlx-cpp PRIVATE -Wl,--allow-shlib-undefined)
