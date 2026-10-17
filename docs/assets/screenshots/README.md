# 历史截图与下载码

以下为保留的历史素材；当前首页已改用[应用界面演示](../showcase/README.md)。

这些截图于 2026 年 10 月 15 日生成，对应桌面 v1.4.0 与手机 1.0.1 的界面。截图使用独立的「产品周会 / Product review」演示数据，不含用户录音、会议、设备凭据或真实麦克风输入。

- `desktop/en`、`desktop/zh`：从本机安装的正式 Brevia v1.4.0 应用捕获，尺寸为 1962 × 1226，保留默认原生窗口及缩放。已核对安装包的 HTML、样式与脚本和当前仓库一致。会议内容通过独立数据目录中的存储记录加载，会议库、详情与设置使用生产页面；实时画面使用生产会议激活入口与正式字幕事件分发。未覆盖视口、注入布局样式、拼接截图或直接改写页面 HTML。涵盖实时会议、明暗主题、会议库、纪要、模型库、声纹设置与手机麦克风选项。
- `mobile/en`、`mobile/zh`：当前 Flutter 生产控件的测试渲染，1560 × 3376；展示会议库、电脑连接、实时转写与离线录音。控件捕获方式参见 `mobile/test/design_capture_test.dart`。这些图片不代表 iPhone 真机或跨设备录音验证。
- 其他语言的 README 共用英文界面图片；中英文首页分别使用对应语言。

捕获检查包括页面横向溢出、启动遮罩退出、PNG 尺寸，以及 Flutter 控件渲染异常。截图中的录音、AI 建议、识别结果与设备连接均为展示数据，不能作为硬件、模型质量或网络恢复的测试证据。

这些历史截图不代表桌面 v1.4.2 或手机 1.2.0 的界面与候选包验收。

## 下载二维码

下载码位于 `../download/`，不是用于连接电脑的配对码。README 中的图片外层链接与实际编码地址保持一致：

| 文件             | 内容                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `ios-qr.png`     | `https://apps.apple.com/app/id6819869442`                                                       |
| `android-qr.png` | `https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk` |

使用项目已有的 `qrcode` 依赖生成，360 × 360、四模块白边、M 级纠错；本次已通过 Apple Vision 独立解码验证。更新地址时，在仓库根目录重新生成对应图片，并同步所有 README 的文字链接和图片外层链接：

```sh
node --input-type=module <<'JS'
import QRCode from 'qrcode';
for (const [name, url] of Object.entries({
  ios: 'https://apps.apple.com/app/id6819869442',
  android: 'https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk',
})) {
  await QRCode.toFile(`docs/assets/download/${name}-qr.png`, url, {
    width: 360,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#111111', light: '#ffffff' },
  });
}
JS
```
