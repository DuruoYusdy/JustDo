# 进程模型与 IPC

本文按当前 `src/main/preload.ts`、`src/main/ipc/` 和 shared channel 合约重写。目标是说明跨进程能力面、调用/事件语义、验证责任和新增 IPC 的完整流程。

## 1. 进程与信任边界

浏览器操作演示通过 `browser:recording:lease` 向 Main 申请 profile 级用户保护。Main 只验证归属及管理互斥；guest 的录制事件直接交给 Renderer，Main 不保存操作内容。暂停/停止通过 guest IPC 确认提交最后输入，停止后释放 lease；窗口销毁、renderer 崩溃或导航也会清理保护。该保护与已有标注锁独立，见[操作演示数据流](../features/browser-operation-recording.md)。

录制仅自动隐藏可识别密码，保留其他字段及普通 URL 参数。guest 提供精简元素 HTML/选择器和密码相关截图检查，Renderer 保留可视区域图片与逐步失败原因；不可访问的跨域/封闭组件不提供全面密码保护，发送前由用户检查。Main 不增加内容日志或存储。

guest 的元素描述器生成有界局部 DOM、经过命中检查的候选定位器及 frame/Shadow root 路径。动作后的短时观察使用同一文档序列和 relatedSequence 回填原步骤，不产生额外用户动作；暂停确认前结束观察，Renderer 拒绝旧文档及重复序列。共享解析器限制嵌套字段、数组和坐标，密码步骤丢弃额外状态和观察证据。该数据仍只经过 guest → Renderer，不引入 Main 内容存储。

| 参与者                  | 权限                        | 主要职责                                                     |
| ----------------------- | --------------------------- | ------------------------------------------------------------ |
| Renderer                | Chromium 页面权限           | UI、交互、Redux、聊天显示；不访问系统资源                    |
| Browser guest           | 沙箱化的外部 Chromium 页面  | 右侧工作区中的真实网页导航与原生输入                         |
| Image preview           | 独立沙箱化 Chromium 页面    | 在原生独立窗口中显示图片并处理缩放/拖动                      |
| Preload                 | 隔离上下文中的 Electron IPC | 暴露固定 `window.electron` API，转换 listener 为 unsubscribe |
| Main                    | Node/Electron 完整权限      | 验证输入、SQLite、文件/网络/进程、Gateway 和系统集成         |
| Gateway                 | 独立受管子进程              | Agent、tool、session/history、cron、plugin runtime           |
| Multica launcher/client | 当前用户本机进程            | 把白名单 OpenClaw CLI 请求转发到 Main 的认证本机管道         |

BrowserWindow 与外部网页 guest 必须维持 Chromium sandbox 和 context isolation；生产路径不得使用全局 `--no-sandbox`。

Main 按 OpenClaw embedding contract 监管 Gateway 子进程：设置
`OPENCLAW_DISABLE_BONJOUR=1`、`OPENCLAW_EXEC_SHELL_SNAPSHOT=0`、
`OPENCLAW_NO_RESPAWN=1` 和 `OPENCLAW_SKIP_CHANNELS=1`。JustDo 自己负责进程、发现与
WebChat-only channel 生命周期；关闭 Electron shell snapshot 还可避免 Gateway 把 Electron
可执行文件误当作 Node 启动。不要设置 `OPENCLAW_OFFLINE`：当前运行时没有随包提供 `fd` 与
`ripgrep`，OpenClaw 需要按需下载受管工具才能启用原生 find/grep 工具。

## 2. IPC 形态

开发模式下，未打包的 Main 跟随当前窗口的 loopback Vite 服务生命周期，每秒进行一次有超时的 TCP 探测，连续三次失败后执行正常退出清理。单实例开发 URL 交接会切换监测目标，并忽略旧目标尚未完成的探测结果。因此浏览器 native host 拉起或被新终端复用的窗口也会在开发服务停止后退出，不依赖父子进程关系或 Ctrl+C 信号转发。正常清理等待 10 秒，超时后独立调用 Gateway 停止流程（自身期限 5 秒），最多再等 6 秒后强制退出，避免会话清理阻塞 Gateway 终止；此兜底不影响安装版。短暂探测失败允许恢复，普通 HMR 不改变会话。探测仅确认端口可连接，无法区分同一端口被其他服务立即接管；Vite 完整重启若超过连续失败阈值，也会触发退出。

### 2.1 调用型

Renderer 调用 preload 方法，preload 使用 `ipcRenderer.invoke`，Main 通过 `ipcMain.handle` 返回可序列化结果。适合 CRUD、查询、命令和显式生命周期操作。

约束：

- handler 在边界验证 unknown payload，不能依赖 TypeScript 类型提供运行时安全；
- 错误结果应保留稳定 `code` 和可显示 message，不能只返回日志文本；
- 长操作应在 service 中支持并发合并、取消或互斥，而不是阻塞 handler；
- 不返回 Node/Electron 对象、Error 实例、数据库 row handle 或 secret。

### 2.2 IPC 事件型

Main/Gateway 状态变化通过 `webContents.send` 到 preload listener。preload 每个 `onX` 方法注册包装 handler 并返回取消函数。适合 stream、engine progress、approval、session changed、cron/status/result 和 update state。

事件消费者必须：

- 在组件卸载或 session 切换时调用 unsubscribe；
- 用 session id、run id、domain 和 sequence 做 admission，不能只看“当前 UI 有无运行”；
- 把事件视为增量提示，重连后以权威查询/history 恢复；
- 允许重复、乱序、终态后迟到以及订阅短暂中断。

### 2.3 Renderer 到本地 Gateway 的聊天数据通道

聊天是当前唯一明确的 Renderer→Gateway 直连通道。`JustDoChatWrapper` 通过 `openclaw.engine.getPort/getToken` 取得连接信息，`GatewayClient` 建立 loopback WebSocket；`ChatController` 订阅 session/message 事件、请求常规 history，并在 IPC paged history 不可用时使用带 Bearer token 的 loopback REST fallback。产品 session start/continue、权限、文件、配置、SQLite 与大部分 Gateway 领域命令仍经过 Main。

### 2.4 Chrome 扩展到 Main 的侧栏对话通道

Chrome Side Panel 不获取 Gateway token，也不直接连接 Gateway。Windows 安装版和开发启动流程都会注册 `com.justdo.browserextension` Chrome Native Messaging host；独立 helper 用 JSON-RPC 2.0 的 `codexRuntime/hello`、`codexRuntime/ensure` 和 `codexRuntime/restart` 发现或拉起桌面进程，并返回动态 `localAppServerUrl`。Electron GUI 不直接承接 Native Messaging stdin/stdout。Native host manifest 只允许固定公钥派生的 JustDo extension id。

Main 每次启动在 `127.0.0.1` 随机端口创建 WebSocket app-server，并为 URL 生成随机 256-bit capability。握手同时校验 capability、`/app-server` path 与精确 extension Origin，单消息限制为 8 MiB。协议采用 app-server 风格的 request/result/error 与 notification：完成 `initialize` 请求及 `initialized` 通知后，只开放 `thread/list`、`thread/read`、`thread/start`、`thread/unsubscribe`、`composer/options`、`turn/start` 和 `turn/interrupt`，并发送 `thread/started`、`thread/updated`、`turn/started` 与 `turn/completed`。composer options 和 turn payload 把已配置模型、会话权限及有界附件连接到现有 Cowork/OpenClaw 生命周期，不建立新的 transcript 或附件缓存。应用退出时清理 rendezvous 并停止监听。

扩展与 OpenClaw relay 使用不同凭据和协议。relay 仍负责用户授权 tab 的自动化，side-chat 服务只负责产品会话。用户显式选择附带的页面标题、URL 和选中文本会被构造成不可信浏览器状态；Main 通过仅允许已认证本地后台客户端使用的 `chat.send.justdoUntrustedContext` 传给本轮 Agent。OpenClaw 的 Agent 输入会组合该状态与用户文本，但 native transcript 只持久化原始用户文本，因此不需要 Renderer 依赖过滤来维持新消息的正确展示，也不建立第二份消息持久化。

这条通道意味着 Renderer 能接触 Gateway token 和原始聊天 wire event，必须由集中式 client/controller 处理，不能让各 React 组件各建连接或各写 parser。连接 generation、session key、run id 和 sequence 用于拒绝旧连接与迟到事件；token 只保存在控制器内存，不得进入 Redux、日志、导出或第三方请求。

### 2.5 Multica 到 Main 的本机桥接

Multica 通过 OpenClaw 兼容启动器执行发现和 `agent` 命令。Windows 原生 launcher 启动一个带私有 switch 的短生命周期 Electron 进程；Main 在 single-instance lock 和 UI 初始化之前识别该模式，关闭 console 输出并作为 bridge client 连接已运行的 JustDo 实例。POSIX launcher 使用同一 client 契约。桥接只使用当前用户 named pipe/Unix socket，不开放网络端口。

Main 启动时生成 per-process random token，并将 endpoint、pid、protocol version 和 token 写入权限受限的 `multica/bridge.json`。Server 对 token、frame 大小、连接数、握手时限、单连接单请求、argv 白名单、cwd 和任务级环境做运行时验证。实际 `agent` 请求由锁定的 OpenClaw CLI 连接已运行的 Gateway；桥接移除 Multica 传入的 `--local`，并保护应用的 state/config 与 Gateway 凭据不被任务环境覆盖。CLI 的 JSON 执行信封只在桥内解析，返回给 Multica 的 stdout 仅包含可见回复正文和附件引用，不暴露 run、模型、用量等内部元数据。这使外部任务使用当前应用中的 Agent、模型、技能和工具，并将 transcript 继续保存到同一 OpenClaw native SQLite。client 断开通过 AbortSignal 终止等待中的 CLI 请求，Cowork 只保存只读映射。

## 3. `window.electron` 能力面

以下分组来自当前 preload；这里只列语义，不复制完整 TypeScript declaration。

| Namespace                     | 能力                                                                     |
| ----------------------------- | ------------------------------------------------------------------------ |
| `store`                       | 通用 KV get/set/remove；写 `app_config` 会触发配置同步                   |
| `marketplace`                 | source、search、detail、install                                          |
| `skills`                      | Gateway skill list/enable 与用户 Skill import/delete                     |
| `extensions`                  | list/import/progress/delete/enable/configuration                         |
| `hooks`                       | list/import/delete/enable                                                |
| `slashCommands`               | 合并 Gateway 命令与本地 policy 后列出                                    |
| `mcp`                         | CRUD、enable、sync、probe、resource read、extension servers 与 sync 事件 |
| `permissions`                 | macOS Calendar check/request                                             |
| `browser`                     | OpenClaw browser mode/status、连接诊断与设置动作                         |
| `terminal`                    | 创建/输入/缩放/关闭窗口所有的 PTY，并订阅输出与退出事件                  |
| `api`                         | Main 受控 fetch 与 request cancellation                                  |
| `window`                      | 最小化/最大化/关闭/系统菜单与状态订阅                                    |
| 顶层 config                   | provider config read/check/save、title generation、recent cwd            |
| `openclaw.approvals`          | pending snapshot、resolve、requested/resolved events                     |
| `openclaw.engine`             | status/restart/port/token、prompt replacement、terminal、progress        |
| `openclaw.history`            | tool inputs、compaction detail、paged history                            |
| `openclaw.memory`             | overview/document/search/rebuild index                                   |
| `openclaw.usage`              | 7/14/30 日 token usage                                                   |
| `agents`                      | agent list                                                               |
| `cowork`                      | session/run/goal/config/model/interaction/subtask 与完整 stream          |
| `sessionGroup`                | group CRUD、移动 session、排序                                           |
| `dialog`                      | 选择/保存/读取用户明确选择的文件和目录                                   |
| `shell`                       | open/reveal/external、上下文菜单、受控文件预览与编辑 token               |
| `imagePreview`                | 校验图片 URL 后创建或复用独立原生查看窗口                                |
| `autoLaunch` / `preventSleep` | OS 级开机启动和阻止休眠                                                  |
| `developerConfig` / `appInfo` | 只读开发配置、版本与 locale                                              |
| `appUpdate`                   | 状态、检查、清理后安装、状态事件                                         |
| `builtinModels`               | 手工刷新和生命周期变更事件                                               |
| `log`                         | 路径、打开目录、导出 zip；debug 写入受 shared channel 控制               |
| `scheduledTasks`              | job CRUD/run/history/session resolve/channel 与本地 result inbox         |
| `multica`                     | 集成状态、启用/禁用、启动器生成与 Multica CLI 探测                       |
| `networkStatus`               | online/offline 事件                                                      |

`ipcRenderer` 兼容分组只允许白名单 channel，不能演化为任意 `send/invoke` 后门。

浏览器工作区是主窗口 Renderer 内的 Electron `<webview>` guest。它固定使用独立的持久化 browser partition，与应用壳的 Cookie、storage、service worker 和认证状态隔离；Main 将系统、自定义或直连代理同时应用到该 partition。交互模式不经过 IPC：Chromium 直接处理页面点击、键盘、滚动、焦点与导航。Main 在 `will-attach-webview` 中覆盖页面请求的 preload 为应用内固定 guest bridge，并强制沙箱、context isolation、无 Node、无嵌套 webview，仅允许 HTTP(S)/`about:blank`；browser-partition request guard 同时阻止程序化顶层导航绕过，主窗口自身也只能停留在应用 origin/file root。PDF 默认使用 guest 内的 Chromium 原生查看器。Main 的导航策略仅允许由内置 PDF 扩展父框架发起的 UUID 流子框架跳转，不能把它误当普通网页的扩展导航拦截。PDF.js 仅作为用户从浏览器菜单主动选择的兼容模式，不再自动覆盖原生查看器或重复读取 PDF。只有聚焦 guest 的网页全屏和净化后剪贴板写入属于低风险直接授权；摄像头、麦克风、定位和通知显示 Main 原生来源确认，授权在页面或子框架的下一次非同文档导航时失效，其余 guest 权限默认拒绝。`mailto:`、`tel:`、`sms:`、`magnet:`、`webcal:` 经 Main 原生确认后交给系统应用，启动失败显示明确提示。Main 提供受管网页右键菜单，链接和图片动作仍经过导航 scope 与下载策略。下载按用户设置询问保存位置或自动保存到指定目录，弹出链接进入受管理的新 Tab。

浏览器权限按 guest、请求 frame 的 origin 和具体能力保存；音频与视频分别授权。非同文档的顶层或子框架导航使授权和待确认请求失效。HTTP 登录 challenge 通过有时限的一次性请求交给应用 Renderer，只有主窗口主 frame 可回应；导航、超时、关闭会统一取消，并通知 UI 移除所属弹窗。应用登录弹窗不受 Agent 对网页的输入锁限制，凭据不进入应用密码库或日志。

兼容模式的 PDF.js 查看器是 Renderer 中独立于 guest 的文档视图。Main 的 PDF 读取由调用窗口与 request ID 绑定，支持取消、窗口销毁清理和 60 秒超时；提前拒绝的响应主动取消 body。各标签保留文档、缩放和滚动状态，非活动标签停止 canvas 渲染，关闭或导航时销毁 worker。字符映射、标准字体、ICC 和 WASM 资源随包分发；应用 CSP 仅放开所需的 WebAssembly 编译，JavaScript eval 仍被禁止。兼容模式下统一工具栏的缩放、刷新调用 PDF.js 查看器；此模式未实现的查找、打印、截图和标注明确禁用，不落到背后的 guest 上。原生模式的查看器自带连续阅读、缩略图、缩放、旋转和打印等控件，打印使用 PDF 工具栏，不调用可能打印空白网页的通用 guest.print()。

检查模式的透明 Canvas 才拦截鼠标，并执行应用内固定的 `elementsFromPoint` 脚本；坐标有限化，结果经长度和字段白名单清洗。完成标注后显示评论条，元素详情可按需展开，语音入口仅在语音输入已启用且可用时出现。平时不生成图片，只有用户提交评论时对当前 guest 调用一次 `capturePage()` 并合成标注。

Agent 浏览器操作复用同一 guest，不创建截图画布或外部浏览器 Tab。浏览器设置提供隔离浏览器、用户 Chrome、Chrome 扩展和内置浏览器四种互斥模式；任一时刻只启用一个名为 `browser` 的 Tool 提供方。前三种模式由 OpenClaw 原生 Browser Plugin 提供，内置模式关闭原生插件并启用桌面 embedded-browser plugin。首次 Agent 导航或 `open` 请求会携带目标 URL，Renderer 直接在对应任务创建真实浏览器 Tab 并挂载 `BrowserPanel`，不先打开侧栏首页或预留隐藏容器。Renderer 把 session、UI target id 与 Electron `webContentsId` 注册给 Main；Main 仅接受主窗口拥有、由合法本地 profile 映射出的内置浏览器 partition 且类型为 `webview` 的 WebContents，并在每次动作前重新验证归属和真实 session storage path。内置模式的 `browser` Tool 通过 Gateway 的受控插件事件向 Main 请求动作，并由 Main 通过类型化 resolve RPC 返回结果；不新增本地 HTTP 端口、Bearer token 或进程环境能力。事件桥与锁定版 OpenClaw 对齐生命周期、Tab、观察、页面、文件和 14 种 `act` 能力；由于产品只控制当前桌面上的实时侧栏 guest，路由固定为本机 `host`，不暴露远程 node 或容器 sandbox 执行拓扑。Tab 可由 label、稳定 `tN` handle、完整 target id 或唯一前缀寻址；同一 guest 的命令串行执行。普通 `eN` DOM ref 绑定当前快照；`type`、`fill`、`select` 等输入动作后，只要节点仍连接且页面未导航即可继续使用，因此可以直接输入后点击同一快照中的提交控件。点击、按键、拖拽、调整 viewport、执行脚本、提交或批量变更后 ref 主动失效。`axN` ARIA ref 在同一文档内自解析、跨只读及无导航操作保持稳定，页面导航或节点移除后失效。模型不需要也不能提交内部 snapshot id。原生 `evaluate`/wait function 只在无 Node/Electron 能力的 guest isolated world 中执行，并限制源码和序列化返回大小。默认 `embedded`、Chrome 导入后的 `imported` 以及合法命名的本地 profile 各自使用隔离的持久 partition；弹窗、复制、恢复、标注及页内派生 Tab 继承来源 profile。若用户正在查看对应任务，Renderer 会聚焦实时 Tab；后台任务保留在自己的侧栏中，不抢占用户当前任务，切回后仍可直接接管同一页面。DOM 快照、页面文本和诊断日志通过 OpenClaw 的 `resultContentSource: network` 作为外部不可信内容返回模型，排除密码/验证码控件、清理链接凭据与敏感 URL 参数，并且网络诊断不收集 header 或 POST body。Agent 显式截图只返回私有观察图片，不替换实时网页；带标签截图在离屏副本上绘制，不修改页面 DOM。上传路径必须解析到任务工作区内的真实普通文件，PDF 和下载也只能写工作区并拒绝覆盖。普通用户下载仍遵循下载目录与逐次询问设置；Agent `act` 期间 Renderer 短暂锁定同一实时页的人工交互，用户处于画笔、框选、元素检查、评论或标注合成阶段时 Renderer 也会反向锁定该 guest，Main 只允许快照、文本和诊断等只读动作，拒绝 Agent 导航、输入、切换或关闭页面，避免双方互相破坏现场。只有与该 guest 和等待请求匹配的下载才由协调器接管保存路径，路径解析失败或请求取消会取消下载并清理部分文件。请求具有 request id、30 秒常规时限、120 秒长操作时限和显式取消事件；Main 把请求绑定到桌面 session，并在超时、取消、窗口关闭或 Gateway 停止时终止执行、导入和待处理下载。

创建、切换、关闭 Tab、停止浏览器和 profile 导入等管理动作在任何 Renderer 变更前先取得 profile scope 面板 lease；首次无 Tab 时只挂载空 `BrowserPanel` 提交遮罩 ACK，不创建 webview、首页或隐藏容器。并发调用共享 readiness，单个调用取消不会使其他等待者失败。Tab 延迟上传/弹窗继续持有目标 lease 到消费或超时。PDF 与下载输出还按 canonical 目标做进程级 reservation，完成、取消或超时后释放，防止两个 Agent 操作并发占用同一路径。

AI 快照递归同源 frame、合并顶层跨域 frame 的 AX 节点，并在连续兼容快照中提供 `[new]`/`newElements`；带标签快照的图像 annotations 使用相同 ref。设备模拟描述由运行在锁定 OpenClaw runtime 内的 embedded plugin 从 Playwright 设备目录解析，再由 Main 校验并应用 UA、viewport、屏幕方向及触控状态。

`WebContentsView` 是后续承载层迁移规划，不在本轮实现。迁移必须保留实时网页交互与两类标注；画笔/矩形优先通过只在标注模式存在的页面内透明 Canvas 实现，不能让用户改为操作截图。详细阶段与验收门槛见 `docs/features/browser-settings-design.md`。

## 4. Cowork IPC

### 4.1 命令与查询

主要调用包括：

- `cowork:session:start|stop|delete|deleteBatch`；
- pin、rename、permission mode、model patch/get；
- session get/list、Gateway session id、remote-managed、单个/批量 runtime status；
- `cowork:session:run:begin|bind|list|fail` 管理 client turn 到 root run 的持久绑定；
- goal get/continue/resume/restart-for-feedback；
- interaction respond/replay；
- config get/set、Agent runtime settings、default model；
- subtask status 与 subagent session lookup。

Start handler 的 admission 次序是：校验输入 -> 等待排队的 config update -> ensure Gateway/config/permission ready -> 建立/绑定 run -> 调用 router。后续回合由 Renderer chat controller 直接调用 Gateway `chat.send`。任何一步失败都要返回明确失败，而不是先让 Renderer进入 running。

### 4.2 Stream

Cowork stream 只承载产品层事件：轻量 session activity、interaction、interactionDismiss、complete、error、sessionsChanged、goal changed/execution changed。

Thinking、Tool、Content 由 Renderer Gateway client 直接送入 chat model；Main runtime forwarder 不再复制消息正文。Main 只映射产品生命周期、run identity、审批和 Goal，且不能把任意 error event 当作 session terminal。

## 5. OpenClaw IPC

### 5.1 Engine

Engine status 是带 phase/message 等信息的快照，progress event 用于启动/停止/错误 UI。端口范围由 shared validator 限制在 1024..65535；49152..65535 会标记为临时端口范围并给出提示，但不会因此拒绝。setPort 还需探测占用、保存并安全重启。

Gateway token 属于敏感能力。Preload 当前提供受控读取，Renderer chat controller 会用它建立 loopback WebSocket，并在 paged-history IPC 不可用时请求本地认证 REST。任何扩展使用都必须避免日志、Redux、持久化和向第三方页面暴露。

### 5.2 History、Memory、Usage

- History handler 读取 Gateway state/session，并按 session 范围返回工具输入、compaction detail 和分页 history。
- Memory handler 按 keyed `agents.entries.main` 定位受管工作区，限制相对路径；搜索委托 Gateway
  原生 `memory.search`。首屏文件概览与较慢的 CLI 索引状态拆成独立 IPC：Renderer 先展示文档，
  再局部合并后台索引结果；手动强制重建继续使用受管 CLI。
- Usage 通过 runtime 请求并 normalize 每日数据和 cache 状态，Renderer 不解析任意 Gateway payload。

### 5.3 Approvals

审批分 exec 与 plugin kind；decision 包含单次、session、always 和 deny 等受支持集合。Main 保存 pending snapshot，并验证某请求是否允许 session 级授权。Renderer modal 的关闭不能伪造授权。

## 6. Plugin IPC

- Skill list/enable 委托 Gateway API；文件 import/delete 由 `OpenClawSkillFileService` 处理 user source。
- MCP CRUD 先操作 store，再经 config sync；probe/resource read 使用 Gateway/SDK transport，而非 Renderer 网络。
- Hook 配置由 SQLite store 管理并同步；导入和删除要进入受管目录事务。
- Extension import 提供 progress event，enable/config/delete 经 extension service 与 config mutation exclusive path。
- Marketplace 返回统一 item/source/detail/install contract，实际安装仍分派到对应 plugin owner。

任何文件路径参数必须 canonicalize 并验证来源/目标；不能相信 UI 下拉框保证安全。

## 7. Scheduled Task IPC

Shared `IpcChannel` 定义 job list/get/create/update/delete/toggle/manual run、run list、session resolve、channel list，以及 status/run/refresh events。结果收件箱另外提供分页查询、单个/全部标记已读、删除、reconcile、result upsert 和 unread count event。

Gateway job/run 是执行权威；SQLite receipt 是应用内阅读状态。IPC 返回对象把 Gateway `ok` 归一为产品 `success`，同时保留 delivery status/error。删除 result 还可能触发 session/transcript artifact cleanup，必须由 Main 执行。

## 8. 文件与网络 IPC

### 8.1 文件

- Dialog API 代表用户显式选择；返回的路径仍需由每个 handler 验证用途。
- `localfile://` 是只读展示协议，不能作为通用目录服务器。
- preview read 解析相对 cwd；写入前由 `AuthorizeEdit` 生成绑定路径/内容约束的 token，写后/取消时撤销。
- `openPath`、`showItemInFolder`、`openExternal` 分开，避免把 URL 当本地路径或反向处理。

### 8.2 网络

Renderer 的 provider 检测使用 `api.fetch` 进入 Main，支持 request id 取消。Main 应限制 method/header/body/redirect/response size，并通过系统/custom/direct proxy 策略发起请求。通用 `api.fetch` 不注入 outbound Header；只有显式标记为模型发现、模型连通性测试或非语言模型发现的请求，且 method/path/header/body 通过 Main 白名单校验后，才复用同一套 Header matcher。模型连通性测试的 body 由 Main 按受限字段重建，不能携带任意 prompt 或 tools。Gateway 的出站 Header 注入仍由独立 proxy environment 管理。

## 9. 注册与生命周期

Handler 在获得 single-instance lock 后统一注册。它们使用 getter 延迟取得 store/runtime，因此注册早于 `app.whenReady` 不意味着可提前调用。窗口只在核心初始化后创建，正常情况下 Renderer 不会撞上未初始化服务；handler 仍要在异常情况下返回清晰错误。

事件发送前必须检查 BrowserWindow/WebContents 未销毁。多窗口语义应明确：全局 engine/update/result 事件广播，窗口局部 UI 事件发送给拥有者。图片查看器是无 parent 的独立 `BrowserWindow`，使用单独 HTML 入口和最小权限 preload；Main 只向该窗口返回经过协议、类型和长度校验的当前图片文档，不向其暴露完整 `window.electron` 能力面。

右侧嵌入式终端由 Main 使用 PTY 启动，Windows 默认运行 PowerShell（优先 PowerShell 7，回退系统 Windows PowerShell），Renderer 只持有随机终端 id 并渲染字符流。创建请求绑定发起请求的 WebContents 和经过验证的工作目录；输入、resize、close 只能操作同一 owner 的终端。关闭标签或销毁 owner 时先请求 shell 正常退出，超时后再强制终止对应进程，避免后台遗留 shell；开发模式的 React effect 检查复用同一 PTY，不能误杀刚创建的终端。

## 10. 输入验证与返回契约

跨 IPC 的最小规则：

- string：trim、长度上限、空值语义、枚举/ID pattern；
- number：finite、integer、范围；
- path：resolve/canonicalize、允许根、符号链接/遍历、文件类型和大小；
- URL：协议、loopback/remote 限制、credential 与 redirect；
- record/array：拒绝非对象、限制项数和嵌套大小；
- config：先 normalize，再持久化，再 sync/verify；失败不提交半状态；
- event：只发送可序列化最小字段，不携带 secret 或原始异常对象。

## 11. 新增 IPC 检查单

1. 在 `src/shared/` 定义 channel 常量、request/result 和运行时 normalize（如需要）。
2. 在 owning `src/main/ipc/<domain>/` 注册 handler，调用领域 service。
3. 验证所有 renderer-controlled 输入并设计稳定错误码。
4. 在 preload 暴露最小语义方法；订阅必须返回 unsubscribe。
5. 更新 `src/renderer/types/electron.d.ts`，保持签名完全一致。
6. 补 handler/normalize/consumer 测试，覆盖失败、重复、乱序、销毁和取消。
7. 更新本文件或对应领域文档。

## 12. 常见反模式

- 暴露 `ipcRenderer.invoke(channel, ...args)` 给 Renderer。
- 仅靠 TypeScript interface 当运行时验证。
- 在 React 组件直接拼 channel 名或解析 Gateway wire payload。
- 订阅未清理，session 切换后继续接收旧事件。
- 用 transient disconnect 生成业务 terminal。
- 把 token、API key 或完整 config 作为调试事件发送。
- handler 同时做验证、数据库事务、Gateway orchestration 和 UI 文案，导致不可测试。

## 13. 相关文档

- [系统架构](02-architecture.md)
- [Cowork 系统](04-cowork-system.md)
- [安全模型](11-security-model.md)
- [Chat 渲染](15-chat-rendering.md)

## 14. 调用生命周期与销毁语义

一次 `invoke` 的生命周期是 Renderer promise → preload 参数转发 → Main handler validation/service → structured result。窗口关闭不会自动取消已经进入 Main 的文件、网络或 Gateway 操作；需要取消的长任务必须使用 request id/AbortController 或领域 cancellation，且 handler 终态只能结算一次。

事件订阅必须保存 preload 创建的包装 listener，并在 unsubscribe 时用同一引用移除。React effect 重建、session 切换和窗口 reload 都可能重复订阅；consumer 不能依赖 Main “只广播一次”来抵消 listener 泄漏。

## 15. IPC 风险分级

| 等级            | 示例                                      | 最低控制                                            |
| --------------- | ----------------------------------------- | --------------------------------------------------- |
| 只读产品查询    | list session、get theme                   | 类型、limit、稳定错误                               |
| 本地状态写入    | rename/pin/group/read receipt             | 字段验证、SQLite 事务/幂等、失败回滚                |
| Runtime 命令    | send/stop/restart/run cron                | readiness、session/run identity、single-flight      |
| 文件/命令/网络  | preview edit、shell、fetch、plugin import | canonical path、allowlist、size/timeout、审批       |
| Credential/权限 | token、provider config、approval          | 最小返回、脱敏日志、owner/session 绑定、fail closed |

风险越高，越不能用通用 `store:set`、`api.fetch` 或任意 channel 代替专用领域接口。

## 16. 测试证据与排障

- Handler 注册测试应证明注册期间不会读取尚未初始化的 store，例如 Cowork session handler 的启动约束。
- Shared contract tests覆盖枚举、limit、normalization；Main handler tests覆盖恶意/边界输入；preload/consumer tests覆盖调用参数和 unsubscribe。
- 事件串线先检查 channel、session/run domain 和 listener 数量；调用悬挂检查 handler 是否等待 readiness/timeout；“空成功”检查 catch 是否吞掉 Gateway 未 ready。
- 新 namespace 应在 `preload.ts` 与 `electron.d.ts` 做结构对照审查；目前没有自动生成，两处漂移是显式风险。

## 17. IPC Definition of Done

新增接口完成时必须有稳定 channel 常量、运行时输入验证、明确 result/error contract、最小 preload 方法、Renderer declaration、销毁/取消语义和至少一个失败测试。涉及 Gateway 的接口还要定义 starting/disconnected/reconnecting 时行为；涉及写入的接口要定义重复调用和部分失败。

## 18. 使用统计

设置页面通过 `openclaw.usage.getDaily` 获取一次统计快照。Main 使用客户端 IANA 时区计算明确的起止日期，并并发请求 Gateway 的 `usage.cost` 和 `sessions.usage`。两者采用相同日期范围与 `agentScope: all`；后者使用 `groupBy: instance`、`limit: 1`、`includeContextWeight: false`，仅读取限额之前计算的全量 aggregates，不将会话明细或上下文报告传给 Renderer。

Token 日趋势和分类来自 `usage.cost` 接口（仅提取 Token 字段，不传递或展示费用数据）；活跃会话、用户/助手消息、消息错误、工具调用、平均响应耗时和模型/供应商/代理分组来自 sessions 聚合。消息错误不能解释为产品任务失败。统计所有 Gateway 会话，不只包含产品会话列表中的记录。

任一响应的缓存尚未 fresh 时，页面每 1.5 秒重试，最多请求 12 次，随后提示手动刷新。切换周期和卸载会使旧请求失效，等待中的旧轮询不会再发起请求。Gateway 未连接时返回失败；会话聚合单独失败时保留 Token 数据并显示维度不可用。数据只保留在组件内存中，不引入 Main、Redux 或 SQLite transcript/统计缓存。
