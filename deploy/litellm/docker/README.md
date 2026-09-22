# Linux Docker 部署

上传本目录及同级 `shared/` 目录，保留两者的相对位置。
本方案只部署 LiteLLM，不创建数据库，不替换现有数据库或数据卷。

## 首次配置

1. 备份现有 Compose、LiteLLM YAML、环境变量文件和数据库；保留旧镜像以便回滚。
2. 进入本目录，执行以下命令，再编辑新文件。不要直接用示例覆盖已有配置。

```bash
cp .env.example .env
chmod 600 .env
cp /path/to/existing/config.yaml ./config.yaml
```

`.env` 中指定原服务已验证的镜像版本或 digest；示例版本不是最新版承诺。
`.env` 填写现有数据库 URI、密钥及所有原服务需要的环境变量。
活动 URI 使用 asyncpg，不能含 Prisma 的 schema、connection_limit、pool_timeout 等参数；启动时会校验。
默认目标为 public；其他 schema 必须同步调整 SQL 安装目标及 PostgreSQL search_path，不能盲删参数。
密码中的 URI 特殊字符需要 URL 编码。数据库地址必须能从容器访问，不能用 localhost
指向宿主机数据库；如使用现有 Docker 网络，请在 compose.yaml 中配置 external 网络。

在原 config.yaml 的 `general_settings` 中合并 `disable_prisma_schema_update: true`，
不要覆盖模型配置或重复创建该节点。所有共用此库的 LiteLLM 实例均需禁用自动 schema 同步。
本入口绕过镜像原 entrypoint；它原有的迁移、证书等初始化需要逐项审查。
依赖在单独构建阶段以 root 安装，最终镜像继承所选原镜像的运行用户，不强制提权。
原镜像若本身使用 root，仍需按其要求另行配置非 root 用户及目录权限。

活动 token 必须匹配桌面客户端使用的 API key，不能随意生成。安全交互计算（不把密钥写入命令历史）：

```bash
python3 -c 'import getpass,hashlib; print(hashlib.sha256(("customer/activity/v1:"+getpass.getpass("Client API key: ")).encode()).hexdigest())'
```

将结果填入 LITELLM_ACTIVITY_TOKEN，按密钥保护。摘要不提高原密钥强度。
备份数据库后，用有 ALTER 权限的账号一次性执行 `../shared/schema.sql`：

```bash
# 使用 ~/.pg_service.conf 与权限为 0600 的 ~/.pgpass 配置连接，避免命令行暴露密码。
psql 'service=litellm-admin' -v ON_ERROR_STOP=1 -f ../shared/schema.sql
docker compose config --quiet
docker compose build
```

已有 EndUser 表是前提；这不是空数据库初始化方案。脚本只增加可空 metadata JSONB 列，
不新增永久表。运行账号需要表 SELECT 和 metadata 列 UPDATE 权限。

## 启动与维护

先在副本/其他端口验证，然后停止旧 LiteLLM 服务释放端口（不要停止或删除数据库），再启动：

```bash
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:9108/health/liveliness
docker compose logs --tail 100 litellm
```

hook 与 LiteLLM 在同一服务启动，无需额外进程；Docker daemon 开机启动后自动恢复该服务。
默认只监听宿主机回环地址，请通过现有 HTTPS 反向代理提供外部访问，支持流式响应和 WebSocket。
验证原模型调用、流式响应和活动落库后再切流；liveliness 不是数据库写入健康检查。

修改 hook 后 `docker compose restart litellm`；修改环境或 Compose 后 `docker compose up -d`；
升级镜像/依赖后 `docker compose build --pull && docker compose up -d`。
升级必须先验证数据库副本，禁止 `prisma db push --accept-data-loss` 删除自定义列。
回滚时停止这套 LiteLLM，恢复旧配置和旧服务，保留 metadata 列及数据库数据。
不要执行带 `-v` 的 down，也不要同时让新旧服务占用同一端口。

## 注册更多 hook

参见 [统一扩展说明](../README.md#注册更多-hook)。只需维护 shared/ 中的一份代码。
