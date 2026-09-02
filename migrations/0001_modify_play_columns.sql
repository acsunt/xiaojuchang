/* 增量迁移:为已有线上 D1 数据库补 submission_type / parent_play_id 列,
 * 同时保留旧的 pending_edit_* 列以便回滚。
 *
 * 应用场景:1.6 主题把「作者就地修改」从「就地写 pending_edit_* 列」
 * 改为「创建新的待审核 modification play 记录」,以便 admin 后台能在
 * 待审核列表里看到它并走标准审核流程。新方案依赖 submission_type 与
 * parent_play_id 两列。
 *
 * 运行方式(D1 控制台 / wrangler d1 execute):
 *   wrangler d1 execute mini-theater --file migrations/0001_modify_play_columns.sql
 *
 * 文件内每条 ALTER 均为幂等,可在任意库状态上重复运行。 */
ALTER TABLE plays ADD COLUMN submission_type TEXT NOT NULL DEFAULT 'original';
ALTER TABLE plays ADD COLUMN parent_play_id TEXT REFERENCES plays(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_plays_parent_play_id ON plays(parent_play_id);
