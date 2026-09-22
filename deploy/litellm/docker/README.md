# Docker 部署

部署完整的 `deploy/litellm` 目录，在本目录执行命令。Compose 只启动一个 LiteLLM 服务，
以及 PostgreSQL、Redis；模型、管理页面和活动接口使用同一端口。

1. 复制 `.env.example` 为 `.env`，填写数据库、Redis、JWT、管理密钥及稳定加密盐。
2. 复用旧库时先备份，保留原盐及数据卷名称；配置说明见[公共 README](../README.md)。
3. 构建并初始化，任一步失败时停止操作：

```sh
docker compose config --quiet
docker compose build
docker compose up -d --wait db redis
docker compose run --rm --no-deps --entrypoint python litellm /opt/litellm-hooks/init_database.py
docker compose up -d
docker compose ps
docker compose logs --tail 100 litellm
```

入口为 `http://服务器地址:9108`，端口通过 `LITELLM_PORT` 配置；生产环境接入现有 HTTPS 入口。
新部署的项目名为 `litellm`。已有部署须保持原 `LITELLM_DEPLOYMENT_NAME`，不要用新示例覆盖旧配置；
旧配置未设置该项时沿用历史项目名，以继续使用原数据卷。
多个 worker 服务于同一个 LiteLLM 实例，不区分新旧认证服务。
在管理页面配置模型，再按公共 README 创建默认 Team 和迁移旧 Key。

初始化执行版本化迁移并增加 EndUser metadata 列，正常启动禁用自动 schema 同步。
升级前备份数据库，保持原项目名，执行 `docker compose down --remove-orphans`（不带 `-v`），
清理旧服务及其端口占用，保留数据卷；再按上述步骤构建、初始化和启动。禁止使用
`prisma db push --accept-data-loss`。镜像固定为 LiteLLM 1.99.1，认证适配拒绝未经验证的版本。

修改 Python Hook 后重新构建镜像；修改环境后执行 `docker compose up -d --force-recreate`。
停止服务使用 `docker compose down`，不要加 `-v`，以免删除数据库和 Redis 数据卷。
