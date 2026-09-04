/* 续写数据访问层。
 *
 * 与 repos 平级的独立表 continuations,字段:
 *   id / play_id / nickname / visitor_id / summary / content / status /
 *   created_at / updated_at / reviewed_at / review_note
 *
 * nickname 字段在续写场景下可空字符串(表示「匿名 / 原作者本人续写」),
 * 后台列表里统一展示为「匿名」;详情页按 nickname 是否非空决定是否
 * 展示署名(空字符串就不显示)。
 *
 * 表结构在 migrations/0002_continuations.sql 里维护,这里通过
 * ensureContinuationsSchema 兜底:首次访问会 CREATE TABLE IF NOT EXISTS
 * + 建索引,老库上线后只要走过这条路径就会自动迁移。 */

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
       WHERE continuations.play_id = ? AND continuations.status = 'approved'
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
  const statement = status
    ? db
        .prepare(
          `${continuationSelect} WHERE continuations.status = ? ORDER BY continuations.created_at DESC`,
        )
        .bind(status)
    : db.prepare(`${continuationSelect} ORDER BY continuations.created_at DESC`);

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

/* 用户「修改」续写:原地覆盖 summary/content/nickname,
 * 状态重置为 pending 等待重新审核。
 *
 * 与 repo 的 updateRepoContent 不同,这里是用户自己发起(不需要管理员会话),
 * 状态必然回到 pending,因为相当于「重新投稿」。 */
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
  const newNickname = patch.nickname !== undefined ? patch.nickname.trim() : null;
  const newSummary = patch.summary !== undefined ? patch.summary.trim() : null;
  const newContent = patch.content !== undefined ? patch.content.trim() : null;

  if (newSummary !== null && newSummary.length === 0) {
    throw new Error('续写简介不能为空');
  }
  if (newContent !== null && newContent.length === 0) {
    throw new Error('续写正文不能为空');
  }

  const sets: string[] = [
    'status = ?',
    'reviewed_at = NULL',
    'review_note = NULL',
    'updated_at = ?',
  ];
  const binds: (string | number)[] = ['pending', timestamp];
  if (newNickname !== null) {
    sets.push('nickname = ?');
    binds.push(newNickname);
  }
  if (newSummary !== null) {
    sets.push('summary = ?');
    binds.push(newSummary);
  }
  if (newContent !== null) {
    sets.push('content = ?');
    binds.push(newContent);
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

  await db.batch([
    db
      .prepare(
        `UPDATE continuations
         SET status = ?, review_note = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(status, normalizedNote, timestamp, timestamp, continuationId),
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
    db.prepare(`DELETE FROM continuations WHERE id = ?`).bind(continuationId),
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
