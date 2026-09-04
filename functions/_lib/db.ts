// db.ts 作为拆分后各领域模块的统一转发入口，保持 functions/api/** 下现有的
// `from '../../_lib/db'` 导入路径不变，避免大范围改动路由文件的 import。
//
// 实际实现按领域拆分在：
// - plays.ts：小剧场的增删改查、审核、批量审核、备份恢复
// - repos.ts：repo 评论的增删改查、审核、审核日志
// - continuations.ts：续写的增删改查、审核、审核日志（与 repos 平级但独立表）
// - tags.ts：标签词表的增删改查、重排
// - site-settings.ts：站点外观配置
// - sessions.ts：管理员会话（登录 / 登出 / 校验）
export * from './plays';
export * from './repos';
export * from './continuations';
export * from './tags';
export * from './site-settings';
export * from './sessions';
