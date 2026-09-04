/* 增量迁移:新增 continuations 表(续写独立审核池)。
 *
 * 应用场景:1.7 主题把「衍生」从 plays 表里的 submission_type='derived'
 * 抽出来,改造成与 repos 平行的独立 continuations 表。
 *
 * 续写与 repos 的差异:
 * - 续写必填 summary,repos 不需要
 * - 续写的 nickname 可空(空字符串视为「匿名」,详情页不展示),
 *   repos 的 nickname 必填
 * - 续写与 repos 各自走自己的审核池,统计/通知独立计数
 *
 * 运行方式(D1 控制台 / wrangler d1 execute):
 *   wrangler d1 execute mini-theater --file migrations/0002_continuations.sql
 *
 * 文件内每条 DDL 均为幂等,可在任意库状态上重复运行。
 *
 * 上线顺序建议:
 *   1. 应用本迁移文件创建 continuations 表
 *   2. 部署新版代码(前端隐藏「上传衍生」入口,后台不再展示
 *      submission_type='derived' 徽章,但代码仍可读旧数据)
 *   3. 应用 migrations/0003_drop_old_derived.sql 删掉旧衍生数据
 *   4. (可选)后续 ALTER 删除 plays.submission_type 与
 *      plays.parent_play_id,简化数据模型 */
CREATE TABLE IF NOT EXISTS continuations (
  id TEXT PRIMARY KEY,
  play_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  review_note TEXT,
  FOREIGN KEY (play_id) REFERENCES plays(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_continuations_play_status_created_at
  ON continuations(play_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_continuations_visitor_created_at
  ON continuations(visitor_id, created_at DESC);
