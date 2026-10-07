# 开发规范

手机、桌面、后端和官网共用以下原则；各语言遵循自己的默认工具，不改变接口或数据格式来统一命名。

## 格式与检查

安装开发工具：`npm ci`、`python -m pip install -r requirements-dev.txt`；手机使用与 `.github/workflows/mobile.yml` 一致的 Flutter 版本。

| 范围                                        | 写入格式                | 只检查                                                                        |
| ------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| 桌面、官网 JS / CSS / HTML 和维护文档、配置 | `npm run format`        | `npm run format:check`                                                        |
| 后端与 Python 脚本                          | `npm run format:python` | `npm run lint:python`                                                         |
| 手机 Dart（在 mobile 目录）                 | `dart format lib test`  | `dart format --output=none --set-exit-if-changed lib test`、`flutter analyze` |

格式工具版本固定在锁文件或 `requirements-dev.txt`；升级工具单独提交。Prettier 保留 HTML 空白语义，不重排模板字符串中的嵌入代码；Markdown 不强制重排段落。`frontend/styles.css` 由 `npm run build` 生成，不手动格式化。模型、录音、翻译词条的实际内容、锁文件、第三方文件和原生工程生成配置不做人工风格清理。

Swift 使用与移动端 CI 一致的 Xcode 自带的 `swift-format`（`xcrun swift-format format --in-place <文件>`），CI 使用 `xcrun swift-format lint --strict` 检查；Kotlin 遵循 Android Studio 默认格式。少量 Ruby 和 Shell 脚本沿用语言惯例，不为格式引入额外依赖；分别用 `ruby -c`、`bash -n` 检查语法。原生源码修改后运行对应平台构建。

## 代码书写

- JS / Dart 的变量和函数使用 camelCase；Python 使用 snake_case；类名使用 PascalCase。
- 跨端协议、存储字段、IPC 名称和外部 API 字段保持既有约定，修改需要兼容性评估。
- 一行一个独立操作；简单提前返回可以单行，复杂条件、异常处理和多步操作展开。换行与引号以格式工具为准。
- 新增导入按标准库、第三方、本地模块分组。JS 有副作用导入及 Python 初始化顺序不得仅为排序而调整。
- 优先复用已有实现；不按文件行数强制拆分，不为统一外观引入抽象。

## 注释

- 新增或修改的自有代码注释以中文为主，技术名称保留英文；模板和第三方注释保留原文。
- 解释原因、协议约束、安全边界、平台限制和恢复策略，不复述明显的代码操作。
- 接口或复杂协议写简短说明，普通内部函数不强制补注释。
- 历史问题只保留当前仍有效的约束，详细过程放在 Git 或 issue；旧注释在修改相关代码时逐步统一，不批量翻译。
- 临时限制明确描述影响及解除条件；安全与数据恢复注释不能因精简而删除。

## 提交与验证

纯格式调整与功能修改分开提交。不要夹带字段重命名、依赖升级或逻辑重构，也不要覆盖其他人的未提交改动。

提交前运行上述范围内的格式与静态检查。桌面/后端修改运行 `npm test`；手机修改在 `mobile` 下运行 `flutter test`；发布脚本修改运行 `ruby mobile/scripts/test-release.rb`。网站演示修改运行 `node_modules/.bin/electron scripts/test-website-demos.cjs`（需要桌面环境）。格式检查由 CI 执行，不在发布流程里自动重写源码。
