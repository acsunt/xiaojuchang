import {
  makeId,
  normalizePlay,
  normalizeReviewLog,
  now,
  validPlayStatuses,
  type PlayStatus,
  type ReviewAction,
} from './http';
import {
  chunkItems,
  D1_BACKUP_INSERT_CHUNK_SIZE,
  D1_BULK_REVIEW_PLAY_CHUNK_SIZE,
  D1_SELECT_CHUNK_SIZE,
} from './db-utils';
import { ensureTagByName } from './tags';

type PlayDraft = {
  title: string;
  authorName: string;
  category: string;
  summary: string;
  content: string;
};

type ReviewPlayDraft = {
  title?: string;
  authorName?: string;
  category?: string;
  summary?: string;
  content?: string;
};

type AdminPlayEditDraft = ReviewPlayDraft;

type BackupPlayDraft = {
  id: string;
  title: string;
  authorName: string;
  category: string;
  summary: string;
  content: string;
  status: PlayStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewNote?: string;
};

const ensurePlay = async (db: D1Database, id: string) => {
  const play = await getAdminPlayById(db, id);
  if (!play) {
    throw new Error('内容写入后读取失败');
  }

  return play;
};

export const normalizeImportedSummary = (value: string) => {
  const normalized = value.trim();
  return normalized === '导入数据' || normalized === '无简介' ? '' : normalized;
};

const normalizeBackupTimestamp = (value: string, fallback: string) => {
  const normalized = value.trim();
  return normalized && !Number.isNaN(Date.parse(normalized)) ? normalized : fallback;
};

const normalizeBackupPlayDraft = (draft: BackupPlayDraft): BackupPlayDraft => {
  const timestampFallback = now();
  const createdAt = normalizeBackupTimestamp(String(draft.createdAt ?? ''), timestampFallback);
  const updatedAt = normalizeBackupTimestamp(String(draft.updatedAt ?? ''), createdAt);
  const normalizedStatus = parsePlayStatus(String(draft.status ?? '').trim()) ?? 'pending';
  const reviewedAt = String(draft.reviewedAt ?? '').trim();
  const reviewNote = String(draft.reviewNote ?? '').trim();

  return {
    // 备份缺少 id 时容错生成新 id，而非拒绝整体导入。
    id: String(draft.id ?? '').trim() || makeId('play'),
    title: String(draft.title ?? '').trim(),
    authorName: String(draft.authorName ?? '').trim(),
    category: String(draft.category ?? '').trim() || '未分类',
    summary: normalizeImportedSummary(String(draft.summary ?? '')),
    content: String(draft.content ?? ''),
    status: normalizedStatus,
    createdAt,
    updatedAt,
    reviewedAt:
      normalizedStatus === 'pending'
        ? undefined
        : reviewedAt
          ? normalizeBackupTimestamp(reviewedAt, updatedAt)
          : updatedAt,
    reviewNote: normalizedStatus === 'pending' ? undefined : reviewNote || undefined,
  };
};

export const listPublicPlays = async (db: D1Database) => {
  const result = await db
    .prepare(
      `SELECT * FROM plays
       WHERE status = 'approved'
       ORDER BY updated_at DESC`,
    )
    .all<Record<string, unknown>>();

  return result.results.map(normalizePlay);
};

export const getPublicPlayById = async (db: D1Database, id: string) => {
  const row = await db
    .prepare(
      `SELECT * FROM plays
       WHERE id = ? AND status = 'approved'
       LIMIT 1`,
    )
    .bind(id)
    .first<Record<string, unknown>>();

  return row ? normalizePlay(row) : null;
};

export const listSubmissionFeedbackByIds = async (db: D1Database, ids: string[]) => {
  const normalizedIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean))).slice(
    0,
    60,
  );
  if (normalizedIds.length === 0) {
    return [] as Array<{
      playId: string;
      status: PlayStatus;
      reviewNote: string;
      reviewedAt?: string;
      updatedAt: string;
      latestTitle: string;
      latestAuthorName: string;
      latestCategory: string;
      latestSummary: string;
      latestContent: string;
    }>;
  }

  const placeholders = normalizedIds.map(() => '?').join(', ');
  const result = await db
    .prepare(
      `SELECT id, status, title, author_name, category, summary, content, review_note, reviewed_at, updated_at
       FROM plays
       WHERE id IN (${placeholders})`,
    )
    .bind(...normalizedIds)
    .all<Record<string, unknown>>();

  const foundMap = new Map(result.results.map((row) => [String(row.id), row]));

  return normalizedIds.map((id) => {
    const row = foundMap.get(id);
    if (!row) {
      return {
        playId: id,
        status: 'missing' as const,
        reviewNote: '该投稿已被删除',
        reviewedAt: undefined,
        updatedAt: '',
        latestTitle: '',
        latestAuthorName: '',
        latestCategory: '',
        latestSummary: '',
        latestContent: '',
      };
    }

    return {
      playId: String(row.id),
      status: String(row.status) as PlayStatus,
      reviewNote: row.review_note ? String(row.review_note) : '',
      reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined,
      updatedAt: String(row.updated_at),
      latestTitle: String(row.title),
      latestAuthorName: String(row.author_name),
      latestCategory: String(row.category),
      latestSummary: String(row.summary),
      latestContent: String(row.content),
    };
  });
};

export const createPlay = async (db: D1Database, draft: PlayDraft) => {
  const id = makeId('play');
  const timestamp = now();

  await db
    .prepare(
      `INSERT INTO plays (
        id, title, author_name, category, summary, content, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      id,
      draft.title,
      draft.authorName,
      draft.category,
      draft.summary,
      draft.content,
      timestamp,
      timestamp,
    )
    .run();

  return ensurePlay(db, id);
};

export const listAdminPlays = async (db: D1Database, status?: PlayStatus) => {
  const statement = status
    ? db
        .prepare(
          `SELECT * FROM plays
         WHERE status = ?
         ORDER BY updated_at DESC`,
        )
        .bind(status)
    : db.prepare(
        `SELECT * FROM plays
         ORDER BY updated_at DESC`,
      );

  const result = await statement.all<Record<string, unknown>>();
  return result.results.map(normalizePlay);
};

export const getAdminPlayById = async (db: D1Database, id: string) => {
  const row = await db
    .prepare(
      `SELECT * FROM plays
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<Record<string, unknown>>();

  return row ? normalizePlay(row) : null;
};

export const parsePlayStatus = (value?: string | null): PlayStatus | undefined => {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  return validPlayStatuses.includes(normalized as PlayStatus)
    ? (normalized as PlayStatus)
    : undefined;
};

export const listReviewLogs = async (db: D1Database, playId: string) => {
  const result = await db
    .prepare(
      `SELECT review_logs.*, plays.title AS play_title
       FROM review_logs
       LEFT JOIN plays ON plays.id = review_logs.play_id
       WHERE review_logs.play_id = ?
       ORDER BY review_logs.created_at DESC`,
    )
    .bind(playId)
    .all<Record<string, unknown>>();

  return result.results.map(normalizeReviewLog);
};

export const listAllReviewLogs = async (db: D1Database) => {
  const result = await db
    .prepare(
      `SELECT review_logs.*, plays.title AS play_title
       FROM review_logs
       LEFT JOIN plays ON plays.id = review_logs.play_id
       ORDER BY review_logs.created_at DESC`,
    )
    .all<Record<string, unknown>>();

  return result.results.map(normalizeReviewLog);
};

export const deletePlay = async (db: D1Database, playId: string) => {
  const currentPlay = await getAdminPlayById(db, playId);
  if (!currentPlay) {
    return false;
  }

  await db.batch([
    db.prepare(`DELETE FROM review_logs WHERE play_id = ?`).bind(playId),
    db.prepare(`DELETE FROM plays WHERE id = ?`).bind(playId),
  ]);

  return true;
};

export const clearReviewLogs = async (db: D1Database, playId: string) => {
  const currentPlay = await getAdminPlayById(db, playId);
  if (!currentPlay) {
    return false;
  }

  await db.prepare(`DELETE FROM review_logs WHERE play_id = ?`).bind(playId).run();
  return true;
};

export const updateAdminPlay = async (
  db: D1Database,
  playId: string,
  draft: AdminPlayEditDraft,
) => {
  const currentPlay = await getAdminPlayById(db, playId);
  if (!currentPlay) {
    return null;
  }

  const nextTitle = String(draft.title ?? currentPlay.title).trim();
  const nextAuthorName = String(draft.authorName ?? currentPlay.authorName).trim();
  const nextCategory =
    String(draft.category ?? currentPlay.category).trim() || currentPlay.category;
  const nextSummary = normalizeImportedSummary(String(draft.summary ?? currentPlay.summary));
  const nextContent = String(draft.content ?? currentPlay.content).trim();

  if (!nextTitle) {
    throw new Error('标题不能为空');
  }

  if (!nextAuthorName) {
    throw new Error('署名不能为空');
  }

  if (!nextContent) {
    throw new Error('正文不能为空');
  }

  await ensureTagByName(db, nextCategory);

  const timestamp = now();
  /* 同系列跟随:把同 (author_name + title + category) 旧键下所有作品的 title/category
   * 一起改写,updatedAt 同步刷新。审核通过或后台直接编辑都共用此逻辑。 */
  await db
    .prepare(
      `UPDATE plays
       SET title = ?, author_name = ?, category = ?, summary = ?, content = ?, updated_at = ?,
           pending_edit_title = NULL, pending_edit_category = NULL,
           pending_edit_summary = NULL, pending_edit_content = NULL,
           pending_edit_author_name = NULL, pending_edit_submitted_at = NULL
       WHERE id = ?`,
    )
    .bind(nextTitle, nextAuthorName, nextCategory, nextSummary, nextContent, timestamp, playId)
    .run();

  if (currentPlay.title !== nextTitle || currentPlay.category !== nextCategory) {
    await db
      .prepare(
        `UPDATE plays
         SET title = ?, category = ?, updated_at = ?
         WHERE author_name = ? AND title = ? AND category = ? AND id <> ?`,
      )
      .bind(
        nextTitle,
        nextCategory,
        timestamp,
        currentPlay.authorName,
        currentPlay.title,
        currentPlay.category,
        playId,
      )
      .run();
  }

  return ensurePlay(db, playId);
};

/* 作者「修改」投稿:把改动写入原 play 的 pending_edit_* 列,不创建新 play。 */
export const submitPlayEdit = async (
  db: D1Database,
  playId: string,
  draft: { title: string; category: string; summary: string; content: string; authorName: string },
) => {
  const currentPlay = await getAdminPlayById(db, playId);
  if (!currentPlay) {
    throw new Error('内容不存在');
  }
  const nextTitle = draft.title.trim();
  const nextAuthorName = draft.authorName.trim();
  const nextCategory = draft.category.trim() || currentPlay.category;
  const nextSummary = normalizeImportedSummary(draft.summary);
  const nextContent = draft.content.trim();
  if (!nextTitle) throw new Error('标题不能为空');
  if (!nextAuthorName) throw new Error('署名不能为空');
  if (!nextContent) throw new Error('正文不能为空');
  await ensureTagByName(db, nextCategory);
  const timestamp = now();
  await db
    .prepare(
      `UPDATE plays
       SET pending_edit_title = ?, pending_edit_category = ?, pending_edit_summary = ?,
           pending_edit_content = ?, pending_edit_author_name = ?, pending_edit_submitted_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      nextTitle,
      nextCategory,
      nextSummary,
      nextContent,
      nextAuthorName,
      timestamp,
      timestamp,
      playId,
    )
    .run();
  return ensurePlay(db, playId);
};

export const clearPendingEdit = async (db: D1Database, playId: string) => {
  const currentPlay = await getAdminPlayById(db, playId);
  if (!currentPlay) {
    return null;
  }
  if (!currentPlay.pendingEdit) {
    return currentPlay;
  }
  const timestamp = now();
  await db
    .prepare(
      `UPDATE plays
       SET pending_edit_title = NULL, pending_edit_category = NULL,
           pending_edit_summary = NULL, pending_edit_content = NULL,
           pending_edit_author_name = NULL, pending_edit_submitted_at = NULL,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(timestamp, playId)
    .run();
  return ensurePlay(db, playId);
};

export const getPendingEditPlays = async (db: D1Database) => {
  const result = await db
    .prepare(
      `SELECT * FROM plays
       WHERE pending_edit_submitted_at IS NOT NULL
       ORDER BY pending_edit_submitted_at DESC`,
    )
    .all<Record<string, unknown>>();
  return result.results.map(normalizePlay);
};

export const restoreBackupPlays = async (db: D1Database, plays: BackupPlayDraft[]) => {
  const normalizedPlays = plays.map(normalizeBackupPlayDraft);
  const seenIds = new Set<string>();

  for (const play of normalizedPlays) {
    if (seenIds.has(play.id)) {
      throw new Error('备份里存在重复 id，请检查压缩包内容');
    }

    if (!play.title || !play.authorName || !play.content.trim()) {
      throw new Error('备份里存在标题、署名或正文为空的内容');
    }

    seenIds.add(play.id);
  }

  await db.prepare(`DELETE FROM review_logs`).run();
  await db.prepare(`DELETE FROM plays`).run();

  for (const playChunk of chunkItems(normalizedPlays, D1_BACKUP_INSERT_CHUNK_SIZE)) {
    await db.batch(
      playChunk.map((play) =>
        db
          .prepare(
            `INSERT INTO plays (
              id, title, author_name, category, summary, content, status, created_at, updated_at, reviewed_at, review_note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            play.id,
            play.title,
            play.authorName,
            play.category,
            play.summary,
            play.content,
            play.status,
            play.createdAt,
            play.updatedAt,
            play.reviewedAt ?? null,
            play.reviewNote ?? null,
          ),
      ),
    );
  }

  return { restoredCount: normalizedPlays.length };
};

export const reviewPlay = async (
  db: D1Database,
  input: {
    playId: string;
    action: ReviewAction;
    note: string;
    operator: string;
    edit?: ReviewPlayDraft;
  },
) => {
  const currentPlay = await getAdminPlayById(db, input.playId);
  if (!currentPlay) {
    return null;
  }

  const mappedStatus: PlayStatus =
    input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'offline';
  const timestamp = now();
  const reviewNote = input.note || '无备注';
  /* 「修改」投稿:author 走 pendingEdit 路径(无 inline edit 时);
   * admin inline edit 优先。 */
  const pendingEdit = !input.edit && currentPlay.pendingEdit ? currentPlay.pendingEdit : null;
  const nextTitle = String(input.edit?.title ?? pendingEdit?.title ?? currentPlay.title).trim();
  const nextAuthorName = String(
    input.edit?.authorName ?? pendingEdit?.authorName ?? currentPlay.authorName,
  ).trim();
  const nextCategory =
    String(input.edit?.category ?? pendingEdit?.category ?? currentPlay.category).trim() ||
    currentPlay.category;
  const nextSummary = normalizeImportedSummary(
    String(input.edit?.summary ?? pendingEdit?.summary ?? currentPlay.summary),
  );
  const nextContent = String(
    input.edit?.content ?? pendingEdit?.content ?? currentPlay.content,
  ).trim();

  if (!nextTitle) {
    throw new Error('标题不能为空');
  }

  if (!nextAuthorName) {
    throw new Error('署名不能为空');
  }

  if (!nextContent) {
    throw new Error('正文不能为空');
  }

  await ensureTagByName(db, nextCategory);

  /* 一次性更新当前 play + 同系列下其他作品(title/category 跟随),
   * 并清空 pendingEdit(任何 action 都会清)。 */
  const stmts = [
    db
      .prepare(
        `UPDATE plays
         SET title = ?, author_name = ?, category = ?, summary = ?, content = ?,
             status = ?, review_note = ?, reviewed_at = ?, updated_at = ?,
             pending_edit_title = NULL, pending_edit_category = NULL,
             pending_edit_summary = NULL, pending_edit_content = NULL,
             pending_edit_author_name = NULL, pending_edit_submitted_at = NULL
         WHERE id = ?`,
      )
      .bind(
        nextTitle,
        nextAuthorName,
        nextCategory,
        nextSummary,
        nextContent,
        mappedStatus,
        reviewNote,
        timestamp,
        timestamp,
        input.playId,
      ),
    db
      .prepare(
        `INSERT INTO review_logs (id, play_id, action, operator, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(makeId('review'), input.playId, input.action, input.operator, reviewNote, timestamp),
  ];

  if (currentPlay.title !== nextTitle || currentPlay.category !== nextCategory) {
    stmts.unshift(
      db
        .prepare(
          `UPDATE plays
           SET title = ?, category = ?, updated_at = ?
           WHERE author_name = ? AND title = ? AND category = ? AND id <> ?`,
        )
        .bind(
          nextTitle,
          nextCategory,
          timestamp,
          currentPlay.authorName,
          currentPlay.title,
          currentPlay.category,
          input.playId,
        ),
    );
  }

  await db.batch(stmts);

  return ensurePlay(db, input.playId);
};

export const bulkReviewPlays = async (
  db: D1Database,
  input: {
    playIds: string[];
    action: ReviewAction;
    note: string;
    operator: string;
  },
) => {
  const normalizedIds = Array.from(new Set(input.playIds.map((id) => id.trim()).filter(Boolean)));
  if (normalizedIds.length === 0) {
    return {
      action: input.action,
      updatedIds: [],
      skippedIds: [],
      updatedCount: 0,
      skippedCount: 0,
    };
  }

  const existingPlays = (
    await Promise.all(
      chunkItems(normalizedIds, D1_SELECT_CHUNK_SIZE).map(async (idChunk) => {
        const placeholders = idChunk.map(() => '?').join(', ');
        const result = await db
          .prepare(
            `SELECT * FROM plays
             WHERE id IN (${placeholders})`,
          )
          .bind(...idChunk)
          .all<Record<string, unknown>>();

        return result.results.map(normalizePlay);
      }),
    )
  ).flat();

  const existingIdSet = new Set(existingPlays.map((play) => play.id));
  const updatedIds = normalizedIds.filter((id) => existingIdSet.has(id));
  const skippedIds = normalizedIds.filter((id) => !existingIdSet.has(id));

  if (updatedIds.length === 0) {
    return {
      action: input.action,
      updatedIds: [],
      skippedIds,
      updatedCount: 0,
      skippedCount: skippedIds.length,
    };
  }

  const timestamp = now();
  const reviewNote = input.note || '无备注';
  const mappedStatus: PlayStatus =
    input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'offline';

  if (mappedStatus === 'approved') {
    for (const play of existingPlays.filter((play) => updatedIds.includes(play.id))) {
      await ensureTagByName(db, play.category);
    }
  }

  for (const playIdChunk of chunkItems(updatedIds, D1_BULK_REVIEW_PLAY_CHUNK_SIZE)) {
    await db.batch(
      playIdChunk.flatMap((playId) => [
        db
          .prepare(
            `UPDATE plays
             SET status = ?, review_note = ?, reviewed_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(mappedStatus, reviewNote, timestamp, timestamp, playId),
        db
          .prepare(
            `INSERT INTO review_logs (id, play_id, action, operator, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(makeId('review'), playId, input.action, input.operator, reviewNote, timestamp),
      ]),
    );
  }

  return {
    action: input.action,
    updatedIds,
    skippedIds,
    updatedCount: updatedIds.length,
    skippedCount: skippedIds.length,
  };
};
