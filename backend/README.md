# 模型与配置资源

此目录保存两端共用的 `models.json`、`settings.json`、`examples.json` 与测试音频；不包含执行后端。

桌面业务由 `macos/backend/worker.cjs` 处理，原生推理由 C++ / Swift 引擎执行。Worker 使用标准输入输出上的 JSONL command/event 协议，沿用既有消息名、会议数据库和模型 ID。Electron 壳与 Python 后端已退役，旧用户数据的读取和迁移由当前 Node 后端负责。

开发、接入模型、测试与打包统一见[开发者手册](../DEVELOPMENT.md)；原生执行接口见[引擎手册](../macos/inference/README.md)。
