# 数据存储

本文按 `v2026.8.27` 的 `SqliteStore`、`CoworkStore`、`GroupStore`、`ScheduledTaskResultStore` 和相关测试重写。JustDo 的核心产品数据使用 SQLite；OpenClaw 自己的 transcript、runtime 和 cron 数据仍位于其 state directory，不归入本 schema。

## 1. 数据库位置与初始化

数据库文件名是稳定内部标识 `justdo.sqlite`，位于 Electron `app.getPath('userData')`，即 `<appData>/<package.json.productName>/justdo.sqlite`。产品名变化会得到不同 userData 目录，旧品牌数据不自动迁移。

`SqliteStore.create()` 的顺序：

1. 解析 userData 和 database path。
2. 检测已知 legacy schema；只在明确缺少必需列时删除 database、`-wal`、`-shm` 并新建。
3. 打开 `better-sqlite3` 连接。
4. 设置 foreign keys、WAL、sync/cache/checkpoint。
5. 创建表/索引并执行兼容迁移。
6. 删除旧版冗余 `cowork_messages` 缓存表，执行 `PRAGMA optimize`。
7. 若 KV 仍为空，从旧 `config.json` 一次性导入 electron-store 数据。

数据库只在 `app.whenReady()` 后初始化；退出时在 Gateway 停止后关闭，以 flush WAL 和释放文件锁。

模型供应商配置仍以 SQLite `kv.app_config` 为产品来源。自定义供应商使用规范化展示名作为 `providers` key，并保存一个仅用于可靠识别改名操作的本地 UUID identity；不再支持的旧 `custom_N` 配置会在 Renderer 加载时删除，用户需要重新添加对应供应商。供 OpenClaw 读取的自定义供应商凭据按规范化名称派生为 `<openclawStateDir>/model-provider-secrets.json`；`openclaw.json` 只保存同名原生 file SecretRef，不包含这些 Key 的值。文件先通过独占临时文件设置权限，再写入并原子替换：POSIX 使用 `0600`，Windows 移除继承 ACL，仅授予当前用户、SYSTEM 和 Administrators。它是敏感派生文件，不应作为普通诊断配置导出或记录日志；供应商目录正常同步时移除不再引用的凭据。Key 内容变更通过 `secrets.reload` 刷新运行时，不要求重启进程，也不新增 SQLite 表。

当已启用供应商被删除、禁用、改名，或失去最后一个可用模型而不再进入 OpenClaw 配置时，配置同步在新配置生效并把现有会话切回可用模型后，通过原生 `models.authLogout` 清理该供应商的系统 auth profile。进程首次成功验收配置时还会通过 `models.authStatus` 收敛旧版本遗留的孤儿：仅匹配已不在配置中、`<provider>:default`、`api_key` 且来源为 saved/inherited 的 profile，不依赖 auth status，因为 OpenClaw 会把无法解析的 legacy `${ENV_VAR}` Key 报告为 `static`；手工 OAuth/token 账号不会被清理。清理使用 `main` Agent 作为共享凭据 owner，由 OpenClaw 自己同步处理共享及继承状态；失败只进入内存待重试集合，并在下一次成功验收时重试，不直接修改 OpenClaw SQLite。该操作只删除鉴权 profile、顺序和健康/限流 `usageStats`，不会删除 transcript，因此 `usage.cost` 与 `sessions.usage` 的历史模型 Token 统计保持不变。

## 2. SQLite 参数

`SqliteStore` 将 `app_config.providers.builtin_models.apiKey` 规范化为非秘密凭据引用，legacy `app_config.api.key` 若与旧内置值相同也一并改为引用。无关的用户自定义 legacy API Key 保持原有存储契约，不新增 OS 密钥服务依赖，避免没有系统密钥库的 Linux 用户无法启动。读取此前已保存的 OS 加密 legacy 记录仍需 Electron `safeStorage`，解密不可用时明确报错；不把密文当作 Key 使用。打开已有数据库时转换内置旧值，并尝试通过 secure-delete 和 WAL truncate 清理本次转换的数据库残留；历史备份、旧导出及存储介质残留不在该保证内。

内置模型不增加本地转发服务。真实 Key 派生为 `<openclawStateDir>/credentials/credentials.bin`，采用带版本头、随机 nonce 和认证标签的 AES-256-GCM 二进制格式，设置与上文相同的私有文件权限。app config 仅存 `justdo-builtin-credential` 非秘密引用，Gateway JSON 仅存原生 exec SecretRef，不存 Key 或密文；历史数据库真实凭据仍受上述 OS 加密保护。原生解析器在启动/刷新时通过 stdin/stdout 调用私有目录中的解密程序，Key 仅在管道和运行时内存中使用，不进入环境变量或命令行。Windows 通过系统 PowerShell 启动 Electron Node 模式以兼容原生 ACL 检查及中文路径，POSIX 使用当前用户拥有的受限启动脚本；没有常驻进程或网络端口。真实运行包测试验证 `models.json` 写入 `secretref-managed` 而非解析后的 Key。退出时不再引用内置凭据会删除二进制文件；凭据轮换保持 JSON 引用稳定，通过 `secrets.reload` 生效。

随包引导凭据和二进制文件的包装材料均可由客户端代码推导，仅用于避免直接打开文件看到明文，不构成防逆向安全边界。未来应由服务端 JWT 替代共享静态凭据；历史备份和旧版本安装包不在本次清理范围内。

| PRAGMA               | 当前值   | 目的                           |
| -------------------- | -------- | ------------------------------ |
| `foreign_keys`       | `ON`     | session 删除级联 run/关联数据  |
| `journal_mode`       | `WAL`    | 读写并发与崩溃恢复             |
| `synchronous`        | `NORMAL` | WAL 下的性能/耐久折中          |
| `cache_size`         | `-8000`  | 约 8 MiB page cache            |
| `wal_autocheckpoint` | `1000`   | 约每 4 MiB WAL 自动 checkpoint |

WAL 是持久设置。备份不能只在运行中复制主 `.sqlite` 而忽略 WAL；优先退出应用后复制，或使用 SQLite backup API。

## 3. Schema 总表

当前共有 14 张核心表：

| 表                                   | 用途                          | Owner                         |
| ------------------------------------ | ----------------------------- | ----------------------------- |
| `kv`                                 | 应用配置与内部同步元数据      | `SqliteStore`、领域 store     |
| `cowork_sessions`                    | 产品会话索引/元数据           | `CoworkStore`                 |
| `cowork_external_sessions`           | 外部 runtime session 映射     | `MulticaExternalSessionStore` |
| `cowork_external_session_tombstones` | 已删除外部 session 防复活记录 | `MulticaExternalSessionStore` |
| `cowork_session_runs`                | client turn/root run receipt  | `CoworkStore`                 |
| `cowork_plan_handoffs`               | Plan artifact/handoff 状态    | `CoworkStore`                 |
| `cowork_config`                      | Cowork/runtime 设置           | `CoworkStore`                 |
| `agents`                             | Agent 产品定义                | `CoworkStore`                 |
| `mcp_servers`                        | 用户 MCP 配置                 | `McpStore`                    |
| `openclaw_hooks`                     | Hook 状态/config              | `OpenClawHookStore`           |
| `session_groups`                     | 会话分组和顺序                | `GroupStore`                  |
| `scheduled_task_run_receipts`        | 应用内 cron 结果/未读         | `ScheduledTaskResultStore`    |
| `scheduled_task_result_cleanup`      | 结果 artifact 清理进度        | cleanup service               |
| `scheduled_task_result_tombstones`   | 已清理结果的删除标记          | cleanup service               |

`scheduled_task_result_cleanup` 也是独立核心表；任何漏掉 cleanup 或 run receipt 的旧清单均不准确。`sqliteStore.ts` 的 `CREATE TABLE` 清单是最终依据。

## 4. `kv`

| 列           | 类型/约束        | 语义          |
| ------------ | ---------------- | ------------- |
| `key`        | TEXT PK          | 稳定配置 key  |
| `value`      | TEXT NOT NULL    | JSON 序列化值 |
| `updated_at` | INTEGER NOT NULL | Unix ms       |

`SqliteStore.get/set/delete` 解析/序列化 JSON，set 使用 upsert，并通过进程内 EventEmitter 触发 `onDidChange(key)`。事件不是跨进程数据库监听；只覆盖同一 Main 实例通过该 Store 写入的变化。

主要内容包括 `app_config`、自动启动/防休眠标记、自动更新检查频率与上次自动检查时间，以及 scheduled result baseline/task watermark/catch-up。自动更新使用 `app_update_check_frequency` 和 `app_update_last_automatic_check_at`；领域 prefix 是兼容接口，改名需迁移。

`plugin_marketplace_installations_v1` 保存市场身份投影：source、kind、catalog id、runtime id、
安装版本及可选安装路径。它不表示插件一定存在；Skill、MCP 和 Extension 的运行时清单仍是
安装状态权威。该投影只用于跨重启更新检查、多市场路由，以及同名分层 Skill 的精确删除。

## 5. `cowork_sessions`

| 列                          | 说明                                                |
| --------------------------- | --------------------------------------------------- |
| `id`                        | UUID/稳定本地 session id，主键                      |
| `title`                     | 用户/模型生成标题                                   |
| `status`                    | idle/running/completed/error 等产品快照             |
| `pinned`                    | SQLite integer boolean                              |
| `cwd`                       | task workspace                                      |
| `execution_mode`            | 当前使用 local；legacy container 被迁移             |
| `permission_mode`           | ask/auto/full 之一；原生 session 权限的耐久期望投影 |
| `active_skill_ids`          | JSON array                                          |
| `agent_id`                  | 默认 `main`                                         |
| `model_ref`                 | qualified provider/model，可空                      |
| `forked_from_session_id`    | 分叉来源本地 session id；父会话删除时置空           |
| `forked_from_session_title` | 创建分叉时的来源标题快照                            |
| `forked_from_entry_id`      | 触发分叉的 OpenClaw transcript entry id             |
| `group_id`                  | 指向 session_groups，可空                           |
| `created_at`,`updated_at`   | Unix ms                                             |

索引：

- `idx_cowork_sessions_order(pinned DESC, updated_at DESC)`；
- `idx_cowork_sessions_agent_order(agent_id, pinned DESC, updated_at DESC)`。

运行状态不能只信该表；启动会把遗留 running 重置为 idle，实时状态需结合 Gateway。

### 5.1 `cowork_external_sessions`

| 列                              | 语义                                         |
| ------------------------------- | -------------------------------------------- |
| `source`,`external_session_key` | 外部 runtime 与其 session id，组合唯一       |
| `cowork_session_id`             | 关联产品 session，删除时级联                 |
| `agent_id`,`cwd`                | 首次任务固定的执行身份与工作目录             |
| `openclaw_session_key`          | local runtime 的原生 transcript key          |
| `status`                        | running/completed/error/cancelled 的集成快照 |
| `created_at`,`updated_at`       | Unix ms                                      |

`idx_cowork_external_sessions_cowork` 支持从产品 session 回查来源；
`idx_cowork_external_sessions_status` 支持运行状态诊断。该表不保存 prompt 或响应。
恢复同一个外部 session 时必须保持 cwd/Agent；若产品 session 已被删除，外键级联删除映射，外部
调用不得静默创建到旧身份的替代映射。删除触发器会先把 `(source, external_session_key)` 写入
`cowork_external_session_tombstones`；tombstone 不含 transcript、cwd、Agent 或凭据。

## 6. 消息所有权

`cowork_messages` 已删除。OpenClaw v2026.9.2 自己的 SQLite transcript 是唯一持久消息来源，Renderer 通过 `chat.startup` / `chat.history` 和分页 history bridge 读取；JustDo 不再把同一份正文、Thinking、Tool output、usage 和附件元数据复制到 `justdo.sqlite`。升级初始化会直接删除遗留缓存表，不迁移其中内容，因为它不是权威数据。

Main 与 Redux 也不再维护 transcript projection。Renderer 的 chat controller 直接消费 Gateway history、in-flight snapshot 和实时 Thinking/Tool/Content 事件，并只在页面生命周期内保存有界的显示状态。会话导出必须从 controller 的 Gateway 快照生成；全文搜索、历史详情、定时任务结果和 subagent timeline 均按需查询 Gateway。产品侧 `CoworkSession` 契约不再包含 `messages` 字段，避免空数组被误当作可用 transcript 或降级数据源。

会话复制新增一条独立的 `cowork_sessions` 元数据记录；正文复制由 OpenClaw transcript fork 完成，不写入 `justdo.sqlite`。源会话已结束的 `cowork_session_runs` 会以新的本地 id/client-turn id 复制到目标，并保留 `root_run_id` 与时间字段，供继承历史继续展示模型、完成时间、耗时和分叉资格；开口 receipt 不复制，也不表示目标发生过新的执行。复制失败时删除新 session，外键级联删除这些 receipt，因此不需要新表或消息缓存。普通“复制当前会话”保持独立，不记录分叉来源。

从完整助手回复创建分叉时，正文仍由 OpenClaw transcript fork 完成；JustDo 在新 `cowork_sessions` row 中记录来源本地会话、来源标题快照和所选助手回复的原生 entry id，并复制已结束 run 的显示 receipt，使继承回复仍可再次分叉。Plan 尚未发生实施 reset 时允许规划回复分叉；reset 后只允许实施 boundary 后的回复，不创建或查询 segment row。来源会话仍存在时，展示标题从来源 row 动态读取，因此重命名会立即反映；来源被删除后，self foreign key 通过 `ON DELETE SET NULL` 避免悬空引用，标题快照仍可用于不可点击的来源说明。Gateway 分叉失败、返回非预期 target key 或新会话 adoption 失败时，新产品 row 会被删除。最后一条用户消息修改/撤回只改变 OpenClaw 的 active transcript branch，不更新本 schema。

OpenClaw v2026.9.2 对接不再由 JustDo 直接读写 agent `sessions.json`。Gateway history、session model 与 task state 分别通过 `chat.history`、`sessions.patch`、`tasks.list/get` 获取；受限 history detail 由内置 runtime services RPC 投影。

若升级时检测到 legacy OpenClaw `sessions.json`，Gateway 启动会被 migration coordinator 阻止。migration receipt、manifest 和不含 workspace 的已验证备份保存在 OpenClaw state 的受管迁移目录，不进入 `justdo.sqlite` schema；只有原生 import、validate、inspect 和 integrity 全部成功才写完成 receipt。取消或失败不删除 legacy store，也不启动空 Gateway。

## 7. `cowork_session_runs`

| 列                                    | 语义                             |
| ------------------------------------- | -------------------------------- |
| `id`                                  | 本地 receipt id                  |
| `session_id`                          | 级联关联 session                 |
| `client_turn_id`                      | Renderer/Main 幂等键，UNIQUE     |
| `root_run_id`                         | Gateway 接受后绑定的真实 run id  |
| `model_ref`                           | 本 turn 模型快照                 |
| `state`                               | admission/accepted/terminal 状态 |
| `started_at`,`accepted_at`,`ended_at` | 各阶段 Unix ms                   |
| `created_at`,`updated_at`             | receipt 时间                     |

未受理的 running receipt 不能仅因 Gateway 暂时 idle 就结算，因为 `chat.send` 的 ACK 可能迟到或丢失。明确发送拒绝走失败结算；传输结果未知时保留 `client_turn_id`，用原生 `agent.wait` 查询对应 run 的终态。只有确认的 terminal result 或已确认的用户取消才能结束这类记录，查询超时和部分快照不构成完成证据。yielded 结果只将对应 receipt 转为已受理，随后仍按整个会话的活动与连续空闲确认结算；未知受理的取消意图必须保留到该请求被权威确认。断连不写业务 failed；异步恢复必须再次核对当前 receipt/run 身份，避免把旧响应写入后续运行。

`idx_cowork_session_runs_session_started` 支持时间线；partial unique `idx_cowork_session_runs_open` 保证每个 session 最多一个 `ended_at IS NULL` 的 receipt。Start 先查 client turn 实现幂等，Adapter 收到真实 run id 后 bind；终态填 ended_at。启动 `interruptOpenSessionRuns(now)` 把上一应用进程遗留的开口 receipt 记为零时长 `aborted` checkpoint，避免恢复期间误报运行且不把离线时间算入耗时；若 Gateway 随后确认该 session 仍有 active work，runtime reconciliation 会重新打开该 checkpoint（root run id 暂缺时也原位恢复）并从当前进程重新计时。首次对账前若用户提交新 turn，main 进程会强制刷新该 checkpoint 的 Gateway 状态：active 时恢复旧 receipt 并拒绝新建，unknown 时 fail closed，只有 confirmed idle 才创建新 receipt。

### 7.1 `cowork_plan_handoffs`

该表保存 Plan request、workspace artifact 的创建时 workspace root、相对路径、SHA-256、字节数、canonical session key、Gateway session/run identity，以及 `presented`、`dispatching`、`admitted`、`resolved`、`failed` 状态和阶段时间。artifact 位于 `<workspace>/.<productName lowercase>/plans/<sessionId>/<planId>.md`；产品名通过共享元数据派生。它不保存消息 transcript。每个产品会话最多有一个未终结 handoff；状态更新使用 expected-state CAS。Gateway 接受同一 session 上的实施 run 后，handoff 进入 `admitted`，使启动恢复能够识别发送前、发送后和已完成 handoff。

## 8. `cowork_config`

结构同 KV：key/value/updated_at，但 owner 是 Cowork/runtime domain。`CoworkStore.getConfig/setConfig` 对 execution mode、working directory、permission mode 等做默认与 normalize；其中 permission mode 只作为新会话默认值，当前会话使用 `cowork_sessions.permission_mode` 保存用户期望值，并在发送前与 Gateway 原生 session entry reconcile。`maxRetainedDisplayTabs` 只持久化 Renderer 后台侧栏 Tab 的内存上限（默认 30）；浏览器 webview 与终端实例在此上限内跨会话保持挂载，以保留网页交互状态、滚动位置和终端屏幕，LRU 淘汰时才卸载并释放资源。Cowork 视图在设置、计划任务、插件等应用内页面切换时仅隐藏，运行实例不会因此销毁；home → temp → canonical 的 owner promotion 也保持独立 runtime identity。Tab 和运行实例仍仅在当前应用进程内保留，重启后清空。版本化 runtime settings 通过 `agentRuntimeSettings:v1` 保存，外部 Agent 的启用状态与权限通过 `externalAgentSettings:v1` 保存。旧记录缺少 Agent 时限/并发、SubAgent 委派/归档、会话访问范围、AskUserQuestion、计划任务审批或 MCP 配置时补入对应默认值，历史通用命令审批字段会在规范化时丢弃，损坏或越界值按 shared contract 回退；外部 Agent 设置按构建时 catalog 补齐新增项并丢弃已移除项，adapter 命令和参数不进入用户数据。

修改配置的 IPC 使用 promise queue 串行。会影响 Gateway config 或启动环境的字段在成功写入后同步 OpenClaw；纯 permission 默认值变更不触发同步。会话访问范围生成 `tools.sessions.visibility`；Subagent 设置生成 `agents.defaults.subagents`；外部 Agent 设置生成原生 `acp` 与 `plugins.entries.acpx`，其中工具访问开关生成两个受管 MCP bridge 字段，并可将已启用的 stdio MCP Server 投影到 ACPX session bootstrap；HTTP/SSE Server 不进入当前 ACPX 投影。AskUserQuestion 等待时限生成该 extension 的 `timeoutMinutes`；计划任务审批时限生成 automation-permission 的 `approvalTimeoutMinutes`；全局 MCP 请求时限作为每个用户 `mcp.servers.<name>.timeout` 的默认值。AskUserQuestion pending 只保存在 extension 的 Gateway 进程内存中，不写入 JustDo SQLite；Main/Redux 也不维护 transcript 式副本。需同步的配置失败会恢复上一份数据库值；数据库保存成功不自动证明 Gateway config active。

## 9. `agents`

字段：id、name、description、system_prompt、identity、model、icon、skill_ids JSON、enabled、is_default、created/updated。启动确保 `main` agent 存在；若是首次迁移，可继承旧 `cowork_config.systemPrompt`。

空 model 可从默认 provider 回填；裸 model 仅在唯一 provider 匹配时升级为 qualified ref。默认/受管 agent 的删除和关键字段限制应由 store/handler 执行，不靠 UI。

## 10. `mcp_servers` 与 `openclaw_hooks`

MCP：id PK、唯一 name、description、enabled、transport_type（默认 stdio）、config_json、created/updated。`config_json.requestTimeoutSeconds` 是可选的单 Server 请求超时覆盖；缺失时继承全局默认。`config_json.openClawConfig` 保存从 OpenClaw 原生配置发现的完整 server 字段，使对话内安装的 MCP 回流数据库并跨重启保留，同时不丢失 JustDo 表单未建模的高级字段。Hook：id PK、enabled（默认 false）、config_json、created/updated。

两表保存产品配置，不等于 runtime 已应用。CRUD 后必须调用 config sync；sync 失败需向 UI 报告并允许恢复。config JSON可能含 environment/credential，禁止原样记录日志。

## 11. `session_groups`

字段：id、name、color（默认 `#6366f1`）、sort_order（默认 0）、created_at。GroupStore 提供 list/get/create/update/delete、moveSessionToGroup 和 reorder。

Reorder 应在 transaction 中更新所有传入 id；删除 group 时要明确 session 的 `group_id` 如何置空/处理。由于 `cowork_sessions` 建表文本在 group 之前，SQLite 允许引用后创建表；foreign keys 已开启。

## 12. `scheduled_task_run_receipts`

run_id PK；task id/name；`system_managed`；session id/key；status；summary/error；delivery status/error；started/finished/duration；observed/read/updated。`system_managed` 由同步时的 Gateway job management 投影，用于让系统任务保留运行证据但不制造收件箱未读。索引分别支持全局时间、task 时间和 partial unread。

Store 行为：

- upsert Gateway runs，保留已有 `read_at`；baseline 可把旧记录设为已读；
- list 用 `(started_at, run_id)` base64url cursor keyset 分页，默认 30、最大 100；
- unread 排除 running；markRead 首次时间用 `COALESCE`；
- baseline、per-task completed-through watermark、durable catch-up 存入 KV prefix；每次成功导入以及删除 receipt 前只允许单调推进 completed-through，避免删除最新结果后回扫旧历史；
- malformed cursor 抛 `Invalid result cursor`，IPC 转为稳定错误。

## 13. `scheduled_task_result_cleanup` 与 tombstone

run_id PK、`archived_paths_json`、updated_at。它不是结果内容表，而是删除 Gateway cron session/transcript/run artifacts 时的恢复记录。只有外部 artifacts 清理成功后才删除 receipt；失败保留两者，便于重试。

`scheduled_task_result_tombstones` 以 run_id 为主键记录已完成的用户删除。写 tombstone 与删除 receipt 在同一 transaction 内完成；后续启动同步或强制全局 reconcile 必须跳过 tombstoned run，防止 Gateway 的延迟 registry 写回使已删除结果复活。

## 14. 兼容与迁移

当前迁移机制是幂等建表、`ensureColumn` 和小型数据修正，没有独立版本表：

- 为 session 加 permission_mode/model_ref；
- 为 session run 加 accepted_at；
- 为早期未合入的 Multica session 映射补 `agent_id` 和 `openclaw_session_key`，已有 row 默认归属
  `main`，缺失的原生 key 在下一次合法恢复时按外部 identity 确定性补齐；
- 为 MCP 加 description；
- 为 scheduled task receipt 加 `system_managed`，并幂等建立删除 tombstone 表；
- 建立 main agent并继承旧 prompt；
- `container` execution mode -> `local`；
- 清 orphan messages；
- KV 空时导入旧 `config.json`。

另有 destructive legacy detection：若已有关键 cowork 表却缺少一组基础必需列，整个 DB/WAL/SHM 会被删除重建。新增列时必须谨慎更新 `REQUIRED_TABLE_COLUMNS`；误把可迁移 schema 判 legacy 会造成数据丢失。

## 15. 数据访问规则

- Renderer 只能通过 preload/IPC；不得打开数据库。
- Store 方法使用 prepared statements；动态 SQL仅允许由内部生成的固定 table/column。
- 多步不变量用 `better-sqlite3` transaction，例如 run、reorder、批量 upsert。
- JSON 边界要 parse/normalize并容忍坏值，不把 unchecked object带入 config sync。
- timestamp 内部用 Unix ms，IPC domain 通常转 ISO；游标必须稳定排序。
- 密钥可能存在配置中；数据库不应被当作可公开日志或随意附到 issue。

## 16. 备份、恢复与排障

正常备份：退出应用后复制 `justdo.sqlite`；如在线备份则用 SQLite backup/checkpoint 机制。排障先备份数据库、WAL、SHM，再运行只读 `PRAGMA integrity_check`/`table_info`。不要在应用运行时手工修改 row。

典型检查：表/列是否存在、foreign_keys 是否开启、WAL 是否堆积、open run partial unique 是否冲突、JSON parse warning、result catch-up key 是否损坏。原始数据库可能包含用户 prompt、路径和 credentials，分享前需脱敏。

## 17. Schema 变更清单

1. 明确权威/生命周期与现有用户兼容策略。
2. 添加幂等 schema/migration；破坏性操作必须有严格检测与备份策略。
3. 添加真实查询所需索引和 transaction。
4. 更新 store/IPC/shared types，处理旧 JSON/NULL/default。
5. 为全新、旧 schema、重复启动、失败中断和级联行为加测试。
6. 同步本文件及受影响架构文档。

## 18. 写入原子性边界

| 操作                           | 应保持的原子性                                       |
| ------------------------------ | ---------------------------------------------------- |
| Session create + 初始 metadata | row 必填字段一致，失败不留下不可打开 session         |
| Turn begin + root run receipt  | 幂等 client turn 与 open clock 同步建立              |
| Run terminal                   | terminal 状态、duration/clock 只结算一次             |
| Group reorder                  | 同一事务更新稳定顺序，避免重复/空洞造成 UI 抖动      |
| Result page upsert             | 同批 run 写入且保留已有 readAt                       |
| Result delete/cleanup          | 跨 Gateway 非数据库事务，用 cleanup table 做补偿记录 |

SQLite transaction 只能保护本数据库，不能回滚 Gateway、文件系统或子进程。跨边界操作要用 durable receipt、幂等 key 和补偿流程，不应让 transaction 长时间包住网络调用。

## 19. 并发与进程假设

当前 store 使用 `better-sqlite3` 同步 API并运行在 Electron Main；Renderer 和 Gateway 不直接打开该文件。WAL 改善读写，但不意味着支持多个 JustDo 实例任意写入；single-instance 与优雅关闭仍是产品约束。prepared statement/transaction 内避免异步等待，关闭时先停上游工作再 close database。

## 20. JSON 与枚举兼容

`kv`/配置字段中的 JSON 是长期数据接口。读取时应对缺字段、旧 enum、坏 JSON 和 `NULL` 设置安全默认；写入时使用当前 canonical shape。旧 model ref、旧 agent model 空值等通过读取归一/启动迁移处理，不要让 Renderer 同时支持多套旧 shape。Goal 不存入 JustDo SQLite；原生 `usage_limited` / `budget_limited` 是当前 Gateway 契约，必须原样投影，不能作为旧枚举折叠或迁移。

## 21. 数据保留与隐私

数据库可能包含 prompt、路径、provider/MCP 配置和任务摘要；Gateway state/history 与 plugin 目录则在数据库之外。所谓“删除用户数据”必须列出所有 owner，不能只删 SQLite row。日志导出/issue 附件不得默认包含数据库、WAL、SHM 或 raw config。

嵌入式浏览器从 Chromium 系浏览器导入的数据及本地浏览记录单独保存在 `<userData>/browser-import.sqlite`，不混入 `justdo.sqlite`：`imported_history` 保存有限 URL/标题/访问时间，`imported_passwords` 的密码列只保存 Electron `safeStorage` 密文，`browser_downloads` 保存下载文件名、脱敏来源、进度、状态、时间和 Main-only 文件路径，`browser_profiles` 保存 Tool 已创建的命名本地 profile。默认浏览与 Tool `importprofile` 的隔离 profile 分别使用 Chromium session store `persist:justdo-browser` 和 `persist:justdo-browser-imported`；其他合法名称映射到各自的 `persist:justdo-browser-profile-<name>`。设置页导入默认写入前者，Tool 导入默认写入后者，也可显式写入命名 profile。Renderer 不得读取密码密文、Cookie 或下载路径；下载的打开/定位操作只提交记录 ID，由 Main 校验完成状态和文件存在性后执行。删除下载记录不会删除磁盘文件。清除浏览数据时，Main 按时间删除上述 SQLite 记录，并通过 Electron session API 清除内置、导入及所有已持久化命名 profile partition 内的 Cookie、站点存储和缓存；后者不支持按时间过滤，产品界面必须披露其全量清除语义。

## 22. 测试证据

- `sqliteStore.test.ts` 覆盖 schema 初始化、兼容与 startup stale-state 处理。
- `coworkStore` 测试覆盖 session/run/clientTurn 幂等、查询和终态。
- `scheduledTaskResultStore.test.ts` 覆盖 baseline、upsert、read、pagination 和 cleanup。
- 各领域 store 测试需使用全新库和旧 schema fixture；只在空库通过不能证明升级安全。

## 23. Schema Definition of Done

提供幂等 DDL、旧用户迁移、真实查询索引、事务边界、坏值 fallback、备份/失败策略和测试。更新表数量/字段/权威文档，并验证重复启动与强制中断后可恢复。任何会触发 destructive legacy detection 的规则调整都必须单独审查其误判与数据丢失风险。
