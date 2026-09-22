# Linux Native 部署（Shell 脚本）

上传本目录及同级 `shared/` 目录，保留两者的相对位置。需要 Bash、Python 3.11+（同时满足所选 LiteLLM 版本要求）、
venv/pip、PostgreSQL 客户端，以及已有 LiteLLM 数据库。无需 Docker，不新增数据库或永久表。
无需 systemd。以下首次安装从本目录开始，建议使用专用非 root 用户。已有路径先备份，不能直接覆盖。

## 安装与配置

先备份原启动服务、配置、环境文件及数据库，记录当前 LiteLLM 精确版本。
使用独立虚拟环境，不升级原生产环境；版本必须与原服务已验证版本一致。

```bash
python3 -m venv .venv
# 替换为当前实际版本；安装前核对该版本的 Python 支持与系统依赖。
.venv/bin/pip install 'litellm[proxy]==1.99.1' -r ../shared/requirements.txt
cp /path/to/existing/config.yaml ./config.yaml
cp .env.example .env
chmod 600 config.yaml .env
```

编辑 `.env`，填写数据库、原服务所有必要环境变量和活动 token。
默认使用脚本同目录 `.venv/bin/python` 和 `config.yaml`；可通过 LITELLM_PYTHON、CONFIG_FILE_PATH 设置其他绝对路径。
token 的计算与桌面客户端一致（输入客户端 API key，不一定是 master key）：

```bash
python3 -c 'import getpass,hashlib; print(hashlib.sha256(("customer/activity/v1:"+getpass.getpass("Client API key: ")).encode()).hexdigest())'
```

把输出填入 LITELLM_ACTIVITY_TOKEN，按密钥保护。密码的 URI 特殊字符需 URL 编码。
活动数据库 URI 由 asyncpg 使用，不接受 Prisma 的 schema、connection_limit、pool_timeout 等参数，
检测到这些参数会直接阻止启动且不输出连接凭据。不能直接复制带此类参数的 DATABASE_URL。
默认使用 public；若原库位于其他 schema，须调整 SQL 安装目标并显式配置 PostgreSQL search_path，不能仅删除 schema 参数。
.env 由 Bash source 执行，只能使用管理员可信文件；字符串用单引号包裹，包含单引号时按 Bash 语法转义。
合并 config.yaml 中 `general_settings.disable_prisma_schema_update: true`，保留模型等原配置。
所有共用此库的实例均需禁用自动 schema 同步；此入口不运行原 LiteLLM CLI/镜像迁移。

在数据库备份完成后，一次性加列：

```bash
# 通过 ~/.pg_service.conf 和 0600 权限的 ~/.pgpass 配置管理员连接。
psql 'service=litellm-admin' -v ON_ERROR_STOP=1 -f ../shared/schema.sql
```

运行账号需要 EndUser 表 SELECT 和 metadata 列 UPDATE 权限。
LiteLLM 的 Prisma Python 客户端应按该精确版本原部署流程预生成；如启动报客户端未生成，
在此虚拟环境按该版本 schema 执行 `prisma generate`（仅生成客户端，不是 db push），
并确保运行用户能读取生成文件。不要以数据库重建或 accept-data-loss 解决启动错误。

## 服务启动

先在副本和其他端口预发布，验证模型请求、流式响应和活动写库。
停止原 LiteLLM 进程，避免端口冲突，然后启动：

```bash
bash start.sh
```

脚本同时加载 LiteLLM 与 hook，前台运行，Ctrl+C 停止。可从任意目录执行脚本的绝对路径。
可用 `LITELLM_ENV_FILE=/absolute/path/.env bash start.sh` 指定其他环境文件。
退出 SSH 后仍需运行时：

```bash
umask 077
nohup bash start.sh >> litellm.log 2>&1 &
echo $! # 记录本次启动 PID
curl --fail http://127.0.0.1:9108/health/liveliness
```

脚本通过 exec 交接给 uvicorn，PID 对应其主进程。用 `kill -TERM <确认属于本服务的PID>` 停止，
等待退出后再启动；不要重复启动或仅凭陈旧 PID 杀进程。
nohup 不提供崩溃重启、开机启动或日志轮转。长期运行可让已有进程管理器托管同一脚本并配置日志轮转。
默认回环监听，通过现有 HTTPS 反向代理暴露服务，代理需支持流式响应和 WebSocket。
liveliness 不代表活动数据库写入已验证。日志可能含原 LiteLLM 的敏感内容，不要公开原始日志。

修改 hook、YAML 或环境变量后，停止进程再运行启动脚本。
升级时保留旧虚拟环境、配置和数据库备份，先在副本验证新版本及迁移，禁止自动删除自定义列。
回滚：停止此脚本启动的进程，恢复旧配置和启动方式；不删除 metadata 列或数据。

## 注册更多 hook

参见 [统一扩展说明](../README.md#注册更多-hook)。只需维护 shared/ 中的一份代码。
