# Agent Engine 与 OpenClaw 集成

本文描述 JustDo 如何安装、配置、启动、连接和监督 OpenClaw `v2026.9.2`。当前唯一 Cowork engine 是 OpenClaw；`CoworkEngineRouter` 只是稳定接口层，不再提供多引擎选择。

## 1. 组件分工

| 组件                               | 职责                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `OpenClawEngineManager`            | runtime/state 路径、端口/token、child process、状态机、stdout filter、CLI env        |
| `OpenClawConfigSyncService`        | config mutation 串行化、写入/验证、restart/reconnect 决策                            |
| `openclawConfigSync.ts`            | 把 provider/agent/全局权限兜底/plugin/browser 等产品配置映射为 OpenClaw config       |
| `OpenClawRuntimeAdapter`           | Gateway client、chat/session RPC、event normalize、approval、history、goal、subagent |
| `CoworkEngineService`              | 延迟创建和访问 router/adapter                                                        |
| `SessionPermissionModeCoordinator` | session permission 更新与同步 admission                                              |
| `openclawSessionKeys.ts`           | managed/cron session key 的纯解析与构造工具                                          |
| patch pipeline                     | 为固定上游版本补足 JustDo 需要而上游尚未提供的能力                                   |

## 2. Runtime 来源与布局

`package.json.openclaw` 固定仓库和版本。平台脚本依次：安装目标 runtime、同步到 current、bundle Gateway、确保 plugins、同步 resources、预编译 extensions、prune。Windows 还准备 MinGit 和带 hashed requirements 的 Python runtime。

开发可运行：

```bash
npm run electron:dev:openclaw
```

它先为 host 准备 runtime，再编译/启动 Electron。普通 `electron:dev` 假设 runtime 已存在。打包测试验证 runtime freeze、staging、prune、launcher、patch manifest 与平台资产，不能只凭目录存在判定可发布。

Gateway 与 CLI 使用不同入口。Gateway 走为常驻服务优化的 `gateway-bundle.mjs` / launcher；受管 one-shot 命令、外部开发者终端及右侧内置 PTY 中的 `openclaw` 都走上游公开 `openclaw.mjs`。交互终端同时生成 `<productName lowercase>` 品牌别名，不使用内部 package id 推导用户可见命令。两种交互终端都复用 `buildCliEnvironment()`，因此 state/config、Gateway port/token、runtime shim、Git/Python 及证书环境保持一致；内置终端若无法完成 OpenClaw 环境准备则明确创建失败，不会静默打开未注入的普通终端。macOS 通过仅当前用户可执行且启动后立即删除的临时 bootstrap 注入环境，AppleScript 命令本身不包含 Gateway token。发布 runtime 的 `gateway.asar` 必须同时包含公开 launcher 所需的 `node-version.mjs`、`package.json` 和 `dist/`，不能把 Gateway bundle 当作通用 CLI。终端 shim 优先使用仍然存在且可执行的应用自带 Electron Node runtime，避免用户系统 Node 版本改变行为；受控 runtime 不可用时回退到 PATH 中的 Node。

## 3. Manager 状态机

Engine status 至少表达 stopped、starting、running、stopping/error 类 phase 及 message。Manager 的重要性质：

- 并发 `startGateway()` 复用同一个 in-flight promise；
- 生成/保存本地 token，不把它写日志；
- 选择用户配置端口并监听变更，启动前验证可用性；
- 构造仅供 Gateway child 的 proxy/header/runtime environment；
- 从输出识别 ready、native log path 和 fatal startup；
- 启停均发 status event，Main 广播 `openclaw:engine:onProgress`；
- external config/policy error 可把 manager 标为不可 admission；
- restart 是有序 stop/start，不允许旧 client 假连接到已退出进程。

默认 Gateway 端口常量为 `42871`。用户端口必须经过 shared validator；临时端口范围只产生提示，端口非法、占用或设置失败才返回相应稳定错误码。

## 4. 启动前配置同步

消息输入框切换模型时，已有会话先通过 `sessions.patch` 更新，再更新 agent 默认模型。
`SessionRpc` 按会话串行协调读取、切换和执行等待；仅以 patch 返回的 `resolved`
确认并保存模型身份，不使用请求值或 `entry.model` 代替 Gateway 结果。查询使用
`sessions.describe` 的公开会话行：`modelProvider/model` 是所选模型，
`activeModelProvider/activeModel` 可以描述临时 fallback。`sessions.get` 只读取消息，
不得用来查询模型配置。选择状态与回复实际模型分开，后者由原生运行事件及消息负责。
配置同步只在当前 catalog 仍存在对应 route 时保留已确认的 Gateway 别名；
已删除的模型/provider 回到 agent 默认模型。已知 `builtin_models` 的公开别名
可映射回原 catalog route，不能对任意 provider 盲目剥掉前缀。

配置同步汇总多个权威源：

- provider models、base URL、API format、auth 与 capability；
- agents 的 identity、system prompt、qualified model 和 skills；
- 无显式 session mode 时的全局 restricted fallback 与 scheduler 隔离 policy；
- runtime settings，包括 MCP 请求超时与 subagent 调度参数；
- MCP servers、Hooks 与 Extensions；
- browser mode（isolated、existing Chrome、Chrome extension、内置浏览器四种）；任一时刻
  只启用一个名为 `browser` 的 Tool 提供方，前三种由 OpenClaw 原生 Browser Plugin 提供，
  内置模式由桌面 embedded-browser plugin 提供；两者共享锁定版 Browser Tool 的 action、
  `act` kind、结构化输出与 `browser-automation` skill 契约；内置模式保留原生本地浏览能力，
  但路由固定为当前桌面 `host`，不提供远程 node 或容器 sandbox 执行拓扑；
- system prompt replacement rules；
- scheduler 隔离 agent 与其他 JustDo 管理项。

同步在 exclusive queue 内执行，避免设置页、MCP/Hook/Extension 同时覆盖文件。写入后必须验证 active Gateway 的 restricted fallback 与 scheduler policy。会话 permission 不写全局 config，而由 session RPC 管理。若 Gateway 正在运行且变化需要 restart，Main 先通过原生 `gateway.suspend.prepare` 原子暂停 scheduler、封闭新 admission 并确认所有 Gateway workload 已空闲，再执行断开 adapter -> restart -> reconnect；busy 或 suspension RPC 不可用时继续延迟，不能用 `cron.list`/本地 active snapshot 代替该屏障。

v2026.9.2 配置只生成 keyed `agents.entries` roster，并以 `agents.ownership: explicit` 标记多 Agent 所有权；`main` 与隔离的 `justdo-scheduler` 在无模型的最小配置中也必须存在。启用的外部 Agent 也必须生成 `runtime.type: "acp"` 的 roster entry，使 Gateway 为它发布 reply-dispatch runtime owner；仅写入 `acp.allowedAgents` 会让手动派生在会话所有权或 runtime publication 阶段失败。外部 runtime owner 的 `workspace` 与 `runtime.acp.cwd` 显式指向受管主工作区；它们不创建 OpenClaw 原生 bootstrap workspace，避免扫描历史版本遗留的 `<defaults.workspace>/<agentId>` 初始化状态，同时单次 spawn 仍可用显式 `cwd` 覆盖执行目录。ACP runtime owner 不写入内嵌 Agent 的 fallback `model`：未在 `sessions_spawn` 指定模型且没有专门的 subagent model 配置时，应由外部 harness 选择默认模型，不能把主 Agent 的 provider/model 误当作 ACP model override。`agents.defaults.systemAgent.agentId` 固定为 `main`，让 memory dreaming 等 OpenClaw 原生环境任务拥有明确 owner；JustDo 创建的无人值守任务仍逐项显式绑定 `justdo-scheduler`。启动权限验收同样只读取 v2026.9.2 的 `agents.entries`，不能再用已删除的 `agents.list` 判断 scheduler 权限。在 v2026.9.2 中，`tools.sessions.visibility` 的上游隐式默认值是 `all`；跨 Agent 访问仍受默认启用的 `tools.agentToAgent` 约束。JustDo 在“设置 → 配置”开放 `self/tree/agent/all`，并显式固定产品默认值为 `tree`，以保留父子任务树边界并避免 sibling session 在升级后自动相互可见。OpenClaw 默认还会把沙盒会话的有效范围归一为当前任务树：`agent/all` 会被收窄，而 `self` 在沙盒内也按任务树范围执行；设置页必须明确提示这一运行时差异。自定义 provider 的展示名经规范化后同时作为 `app_config.providers` key、Gateway provider ID 和模型引用中的 provider ID，使 OpenClaw 注入的当前模型身份保持用户可读；OpenClaw 内置与插件 provider ID 支持由显式 `models.providers.<id>` 配置覆盖，因此设置页允许用户使用这些自然名称，只拒绝 `builtin_models`、`justdo` 与旧版 `custom_数字` 命名空间。记忆检索写入顶层 `memory.search`；OpenClaw 仍以官方配置键 `tools.updatePlan` 控制替代工具 `progress_card` 是否启用，这个键名不是旧 timeline 实现。同步会定向清理 JustDo 历史写入但已被该版本删除的 metadata、diagnostics、pricing、heartbeat 与 experimental tool 字段，避免把旧生成结果重新喂给严格 schema。

版本化的 `agentRuntimeSettings:v1` 生成 `agents.defaults.timeoutSeconds/maxConcurrent/subagents` 和 `tools.sessions.visibility`，并以全局 MCP 请求时限作为用户 MCP Server 的默认 `timeout`。Agent 客户端 watchdog 动态读取相同的单任务运行时限；总并发为 null 时不写固定值，保留按设备自适应的系统默认。配置同步按字段合并 `subagents`，不会删除设置页未管理的 allowlist、显式 Agent 要求或通知等待策略。`mcp_servers.config_json.requestTimeoutSeconds` 可覆盖单个 Server；旧数据缺少后来加入的 Agent 时限/并发、SubAgent 委派/归档、会话访问范围、AskUserQuestion、计划任务审批或 MCP 字段时补入产品默认；历史通用审批字段会在规范化时丢弃；配置同步失败会恢复上一份数据库值。AskUserQuestion 的分钟数只供自定义交互 extension 在模型显式设置 `timeoutEnabled` 时使用；计划任务审批分钟数只写入 automation-permission；两者都不改变 exec 或其他插件的等待时限。

## 5. Fail-closed admission

`ensureOpenClawRunningForCowork` 的顺序：

1. 检测 legacy `sessions.json`。存在时先生成原生 SQLite migration dry-run plan，并在用户确认前阻止 Gateway 启动。
2. 执行 config sync；失败则设置 external engine error。
3. 若 manager 已 running，仍验证 active fallback/scheduler policy。
4. 否则调用可合并的 start；running 后再次验证该 policy。
5. 只有 phase 为 running 且验证成功，Cowork start/continue 才被接受。

这防止 Gateway 在无显式 session mode 的路径使用旧 Full fallback。具体 session 的 mode/root 在每个 turn admission 中另外回读验证。

Legacy session migration 是显式事务：`doctor --session-sqlite plan` dry-run -> 用户确认 -> 创建不含 workspace 的已验证备份 -> import 全部 agent session -> `validate`/`inspect`/integrity -> 写 receipt 与 manifest。取消或任一步失败会恢复旧 session store、保留备份和脱敏错误，并继续阻止空 Gateway；成功 receipt 使重复启动只做完整性复核，不重复导入。

## 6. Provider 与模型引用

JustDo 支持内置和自定义 provider。provider registry 规范化 provider id、API format (`openai-completions`) 与 auth。模型发现读取 `/models` 和可选 model info，填充 context length、max tokens 和 image capability，并以保守默认值兜底。

OpenClaw model ref 必须是 `provider/model-id`。启动迁移规则：

- agent model 为空时从当前默认 model 回填；
- 裸 model id 只有在 available providers 中唯一匹配时才补 provider；
- 多 provider 同名时跳过并记录无 secret 的警告；
- session 可保存自身 model，`sessions.patch` 只影响明确返回的后续调用范围。

当用户修改自定义 provider 展示名时，配置中的本地 UUID identity 用于关联改名前后的名称 key；Main 在生成 Gateway 配置前事务性更新当前 Agent、session 与 subagent 默认模型中的 wire ref。identity 不进入 Gateway provider ID、模型引用或 SecretRef。Renderer 的 `app_config` 写入会等待相关 OpenClaw 配置实际应用；失败时回滚配置与这些引用，不向用户报告伪成功。主题、语言等与 OpenClaw 无关的更改不等待 Gateway 同步。

## 7. Built-in model 生命周期

`BuiltinModelLifecycle` 与 `syncBuiltinModelProvider` 管理内置 provider。当前启动保持 access enabled，未来认证 login/logout 通过同一入口切换。刷新会获取可用模型、更新 `app_config.providers`、通知 Renderer，并触发 OpenClaw config sync。刷新失败不能删除上一次可用配置，也不能记录凭证。

内置模型服务的 OpenAI-compatible 响应契约要求：完整结构化 `tool_calls` 的最终 `finish_reason` 必须是 `tool_calls`；普通文本、不完整参数或未知工具不能被服务推断为调用。JustDo 不再用通用 runtime patch 放宽第三方 provider；第三方响应继续遵守 OpenClaw 原生的 visible-text + stop 安全策略。

## 8. Gateway client 与连接恢复

Adapter 延迟建立 Gateway client，并维护 generation 防止旧 socket 回调污染新连接。连接后订阅 sessions/event 能力、拉取 pending approvals，并安排 active goal recovery。

- 系统 resume 显式触发 reconnect。
- proxy 改变先 dispose client，再 restart Gateway；成功后创建新 client。
- disconnect 不自动宣告业务终态；active turns 由 Gateway runtime/history 恢复或明确超时/abort。
- subscription、ready promise、timer 和 caches 都绑定 generation，disconnect 时清理。
- Manager 在 Electron Main 模块加载时捕获一次稳定的 app-start 时间，并传给该软件进程启动的每个 Gateway。原生 restart recovery 保留同一 JustDo 进程内的 Gateway 重启；补丁 `008` 在恢复副作用前中断早于 app-start 的 main session，并取消对应的 queued/running durable task，防止完整软件重启后旧工作复活。

## 9. Managed session key

JustDo 使用稳定 managed key 编码 agent 与本地 session。纯 session-key helper 只接受规定格式，避免把任意 channel/session key 归入产品 session；它也识别 cron 隔离 key。未接入产品数据流的旧 channel 自动建会话逻辑已经删除，外部会话不会被静默写入本地产品列表。

删除只操作可证明归属的 managed tree；通用 main session 不递归删除。runtime status 批量查询采用单飞/TTL snapshot，避免会话列表轮询造成 N+1 RPC。

## 10. Chat 与事件归一化

Adapter 在初始会话和后台任务路径调用 `chat.send`，保存 requested run id，接收真实 run id 后重绑。普通对话的 Thinking/Tool/Content 由 Renderer Gateway client 直接处理；Main 不再建立第二套消息投影。Adapter 仍处理：

- chat final/aborted/error 对产品 run 状态的收敛；
- agent lifecycle、审批、cron 与后台任务事件；
- requested/acknowledged run id 绑定与迟到终态去重；
- foreign/detached/visible run 的运行状态边界；
- scheduler 等全量结果消费者的分页 `chat.history` 读取。

后台全量历史同步按每页 1000 条循环读取；Renderer 另有分页窗口。扩大单页限制前必须评估内存和二次投影成本。

Adapter 不再读写 OpenClaw `sessions.json`。模型变更在 Gateway ready 后用 `sessions.patch`；历史来自原生分页 `chat.history`；原生 display projection 未公开的 tool input 与 compaction detail 由 `runtime-services` 的受限 `operator.read` RPC 按请求 id 有界补齐。所有 RPC 结果先经过 `v2026.9.2` wire validator，再进入产品 DTO。

## 11. Slash commands

命令列表来自 Gateway，再应用 JustDo policy 的 blacklist、category、tier、execution type 和 before-send hook。本地命令和 Gateway 命令分开；UI 不应把未知 `/...` 默认为本地执行，也不能绕开 policy 直接 RPC。App-owned `/plan` 只切换模式，`/plan <task>` 切换后把去掉命令前缀的任务作为规划消息提交；冒号形式 `/plan: ...` 按普通消息发送。用户手工输入的 Gateway slash command仍可走命令处理，但 Goal 卡片生命周期操作使用原生 structured Goal RPC，不依赖命令文本和控制 run。

## 12. Goal continuation

Adapter 内的 coordinator 将 Gateway Goal、tool/lifecycle 和原生 task 状态组合成产品自动续跑状态机，但不拥有 Goal 内容或 lifecycle。创建通过带 `session-goal-start` intent 的 `chat.send` 完成；edit/pause/resume/block/complete/clear 使用 `sessions.goal.update` / `sessions.goal.clear`，并以精确 sessionId、goalId 和 24 小时 operation receipt 做并发隔离与幂等重放。Resume 自身原子启动 continuation，不建立 `/goal resume` 控制 run。

Coordinator 只为仍是 canonical `active` 的目标调度后续 turn，并保留退避、最大续跑次数、等待用户输入/确认和 stop latch。连接 generation 变化后扫描本地 session 与 Gateway Goal/runtime；只有 Goal id 和状态一致才恢复，避免旧 snapshot 续跑新目标。`usage_limited` 与 `budget_limited` 保持独立展示，resume 后由 OpenClaw 原生逻辑重置预算窗口。

软件启动后的首次完整 Goal 扫描复用 Manager 的 app-start cutoff：早于 cutoff 或缺少
`createdAt`、且没有当前 active run/用户 activation/精确 session+goal ownership 的 active Goal
会恢复为 `stopped`，不会自动 continuation。扫描失败会携带同一 cutoff 重试；旧 generation
不能清除首次扫描状态。首次扫描成功后，后续 Gateway-only reconnect 恢复当前软件进程内的
active Goal。

Goal、required child join、queue admission、审批、thinking、compaction/context budget 均使用 v2026.9.2 原生能力。Subagent 列表和终态来自 `task` events 与 `tasks.list/get`；产品层只映射为 `pending/running/done/failed/killed/timeout`，其中 `taskName` 是稳定 task id，`label` 是展示标题。

压缩 watchdog 会随原生执行进展重置，不能把配置的 timeout 当作整体执行时限。Adapter 不再按固定 elapsed 清除 compaction busy 状态或触发 run complete；只在原生压缩终态、会话 reset/delete/new、运行清理或连接清理时释放该状态。Renderer 的手动压缩 RPC 同样不设独立总时限，普通 RPC 的请求超时不受影响。

## 13. Agent runtime settings

Shared contract 对 delegation mode、全局及单 Server MCP request timeout、计划任务审批时限、subagent concurrency/children/depth/timeout/archive/model/thinking/announce timeout 等字段做默认值、范围和跨字段 normalize。Main IPC 保存后进入 config sync。需要 hard restart 的配置会一直通过原生 suspension 屏障等待活动任务结束，不设置强制中断上限，真正重启前 scheduler 与新 admission 已被冻结；MCP timeout 变化会重建托管 server 配置；subagent 配置通常影响新 spawn/turn，不能承诺正在运行的 subagent 热更新。Exec 使用 OpenClaw 原生 30 分钟期限；automation-permission 仅为计划任务变更设置原生支持的 2/5/10 分钟 `timeoutMs`。

受管字段（例如 scheduler agent 的权限、关键 extension/plugin 配置）不能被通用 settings UI 覆盖。

## 14. 权限与审批

权限模式是 ask、auto、full 三档产品语义，分别映射到 OpenClaw 原生 session `guarded`、`workspace`、`full`。`OpenClawRuntimeAdapter.prepareSession` 通过 `sessions.create({key,cwd,permissionMode})` 幂等写入并核对 entry；会话变更由 coordinator 串行并先保存 SQLite 期望值，活跃 run 允许切换并在终态后应用最新值。原生同步失败只保留 pending，不回滚旧模式；下一 turn 前的严格 reconcile 失败会阻止发送。Cowork config 中的 mode 只作为新会话默认值，不触发 Gateway config reload。

Exec 和 plugin approval API 分开，pending list 在连接后恢复。session grant 仅对满足 shared predicate 的 exec request 有效，并在 session terminal/stop/delete 清除。scheduler agent 使用固定无人值守 policy，不能弹 UI，也不能借 cron 修改升级普通交互会话。

## 15. Plan mode

Plan mode 是独立于 ask/auto/full 执行权限的会话工作流。Renderer 对新会话保存临时选择；创建 Gateway session 后，Adapter 通过原生 `sessions.pluginPatch` 把 `{enabled, updatedAt}` 写入 `plan-mode/state` session extension。计划文件和 handoff 成功持久化后，Adapter 在展示侧栏前把同一 state 扩展为带版本和 request id 的 `awaitingReview` 标记。`justdoPlanMode` 是 OpenClaw session row 的只读投影，JustDo 不新增消息缓存。

内置 `plan-mode` extension 在 turn prepare 时读取该投影并注入规划规则，要求 Agent 先检查上下文、只做只读研究，最终调用 `PresentPlan`。trusted tool policy 复用 OpenClaw 的公开 replay-safe 分类处理原生复合工具，并拒绝文件写入、会产生副作用的 shell/code execution 和名称可判定的 mutation 工具；`rg` 等经过保守语法校验的只读命令仍可用于代码检索。提示约束覆盖无法可靠静态分类的第三方工具。活动规划 run 中可以从输入栏关闭 Plan mode 并切换权限，Gateway 原子更新 session extension 和权限期望值，不停止或重启当前会话；活动 run 中仍不能开启 Plan mode。

`PresentPlan` 使用与 AskUserQuestion 相同的 plugin Gateway event/RPC 桥接模式，但拥有独立 pending 状态。Renderer 在当前会话的右侧预览区域自动展示非模态计划审核面板：批准、要求修改或取消；切换会话只隐藏面板，不会解决后台会话的 pending 请求。批准实施后面板保留为可关闭的只读预览，操作按钮全部隐藏且不再阻塞输入。实时流和历史记录都把 `PresentPlan` 投影为独立计划卡片，点击卡片可重新打开相同的只读侧栏，因此应用重启后无需另建 Renderer 消息缓存也能查看计划。计划面板与文件预览共用侧栏视觉，但没有文件路径、编辑、保存或文件授权能力。计划出现时，Main 先把规范化 Markdown 原子发布到 `<workspace>/.<productName lowercase>/plans/<sessionId>/<planId>.md` 并写入 handoff，再写 `awaitingReview`，最后才显示侧栏；这是 Plan 阶段唯一由产品执行的受控 workspace 写入。目标不可覆盖，批准和注入前均校验长度与 SHA-256，handoff 还持久化创建计划时的 workspace root，避免会话 cwd 后续变化导致恢复读错位置。批准后的新实施上下文得到 `Implement the plan.`、workspace 相对路径和完整正文；Gateway 将该实施指令持久化为 `display:false`，供模型上下文和恢复使用，但不投影为用户消息。Plan 不再改变 Gateway 的恢复状态机：完整应用重启按通用 app-start boundary 中断旧 run，同一应用进程内的 Gateway 重启沿用 OpenClaw 原生恢复；Main 可从计划文件和 handoff 恢复仍待处理的侧栏。

批准实施不会让等待中的规划 Agent 在原模型上下文继续写代码。Adapter 先调用 `planMode.resolve(implement)`，让 `PresentPlan` 返回并等待规划 run 结束；超时则显式停止该 run。随后调用 OpenClaw 原生 `sessions.reset { reason: 'reset' }`，并校验返回的 canonical key 与 Gateway `sessionId` 都未变化。reset boundary 保留完整 transcript 供 UI 展示，但 OpenClaw 的模型上下文从 boundary 后开始。Adapter 最后在同一个 session 中以稳定 idempotency key 发送隐藏的 `Implement the plan.` 消息，内容包含已核验计划的相对路径和完整正文。整个流程不创建 implementation child session，也不拼接多份 transcript。

这条链路使用 OpenClaw v2026.9.2 的 session extension、turn hook、trusted tool policy、plugin tool、Gateway events 与 scoped RPC，不拥有 Plan 专用恢复补丁。完整应用重启由通用 Patch 008 中断旧 planning run；同一应用进程内的 Gateway 重启继续使用原生恢复，持久 artifact、handoff 与 session extension state 用于恢复待审核侧栏。

## 16. Runtime patches

当前补丁目录为 `scripts/patches/v2026.9.2/`，仅保留十九个产品缺口：managed Python、通用 Windows MCP runner、Chrome Windows package runner、最终 system-prompt replacements、agent metadata、compaction/reviewer purpose、app-start session/task boundary、forced memory reindex cache bypass、暂停中止后的原生 Goal resume 准入、assistant display block replay 过滤、trusted local generic MEDIA、离线官方插件目录、分段 live progress snapshot、mixed tool/commentary 顺序、禁止配置驱动的插件自动安装、OpenAI realtime transcription 自定义 base URL、OpenAI-compatible 媒体 provider 隔离、reset 后的 JustDo display history，以及受管 session fork 目标 key/assistant cut。Chrome connect 前 stderr 捕获、exec/plugin approval 期限与 plugin approval dispatch 均使用上游行为。权威处置与删除条件以该目录 README 为准。

补丁不是传统数据库 migration：每次 runtime 都从锁定的 pristine npm tarball 构建，source lock 同时验证 registry integrity 与 tarball SHA-256。安装、source/worker、esbuild bundle 和 prune 后均验证当前 patch shape；旧 marker 或部分应用状态 fail closed，禁止对旧 JustDo runtime 原地升级。开发态 Electron 会在系统临时目录持有按仓库隔离、带心跳的进程租约；已有开发会话未退出时，新的 runtime prepare 必须在下载或目录替换前失败，避免 Windows 对正在执行的 runtime 进行 rename 而产生延迟 `EPERM`。

## 17. 网络环境

Manager 通过 `OutboundHeaderProxy.buildGatewayEnvironment` 为 Gateway child 构造环境，并允许
需要远端模型访问的 OpenClaw one-shot CLI 显式 opt-in 同一环境。当前 memory index CLI
会 opt-in，使独立 CLI 发出的 embedding 请求也经过 URL 白名单和 Header 注入；status 等纯本地
命令保持继承环境。CLI 复用当前 capability，不触发 Gateway capability rotation。系统/custom/direct
proxy 变化会更新 bypass，其中动态加入当前 Gateway loopback 端口，避免本地 RPC 被送到上游代理。
内置 provider 若使用 loopback base URL 可列为 forced URL。

Header proxy 的 CA 使用每次生成唯一的 Subject，启动前验证 CA 自签名、有效期、公私钥及缓存叶子证书。旧版固定
`CN=NodeMITMProxyCA`、不完整 store、密钥不匹配或跨 CA 叶子证书会触发应用生成的 `certs/`、
`keys/` 重建；Main 不安装、删除或修改 Windows 系统根证书。这样 Gateway 同时启用 system CA 时，
系统库里的历史同名根证书不会覆盖当前本地代理 CA 并触发 `CERT_SIGNATURE_FAILURE`。

仅提供 CLI 环境并不足以让 OpenClaw 的 guarded fetch 使用代理。内置 `runtime-services`
注册 remote embedding provider，复用 OpenClaw SSRF guard，并只对 eligible URL 使用 env proxy；
没有 `HTTP(S)_PROXY` 或命中 `NO_PROXY` 时保持原路径。请求到达本地代理后仍由完整 URL 白名单决定
是否注入业务 Header，未命中请求不会获得自定义 Header。

OpenClaw 原生 `memory index --force` 会把 `reason: "cli"` 和 `force: true` 传入 shadow reindex，
但 pristine v2026.9.2 仍无条件复制旧 embedding cache，内容未变化时因此不会发出模型请求。
Runtime patch `009` 只对这组原生 CLI 意图跳过旧 cache seed，使现有记忆分块重新计算向量；普通搜索、
后台增量索引和自动 provider fallback 仍复用缓存。失败时继续由上游 shadow reindex 保留原数据库。

受管 memory search 配置只额外声明与标题模型请求一致的
`User-Agent: OpenAI/JS 6.39.1`；`Authorization`、`Content-Type` 和动态 body length 仍由 OpenClaw
embedding 请求层负责。OutboundHeader 的用户值继续只存在于代理 policy/cache，不写入
`openclaw.json`。

Main 通用 fetch、Electron session proxy 与受管 OpenClaw child environment 是不同作用域；修改一个
不能假定其他两个自动同步。

## 18. 日志与诊断

优先顺序：

1. `%APPDATA%/<productName>/logs/main-YYYY-MM-DD.log`；
2. `%APPDATA%/<productName>/openclaw/logs/gateway.log`；
3. `[gateway] log file:` 指向的 `%TEMP%/openclaw/openclaw-YYYY-MM-DD.log` 原生 JSON。

Gateway stdout filter 会压缩 thinking/assistant/item 流，只保留段首尾及 80 字预览，并省略 plugin loading、schema walk、droppable delta、tick/health。因此 condensed log 中“没看到事件”不是事件不存在的证据。分享前检查敏感内容，禁止提交 raw native log。

## 18. 升级与验证

升级 OpenClaw 时：固定新版本 -> 安装 pristine runtime -> 重新验证 capability gaps -> port 当前 patch 而非复制旧目录 -> 更新 patch README/manifest/tests -> 运行 patch verify、runtime staging/freeze/prune 和相关 adapter测试 -> 更新本文件及 capability matrix。

常用验证：

```bash
npm run openclaw:patches:verify
npm run compile:electron
npm test
```

还需手工验证启动、proxy 切换、sleep/resume、start/stop、approval、goal continuation、subagent completion、cron 和退出清理。

## 19. Manager 并发约束

Gateway start/restart/stop 不是三个互不相关的按钮。Manager 需要共享启动与完整重启 promise、shutdown flag、child identity 和 readiness wait：并发 ensure 复用同一启动；同一 generation 的并发 hard restart 复用同一 stop/start，禁止通过 `afterCurrent` 给新进程排入未获取 suspension 的 trailing restart。若当前 start/restart 的启动快照之后又发生 secrets、代理或扩展等启动输入变化，上层必须等当前 generation 完成后，针对新 generation 重新获取原生 suspension 再执行下一轮。ready lease 返回后还要再次核对 phase 与 process generation，旧 lease 不能作用于新进程。shutdown 让 readiness/retry loop 尽快退出；stop 有超时兜底，不能永久阻塞应用退出。

设置页的手动 restart 优先请求 Gateway 的 `gateway.restart.request`，并以当前受管进程日志中的下一次 `[gateway] ready` 作为完成边界。受管 Gateway 设置 `OPENCLAW_NO_RESPAWN=1`，因此该请求复用当前 Node 进程和已加载模块，避免重新解析 runtime bundle。若 RPC 不可用、进程退出、ready 超时或 Gateway 因 cooldown 给出较长延迟，手动 restart 回退到有序 stop/start。端口属于 launch argument；配置端口与当前监听端口不同时必须直接走完整重启。Secrets 等启动环境有尚未应用的变更时同样必须完整重启，避免进程内 restart 继续使用旧环境。

配置保存采用更保守的自动恢复路径：启动中的 Gateway 先完成当前启动，再写配置并等待原生热更新，避免因启动快照竞争直接再冷启动一次。环境变量比较忽略 key 的排列顺序。扩展配置内容未变时不写文件；改变时先等待 watcher 完成热更新。原生热更新失败、扩展配置恢复或扩展启停明确返回 restartRequired 时，启动环境与端口未变则请求 `gateway.restart.request({skipDeferral:false})`。scheduled 等待下一次 ready 后恢复桥接并验证权限；deferred/coalesced 或已接受但尚未 ready 的请求由原生 coordinator 持有，不能仅因等待超时再发起竞争的冷重启。RPC 不可用时才回到已有 suspension 屏障和冷重启路径。扩展代码导入/删除、目录操作和代理环境变化仍保留进程替换。

Windows bundle launcher 每 5 秒 best-effort flush V8 compile cache，timer 不保持 CLI 进程存活。Gateway 的顶层 await 可能令 `import()` 在整个服务生命周期都不 resolve，因此不能只在 import 完成或正常退出时落盘；Windows 终止进程前已落盘的缓存可被后续冷启动复用。该优化减少重复编译，不能省去插件、数据库和 Gateway 服务初始化。

自定义模型供应商的 API Key 不再注入 Gateway launch environment，也不再经过 `JUSTDO_APIKEY_CUSTOM_N` 环境变量样式的中间占位符。同步先将凭据按规范化 provider 名称原子写入 `<stateDir>/model-provider-secrets.json`，再将 `models.providers.*.apiKey` 写成同名原生 file SecretRef；`secrets.providers.justdo-model-providers` 声明该 JSON 文件。新增供应商由 config watcher 加载配置及凭据，启动环境不变，因此不触发冷重启。只修改 Key 时引用及配置文件不变，Main 显式调用 `secrets.reload` 刷新原生快照，并在失败时停止 Gateway，避免把旧凭据状态报告为已更新。供应商改名会同步更改 SecretRef 与密钥文件条目。

内置模型（含 memory embedding）使用 `justdo-builtin` 原生 exec SecretRef，凭据在 `<stateDir>/credentials/credentials.bin` 中加密保存。Gateway 在启动或凭据刷新时一次性调用解密程序，通过管道取得 Key；JSON 只保存引用，`models.json` 由原生来源快照机制写入 `secretref-managed` 标记，环境变量及命令行不携带 Key。没有新增本地代理、监听端口或常驻解密进程，模型请求继续由 Gateway 直接发往原上游，现有出站请求头代理未改变。Main 的模型发现、标题生成和就绪探测在各自直接请求边界解析内置引用，不将真实值回写产品配置。退出登录通过既有强制失效流程停止旧 Gateway，并移除不再引用的二进制凭据；Key 轮换可 `secrets.reload`，无需冷重启。当前加密只满足防直接查看，不替代后续服务端 JWT。

`phase=running` 只表示受管进程/readiness 达标，不保证每个 adapter consumer 的 WebSocket 仍健康。配置、代理以及 extension 配置/启停/导入/删除触发的自动 hard restart 都进入 `OpenClawConfigSyncService` 的 exclusive queue 与原生 suspension 屏障，由同一路径 disconnect 旧 client、restart Gateway、再 connect Cowork service；最后一步失败时停止 Gateway，避免留下假健康状态。Skill/Extension 的 Windows 目录锁恢复也在同一 exclusive queue 中，只有原生 suspension 返回 ready 才能 stop/mutate/start；Gateway 忙碌时操作失败并提示稍后重试，不能直接中断 active run。

设置页“测试连接”通过既有 `api:fetch` IPC 发起请求。Renderer 仅提供内置凭据占位符；Main 在出站请求头策略之后、实际发送之前解析它，仅允许指定内置上游的 `POST /chat/completions`，并禁止该请求自动重定向。真实 Key 不回写输入对象或产品配置。自定义 Key 的请求路径保持不变；标题生成在自己的 Main 请求边界解析内置引用。

## 20. 启动失败分层

| 阶段               | 失败示例                 | 处理                                                   |
| ------------------ | ------------------------ | ------------------------------------------------------ |
| Runtime resolution | bundle/Node/资源缺失     | manager 返回失败并记录解析路径，不尝试随机全局 runtime |
| Config sync        | schema/write/reload 失败 | 不自动启动 Gateway；高风险 admission fail closed       |
| Spawn              | child 无法启动/立即退出  | 收集 exit/stdout，进入 error phase                     |
| Readiness          | port/token/health 超时   | 终止或清理 child，返回可重试错误                       |
| Client connect     | WS/RPC handshake 失败    | adapter 保留断线状态，由 reconnect/显式 restart 恢复   |
| Runtime request    | method error/timeout     | 绑定具体 command/run，不自动等同整个 session terminal  |

## 21. Credential 与网络边界

Gateway port/token 由 Main 管理；token 不应进入普通 Redux、日志或导出。Provider key 写入受管配置时必须避免 console 序列化完整对象。系统代理、Main fetch 代理、Gateway child environment 与 outbound-header proxy 是不同网络层；变更 `NO_PROXY` 或 header injection 时要验证 loopback Gateway 不被错误代理，同时远程 provider 仍遵守用户偏好。

## 22. Runtime Capability 证据

每项能力需要区分：upstream native、当前版本 patch、adapter projection 和 UI consumer。只有类型或 patch 文件不足以证明可用。证据至少包含 Gateway fixture/RPC 或 patch consumer test、adapter test，以及实际注册的 IPC/UI 路径；完整表见 capability matrix。

## 23. 代码与测试地图

| 主题                     | 入口                                                       |
| ------------------------ | ---------------------------------------------------------- |
| 进程/端口/readiness      | `openclawEngineManager.ts`、`loopbackPort.ts` 及测试       |
| 启动参数与 Node          | `gatewayLaunchArgs.ts`、`electronNodeRuntime.ts` 及测试    |
| Config reload            | `gatewayConfigReloadMonitor.ts`、config sync service tests |
| Adapter/session RPC      | `openclawRuntimeAdapter.test.ts`、`sessionRpc.test.ts`     |
| Renderer history/live    | `chat-controller.test.ts`、`history-reconciler.test.ts`    |
| Model refs/agent models  | shared modelRef 与 `openclawAgentModels` tests             |
| Goals/subagents/approval | goals、subagent gateway、permissions tests                 |
| 日志压缩                 | `gatewayLogFilter.test.ts`                                 |

## 24. Engine 变更完成条件

必须验证冷启动、并发 ensure、启动中 stop、异常 child exit、代理 restart、sleep/resume、优雅退出和打包 runtime path。Gateway method/schema 变化还要更新 shared contract、adapter、capability matrix 和 patch disposition；只让 TypeScript 编译通过不构成 runtime 兼容验证。
