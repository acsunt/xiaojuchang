/* 增量迁移:为已有线上 D1 数据库补 pending_edit_* 列。
 *
 * 应用场景:1.6 主题新增的「作者就地修改」流程依赖这些列,
 * 线上数据库若仍按旧 schema 运行,审核后台 reviewPlay / updateAdminPlay
 * 在写入时(没有该列)会触发 SQLite "no such column" 错误,
 * 并在 Cloudflare Pages 上以 HTML 错误页形式返回,前端展示为
 * 「接口返回了异常页面,请刷新后重试」。
 *
 * 运行方式(D1 控制台 / wrangler d1 execute):
 *   wrangler d1 execute mini-theater --file migrations/0001_pending_edit_columns.sql
 *
 * 文件内每条 ALTER 均为幂等,可用同一语句在任意库状态上重复运行。 */
ALTER TABLE plays ADD COLUMN pending_edit_title TEXT;
ALTER TABLE plays ADD COLUMN pending_edit_category TEXT;
ALTER TABLE plays ADD COLUMN pending_edit_summary TEXT;
ALTER TABLE plays ADD COLUMN pending_edit_content TEXT;
ALTER TABLE plays ADD COLUMN pending_edit_author_name TEXT;
ALTER TABLE plays ADD COLUMN pending_edit_submitted_at TEXT;