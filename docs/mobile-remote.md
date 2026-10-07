# 手机跨网连接与恢复

WebRTC 传输使用 Electron 的 Chromium 实现和 `flutter_webrtc`。局域网 HTTPS 保留，失败后自动转向可靠、有序的 DataChannel；录音仍为原来的 16 kHz 单声道 PCM16，没有 Opus 转码。传输分帧与发送缓冲有上限，收到持久化确认才前移手机上传位置，重连后从电脑清单恢复。

## 首次配对与安全边界

先在同一局域网完成原有扫码/配对码及电脑确认。桌面启用远程配置后，已配对手机下次局域网连接会获取自己的跨网凭据，无需删除原有录音或重新配对。首次配对尚不能跨网完成。

每台手机使用独立 256 位 AES-GCM 密钥加密信令，方向作为认证附加数据，每次协商使用随机会话编号。房间的电脑票据和手机票据分离；手机不持有服务端管理密钥。DataChannel 仍验证原来的配对 Bearer 令牌和设备归属，不能凭信令票据调用电脑 API。电脑“取消信任”会关闭该设备连接并撤销 API 权限。

信令服务仅转发加密协商信息，不收录音；TURN 在无法直连时中继 DTLS 加密流量，不解密、不存储音频。服务运营方仍能看到网络地址、连接时刻和流量大小，因此不应宣传为“音频完全不经服务器”。不要把 `remote.json`、`.env` 或手机安全存储中的凭据放入日志、截图或版本库。

## 部署信令与 TURN

部署目录：[services/mobile-relay](../services/mobile-relay)。需要 Linux 公网主机、Docker Compose、两个已解析域名和 TURN 域名的有效 TLS 证书。

1. 将该目录复制到服务器，复制 `.env.example` 为 `.env`。分别执行 `openssl rand -hex 32` 生成 `RELAY_SECRET`、`TURN_SECRET`，填写域名和公网 IP。`.env` 权限设为 `600`。
2. 将 TURN 域名证书放在 `certs/fullchain.pem`、私钥放在 `certs/privkey.pem`，只授予容器所需读取权限。证书可以通过 DNS 验证签发；配置续期后重启 TURN 容器。信令 HTTPS 证书由 Caddy 自动申请和续期。
3. 开放 TCP 80/443（信令）、UDP/TCP 3478、TCP 5349（TURN TLS）和 UDP 49160–49260（中继），执行 `docker compose up -d --build`。云主机 NAT 映射时应按 coturn 文档补充公网/私网映射。
4. 检查 `https://你的信令域名/health` 返回 `ok`。TURN 还需要实际 ICE 中继测试，HTTP 健康检查不能证明 TURN 可用。

受限企业网络可能只放行 TCP 443。此时在**另一个公网 IP/主机**运行 TURN，将 TLS 监听端口改为 443，并将信令容器 `TURN_URLS` 的 TLS 地址改为 `turns:该域名:443?transport=tcp`。同一 IP 的 Caddy 和 coturn 不能同时占用 443。不要用关闭证书验证的方式解决连接问题。

TURN 凭据按房间签发，有效期一小时，在重新建立信令连接时刷新；连接每 45 分钟重新协商一次，避免过期后失去中继，协商期间继续本地录音并保留待确认分片；静态 TURN 密钥只在服务端使用。默认限制 128 个房间、每用户 4 个 TURN 分配、中继端口范围及带宽；扩大部署前按负载调整，且保留配额和禁止内网目的地址的限制。设备票据长期有效，取消信任立即撤销桌面 API 权限；若票据泄露导致公共服务资源滥用，应轮换服务密钥并重新分发配置。

## 桌面配置入口

在 Brevia 数据目录的 `mobile/remote.json` 写入以下配置并重启桌面应用（默认数据目录为用户选择的 Brevia 数据目录，macOS 初始为 `~/brevia`）：

```json
{
  "url": "wss://signal.example.com",
  "secret": "与服务器 RELAY_SECRET 相同的 64 位十六进制字符串"
}
```

文件权限设为 `600`。不配置时完全保留原有局域网行为。服务部署密钥仅配置在可信电脑上；为多个互不信任用户提供公共服务前，需要额外的账号注册、每用户票据签发与配额管理，本部署面向个人或可信团队。

启用后先让手机在局域网在线一次，确认后再切换蜂窝网络。更换服务地址/密钥后也需要在局域网刷新凭据。删除 `remote.json` 并重启可关闭跨网连接。

## 休眠、锁屏与网络切换

- 仅熄屏不会主动结束传输。实际系统休眠会关闭 WebRTC 连接，保留会议；电脑唤醒立即恢复信令连接，手机收到在线通知后重新协商，无需重新配对。
- 手机断连显示加载条、“电脑已休眠或断开，等待开盖或恢复连接”，继续本地录音。网络切换和回到前台立即重试；信令断线使用带抖动的有上限退避，避免请求风暴。
- Android 使用现有麦克风前台服务、唤醒锁与 Wi-Fi 锁；iOS 使用现有后台音频录制能力。WebRTC 不接管麦克风，重连不会创建第二份录音流。
- 手机系统强制停止、权限撤销、电话中断或存储耗尽不能靠 WebRTC 消除。系统挂起已经结束录音的应用时，恢复上传可能需要重新打开手机应用；不会声称后台无限常驻。
- 唤醒后还需等待系统网络、DNS、TLS、ICE/TURN 恢复，不能保证固定的“闪连”时长。离线提示无法可靠区分合盖、关机、路由器故障和系统休眠，文案保留“或断开”。

## 回归验证

`npm test` 包括实际 Chromium DataChannel 的端到端检查：分片传输、Unicode 大响应、设备鉴权、确认丢失后重连重发、冲突分片、加密信令篡改与角色票据隔离。手机执行 `flutter analyze`、`flutter test` 和两个平台构建。

发布前使用真实 iPhone/Android 和已部署服务补测：Wi-Fi ↔ 蜂窝、飞行模式、双方网络断开、PC 合盖/开盖、手机锁屏 30 分钟、TURN 强制中继与仅 TCP 443、1%/5% 丢包和 200 ms 延迟。比较最终 PCM 字节、样本数、会议 ID 与字幕，记录首次连接及恢复耗时分布。开发机回环测试不能代替公网 NAT、真机后台和 Windows 测试。

参考：[Flutter WebRTC](https://flutter-webrtc.org/docs/flutter-webrtc/api-docs/rtc-peerconnection/)、[WebRTC DataChannel](https://webrtc.org/getting-started/data-channels)、[coturn](https://github.com/coturn/coturn)。
