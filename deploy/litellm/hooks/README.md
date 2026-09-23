# 新增 Hook

每种 Hook 一个目录，所有注册集中在根目录 `register.py`：

```text
litellm/
  start.py             # 启动与首次数据库初始化
  register.py          # 统一注册、加载和执行顺序
  hooks/
    jwt_auth/          # 强制 JWT 认证、默认组初始化
    model_headers/     # 强制校验模型请求账号与 Cookie 格式
    activity/          # 用户活动接口及存储
    example/           # 响应头示例，默认关闭
  tests/               # 所有测试
  docker/              # Docker 部署配置
  native/              # 普通机器部署配置
```

## 三步接入

1. 复制 `example/` 为 `my_hook/`，修改 `__init__.py` 中的 `wrap(app, environ)`。
2. 在 `register.py` 的 `HOOKS` 添加 `'my_hook': Hook('hooks.my_hook')`。
3. `.env` 设置 `LITELLM_HOOKS=activity,my_hook`，重新部署代码并重启服务。

工厂接收下游 ASGI 应用和环境配置，返回包装后的应用。复杂功能可像 `activity/`
一样在内部拆分请求处理、纯业务逻辑和存储，不向外暴露内部文件。
如需初始化数据库，实现 `async initialize(connection, environ)`；它只在显式执行
`start.py init` 时运行，必须可重复执行且不覆盖管理员数据，禁止在请求或工厂中执行 DDL。
所有 Hook 初始化共用入口管理的事务，Hook 不得自行 `BEGIN`、`COMMIT` 或 `ROLLBACK`。

## 执行规则

`HOOKS` 列出全部 Hook：`required=True` 始终启用；`enabled_by_default=True` 在未配置
`LITELLM_HOOKS` 时启用。`kind='auth'` 使用认证配置入口，其他模块使用 HTTP 中间件入口。
环境配置可以显式列出 `jwt_auth`，也可以省略；它都会启用且只执行一次。

- `LITELLM_HOOKS=a,b`：请求 `a → b → LiteLLM`，响应顺序相反。
- 只加载注册且启用的模块；未知名称、重复名称或无效工厂拒绝启动。
- 空值关闭可选 Hook；`jwt_auth` 和 `model_headers` 始终启用，不能通过此列表关闭。
- 未处理的 HTTP、WebSocket、lifespan 必须原样转发；流式响应逐条转发，不聚合。
- 独立接口必须自行认证。可复用 `hooks.jwt_auth.identity.authenticate_jwt(scope)` 获取
  JWT/Team 校验后的用户 ID；仍需实施端点权限、输入限制及必要的限流。
- 工厂不连接数据库；连接延迟创建，通过 lifespan 释放。禁止记录凭证和用户正文。

`example` 启用后添加 `X-Extension-Example: enabled` 响应头，不新增接口或绕过认证。
模型调用生命周期回调使用 LiteLLM `CustomLogger` 和 `litellm_settings.callbacks`，
不通过 HTTP Hook 解析模型流来实现。

从 `deploy/litellm` 运行 `python -m pytest -q tests`。新增 Hook 的测试也放 `tests/`，
至少覆盖启停、执行顺序、流式透传、WebSocket/lifespan、异常及权限边界。
依赖统一维护在根目录 `requirements.txt`。

校验错误共用 `hooks/errors.py` 的响应和日志机制，错误码见[校验与授权错误码](ERRORS.md)。
具体分类由各 Hook 自己维护，不直接返回底层异常字符串。
