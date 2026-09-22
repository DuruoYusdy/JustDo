# 浏览器设置与 OpenClaw v2026.9.2 边界

操作演示录制的交互、数据流与限制见[浏览器操作演示](browser-operation-recording.md)。录制属于嵌入式网页工作区，不修改 OpenClaw 配对扩展或 relay。

本文描述 JustDo 浏览器设置、右侧嵌入式浏览器工作区，以及它们与 OpenClaw v2026.9.2 Browser plugin 的边界。OpenClaw 持有 Agent 浏览器执行、profile driver、relay 协议与 tab 授权；JustDo 持有模式选择、设置引导、可直接操作的嵌入式网页、用户标注和 Electron guest 安全边界。

## 1. 产品模式

四个产品模式保存在 `app_config.browserMode`。前三种映射到 OpenClaw 的官方 profile，
内置模式切换到 JustDo 的实时侧栏浏览器：

| UI 模式    | app_config  | `browser` Tool 提供方         | 用途                                |
| ---------- | ----------- | ----------------------------- | ----------------------------------- |
| 隔离浏览器 | `isolated`  | OpenClaw / `openclaw`         | OpenClaw 管理的独立浏览器资料       |
| 用户浏览器 | `user`      | OpenClaw / `existing-session` | Chrome DevTools MCP 连接日常 Chrome |
| 浏览器扩展 | `extension` | OpenClaw / `extension`        | OpenClaw 扩展连接已登录 Chrome      |
| 内置浏览器 | `embedded`  | JustDo embedded-browser       | 用户与 Agent 共享侧栏实时网页       |

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

内置模式将原生 Browser Plugin 与根 `browser.enabled` 关闭，并只启用 embedded-browser
plugin；该 plugin 同样注册名为 `browser` 的 Tool。任何模式下模型都只能看到一个
`browser`，不依赖模型在两个近义 Tool 之间自行选择。

原生 `browser` 与 `embedded-browser` 都属于应用管理插件。插件页只展示其状态，不允许
用户绕过浏览器模式开关单独启停任一提供方；Main 同样拒绝直接 IPC 修改，不能只依赖 UI
禁用按钮维持互斥。

### 内置模式能力契约

内置模式以 OpenClaw Browser Plugin 的 Tool schema、结构化返回值和随附
`browser-automation` skill 为兼容目标。不因承载层是 Electron guest 而删减正常的本地浏览器
能力。JustDo 不支持其他部署形态，因此路由固定为当前桌面 `target=host`，不暴露远程 node
或容器 sandbox 执行拓扑：

- 生命周期与诊断：`doctor`、`status`、`start`、`stop`、`profiles`、`importprofile`；
- Tab：`tabs`、`open`、`focus`、`close`；
- 观察：`snapshot`、`screenshot`、`text`、`console`、`requests`、`errors`；
- 页面与文件：`navigate`、`emulate`、`pdf`、`download`、`waitfordownload`、`upload`、`dialog`；
- 交互：`act` 及原生支持的 `batch`、`click`、`clickCoords`、`type`、`press`、`hover`、
  `scrollIntoView`、`drag`、`select`、`fill`、`resize`、`wait`、`evaluate`、`close`。

`screenshot` 是 Agent 对当前实时 guest 的一次观察结果，不改变侧边栏承载方式；原图默认只供
Agent 观察。仅当用户明确要求查看截图时，Tool 才提示 Agent 使用 OpenClaw 管理的、受大小限制的
`outbound` 副本显式发送，普通观察截图不会自动进入会话。用户始终操作真实网页，不能把截图显示成
可交互页面。`open` 创建的是当前任务侧边栏中的受管 Tab，
不能启动外部 Chrome 或系统浏览器。能力尚未实现或无法满足原生返回契约时必须明确失败，
不能静默降级、换浏览器或伪造成功。

当前事件桥暴露与锁定版 OpenClaw 相同的 24 个 action 和 14 个 `act` kind，并通过对齐清单、
输出 schema 校验与桌面桥回归测试约束契约；只收窄不适用于桌面侧栏的执行拓扑字段。生命周期查询不会预建空 Tab，`open` 创建新的
内部实时 Tab，后续调用可用 label、稳定的 `tN` handle、完整 target id 或唯一前缀寻址。
AI 快照默认包含可交互与有语义的内容节点，递归同源 frame 和 open Shadow DOM，并将顶层跨域 frame 的 AX 节点
合并到同一结果；连续兼容快照使用 `[new]`/`newElements` 标出新增节点。`labels=true` 返回供
Agent 观察的标注图像和与稳定 ref 一致的 annotations；ARIA 格式不支持 labels 时明确报错。
手写 DOM 名称回退遵循 `aria-labelledby` 优先于 `aria-label`，并保留原生 input button/submit/reset
的 value 名称；通过 `element` 指定上传控件时也递归 open Shadow DOM，并与 `ref`/`inputRef` 严格互斥。
设备模拟名称由 embedded plugin 从锁定 OpenClaw runtime 的 Playwright 设备目录解析，Main 只
接受经过尺寸、UA、触控与方向字段校验的描述，因此保持原生设备目录覆盖而不信任任意事件值。
快照引用仅在当前页面状态有效，导航或 DOM 交互后必须重新获取。页面文本、日志和脚本返回
都按不可信外部内容处理；请求诊断不采集 header 与 POST body，可编辑 AX 控件的当前 value
默认不进入 Tool 输出。上传只接受任务工作区内的真实文件，PDF 与下载只写任务工作区且拒绝
覆盖已有文件，并在实际读写边界再次解析路径；输出路径按真实父目录生成 canonical key 并做
进程级原子 reservation，完成、取消或超时后释放。`evaluate` 在 guest 的 isolated
world 中执行并限制输入与返回大小，不获得 Node/Electron 能力。

## 2. 配置应用

OpenClaw Browser plugin 将 `browser.profiles` 与 `browser.defaultProfile` 声明为 hot reload，
因此前三种原生模式之间可走 Gateway 配置重载。切入或切出 `embedded` 会更换 `browser`
Tool 提供方与插件 service 生命周期，所以必须硬重启 Gateway；不能把仍持有旧 Tool 注册表
的进程误报为切换成功。

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

JustDo 不维护独立的 Chrome relay 实现。`resources/browser-extension/openclaw` 保存锁定 OpenClaw runtime 所带的配对扩展基线，`resources/browser-extension/conversation-overlay` 保存独立的侧栏对话覆盖层，构建结果生成到 `build/browser-extension/chrome-extension`。当前 manifest 版本为 `2.2.0`；OpenClaw relay、认证和 tab 授权模块保持上游同版本，构建脚本组合并验证以下契约：

- manifest 保持 OpenClaw relay 能力，并用固定公钥生成稳定的 JustDo extension id；
- `openclaw-extension-relay.v2` 认证存在；
- v2 challenge/response 模块、Options 页面和完整权限存在；
- JustDo side panel、active-tab 注入权限、可选网页读取权限与 `nativeMessaging` permission 存在；
- 16/32/48/128 图标尺寸正确。

更新 OpenClaw 时必须从同一锁定 runtime 整体替换 `openclaw/` 基线，再审查构建期接缝并组合对话覆盖层；不能只复制 `background.js`、从 `build/` 回灌混合产物或继续兼容旧扩展。Gateway relay 和认证协议必须保持同版本。

### 源码所有权与升级接缝

浏览器配对和侧栏对话是两个独立功能层。即使最终打包为同一个 Chrome 扩展，也不得把对话状态、app-server 协议或 UI 逻辑写入 OpenClaw relay/tab 模块：

| 层级              | 文件/目录                                           | 维护规则                                                                     |
| ----------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| OpenClaw 配对基线 | `resources/browser-extension/openclaw/`             | 从锁定 OpenClaw 版本整体同步；除产品名占位适配外，不承载对话逻辑             |
| 对话覆盖层        | `resources/browser-extension/conversation-overlay/` | 独立维护侧栏、app-server client 和第三方声明；不得改变 relay 或 tab 授权语义 |
| 显式集成接缝      | 构建脚本中的 manifest/background/options overlay    | 注册 side panel、app-server 分发并组合配对布局；上游锚点漂移时明确失败       |

升级顺序固定为：取得与 `package.json.openclaw.version` 相同版本的 pristine 扩展，整体替换并验证 `openclaw/`，随后审查构建脚本中的显式接缝，再组合 `conversation-overlay/` 并运行扩展测试。禁止用 `build/` 混合产物反向覆盖新的上游基线。对话 UI 的日常修改应只触及覆盖层；若必须修改集成接缝，提交中要说明原因，且不得顺手格式化或重写配对基线文件。

### 配对

Windows 仍使用 OpenClaw 支持的高级手动配对。Main 调用锁定 runtime 的 `browser extension pair --json`，由 OpenClaw 负责 relay key 的安全创建、权限校验和并发复用；剪贴板中只包含 OpenClaw 原始 relay pairing，典型格式为：

```text
ws://127.0.0.1:<relay-port>/extension?gateway=ws%3A%2F%2F127.0.0.1%3A<gateway-port>#<relay-key>
```

默认 relay port 为 Gateway port + 10；显式 `browser.profiles.chrome.cdpPort` 优先。该字符串属于密码，只进入系统剪贴板，不返回 Renderer、不写日志。侧栏对话不依赖这条 pairing：它通过仅允许固定扩展 id 的 Chrome Native Messaging host 自动发现或拉起桌面应用。

新版扩展在 Settings → Advanced manual pairing 接收该字符串，并使用 Browser Relay Authentication v2 完成连接绑定的挑战认证。JustDo 显式设置 `browser.extensionRelay.allowLegacyAuth=false`，不再开放 Basic/Bearer 和旧 token-subprotocol 通道。

Browser service 由第一次 `browser.request` 或 OpenClaw 的 Gateway extension route 按需唤醒。旧的 `OPENCLAW_EAGER_BROWSER_CONTROL_SERVER` 环境变量不存在于 v2026.9.2，不得重新引入。

### 侧栏对话

扩展通过 Chrome Side Panel 提供新建会话、最近会话、历史刷新和发送消息。用户勾选“Include current page context”并授予网页读取权限时，扩展读取当前页标题、URL、最多 24,000 字符的可见正文与选中文本；Main 把这些字段包裹为不可信的 browser context 后再交给 Agent。发送后先乐观显示用户消息，Gateway 权威历史到达后按正文去重，避免输入气泡等待回复才出现。

桌面应用安装后注册 `com.justdo.browserextension` Native Messaging host，`npm run electron:dev` 也会为当前源码目录注册开发配置。Windows 独立 helper 负责 Native Messaging framing 和桌面进程拉起，避免 Electron GUI 直接承接标准输入输出。扩展后台以 JSON-RPC 2.0 调用 `codexRuntime/hello`、`codexRuntime/ensure` 和 `codexRuntime/restart`，取得当前进程动态发布的 `localAppServerUrl`。侧栏随后连接只监听 `127.0.0.1` 随机端口的 WebSocket app-server，完成 `initialize` 请求与 `initialized` 通知握手，再使用 `thread/list`、`thread/read`、`thread/start`、`thread/unsubscribe`、`composer/options`、`turn/start` 和 `turn/interrupt`；Main 通过 `thread/started`、`thread/updated`、`turn/started` 与 `turn/completed` 主动通知状态。扩展工具栏点击默认直接打开对话侧栏，侧栏右上角设置按钮进入原有浏览器配对 options 页面。底部 composer 提供真实的附件、会话权限、模型和发送/停止控制。

WebSocket URL 携带每次启动随机生成的 256-bit capability，握手还严格校验固定 extension id 的 Origin，单消息上限为 8 MiB，应用退出时关闭监听并清理 rendezvous。附件另有限制：最多 5 个、浏览器端原始文件合计最多 4 MiB、Main 端 base64 总长度最多 6 MiB。该 capability 与 Gateway token、relay key 相互独立，扩展不能借此调用任意 Gateway API。历史仍以 OpenClaw native transcript 为准，不新增 transcript cache。

详细功能对照、协议和后续阶段见 [浏览器扩展侧栏对话](browser-extension-side-chat.md)。

### Tab 授权

新版扩展有两种 access mode：

- `Selected tabs`：高级手动配对的默认值，只允许 OpenClaw tab group 中的网页；
- `All tabs`：用户主动选择后，允许所有符合条件的普通网页。

设置文案必须明确默认值，不能继续声称扩展始终只共享 tab group。暂停、移组、断开、导航和 debugger attachment 的撤销与竞态处理由上游扩展实现。

### 连接测试

扩展测试调用相同的 `/tabs` route，profile 为 `chrome`。只有 `running: true` 才成功；共享 tab 可以为空。失败诊断来自 Gateway Browser plugin，不通过读取 relay key 后发送 legacy HTTP 认证来猜测端口 owner。

## 5. 安全边界

- 右侧工作区使用 Electron `<webview>` 承载真实网页，交互模式下点击、输入、滚动和选择直接进入 guest 页面，不通过截图坐标遥控外部 Chrome。
- 当前版本暂不迁移到 `WebContentsView`：标注 canvas、元素卡片和评论编辑器需要作为 React DOM 直接覆盖实时网页。`WebContentsView` 不属于 DOM，直接替换会引入额外的 overlay 与跨进程坐标同步。当前实现继续使用受限 guest，不在本轮同时改写显示层与 Agent 控制层。
- 默认 guest 使用 `persist:justdo-browser`，默认导入 profile 使用独立的 `persist:justdo-browser-imported`，Tool 还可按 OpenClaw profile 命名规则创建 `persist:justdo-browser-profile-<name>`；各 profile 的 Cookie、站点存储与缓存互不混用，来源页创建的弹窗、复制、恢复、标注和页内派生 Tab 必须继承同一 profile。系统/自定义/直连代理偏好同时应用到 default session 与所有已使用的 browser partition；新 partition 在创建真实 Tab 前先完成代理配置，不能让首个请求绕过用户偏好。
- `will-attach-webview` 把 preload 强制覆盖为有限的检查、viewport、快捷键和凭据确认 bridge，关闭 Node、嵌套 webview 和不安全内容，仅允许 HTTP(S) 与 `about:blank`；request guard 阻止非网页导航。PDF 默认由 Chromium 原生查看器渲染；`application/pdf` 响应头、常见 `.pdf` 与 arXiv 路径只用于识别 PDF 功能，不自动创建 PDF.js 覆盖层。只有用户主动选择兼容查看器时，才以相同 browser partition（保留 Cookie 与代理）读取不超过 64 MiB 的内容交给 PDF.js。兼容模式采用连续页流，仅为视口附近页面建立高分辨率 canvas。只有当前聚焦 guest 的网页全屏与净化后剪贴板写入可直接授权；摄像头、麦克风、定位和通知必须在 Main 原生对话框展示来源并逐次确认，许可在页面或子框架的下一次非同文档导航时清除，其余权限默认拒绝。网站 HTTP Basic/Digest challenge 通过一次性 Renderer 登录框回传给原 guest，不持久化或记录凭据，并在超时、取消、guest 销毁时释放回调。`mailto:`、`tel:`、`sms:`、`magnet:`、`webcal:` 只在 Main 原生确认后交给系统应用。网页右键菜单由 Main 构建，链接新标签继续经过同一 URL 与本地预览 scope 校验，图片另存为复用受管下载链路。下载设置允许选择保存目录并决定是否逐次询问；询问时由 Main 串行显示保存对话框，自动保存时由 Main 分配不覆盖已有文件的路径，两种方式均记录状态；`target=_blank` GET 导航进入受管 guest Tab，无法安全重放的 POST popup 会明确阻止。
- 检查元素只执行应用内置脚本，脚本只插入经过有限数值化的坐标。返回文本折叠空白并限制长度，不读取表单值、cookie、页面存储或完整 DOM。
- 普通用户浏览和交互不依赖截图。Agent 显式调用原生兼容的 `screenshot` 时可抓取当前实时 guest 作为 Tool 观察结果，但侧边栏仍显示并操作真实网页。用户完成元素、画笔或矩形标注后会出现评论条，可展开清洗后的 HTML 元素详情、输入或语音录入评论；提交评论时调用 guest `capturePage()`，在 Renderer 内合成标注 PNG，并沿用 20 MB 附件上限。
- 用户进入画笔、矩形、元素检查、评论或标注合成阶段后，Renderer 会向 Main 标记当前 Tab 正由用户编辑；Agent 只能继续读取快照、文本和诊断，不能导航、点击、输入、上传下载、处理弹窗、切换或关闭页面。所有 Agent 变更操作先由 Main 申请 lease，Renderer 在实时页遮罩提交后显式 ACK，Main 才能执行；`open`、无 Tab 的 `navigate`、focus/close/stop 和 `importprofile` 使用 profile scope 的面板预锁，因此在 ACK 前不会创建、切换或关闭 Tab。首次使用时 Cowork 只挂载无 webview 的空 `BrowserPanel` 来提交锁层，不创建首页或隐藏运行容器。并发调用共享同一 readiness，但单个调用取消不会取消其他等待者；`importprofile` 按实际 `into` profile 加锁。用户锁与 ACK 竞争时用户锁优先。等待下一次 file chooser 的上传和预置弹窗响应会持续持有同一 Tab lease，直至被消费、取消或超时，不能在命令返回后留下无保护的延迟注入窗口。
- 嵌入式 tab id 仅标识 JustDo UI guest，不伪装成 OpenClaw browser target。Renderer 仍不接收 Gateway token、relay key、CDP credential 或本机配置路径。
- 页面报告始终是不可信数据，加入模型上下文时必须显式标记，不能被解释为用户指令。
- 浏览器数据导入只允许 Main 进程读取本机 Chromium 系 Profile。Windows 使用当前用户 DPAPI/Chrome 主密钥，macOS 使用对应浏览器的 Keychain Safe Storage 密钥；Renderer 只接收 Profile 名称、导入计数和错误码，不接收源路径、Cookie 值或密码。历史记录写入独立的 `browser-import.sqlite`；密码先用浏览器当前用户密钥解密，再通过 Electron `safeStorage` 二次加密保存。设置页由用户发起的导入写入当前默认 embedded profile；Tool 的 `importprofile` 默认写入隔离的 imported profile，并可显式选择 embedded 或合法命名 profile。导入在用户确认后仍受 Tool 取消和 120 秒期限约束，取消后不得继续复制 Cookie 或持久化 profile。页面点击密码框只能请求显示应用自有确认条；用户在 guest 外明确点击“填充”后，Main 才向对应专用 partition 的主 frame 返回唯一匹配的同源凭据。Chrome `v20` 应用绑定数据无法由当前进程验证解密时必须逐项跳过并报告，禁止写入乱码或伪报成功。
- 内置浏览器下载由 Electron `will-download` 生命周期记录到 `browser-import.sqlite`，设置页可选择下载目录、切换下载前询问、搜索并查看进度与状态、打开文件、在文件夹中定位、删除单条记录或清空记录。具体下载文件路径始终留在 Main，Renderer 仅持有随机记录 ID；删除或清空只影响历史记录，不删除用户文件。Agent `download`/`waitfordownload` 及可触发下载的 `act` 只在同一 guest 的受控交互窗口内接管下载，期间页面暂时禁止人工输入以避免归属串线；下载只能落在任务 workspace，目标路径解析失败、超时、取消、Tab/窗口关闭都会取消下载并尽力删除部分文件。
- “清除浏览数据”通过显式 IPC 清理两个内置浏览器 partition 与 `browser-import.sqlite`。历史、下载记录和导入的自动填充凭据按所选时间范围精确删除；Cookie、站点存储和缓存受 Electron session API 限制，只能同时清除两个 partition 的全部对应数据，界面必须明确提示，不能伪报时间精度。下载清理仍只删除记录，不删除磁盘文件。站点权限仅在内存中保留到页面或子框架导航、guest 销毁，不写入持久权限库，因此不展示持久站点设置清理项。
- Pairing string 只写剪贴板；日志仅记录非秘密 relay port 或动作结果。
- 浏览器 extension 资源必须与锁定 OpenClaw 版本整体同步。
- side-chat Native Messaging 与 WebSocket app-server 不得接受非固定扩展 id 或绑定非 loopback 地址，不得复用或返回 Gateway token；页面内容一律按不可信外部输入处理。
- `dangerouslyAllowPrivateNetwork` 表示允许浏览器访问私网，不表示禁止互联网；UI 不得把 profile 隔离描述成网络隔离。
- 本机端口探测只能辅助引导，不能替代 Gateway 的 `running`/`pageReady` 结果。
- 切换模式时 app config 与 OpenClaw config 必须一起成功或一起回滚。

### PDF、授权与认证的生命周期

2026-09-21 使用锁定的 Electron 42.7.0 / Chromium 148，在隔离的临时用户目录内对比 `<webview>` 与 `WebContentsView`。持久 partition 下两种容器都能显示 Chromium 内置 PDF 查看器；原有 `will-frame-navigate` 将 `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/<uuid>` 内部流导航当作非法网页跳转拦截，复现工具栏或页面空白。修复只放行非主框架、真实父框架 URL 为内置扩展 `index.html`、目标为该扩展 UUID 流的组合；普通网页、其他扩展和主框架仍不能导航到扩展地址。无需为了 PDF 迁移整个浏览器承载层，也不应将网页与应用壳合并到同一 partition。

默认使用 Chromium 原生查看器，浏览器菜单提供“尝试兼容 PDF 查看器”和“切回浏览器 PDF 查看器”。原生模式没有 PDF.js 的 64 MiB 整体读取限制或额外二次下载。原生 PDF 的打印通过其自带工具栏执行；应用通用网页打印菜单在 PDF 标签禁用并给出引导，避免对外层文档调用 `print()` 导致空白页。

麦克风与摄像头分别记录 `audio` / `video` 授权，组合请求必须同时满足两项，不能由麦克风许可推导摄像头许可。授权归属请求 frame 的 origin；顶层页面与跨域 frame 不必同源。每次非同文档导航（含子框架）使已有许可和待确认请求失效，避免弹窗确认作用于替换后的文档。

HTTP 认证请求以随机 ID 和 guest ID 绑定，主窗口主 frame 才能回应。主导航、guest/窗口关闭、用户取消或 120 秒超时统一结束请求并通知 Renderer 移除弹窗；迟到回应被忽略。只在所属标签和面板可见时显示登录框，应用授权框不受 Agent 网页输入锁阻挡。应用不把输入写入密码库或日志；Chromium 自身可能在浏览器 session 内缓存 HTTP 认证。

兼容模式的 PDF 加载采用调用窗口隔离的 request ID，关闭查看器或窗口会取消请求，网络读取设 60 秒超时及 64 MiB 上限。超限或失败响应主动关闭 body。异步响应晚于组件卸载时不再创建 PDF.js worker。CMap、标准字体、ICC 与 WASM 解码资源随安装包提供，应用 CSP 允许本地资源和 WebAssembly 编译，仍禁止 JavaScript `eval`。

兼容模式 PDF 标签切换保留文档、滚动位置和缩放，仅活动标签绘制页面，并限制单页 canvas 像素数。关闭标签、导航或刷新会释放旧文档；刷新重新加载 PDF。URL 提前识别只使用路径和已知 arXiv PDF 路径，不通过任意查询参数推断；读取结果为 HTML 时回退到真实网页。工具栏缩放和刷新路由到 PDF 查看器；兼容模式尚未实现的 PDF 查找、打印、截图、开发者工具和标注明确禁用，不能调用背后的 WebView 并声称操作了可见文档。加载失败提供重试，超限单独提示；PDF.js 的文本选择、链接/目录、密码 PDF 和打印仍属后续功能；原生查看器的已有能力不受这份兼容模式限制清单约束。

## 6. 下一步规划：迁移到 WebContentsView

`WebContentsView` 是内置浏览器承载层的下一步规划，但不属于当前单一 `browser`
Tool 和第四模式的交付范围。迁移必须保持用户操作实时网页，禁止退化为截图遥控。

规划方案：

1. Main 按会话和 tab 持有 `WebContentsView` 与 `webContents`，Renderer 只上报浏览区域的
   bounds、可见性和当前 tab。
2. 地址栏、标签栏和浏览器菜单继续由 React 渲染，并放在 View 边界之外；窗口、侧栏和
   DPI 变化通过有界 IPC 更新 View bounds。
3. 元素检查继续使用固定的 preload/isolated-world 脚本读取有限摘要，不开放任意脚本
   Tool。
4. 画笔和矩形标注优先采用页面内注入的透明 Canvas：用户看到并操作的仍是实时网页，
   Canvas 只在标注模式存在；评论编辑器放到浏览器工具栏区域。不得隐藏网页并让用户在
   截图上操作。
5. 若页面内 Canvas 无法满足隔离、全屏/top-layer、缩放或 iframe 场景，再评估独立透明
   Overlay View；不能在没有原型与性能数据时直接引入第二个长期渲染层。
6. 迁移按单 tab 原型、多 tab 生命周期、标注、下载/弹窗/权限、Agent 控制和打包回归
   分阶段进行；每一阶段都要能回退到当前 guest 实现。

迁移验收门槛：真实点击、输入、滚动和输入法不退化；检查元素与画笔/矩形标注完整；
窗口缩放、侧栏拖动和多 tab 切换无错位；关闭会话和窗口后无遗留 WebContents；Agent 与
用户始终操作同一页面；不新增外部浏览器 tab；Agent 的 `screenshot` 只返回观察结果，不得
替代实时页面或成为用户交互面。

## 7. 当前实现验收

自动测试至少覆盖：

- 四种模式只启用一个 `browser` Tool 提供方，前三种生成 v2026.9.2 接受的 profile driver；
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
