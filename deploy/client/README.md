# 客户端换证配置

编辑 [builtinModelAuth.ts](../../src/config/builtinModelAuth.ts) 中的
`BUILTIN_MODEL_AUTH_CONFIG`，然后重启 Electron 开发进程或重新打包。

```ts
tokenExchangeUrl: 'https://你的组织服务地址/api/litellm/mtoken2jwt',
maxJwtLifetimeSeconds: 10800,
```

- `tokenExchangeUrl` 是 Jalor 完整换证地址，不是模型地址；空地址禁用换证。
- `maxJwtLifetimeSeconds` 为允许接受的 JWT 生命周期上限，整数 30–10800，默认 300。
  不改变服务端签发时长，LiteLLM 的 `LITELLM_JWT_MAX_LIFETIME_SECONDS` 也须匹配。
  有效期越长，被盗后的重放窗口越长。
- 禁止填写 mtoken、JWT、Cookie 或生产固定 Key。生产使用可信组织的 HTTPS 地址。

开发启动：`npm run electron:dev`。
Windows 打包：`npm run dist:win`。

## 仅 API Key 的开发验证

编辑 `src/config/builtinModelAuth.ts`：

```ts
developmentAuthMode: 'api-key',
developmentApiKey: '<development-only-key>',
```

然后运行 `npm run electron:dev`。该模式不执行 mtoken 换证，
使用 `Authorization: Bearer <key>`；Key 不写入 SQLite，也不传给 Renderer。
此开关只对未打包开发进程有效，打包版始终使用 JWT。修改后须重启 Electron；
提交或打包前改回 `developmentAuthMode: 'jwt'` 并清空 Key，打包钩子会拒绝其他配置。
