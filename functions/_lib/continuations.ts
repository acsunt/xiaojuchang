/* 续写数据访问层。
 *
 * 与 repos 平级的独立表 continuations,字段:
 *   id / play_id / nickname / visitor_id / summary / content / status /
 *   created_at / updated_at / reviewed_at / review_note /
 *   last_approved_nickname / last_approved_summary / last_approved_content /
 *   last_approved_at / deleted_at
 *
 * nickname 字段在续写场景下可空字符串(表示「匿名 / 原作者本人续写」),
 * 后台列表里统一展示为「匿名」;详情页按 nickname 是否非空决定是否
 * 展示署名(空字符串就不显示)。
 *
 * 「作者修改-进入待审核」语义:
 *   原本已经通过审核的续写被原作者再次修改后,我们不直接抹掉已通过的内容,
 *   而是把当前主字段快照到 last_approved_*,主字段再写入新内容,
 *   状态置回 pending。这样:
 *     - 详情页继续展示旧版(last_approved_*)给读者,
 *       并通过 _displayStatus='pending' 提示「本条后续修订等待审核」。
 *     - 等管理员 approve,主字段升级为新内容(此时 last_approved_* 同步为新版)。
 *     - 等管理员 reject,主字段回到 last_approved_*,状态变为 rejected,
 *       详情页仍然展示旧版(原已通过内容),不被删除。
 *
 * 表结构在 migrations/0002_continuations.sql 里维护,这里通过
 * ensureContinuationsSchema 兜底:首次访问会 CREATE TABLE IF NOT EXISTS
 * + 加新列(幂等)+ 建索引,老库上线后只要走过这条路径就会自动迁移。 */

import {
  makeId,
  normalizeContinuation,
  normalizeContinuationAuditLog,
  now,
  type ContinuationRecord,
  type ContinuationReviewAction,
  type ContinuationStatus,
} from './http';
import { chunkItems, D1_SELECT_CHUNK_SIZE } from './db-utils';

type ContinuationDraft = {
  playId: string;
  nickname: string;
  visitorId: string;
  summary: string;
  content: string;
};

export const ensureContinuationsSchema = async (db: D1Database) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS continuations (
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
      )`,
    )
    .run();

  /* 兼容老库:给历史表加 last_approved_* / pending_draft_* 字段。
   *
   * 这些字段承载「作者修改 → 待审核 → 期间原内容继续展示」的语义:
   * - last_approved_*:保留上次通过时的主字段,作为兜底快照;
   * - pending_draft_*:作者最近一次修改后还没通过的新内容;
   *   只要它非空就表示「有待审核修订」,详情页继续展示主字段
   *   (status 仍是 approved),并用 _displayStatus 把状态透出给前端。
   *
   * SQLite 的 ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS,
   * 因此这里 catch 「duplicate column name」异常后忽略,
   * 保证幂等。 */
  const snapshotColumns: Array<{ name: string; ddl: string }> = [
    {
      name: 'last_approved_nickname',
      ddl: 'ALTER TABLE continuations ADD COLUMN last_approved_nickname TEXT',
    },
    {
      name: 'last_approved_summary',
      ddl: 'ALTER TABLE continuations ADD COLUMN last_approved_summary TEXT',
    },
    {
      name: 'last_approved_content',
      ddl: 'ALTER TABLE continuations ADD COLUMN last_approved_content TEXT',
    },
    { name: 'last_approved_at', ddl: 'ALTER TABLE continuations ADD COLUMN last_approved_at TEXT' },
    {
      name: 'pending_draft_nickname',
      ddl: 'ALTER TABLE continuations ADD COLUMN pending_draft_nickname TEXT',
    },
    {
      name: 'pending_draft_summary',
      ddl: 'ALTER TABLE continuations ADD COLUMN pending_draft_summary TEXT',
    },
    {
      name: 'pending_draft_content',
      ddl: 'ALTER TABLE continuations ADD COLUMN pending_draft_content TEXT',
    },
    {
      name: 'pending_draft_updated_at',
      ddl: 'ALTER TABLE continuations ADD COLUMN pending_draft_updated_at TEXT',
    },
    { name: 'deleted_at', ddl: 'ALTER TABLE continuations ADD COLUMN deleted_at TEXT' },
  ];

  for (const column of snapshotColumns) {
    try {
      await db.prepare(column.ddl).run();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (!/duplicate column name/i.test(message)) {
        throw reason;
      }
    }
  }

  await db.batch([
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_continuations_play_status_created_at
       ON continuations(play_id, status, created_at DESC)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_continuations_visitor_created_at
       ON continuations(visitor_id, created_at DESC)`,
    ),
  ]);
};

const ensureContinuationReviewLogsSchema = async (db: D1Database) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS continuation_review_logs (
        id TEXT PRIMARY KEY,
        continuation_id TEXT NOT NULL,
        play_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'delete', 'edit')),
        operator TEXT NOT NULL,
        note TEXT NOT NULL,
        nickname TEXT,
        play_title TEXT,
        created_at TEXT NOT NULL
      )`,
    )
    .run();

  await db.batch([
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_continuation_review_logs_created_at
       ON continuation_review_logs(created_at DESC)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_continuation_review_logs_continuation_id
       ON continuation_review_logs(continuation_id, created_at DESC)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_continuation_review_logs_play_id
       ON continuation_review_logs(play_id, created_at DESC)`,
    ),
  ]);
};

const continuationSelect = `SELECT continuations.*,
       plays.title AS play_title,
       plays.author_name AS play_author_name
       FROM continuations
       JOIN plays ON plays.id = continuations.play_id`;

export const listApprovedContinuationsByPlayId = async (
  db: D1Database,
  playId: string,
  order: 'asc' | 'desc' = 'asc',
) => {
  await ensureContinuationsSchema(db);
  const result = await db
    .prepare(
      `${continuationSelect}
       WHERE continuations.play_id = ?
         AND continuations.deleted_at IS NULL
         AND (
           continuations.status = 'approved'
           OR (continuations.last_approved_content IS NOT NULL
               AND continuations.last_approved_content != '')
         )
       ORDER BY continuations.created_at ${order === 'desc' ? 'DESC' : 'ASC'}`,
    )
    .bind(playId)
    .all<Record<string, unknown>>();

  return result.results.map(normalizeContinuation);
};

export const listMyContinuations = async (
  db: D1Database,
  visitorId: string,
  order: 'asc' | 'desc' = 'desc',
) => {
  await ensureContinuationsSchema(db);
  const result = await db
    .prepare(
      `${continuationSelect}
       WHERE continuations.visitor_id = ?
       ORDER BY continuations.created_at ${order === 'desc' ? 'DESC' : 'ASC'}`,
    )
    .bind(visitorId)
    .all<Record<string, unknown>>();

  return result.results.map(normalizeContinuation);
};

export const listAdminContinuations = async (db: D1Database, status?: ContinuationStatus) => {
  await ensureContinuationsSchema(db);
  /* 管理员需要看到「待审核修订」:这些行主字段仍可能是 approved,
   * 但 pending_draft_* 已经有值。等管理员通过 / 拒绝 draft,
   * 状态字段才真正落到 approved / rejected。
   *
   * 因此 status='pending' 同时要包含:
   * - 真正 status='pending' 的行(新投稿)
   * - status='approved' 但 pending_draft_content 非空的行(作者编辑的修订)
   *
   * 其它状态过滤照旧。 */
  let statement;
  if (status === 'pending') {
    statement = db.prepare(
      `${continuationSelect}
       WHERE continuations.deleted_at IS NULL
         AND (
           continuations.status = 'pending'
           OR (continuations.status = 'approved'
               AND continuations.pending_draft_content IS NOT NULL
               AND continuations.pending_draft_content != '')
         )
       ORDER BY continuations.updated_at DESC`,
    );
  } else if (status) {
    statement = db
      .prepare(
        `${continuationSelect}
         WHERE continuations.status = ? AND continuations.deleted_at IS NULL
         ORDER BY continuations.updated_at DESC`,
      )
      .bind(status);
  } else {
    statement = db.prepare(
      `${continuationSelect}
       WHERE continuations.deleted_at IS NULL
       ORDER BY continuations.updated_at DESC`,
    );
  }

  const result = await statement.all<Record<string, unknown>>();
  return result.results.map(normalizeContinuation);
};

/* 按 play_id 列表统计已通过续写数量,前端广场卡片徽章用。 */
export const listContinuationCountsByPlayIds = async (db: D1Database, playIds: string[]) => {
  await ensureContinuationsSchema(db);
  const normalizedIds = Array.from(new Set(playIds.map((id) => id.trim()).filter(Boolean)));
  if (normalizedIds.length === 0) {
    return [] as Array<{
      playId: string;
      count: number;
      firstCreatedAt?: string;
      lastCreatedAt?: string;
    }>;
  }

  const summaryMap = new Map<
    string,
    { count: number; firstCreatedAt?: string; lastCreatedAt?: string }
  >();
  for (const idChunk of chunkItems(normalizedIds, D1_SELECT_CHUNK_SIZE)) {
    const placeholders = idChunk.map(() => '?').join(', ');
    const result = await db
      .prepare(
        `SELECT play_id,
                COUNT(*) AS count,
                MIN(created_at) AS first_created_at,
                MAX(created_at) AS last_created_at
         FROM continuations
         WHERE status = 'approved' AND play_id IN (${placeholders})
         GROUP BY play_id`,
      )
      .bind(...idChunk)
      .all<Record<string, unknown>>();

    result.results.forEach((row) => {
      summaryMap.set(String(row.play_id), {
        count: Number(row.count ?? 0),
        firstCreatedAt: row.first_created_at ? String(row.first_created_at) : undefined,
        lastCreatedAt: row.last_created_at ? String(row.last_created_at) : undefined,
      });
    });
  }

  return normalizedIds.map((playId) => {
    const summary = summaryMap.get(playId);
    return {
      playId,
      count: summary?.count ?? 0,
      firstCreatedAt: summary?.firstCreatedAt,
      lastCreatedAt: summary?.lastCreatedAt,
    };
  });
};

export const createContinuation = async (db: D1Database, draft: ContinuationDraft) => {
  await ensureContinuationsSchema(db);
  const timestamp = now();
  const id = makeId('cont');

  await db
    .prepare(
      `INSERT INTO continuations (id, play_id, nickname, visitor_id, summary, content, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      id,
      draft.playId.trim(),
      draft.nickname.trim(),
      draft.visitorId.trim(),
      draft.summary.trim(),
      draft.content.trim(),
      timestamp,
      timestamp,
    )
    .run();

  const row = await db
    .prepare(`${continuationSelect} WHERE continuations.id = ? LIMIT 1`)
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new Error('续写写入后读取失败');
  }

  return normalizeContinuation(row);
};

/* 用户「修改」续写：保留原 approved 状态与原内容(主字段不动),
 * 把新内容写入 pending_draft_* 字段,等管理员通过再覆盖主字段;
 * 拒绝 / 删除 draft 时主字段保持不变,详情页继续展示原内容。
 *
 * 与之前版本区别:之前会把 status 重置为 pending,导致详情页
 * (只查 status='approved') 看不到这条记录,主字段被新内容覆盖。
 * 这里是真实业务 bug,本次修复保留原展示内容不动。 */
export const updateContinuationByAuthor = async (
  db: D1Database,
  continuationId: string,
  visitorId: string,
  patch: { nickname?: string; summary?: string; content?: string },
) => {
  await ensureContinuationsSchema(db);
  const current = await db
    .prepare(`${continuationSelect} WHERE continuations.id = ? LIMIT 1`)
    .bind(continuationId)
    .first<Record<string, unknown>>();
  if (!current) {
    return null;
  }

  const normalized = normalizeContinuation(current);
  if (normalized.visitorId !== visitorId.trim()) {
    throw new Error('只有原作者才能修改这条续写');
  }

  const timestamp = now();
  const draftNickname = patch.nickname !== undefined ? patch.nickname.trim() : null;
  const draftSummary = patch.summary !== undefined ? patch.summary.trim() : null;
  const draftContent = patch.content !== undefined ? patch.content.trim() : null;

  if (draftSummary !== null && draftSummary.length === 0) {
    throw new Error('续写简介不能为空');
  }
  if (draftContent !== null && draftContent.length === 0) {
    throw new Error('续写正文不能为空');
  }

  /* 把当前主字段备份到 last_approved_*:
   * - 已 approved 的行,last_approved_* 是已有快照的来源,继续保留即可;
   * - pending/rejected 但已有历史通过版本的行,继续保留旧快照;
   * - 从未通过过、用户再次修改的情况,把当前内容也存为旧版快照,
   *   避免 reviewContinuation 通过时丢失原始数据(虽然这条路径
   *   通常不会发生,因为未通过的行不会进入详情页)。
   */
  const wasApproved = normalized.status === 'approved';
  const newLastApprovedNickname = wasApproved
    ? normalized.nickname
    : (normalized.lastApprovedNickname ?? null);
  const newLastApprovedSummary = wasApproved
    ? normalized.summary
    : (normalized.lastApprovedSummary ?? null);
  const newLastApprovedContent = wasApproved
    ? normalized.content
    : (normalized.lastApprovedContent ?? null);
  const newLastApprovedAt = wasApproved
    ? (normalized.reviewedAt ?? timestamp)
    : (normalized.lastApprovedAt ?? null);

  const sets: string[] = [
    'updated_at = ?',
    /* 关键:status 不变。approved 仍显示主字段;
     * 前端通过 _displayStatus='pending' 知道有未发布修订。 */
    'last_approved_nickname = ?',
    'last_approved_summary = ?',
    'last_approved_content = ?',
    'last_approved_at = ?',
  ];
  const binds: (string | number | null)[] = [
    timestamp,
    newLastApprovedNickname,
    newLastApprovedSummary,
    newLastApprovedContent,
    newLastApprovedAt,
  ];

  if (draftNickname !== null) {
    sets.push('pending_draft_nickname = ?');
    binds.push(draftNickname);
  }
  if (draftSummary !== null) {
    sets.push('pending_draft_summary = ?');
    binds.push(draftSummary);
  }
  if (draftContent !== null) {
    sets.push('pending_draft_content = ?');
    binds.push(draftContent);
  }
  /* pending_draft_updated_at 在任意 patch 命中时刷新,前端用来显示
   * 「本条后续修订等待审核」时给出更新时间。 */
  if (draftNickname !== null || draftSummary !== null || draftContent !== null) {
    sets.push('pending_draft_updated_at = ?');
    binds.push(timestamp);
  }

  binds.push(continuationId);

  await db
    .prepare(`UPDATE continuations SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  const row = await db
    .prepare(`${continuationSelect} WHERE continuations.id = ? LIMIT 1`)
    .bind(continuationId)
    .first<Record<string, unknown>>();
  return row ? normalizeContinuation(row) : null;
};

export const getContinuationById = async (db: D1Database, continuationId: string) => {
  await ensureContinuationsSchema(db);
  const row = await db
    .prepare(`${continuationSelect} WHERE continuations.id = ? LIMIT 1`)
    .bind(continuationId)
    .first<Record<string, unknown>>();
  return row ? normalizeContinuation(row) : null;
};

export const reviewContinuation = async (
  db: D1Database,
  continuationId: string,
  action: ContinuationReviewAction,
  note: string,
  operator: string,
) => {
  await ensureContinuationsSchema(db);
  await ensureContinuationReviewLogsSchema(db);
  const current = await db
    .prepare(`${continuationSelect} WHERE continuations.id = ? LIMIT 1`)
    .bind(continuationId)
    .first<Record<string, unknown>>();
  if (!current) {
    return null;
  }

  const normalized = normalizeContinuation(current);
  const timestamp = now();
  const status: ContinuationStatus = action === 'approve' ? 'approved' : 'rejected';
  const normalizedNote = note.trim() || '无备注';

  /* 通过时:把 pending_draft_* 拷到主字段(如果有),并清空 draft 字段;
   * 拒绝时:仅清空 draft,主字段保持原状(仍是上次通过的版本),
   * 这样详情页的「原内容继续展示」语义不会因为拒绝而被覆盖。 */
  const hasDraft =
    (normalized.pendingDraftContent ?? '').trim().length > 0 ||
    (normalized.pendingDraftSummary ?? '').trim().length > 0 ||
    (normalized.pendingDraftNickname ?? '').trim().length > 0;

  const newNickname =
    action === 'approve' && hasDraft
      ? (normalized.pendingDraftNickname ?? normalized.nickname)
      : normalized.nickname;
  const newSummary =
    action === 'approve' && hasDraft
      ? (normalized.pendingDraftSummary ?? normalized.summary)
      : normalized.summary;
  const newContent =
    action === 'approve' && hasDraft
      ? (normalized.pendingDraftContent ?? normalized.content)
      : normalized.content;

  /* 旧版快照语义:只在有 draft 且 approve 时更新,因为 draft 通过后
   * 就是新的最新版,旧版是它被替换之前的内容(=原主字段)。 */
  const newLastApprovedNickname =
    action === 'approve' && hasDraft
      ? normalized.nickname
      : (normalized.lastApprovedNickname ?? null);
  const newLastApprovedSummary =
    action === 'approve' && hasDraft
      ? normalized.summary
      : (normalized.lastApprovedSummary ?? null);
  const newLastApprovedContent =
    action === 'approve' && hasDraft
      ? normalized.content
      : (normalized.lastApprovedContent ?? null);
  const newLastApprovedAt =
    action === 'approve' && hasDraft ? timestamp : (normalized.lastApprovedAt ?? null);

  await db.batch([
    db
      .prepare(
        `UPDATE continuations
         SET status = ?,
             review_note = ?,
             reviewed_at = ?,
             updated_at = ?,
             nickname = ?,
             summary = ?,
             content = ?,
             last_approved_nickname = ?,
             last_approved_summary = ?,
             last_approved_content = ?,
             last_approved_at = ?,
             pending_draft_nickname = NULL,
             pending_draft_summary = NULL,
             pending_draft_content = NULL,
             pending_draft_updated_at = NULL
         WHERE id = ?`,
      )
      .bind(
        status,
        normalizedNote,
        timestamp,
        timestamp,
        newNickname,
        newSummary,
        newContent,
        newLastApprovedNickname,
        newLastApprovedSummary,
        newLastApprovedContent,
        newLastApprovedAt,
        continuationId,
      ),
    db
      .prepare(
        `INSERT INTO continuation_review_logs (id, continuation_id, play_id, action, operator, note, nickname, play_title, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        makeId('cont_review'),
        normalized.id,
        normalized.playId,
        action,
        operator,
        normalizedNote,
        normalized.nickname || null,
        normalized.playTitle ?? null,
        timestamp,
      ),
  ]);

  const row = await db
    .prepare(`${continuationSelect} WHERE continuations.id = ? LIMIT 1`)
    .bind(continuationId)
    .first<Record<string, unknown>>();
  return row ? normalizeContinuation(row) : null;
};

export const updateContinuationByAdmin = async (
  db: D1Database,
  continuationId: string,
  patch: { content?: string; summary?: string; note?: string; nickname?: string },
  operator: string,
) => {
  await ensureContinuationsSchema(db);
  await ensureContinuationReviewLogsSchema(db);
  const current = await db
    .prepare(`${continuationSelect} WHERE continuations.id = ? LIMIT 1`)
    .bind(continuationId)
    .first<Record<string, unknown>>();
  if (!current) {
    return null;
  }

  const normalized = normalizeContinuation(current);
  const timestamp = now();
  const newContent = patch.content !== undefined ? patch.content.trim() : null;
  const newSummary = patch.summary !== undefined ? patch.summary.trim() : null;
  const newNickname = patch.nickname !== undefined ? patch.nickname.trim() : null;
  const newNote = patch.note !== undefined ? patch.note.trim() : null;

  if (newContent !== null && newContent.length === 0) {
    throw new Error('续写正文不能为空');
  }
  if (newSummary !== null && newSummary.length === 0) {
    throw new Error('续写简介不能为空');
  }

  const sets: string[] = ['updated_at = ?'];
  const binds: (string | number)[] = [timestamp];
  if (newContent !== null) {
    sets.push('content = ?');
    binds.push(newContent);
  }
  if (newSummary !== null) {
    sets.push('summary = ?');
    binds.push(newSummary);
  }
  if (newNickname !== null) {
    sets.push('nickname = ?');
    binds.push(newNickname);
  }
  if (newNote !== null) {
    sets.push('review_note = ?');
    binds.push(newNote);
  }
  binds.push(continuationId);

  await db
    .prepare(`UPDATE continuations SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  await db
    .prepare(
      `INSERT INTO continuation_review_logs (id, continuation_id, play_id, action, operator, note, nickname, play_title, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      makeId('cont_review'),
      normalized.id,
      normalized.playId,
      'edit',
      operator,
      newNote ?? normalized.reviewNote ?? '',
      normalized.nickname || null,
      normalized.playTitle ?? null,
      timestamp,
    )
    .run();

  const row = await db
    .prepare(`${continuationSelect} WHERE continuations.id = ? LIMIT 1`)
    .bind(continuationId)
    .first<Record<string, unknown>>();
  return row ? normalizeContinuation(row) : null;
};

export const deleteContinuation = async (
  db: D1Database,
  continuationId: string,
  operator: string,
) => {
  await ensureContinuationsSchema(db);
  await ensureContinuationReviewLogsSchema(db);
  const current = await db
    .prepare(`${continuationSelect} WHERE continuations.id = ? LIMIT 1`)
    .bind(continuationId)
    .first<Record<string, unknown>>();
  if (!current) {
    return false;
  }

  const normalized = normalizeContinuation(current);
  const timestamp = now();

  await db.batch([
    db
      .prepare(
        `INSERT INTO continuation_review_logs (id, continuation_id, play_id, action, operator, note, nickname, play_title, created_at)
         VALUES (?, ?, ?, 'delete', ?, ?, ?, ?, ?)`,
      )
      .bind(
        makeId('cont_review'),
        normalized.id,
        normalized.playId,
        operator,
        '后台删除续写',
        normalized.nickname || null,
        normalized.playTitle ?? null,
        timestamp,
      ),
    /* 软删除:写 deleted_at 时间戳,listApprovedContinuationsByPlayId
     * 已经过滤 deleted_at IS NULL,游客侧详情页会立即消失;
     * 管理员后台通过 getContinuationById / getAdminContinuations
     * 仍可访问,用于审核追溯。 */
    db
      .prepare(`UPDATE continuations SET deleted_at = ?, updated_at = ? WHERE id = ?`)
      .bind(timestamp, timestamp, continuationId),
  ]);

  return true;
};

export const listAllContinuationAuditLogs = async (db: D1Database) => {
  await ensureContinuationReviewLogsSchema(db);
  const result = await db
    .prepare(`SELECT * FROM continuation_review_logs ORDER BY created_at DESC`)
    .all<Record<string, unknown>>();

  return result.results.map(normalizeContinuationAuditLog);
};

/* 「我收到的」续写:针对一组 play_id 中
 *  visitor_id 不是我自己的 approved / rejected 续写。
 *
 * 与 repos 的 listReceivedRepos 不同,这里不需要 root/parent 概念,
 * 因为续写是扁平结构(不嵌套)。语义上跟 repos 保持一致:用于个人首页
 * 的「我收到的」统计。 */
export const listReceivedContinuations = async (
  db: D1Database,
  playIds: string[],
  visitorId: string,
  order: 'asc' | 'desc' = 'desc',
) => {
  await ensureContinuationsSchema(db);
  const normalizedPlayIds = Array.from(new Set(playIds.map((id) => id.trim()).filter(Boolean)));
  const normalizedVisitorId = visitorId.trim();

  if (normalizedPlayIds.length === 0) {
    return [] as ContinuationRecord[];
  }

  const merged = new Map<string, ContinuationRecord>();
  for (const idChunk of chunkItems(normalizedPlayIds, D1_SELECT_CHUNK_SIZE - 1)) {
    const placeholders = idChunk.map(() => '?').join(', ');
    const result = await db
      .prepare(
        `${continuationSelect}
         WHERE continuations.status IN ('approved', 'rejected')
           AND continuations.play_id IN (${placeholders})
           AND continuations.visitor_id != ?
         ORDER BY continuations.created_at ${order === 'desc' ? 'DESC' : 'ASC'}`,
      )
      .bind(...idChunk, normalizedVisitorId || '__anonymous__')
      .all<Record<string, unknown>>();

    result.results.forEach((row) => {
      const item = normalizeContinuation(row);
      merged.set(item.id, item);
    });
  }

  return [...merged.values()].sort((left, right) =>
    order === 'desc'
      ? right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
      : left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(left.id),
  );
};
