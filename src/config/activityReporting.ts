/** 活动上报部署开关；修改后重启开发进程或重新打包。 */
export const ACTIVITY_REPORTING_CONFIG: Readonly<{ enabled: boolean }> = Object.freeze({
  // false 禁用启动、每日心跳和失败重试；不影响 JWT 认证或模型请求。
  enabled: true,
});
