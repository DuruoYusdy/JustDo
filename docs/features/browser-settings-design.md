# 浏览器设置与 OpenClaw v2026.9.2 边界

本文描述 JustDo 浏览器设置、右侧嵌入式浏览器工作区，以及它们与 OpenClaw v2026.9.2 Browser plugin 的边界。OpenClaw 持有 Agent 浏览器执行、profile driver、relay 协议与 tab 授权；JustDo 持有模式选择、设置引导、可直接操作的嵌入式网页、用户标注和 Electron guest 安全边界。

## 1. 产品模式

三个产品模式保存在 `app_config.browserMode`，并映射到 OpenClaw 的三个官方 profile：

| UI 模式    | app_config  | defaultProfile | driver             | 用途                                |
| ---------- | ----------- | -------------- | ------------------ | ----------------------------------- |
| 隔离浏览器 | `isolated`  | `openclaw`     | `openclaw`         | OpenClaw 管理的独立浏览器资料       |
| 用户浏览器 | `user`      | `user`         | `existing-session` | Chrome DevTools MCP 连接日常 Chrome |
| 浏览器扩展 | `extension` | `chrome`       | `extension`        | OpenClaw 扩展连接已登录 Chrome      |

`normalizeBrowserMode` 对未知持久化值回退 `isolated`；IPC 写入仍严格拒绝未知值。切换通过 app config 与 OpenClaw config 的事务完成，同步失败时恢复原模式。

OpenClaw v2026.9.2 会补齐缺失的 `openclaw`、`user` 和 `chrome` 内置 profile。JustDo 仍显式写入所选外部浏览器 profile，以固定产品语义：

```json5
// user
{ browser: { defaultProfile: "user", profiles: { user: {
  driver: "existing-session", attachOnly: true
} } } }

// extension
{ browser: { defaultProfile: "chrome", profiles: { chrome: {
  driver: "extension"
} } } }
```

## 2. 配置应用

OpenClaw Browser plugin 将 `browser.profiles` 与 `browser.defaultProfile` 声明为 hot reload。模式切换正常走 Gateway 原生配置重载，不依赖进程环境变量，也不要求为了浏览器切换预热或重启 Gateway。

JustDo 仍在运行中会话存在时阻止切换。这是产品级一致性策略：避免同一个任务的省略 profile 调用在执行途中改变路由，不表示 OpenClaw 缺少热更新能力。

当前 JustDo 将根 `browser` block 视为应用管理配置。若以后开放自定义 browser profiles，必须改为字段级 merge 并明确保留 `snapshotDefaults`、`tabCleanup`、`extensionRelay`、自定义 profiles 等用户字段。

右侧浏览器地址栏同时承担导航与搜索：可识别的 HTTP(S) 地址直接导航，其余非空内容经过 URL 编码后交给 `app_config.browserSearchEngine` 选择的百度或 Google。未知或旧版本缺失的搜索引擎配置回退为百度。

## 3. 用户浏览器

`user` 使用 OpenClaw 的 `existing-session` driver。Gateway 通过 Chrome DevTools MCP `--autoConnect` 连接本机 Chrome；用户首次连接需要在 Chrome 中批准 Remote Debugging。

设置页读取 Preferences、`DevToolsActivePort` 和端口 owner，仅用于安装与启动引导。这些本机迹象不是连接成功的权威证据。真正的连接测试通过：

```text
browser.request
  method: GET
  path: /tabs
  query.profile: user
  timeoutMs: 45000
```

只有响应严格包含 `running: true` 才表示 Chrome MCP 页面通道可用。`{running:false,tabs:[]}` 是正常的未连接结果，不能显示“已连接”。请求超时归类为授权超时；Gateway 未连接和其他运行错误分别报告。

OpenClaw 还提供 profile-aware 的 `/` 和 `/doctor` Browser routes，后续若扩充诊断 UI，应直接投影其 `driver`、`transport`、`running`、`cdpReady`、`pageReady` 与 doctor checks，不在 JustDo 重建同一套 runtime 状态机。

## 4. 浏览器扩展

JustDo 不维护独立的 Chrome relay 实现。`resources/browser-extension/chrome-extension` 是锁定 OpenClaw runtime 所带扩展的未修改快照，当前 manifest 版本为 `2.2.0`。构建脚本只复制并验证以下契约：

- manifest 保持 OpenClaw identity；
- `openclaw-extension-relay.v2` 认证存在；
- v2 challenge/response 模块、Options 页面和完整权限存在；
- 16/32/48/128 图标尺寸正确。

更新 OpenClaw 时必须从同一锁定 runtime 更新整个目录，不能只复制 `background.js` 或继续兼容旧 JustDo extension。扩展代码、Gateway relay 和认证协议必须保持同版本。

### 配对

Windows 仍使用 OpenClaw 支持的高级手动配对。Main 调用锁定 runtime 的 `browser extension pair --json`，由 OpenClaw 负责 relay key 的安全创建、权限校验和并发复用；JustDo 只将返回的 pairing string 写入剪贴板。典型格式为：

```text
ws://127.0.0.1:<relay-port>/extension?gateway=ws%3A%2F%2F127.0.0.1%3A<gateway-port>#<relay-key>
```

默认 relay port 为 Gateway port + 10；显式 `browser.profiles.chrome.cdpPort` 优先。完整字符串属于密码，只进入系统剪贴板，不返回 Renderer、不写日志。

新版扩展在 Settings → Advanced manual pairing 接收该字符串，并使用 Browser Relay Authentication v2 完成连接绑定的挑战认证。JustDo 显式设置 `browser.extensionRelay.allowLegacyAuth=false`，不再开放 Basic/Bearer 和旧 token-subprotocol 通道。

Browser service 由第一次 `browser.request` 或 OpenClaw 的 Gateway extension route 按需唤醒。旧的 `OPENCLAW_EAGER_BROWSER_CONTROL_SERVER` 环境变量不存在于 v2026.9.2，不得重新引入。

### Tab 授权

新版扩展有两种 access mode：

- `Selected tabs`：高级手动配对的默认值，只允许 OpenClaw tab group 中的网页；
- `All tabs`：用户主动选择后，允许所有符合条件的普通网页。

设置文案必须明确默认值，不能继续声称扩展始终只共享 tab group。暂停、移组、断开、导航和 debugger attachment 的撤销与竞态处理由上游扩展实现。

### 连接测试

扩展测试调用相同的 `/tabs` route，profile 为 `chrome`。只有 `running: true` 才成功；共享 tab 可以为空。失败诊断来自 Gateway Browser plugin，不通过读取 relay key 后发送 legacy HTTP 认证来猜测端口 owner。

## 5. 安全边界

- 右侧工作区使用 Electron `<webview>` 承载真实网页，交互模式下点击、输入、滚动和选择直接进入 guest 页面，不通过截图坐标遥控外部 Chrome。
- guest 使用 `persist:justdo-browser` 持久 partition；系统/自定义/直连代理偏好同时应用到 default session 与该 partition，因此不依赖 OpenClaw 隔离浏览器的网络环境。
- `will-attach-webview` 把 preload 强制覆盖为有限的检查、viewport、快捷键和凭据确认 bridge，关闭 Node、嵌套 webview 和不安全内容，仅允许 HTTP(S) 与 `about:blank`；request guard 阻止非网页导航，权限请求默认拒绝。下载设置允许选择保存目录并决定是否逐次询问；询问时由 Main 串行显示保存对话框，自动保存时由 Main 分配不覆盖已有文件的路径，两种方式均记录状态；`target=_blank` GET 导航进入受管 guest Tab，无法安全重放的 POST popup 会明确阻止。
- 检查元素只执行应用内置脚本，脚本只插入经过有限数值化的坐标。返回文本折叠空白并限制长度，不读取表单值、cookie、页面存储或完整 DOM。
- 浏览期间不抓取截图；用户完成元素、画笔或矩形标注后会出现评论条，可展开清洗后的 HTML 元素详情、输入或语音录入评论。仅在用户提交评论时调用 guest `capturePage()`，在 Renderer 内合成标注 PNG，并沿用 20 MB 附件上限。
- 嵌入式 tab id 仅标识 JustDo UI guest，不伪装成 OpenClaw browser target。Renderer 仍不接收 Gateway token、relay key、CDP credential 或本机配置路径。
- 页面报告始终是不可信数据，加入模型上下文时必须显式标记，不能被解释为用户指令。
- 浏览器数据导入只允许 Main 进程读取本机 Chrome Profile。Renderer 只接收 Profile 名称、导入计数和错误码，不接收源路径、Cookie 值或密码。Chrome 历史记录写入独立的 `browser-import.sqlite`；密码先用 Chrome 当前用户密钥解密，再通过 Electron `safeStorage` 二次加密保存；Cookie 直接写入 `persist:justdo-browser` session。页面点击密码框只能请求显示应用自有确认条；用户在 guest 外明确点击“填充”后，Main 才向专用 partition 的主 frame 返回唯一匹配的同源凭据。Chrome `v20` 应用绑定数据无法由当前进程验证解密时必须逐项跳过并报告，禁止写入乱码或伪报成功。
- 内置浏览器下载由 Electron `will-download` 生命周期记录到 `browser-import.sqlite`，设置页可选择下载目录、切换下载前询问、搜索并查看进度与状态、打开文件、在文件夹中定位、删除单条记录或清空记录。具体下载文件路径始终留在 Main，Renderer 仅持有随机记录 ID；删除或清空只影响历史记录，不删除用户文件。
- “清除浏览数据”通过显式 IPC 清理 `persist:justdo-browser` 与 `browser-import.sqlite`。历史、下载记录和导入的自动填充凭据按所选时间范围精确删除；Cookie、站点存储和缓存受 Electron session API 限制，只能清除该 partition 的全部对应数据，界面必须明确提示，不能伪报时间精度。下载清理仍只删除记录，不删除磁盘文件。站点权限始终被 guest 权限策略拒绝，因此不展示无效的站点设置清理项。
- Pairing string 只写剪贴板；日志仅记录非秘密 relay port 或动作结果。
- 浏览器 extension 资源必须与锁定 OpenClaw 版本整体同步。
- `dangerouslyAllowPrivateNetwork` 表示允许浏览器访问私网，不表示禁止互联网；UI 不得把 profile 隔离描述成网络隔离。
- 本机端口探测只能辅助引导，不能替代 Gateway 的 `running`/`pageReady` 结果。
- 切换模式时 app config 与 OpenClaw config 必须一起成功或一起回滚。

## 6. 验收

自动测试至少覆盖：

- 三种模式生成 v2026.9.2 接受的 profile driver；
- `user` 与 `chrome` 的 `/tabs` 返回 `running:false` 时不误报成功；
- Gateway 缺失、授权超时和一般连接错误的稳定分类；
- v2 扩展 manifest、关键模块、图标和重复 prepare；
- pairing key 创建/复用且不经 IPC 返回；
- 模式同步失败与活动会话竞态回滚；
- 构建和安装包包含完整的官方扩展目录。
- guest URL 白名单、权限拒绝、preload/Node 清除及 default-session 代理继承。
- 元素摘要与 URL 清洗、坐标映射、Tab/会话切换的旧检查响应拒绝，以及视觉/非视觉模型附件分流。
- Chrome 导入的自动测试覆盖请求白名单、历史 URL credentials 清洗、Cookie SameSite/host-only/partition/v24 host digest 转换和清理范围；Profile 枚举、系统解密、密码二次加密及应用绑定项计数通过 Windows 手工 smoke 验证。

手工 smoke 需要分别验证嵌入式网页在 system/custom/direct proxy 下的加载、真实点击/输入/滚动、同页新窗口导航、检查与标注；另行验证隔离浏览器启动、Chrome MCP 首次授权、扩展手动配对、All tabs/Selected tabs、移除授权、Gateway 重启后重连，以及 Windows 打包资源路径。
