/* 增量迁移:为 continuations 表加 last_approved_* / pending_draft_* 字段,
 * 用于「作者修改 → 进入待审核 → 期间原内容继续展示」语义。
 *
 * 字段语义:
 *   last_approved_*:
 *     保留上次通过时的主字段,作为「原内容」快照,详情页继续对外展示。
 *   pending_draft_*:
 *     作者最近一次编辑后还没通过的新内容;非空即「待审核修订」,
 *     主字段(status 仍是 approved)对外展示,详情页给「本条后续修订等待审核」提示。
 *
 * 运行方式(D1 控制台 / wrangler d1 execute):
 *   wrangler d1 execute mini-theater --file migrations/0004_continuation_revision_snapshot.sql
 *
 * 同样字段在 ensureContinuationsSchema 内有幂等兜底,
 * 本文件仅供老库一次性补齐用。
 */
ALTER TABLE continuations ADD COLUMN last_approved_nickname TEXT;
ALTER TABLE continuations ADD COLUMN last_approved_summary TEXT;
ALTER TABLE continuations ADD COLUMN last_approved_content TEXT;
ALTER TABLE continuations ADD COLUMN last_approved_at TEXT;
ALTER TABLE continuations ADD COLUMN pending_draft_nickname TEXT;
ALTER TABLE continuations ADD COLUMN pending_draft_summary TEXT;
ALTER TABLE continuations ADD COLUMN pending_draft_content TEXT;
ALTER TABLE continuations ADD COLUMN pending_draft_updated_at TEXT;
ALTER TABLE continuations ADD COLUMN deleted_at TEXT;
