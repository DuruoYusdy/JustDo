# 普通机器部署

需要 Python 3.11/3.12、PostgreSQL 和 Redis，不需要 Docker。部署完整目录，
下面以 Linux 的 `/opt/litellm` 为例。使用专用服务账号运行。

## 安装和配置

```sh
cd /opt/litellm/native
python3 install.py
cp .env.example .env
chmod 600 .env
```

已有配置不要覆盖。填写 `.env` 中的数据库、Redis、管理密钥、稳定加密盐和 JWT 参数。
它使用 dotenv 格式，不通过 Shell source 加载。复用旧库先备份并保留原盐。

安装脚本创建 `.venv`，安装固定版本依赖并生成 Prisma 客户端；可通过组织配置的软件源安装。
离线环境需预备 Python 包及匹配平台的 Prisma 引擎。数据库和 Redis 由组织提供或独立安装。

## 初始化和启动

```sh
.venv/bin/python start.py init
.venv/bin/python start.py
```

初始化成功后才启动。第一个命令执行 LiteLLM 版本化迁移并增加 EndUser metadata 列；
正常启动不修改表结构。Linux 也可执行 `bash start.sh init` 和 `bash start.sh`。

只有一个 LiteLLM 实例，默认监听 `127.0.0.1:9108`，接入现有 HTTPS 入口即可。
`LITELLM_PORT` 配置端口，`LITELLM_WORKERS` 配置 worker 数量。模型、旧 Key、JWT、
管理页面和活动接口共用此实例。创建分组和兼容旧 Key 见[公共 README](../README.md)。

Windows 使用 `py -3.12 install.py` 安装，再运行
`.venv\Scripts\python.exe start.py init` 和 `.venv\Scripts\python.exe start.py`。

## 可选 Linux 服务

创建专用的 `litellm` 系统账号，使其拥有部署目录和虚拟环境，核对
`litellm.service` 中的账号及路径。停止前台进程后：

```sh
sudo install -m 644 litellm.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now litellm
sudo systemctl status litellm
```

日志使用 `journalctl -u litellm` 查看。修改配置后重启该服务。
升级前备份数据库、停止服务，安装依赖并运行 `start.py init`，成功后重新启动。
禁止使用 `prisma db push --accept-data-loss`。认证适配固定支持 LiteLLM 1.99.1，
升级版本须先验证认证、数据库和模型请求。
