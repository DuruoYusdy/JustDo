# EndUser activity extension

只给已有 public."LiteLLM_EndUserTable" 增加一个可空 metadata JSONB 列。
不创建永久表或 Internal User，不改变 alias。手动执行shared/schema.sql，先备份数据库。
DDL锁等待限制3秒。运行账号需要SELECT和metadata列UPDATE权限。

## 部署

本版统一使用中性命名。若已部署早期版本，必须同步更新客户端与服务端，
按下文重新配置环境变量和 token；旧活动 JSON 数据不删除、不自动迁移，
新上报写入 `metadata.customer_activity`。仅替换客户端会导致旧服务无法接收上报。

Linux 服务器请选择一套方案，拷贝所选目录及同级 shared/，保持相对位置：

- [Docker 部署](docker/README.md)：Compose，hook 与 LiteLLM 同容器启动。
- [Native 部署](native/README.md)：Python 虚拟环境 + Shell 启动脚本，无需 systemd。

根目录只保留说明、测试脚本及 Git 配置。公共代码、依赖和 SQL 统一放在 shared/，不再保留重复副本。
复用现有数据库，只需首次手动加列。

docker/Dockerfile基于配置的现有镜像构建，安装asyncpg，替换ASGI入口。
入口为 proxy_app:create_app；Docker 挂载 proxy_app.py 和整个 proxy_hooks/ 目录。
配置环境变量：CONFIG_FILE_PATH（原LiteLLM YAML）、LITELLM_ACTIVITY_DATABASE_URL
（PostgreSQL URI）、LITELLM_ACTIVITY_TOKEN（至少32位随机ASCII密钥）。使用secret注入。
启动参数为 --host 0.0.0.0 --port 9108 --workers 2。

这不是callbacks配置项。所有普通HTTP、WebSocket及lifespan转交LiteLLM原应用。
原CLI参数需要转入YAML；镜像原entrypoint的迁移不会执行，升级需单独验证。
所有连接此库的LiteLLM实例应设置general_settings.disable_prisma_schema_update: true，
并检查原entrypoint中是否有额外迁移。禁止对带自定义列的库执行
prisma db push --accept-data-loss；升级应先用副本验证，防止额外列被删除。

## 上报

POST /customer/activity，Authorization: Bearer <LITELLM_ACTIVITY_TOKEN>。

```json
{"event_id":"822f78cc-bd26-4e13-a42a-b45060a330da","user_id":"existing-end-user-id","event_type":"startup","metadata":{"userName":"Alice","loginTime":"2026-09-22T09:00:00+08:00","productName":"Example","version":"1.0","clientTime":"2026-09-22T10:00:00+08:00"}}
```

用户必须已存在，否则404。startup表示启动，heartbeat表示持续运行，login只用于真实登录事件。
metadata只接收上述字符串字段，正文最多8KiB；不要发送Cookie或凭据。
每个事件一个UUID，重试复用；只保留最近256个事件ID去重，过期重试不保证去重。
重复事件仍更新接收日活跃状态、last_seen_at 和客户端时间，但不重复增加启动次数或登录事件时间。
200表示保存成功，503可退避重试。连接池每worker最多4连接，数据库操作有超时。
使用事务行锁合并metadata，保留其他顶层字段，防止并发丢失。

metadata.customer_activity保存最近90个有活动的UTC日期、每日启动数、首次/最后活动时间、
最后启动时间和最后登录上报时间。时间由数据库生成；客户端loginTime仅作为上报值。
离线补报按接收日统计；没有上报不能证明软件未启动。共享密钥无法证明user_id真实身份，
需要可信身份时接入现有用户JWT验证。生产入口应使用TLS和限流。

```sql
SELECT user_id, alias, metadata->'customer_activity' AS activity
FROM public."LiteLLM_EndUserTable" WHERE metadata->'customer_activity' IS NOT NULL;
```

原生Customer API和UI不会自动返回新增列。客户端在Customer同步成功后上报startup，
成功后每24小时上报heartbeat（每次重新启动仍上报startup）；失败保留事件ID，依次等待1、5、15分钟补试。
三次补试仍失败则等待24小时进入下一轮；成功即恢复24小时间隔。待重试事件不跨进程重启保留。
每次上报保留原始loginTime，并附带clientTime（发送时的客户端当前时间，UTC ISO格式）；数据库接收时间另存为last_seen_at。
原Customer metadata仍会被标准LiteLLM忽略，由活动接口保存。本扩展不自动建列。
部署时将活动令牌设为SHA256("customer/activity/v1:" + 客户端API key)，客户端同样派生；
这是兼容现有客户端凭据的方式，不会增加原密钥的强度，不应将摘要当作用户身份凭据。

## 测试

python -m unittest discover -s deploy/litellm -p 'test_*.py'

test_postgres.py在LITELLM_TEST_DATABASE_URL存在时使用连接级临时表验证真实SQL，
不修改实际EndUser表。服务器需先在其他端口预发布验证配置、模型请求和流式响应。

## 注册更多 hook

```text
litellm/
  shared/
    proxy_app.py           # 统一 ASGI 入口
    proxy_hooks/
      registry.py          # 注册表与执行顺序
      activity.py          # 活动上报
    requirements.txt
    schema.sql
  native/                  # Shell 启动、.env、配置
  docker/                  # Compose、Dockerfile、.env、配置
```

启动入口固定为 `proxy_app:create_app`。在 `shared/proxy_hooks/` 添加模块，
提供 `wrap(app, environ)` 返回 ASGI middleware，再在 registry.py 的 HOOK_FACTORIES 注册。
新增依赖写入 shared/requirements.txt，无需更改启动脚本或维护两份实现。

.env 的 LITELLM_HOOKS 控制启用项及顺序，默认 activity，显式空字符串关闭所有扩展。
请求从左到右进入，响应反向返回；未知名称或重复注册项使启动失败，不静默跳过鉴权。
例如未来实现并注册 JWT 后可设置 `LITELLM_HOOKS='jwt,activity'`，JWT 才会先于活动接口处理。
JWT 尚未实现，签名、受众及活动接口认证关系需在接入时确定。

middleware 必须转发未处理的 HTTP、WebSocket 和 lifespan；资源延迟创建，在 lifespan 结束时清理。
模块导入不得连接数据库或创建资源；每个启用的 hook 自行验证配置，不重复启动 LiteLLM。
修改共享代码后重启服务；依赖变更后 Native 重新安装依赖，Docker 重新构建镜像。
