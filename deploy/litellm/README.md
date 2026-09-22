# LiteLLM JWT、Team 与旧版 30 天兼容

选择部署方式：

- [Docker 部署](docker/README.md)：Compose 管理 PostgreSQL、Redis 和单个 LiteLLM 服务。
- [普通机器部署](native/README.md)：Python 虚拟环境、独立基础服务及 systemd 模板。

两个目录共用本目录的 `custom_auth.py`、`provision_groups.py` 和分组模板。
环境变量使用 `LITELLM_JWT_*` 和 `LITELLM_DEFAULT_TEAM_ID`；旧前缀仍可读取，新名称优先。
现有部署应保留原 audience、Team ID、旧 Key alias 和数据库标记，避免改变既有授权及有效期。
请求头、内部计数标识和已有数据库字段保持协议兼容，不随部署名称变化。
活动上报与 Hook 注册表位于 `shared/`，两种部署均通过 `shared/proxy_app.py` 启动。
以下为两种部署方式通用的认证、分组和旧版兼容说明。

| 客户端      | 请求凭证                                | LiteLLM 授权主体                   | 有效期                         |
| ----------- | --------------------------------------- | ---------------------------------- | ------------------------------ |
| 新版客户端 | 登录服务签发的短期 JWT                  | 长期存在的 User + 唯一受管 Team | JWT 默认上限 5 分钟，可配置；Team 长期有效 |
| 未升级旧版  | 历史共享值注册成一枚 legacy Virtual Key | 专用 legacy Team                   | 30 天，禁止续期                |

Team 管理模型白名单、预算、禁用状态及 TPM/RPM 限制。
JWT 泄露后可在剩余有效期内被重放，应按需设置最短有效期。

## 部署结构

单个 LiteLLM 实例同时处理以下请求：

- 带 `X-JustDo-JWT` 或 JWT 形式 Bearer 的请求：校验 JWT 和 managed Team，失败直接拒绝。
- 普通 API Key、管理员密钥和管理页面会话：由 LiteLLM 原生认证校验。
- 活动请求：JWT 绑定当前 EndUser；可选的旧活动令牌只在配置期限内有效。

`shared/auth_dispatch.py` 在服务启动时连接 LiteLLM 1.99.1 的认证回调入口，
普通 Key 返回原生认证流程，JWT 异常不回退。所有模型请求仍经过 LiteLLM 的公共权限、
预算和限流检查。适配固定支持此版本，升级前须验证。

参考 LiteLLM 官方文档：[Custom Authentication](https://docs.litellm.ai/docs/proxy/custom_auth)、
[Virtual Keys](https://docs.litellm.ai/docs/proxy/virtual_keys)、
[Team Budgets](https://docs.litellm.ai/docs/proxy/team_budgets)、
[Model Access](https://docs.litellm.ai/docs/proxy/model_access)。

## 1. 登录服务签发 JWT

登录服务必须使用非对称算法签名并提供 HTTPS JWKS。默认只启用 `RS256`。每枚 JWT 必须
包含：

- `kid`：JWT header 中的签名公钥 ID；
- `iss`：与 `LITELLM_JWT_ISSUER` 完全一致；
- `aud`：包含 `LITELLM_JWT_AUDIENCE`；
- `sub`：LiteLLM `user_id`，并与 `X-User-Account` 一致；
- `iat`、`exp`：整数时间戳，生命周期不超过配置上限（默认 300 秒，可配置 30–10800 秒）；
- `jti`：每枚 token 唯一。

客户端换证地址及有效期上限见 [客户端配置](../client/README.md)。
客户端自动换证、续签；Hook 使用 JWKS 校验签名及上述字段。

## 2. 配置服务

按所选部署目录的 README 安装依赖、填写该目录的 .env 并启动服务。

服务必须使用稳定的 `LITELLM_SALT_KEY`，它用于数据库模型凭据加密，不能跟随
master key 随意轮换。复用旧数据库时，保留原 salt；旧服务未设置 salt 时，将旧 master key
作为 salt 保留，再单独更换管理 master key。不要打印这些值。全新数据库使用独立随机 salt。
若旧 master key 曾分发给客户端，这只是保持可解密的迁移措施，应另外安排数据库凭据重加密，
不能直接改 salt 后重启。

多个 worker 通过 Redis 共享用量和限流计数。上线前须验证 Redis 故障行为、数据库
连接池和上游模型容量，并按目标并发执行流式请求压测。

模型可继续通过 LiteLLM UI 配置。唯一的 `config.yaml` 加载 `custom_auth.py` 并开启：

```yaml
custom_auth_run_common_checks: true
```

不能删除该开关，否则自定义认证成功后不会执行 Team 的模型、预算和限流检查。

## 3. 创建 Team 和用户分组

### 首次认证自动入组

预先创建默认 Team，在所选目录的 `.env` 设置 `LITELLM_DEFAULT_TEAM_ID=standard`，
然后按该部署方式重启服务。空值关闭自动入组。默认组的 `users` 可以省略或为 `[]`，
但必须有明确模型列表和 `metadata.justdo_managed=true`，不能是 legacy 或 blocked 组。

新用户首次通过 JWT 校验后自动加入默认组，继承默认成员策略。

已有用户即使没有组也不自动回填默认组，防止覆盖管理员移组或撤权。新组同样需要
`justdo_managed=true`；移组时移除旧组再加入新组，中间无组阶段请求被拒绝。
封禁应保留用户记录并移除成员关系或放入 blocked 组，**不要通过删除用户记录封禁**：
仍持有效组织身份的已删除用户会被识别为新用户。

权限变更受 LiteLLM 授权缓存传播影响。模型列表变化后，客户端可手动刷新。

### 管理员预置和移组

推荐编辑 `groups.json`（可从 `groups.example.json` 复制）后运行幂等脚本：

```powershell
$env:LITELLM_MASTER_KEY = '<new-server-master-key>'
python .\provision_groups.py .\groups.json --base-url http://127.0.0.1:9108
```

脚本创建或更新 Team 和用户，将用户分配到唯一受管理组，不生成用户 Key。

一个用户不能同时出现在两个配置组中。Team 的 `models` 必须显式填写；可同时设置
`max_budget`、`budget_duration`、`tpm_limit`、`rpm_limit` 和 `blocked`。

也可在 LiteLLM UI 中完成同样操作：创建 Team、设置 Models/Budget/Limits，然后创建
Internal User 并添加为 Team member。使用 UI 时仍需把 Team metadata 标记为
`{"justdo_managed": true}`；Hook 只承认恰好一个此类非 legacy Team，避免模糊授权。

## 4. 旧版客户端只兼容 30 天

若历史客户端使用的固定值也是当前 `LITELLM_MASTER_KEY`，必须先生成新 master key、修改
`.env` 并重启服务。绝不能直接把 master key 当 legacy Key；否则它仍拥有管理权限。
旧值不能是三段 base64url 的 JWT 外形或等于 `justdo-jwt-auth`；这些凭证保留给 JWT 认证，避免歧义。

随后只在当前 PowerShell 进程中放入旧值：

```powershell
$env:LITELLM_MASTER_KEY = '<new-server-master-key>'
$env:LITELLM_LEGACY_KEY = '<exact-old-client-key>'
python .\provision_groups.py .\groups.json `
  --base-url http://127.0.0.1:9108 `
  --legacy-key-env LITELLM_LEGACY_KEY
Remove-Item Env:LITELLM_LEGACY_KEY
```

脚本把该值登记成 alias 为 `justdo-legacy-client` 的**唯一 legacy Virtual Key**，并强制：

- `allowed_routes=["llm_api_routes", "/models", "/v1/models"]`，只开放推理与客户端模型发现；
- 只继承 legacy Team 的模型列表；
- `duration=30d`。

第一次补迁移一个原先无过期时间的同 alias Key 时，脚本会加上 30 天期限；之后重复运行
不会延长已有期限。已经过期或过期时间超过迁移窗口时脚本直接拒绝。

旧 Key 若短于 16 字符，可在迁移时把 `MINIMUM_CUSTOM_KEY_LENGTH` 临时降到旧值长度，完成
后立刻恢复为 16 并重启。该设置不会改变现有 Key。

30 天后 LiteLLM 会自动拒绝过期 Key。确认旧版流量结束后再删除记录：

```powershell
$body = @{ key_aliases = @('justdo-legacy-client') } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9108/key/delete `
  -Headers @{ Authorization = "Bearer $env:LITELLM_MASTER_KEY" } `
  -ContentType 'application/json' -Body $body
```

然后可移除 `legacy_client` 配置，单个 LiteLLM 服务继续提供 JWT 和管理功能。

## 5. 验证

在安装 LiteLLM v1.99.1 及测试依赖的 Python 环境中运行：

```powershell
python -m pytest -q .
```

上线前至少验证：同一 Team 只能看到自己的模型；跨 Team 模型返回 403；blocked、预算和
RPM/TPM 生效；篡改签名、issuer、audience、`sub` 或账号 header 均返回 401/403；带无效
JWT 的请求不回退 legacy；旧 Key 到期后返回 401；任何日志中都不出现 JWT、Cookie、
Authorization 或 master key 明文。

## 6. EndUser 注册与活动记录

新版客户端使用同一短期 JWT 调用 `POST /customer/activity`，不调用 Customer 管理 API。
服务端先校验 JWT 和当前 managed Team，再要求正文 `user_id` 等于签名中的 `sub`。
首次调用原子创建 EndUser；已有记录保留预算、blocked 及其他 metadata，更新产品版本 alias 和活动信息。
被禁用的 Team 或 EndUser 不允许上报。模型权限仍由 LiteLLM 的公共授权检查执行。

请求正文示例：

```json
{"event_id":"822f78cc-bd26-4e13-a42a-b45060a330da","user_id":"alice","event_type":"startup","metadata":{"userName":"Alice","loginTime":"2026-09-22T09:00:00Z","productName":"Example","version":"1","clientTime":"2026-09-22T10:00:00Z"}}
```

首次成功后每 24 小时上报 heartbeat；失败按 1、5、15 分钟补试，再等待 24 小时。
重试复用事件 ID；保留最近 256 个 ID 去重及最近 90 个有活动的 UTC 日期。
数据库时间用于活动统计；客户端 loginTime 仅为声明值。正文最多 8 KiB，不接收 Cookie 或登录凭据。
开发环境 API Key 模式仅验证模型，不上报活动。

`LITELLM_ACTIVITY_DATABASE_URL` 是 asyncpg 使用的 PostgreSQL URI，必须与模型数据库一致，
不能带 Prisma 专有的 schema、connection_limit、pool_timeout 等参数；默认 schema 为 public。
初始化脚本执行 `shared/schema.sql` 增加可空 metadata JSONB 列。运行账号需要 SELECT、INSERT，
以及 metadata 和 alias 的 UPDATE 权限。行锁与事务保护并发写入。
原生 Customer API/UI 不自动展示新增列，可查询：

```sql
SELECT user_id, alias, metadata->'customer_activity' AS activity
FROM public."LiteLLM_EndUserTable";
```

旧版活动兼容可选：`LITELLM_ACTIVITY_TOKEN` 设置为旧 Key 的
`SHA256("customer/activity/v1:" + oldKey)`，并设置带时区的绝对截止时间
`LITELLM_ACTIVITY_LEGACY_EXPIRES_AT`（例如 `2026-10-22T00:00:00Z`），不得晚于旧模型 Key 到期时间。
默认留空即拒绝旧活动上报；不会影响旧模型 Key 的调用。旧活动令牌不能证明用户身份，
也不能创建 EndUser，且到期后拒绝上报。新版 JWT 请求失败不会回退到此令牌。

## 7. 注册更多 Hook

在 `shared/proxy_hooks/` 添加模块，提供 `wrap(app, environ)`，然后在
`registry.py` 的 `HOOK_FACTORIES` 注册。`LITELLM_HOOKS=activity` 默认开启活动扩展；
显式空字符串关闭活动扩展。列表从左到右接收请求，未知名称或重复项拒绝启动。
模型 JWT 认证独立配置在 `config.yaml` 的 `custom_auth` 中，关闭活动 Hook 不会关闭模型认证。

中间件必须转发未处理的 HTTP、WebSocket 和 lifespan，导入时不连接数据库，关闭时释放资源。
公共依赖维护在 `shared/requirements.txt`。真实 SQL 测试通过 `LITELLM_TEST_DATABASE_URL`
连接测试数据库并使用临时表；未配置时跳过。千级并发、生产登录服务及数据库升级需在预发布环境验证。
