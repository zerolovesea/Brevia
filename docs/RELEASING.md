# Brevia 发版清单

发布任何版本前逐项确认。机器无关的步骤写在这里；本机专用的操作（证书、`gh` 登录、离线打包路径）
见 `docs/RELEASING.local.md`。

## 1. 版本号（三处，只有一处是自动的）

| 位置 | 内容 | 谁负责 |
| --- | --- | --- |
| `package.json` / `package-lock.json` | `version` | 自动：`release.sh` 里的 `npm version` |
| `frontend/i18n-data.js` 的 `whatsNewLog` | 新增一条 `{ version, date, current: true }`，并把上一条的 `current: true` 去掉 | **手动，没有任何工具校验** |
| `docs/releases/v<version>.md` | GitHub Release Notes | 手动，缺文件 `release.sh` 会直接退出 |

`whatsNewLog` 漏更新的后果：应用内「更新日志」把上一个版本标成当前版本。
`current` 只能有一条，顺序按版本从新到旧。

## 2. 内容与文案

- [ ] `whatsNewLog` 新条目按实际改动写 `what` / `improved` / `fixed`，至少 `zh` + `en`（其余语言回退到 `en`）。
- [ ] `docs/releases/v<version>.md` 与 `whatsNewLog` 口径一致。
- [ ] 用户可见行为变化同步到 `README.md` 与 `docs/README.zh-CN.md`（例如停顿阈值、模型列表、性能模式说明）。
- [ ] 面向访客的功能描述同步到 `website/index-zh.html` / `website/index-en.html`（下载链接由 CI 自动更新，正文不会）。
- [ ] 基准报告、诊断脚本里的数字与类名/用例名指向当前代码（删除的功能不要留在文档里）。

## 3. 代码卫生（发版前最后一遍）

- [ ] 没有历史兼容分支：下架的功能不留占位字段、别名、空函数钩子或「保留旧客户端字段」的注释。
- [ ] 删除的配置项同时从 `backend/settings.json` 移除；用户覆盖文件的多余键由 `config._prune_to_template` 统一丢弃。
- [ ] 删除的模型 ID 同步从 `backend/config.py` 的 `BUNDLED_MODEL_IDS` 移除（否则 `pack:backend` 会以 `Unknown model` 直接失败）。
- [ ] 没有只写不读的状态、没有无调用方的函数、没有只被演示数据触发的渲染分支。
- [ ] 删掉的功能同时删掉它的 CSS 类与 i18n 文案；新增的手写组件类必须有暗色规则。

## 4. 验证

```bash
npm test              # Electron 逻辑 + UI 结构 + 后端 228 项用例
ruff check backend/   # 必须 All checks passed
npm run build         # tailwind.css → styles.css，构建后 styles.css 应无额外差异
```

- [ ] 上述命令全绿。
- [ ] 手写组件类与 `styles.css` 同步（`npm run build` 后 `git diff frontend/styles.css` 只包含本次改动）。
- [ ] 启动一次应用：完成引导 → 录一段（或导入音频）→ 会后精修 → 导出，确认无控制台报错。

## 5. 打包与发布

工作区必须干净：`release.sh` 只允许 `package.json`、`package-lock.json` 和 release note 处于未提交状态，
其余改动先提交并推送。

```bash
./release.sh <version>          # 公开发布：打标签、推 main、等 GitHub Actions、下载产物
# 或
npm run release:offline         # 只在本机出安装包，不推送、不公证
```

`pack:backend` 现在会在打包开始时就校验出厂模型清单，模型下架不同步会立刻失败，而不是等到用户机器上。

## 6. 发布后

- [ ] 确认 GitHub Release 里的 `Brevia-<version>-arm64.dmg` 与 `Brevia-<version>-x64-setup.exe` 存在。
- [ ] 确认 CI 已更新 `website/index-*.html` 的下载链接（`scripts/update-release-links.mjs`）。
- [ ] 在应用内「更新日志」里确认新版本被标为当前版本。
