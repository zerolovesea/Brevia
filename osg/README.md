# Brevia App Store 宣传图

为 iOS 1.0.1 准备的中文、英文宣传图，每种语言 5 张，使用 [Open Screenshot Generator](https://github.com/dotnetdreamer/open-screenshot-generator) 0.1.34 的原生工程与官方 PNG 渲染器导出。Shotluma 已评估，本套采用 Open Screenshot Generator。

## 五个功能场景

| 顺序 | 中文主标题                   | 展示内容                                           |
| ---- | ---------------------------- | -------------------------------------------------- |
| 01   | 随身录音。电脑接力。         | iPhone 采集声音，自己的电脑识别，文字回到手机      |
| 02   | 两台设备，一次连接。         | 扫码或 PIN 配对，电脑端确认与已连接设备            |
| 03   | 手机负责录。电脑负责识别。   | 手机实时查看电脑返回的转写，不宣传手机运行识别模型 |
| 04   | 你的手机，也是电脑的麦克风。 | 电脑发起会议，手机采音，逐字稿和笔记保存在电脑     |
| 05   | 先录下来。稍后再转写。       | 手机独立离线录音，之后选择电脑并确认上传           |

## 成品位置

- `out/1320x2868/`：中英文共 10 张原生画板尺寸 PNG。
- `out/1206x2622/`：中英文共 10 张中等显示屏尺寸 PNG。
- `out/preview-zh.png`、`out/preview-en.png`：两套图片的总览，不能作为单张 App Store 截图上传。
- `Brevia-App-Store-1.0.1.zip`：两档成品、总览、工程与源素材的压缩包。
- `project.json`：可编辑的 Open Screenshot Generator 原生工程，包含 10 个画板与内嵌图像，不依赖临时文件。

文件名中的 `zh-01` 至 `zh-05` 为中文，`en-01` 至 `en-05` 为英文。两种语言分别上传到对应商店本地化版本，保持顺序。

## 继续编辑与导出

### 标题横幅与搜索结果素材

这四张素材用于 App Store Connect 的“标题和搜索结果”，与上面的竖版截屏分开。最终文件为：

- `out/creative/01_zh-header-final_3840x1646.png`：中文标题横幅。
- `out/creative/03_en-header-final_3840x1646.png`：英文标题横幅。
- `out/creative/02_zh-search_iPhone_3840x2560.png`：中文搜索图。
- `out/creative/04_en-search_iPhone_3840x2560.png`：英文搜索图。

标题使用声波连接手机与电脑的概念主视觉；手机和电脑画面是品牌示意，不作为应用操作截图。底图由内置 imagegen 生成，原图及按手机裁切收拢后的底图分别保存在 `screenshots/header-sound-to-text.png` 和 `screenshots/header-sound-to-text-safe.png`；完整生成及修改提示词在 `source/header-image-prompt.txt`。中英文文字使用原生文字图层排版，避免生成图片中的文字误差。

`project-creative.json` 为四张最终素材的可编辑原生工程；`project-creative-v1.json` 保留首版设备构图。`source/creative.mjs` 和 `osg-creative.config.ts` 用于生成与导出。`out/creative/` 中没有 `-final` 的旧横幅仅为迭代记录；`Brevia-Creative-1.0.1.zip` 只打包四张最终成品、可编辑工程、提示词和检查记录。

```sh
node osg/source/creative.mjs
npx --yes open-screenshot-generator@0.1.34 render --config osg/osg-creative.config.ts
```

渲染器输出 PNG 后，需要按 Apple 要求转为 RGB、去除完全不透明的 alpha 通道，再上传；本次交付文件已完成此处理，四张最终图片均核对了尺寸、RGB 模式及画板元素边界。

四张创意素材已保存至 1.0.1 草稿，未提交审核；已核对 iPhone 和 iPhone Duo 竖屏的标题及搜索结果预览。Duo 横向产品页预览未提供横幅图源，未确认横向呈现；不将后台预览等同于实际商店全设备验收。预览凭证位于 `out/asc-proof/creative/`。

### 竖版截屏

在仓库根目录运行：

```sh
# 在原工具中打开可编辑工程；无需重新制作画板。
npx --yes open-screenshot-generator@0.1.34 studio --config osg/osg.config.ts

# 从保存的工程导出两档尺寸，并运行工具的规格检查。
bash osg/render.sh
```

也可以把 `project.json` 导入工具的可视化编辑器。标题、副标题、说明、背景、位置和设备框均保留为原生图层；桌面界面示意作为设备中的图像素材使用。

`source/design.mjs` 保存本次排版、文案和桌面 SVG 的生成源。运行 `node osg/source/design.mjs` 会重新生成工程并覆盖在可视化编辑器中的手工改动；日常修改优先直接编辑 `project.json` 对应的工程。两个配置文件分别确定原始尺寸和 1206×2622 转换输出。

`source/medium.mjs` 从原始工程按比例生成中等尺寸的 `project-medium.json`，再由原工具以原生画板导出，避免依赖当前 CLI 尚未提供的中等尺寸转换预设。总览和 ZIP 是本次交付快照，重新导出 PNG 后需重新制作总览与打包。

## 截图来源与范围

手机画面通过 `source/mobile_capture_test.dart` 调用当前 Flutter 生产控件渲染，使用隔离的虚构会议、笔记和转写。图片尺寸为 1560×3376。未启动真实麦克风，也未读取用户录音、账号或配对凭据。这些是控件渲染的宣传示例，不是 iPhone 真机运行的验证证据。

桌面画面参考当前双栏会议界面和“设备连接”页面重绘，源文件在 `screenshots/desktop/`。录音来源、识别分工、离线上传等行为依据现有实现；不添加未实现的手机本地转写、云端识别或自动上传功能。文字内容为虚构示例，产品界面示意仍需在提交前与选定发布包人工核对。

重新捕获手机界面时，在 `mobile` 目录运行，给 `BREVIA_CAPTURE_FONT` 提供本机支持中文的字体文件；英文将 `zh` 改为 `en`，输出目录也相应修改：

```sh
BREVIA_STORE_LANGUAGE=zh \
BREVIA_STORE_CAPTURE_DIR="$PWD/../osg/screenshots/zh" \
BREVIA_CAPTURE_FONT="/path/to/PingFang.ttc" \
flutter test --no-pub ../osg/source/mobile_capture_test.dart
```

## 验证与使用边界

中英文控件捕获测试均通过。排版检查通过工具的 `measure_element` 核对所有 70 处文字边界，未发现裁切；两档 PNG 使用 `verify` 检查尺寸及文件规格。工具检查不能替代 Apple 审核、真机体验验收或发行包与宣传图的一致性核对。

竖版截屏只使用本项目 Logo、生产控件、重绘的桌面示意和工具的程序化设备框，没有使用第三方模板的摄影、占位应用画面、虚构评分或用户评价。中英文两档竖版截屏共 20 张已上传至 App Store Connect 的 1.0.1 草稿，尚未提交审核。
