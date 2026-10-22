# README 功能演示素材

桌面 GIF 直接导出官网的 `website/product-motion.html`，沿用正式应用模板、样式、词条、图标和渲染函数；手机 PNG 由 `mobile/test/design_capture_test.dart` 渲染正式 Flutter 页面。中英文各一套，其他语言共用英文素材。

## 桌面动图

需要 Node.js 与 FFmpeg（含 `ffprobe`）；脚本通过固定版本的 HyperFrames 导出，无需修改项目依赖。

```sh
node scripts/render-readme-demos.mjs
```

只更新单个场景时：

```sh
node scripts/render-readme-demos.mjs live zh
```

场景为 `capsule`、`live`、`summary`、`library`、`phone-microphone`，语言为 `zh`、`en`。逻辑视口 1280 × 800，输出 2560 × 1600、10 fps 循环 GIF。中间文件保存在忽略目录 `output/readme-gif-export/`。胶囊场景为 26 秒，复用正式 `recording-capsule.html` 与状态渲染，展示收起、字幕翻译、笔记建议与采纳、固定面板、暂停与继续、保存及失败重试，并回到主窗口。演示使用虚构会议数据，不启动录音或后端。

脚本检查尺寸、帧数、播放时长和文件大小；导出后还应查看完整流程、文字和控件。

## 手机页面

在 `mobile/` 目录运行，字体路径按本机环境设置：

```sh
BREVIA_MOBILE_CAPTURE_DIR="$PWD/../output/readme-mobile-zh" \
BREVIA_CAPTURE_FONT='/Library/Fonts/Arial Unicode.ttf' \
flutter test test/design_capture_test.dart

BREVIA_MOBILE_CAPTURE_DIR="$PWD/../output/readme-mobile-en" \
BREVIA_CAPTURE_FONT='/Library/Fonts/Arial Unicode.ttf' \
BREVIA_CAPTURE_LANGUAGE=en \
flutter test test/design_capture_test.dart
```

通过检查后，将两次输出的 `mobile-library.png`、`mobile-live.png`、`mobile-offline.png` 分别复制为 `mobile/zh/` 与 `mobile/en/` 下的 `library.png`、`live.png`、`offline.png`。逻辑视口 390 × 844，输出 780 × 1688；源码指纹与检查记录保存在各输出目录的 `capture-run.json`。

下载码的目标地址与生成方法见[下载码说明](../screenshots/README.md#下载二维码)。
