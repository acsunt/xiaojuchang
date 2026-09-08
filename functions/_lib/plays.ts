import {
  makeId,
  normalizePlay,
  normalizeReviewLog,
  now,
  parseContinuationStatus,
  validPlayStatuses,
  type ContinuationStatus,
  type PlayStatus,
  type RepoStatus,
  type ReviewAction,
} from './http';
import {
  chunkItems,
  D1_BACKUP_INSERT_CHUNK_SIZE,
  D1_BULK_REVIEW_PLAY_CHUNK_SIZE,
  D1_SELECT_CHUNK_SIZE,
} from './db-utils';
import { ensureTagByName } from './tags';
import { parseRepoStatus } from './repos';

type PlayDraft = {
  title: string;
  authorName: string;
  category: string;
  summary: string;
  content: string;
};

/* submission_type / parent_play_id 两列于 1.6 主题新增,旧线上 D1 库可能未迁移。
 * 首次访问相关路径时通过 pragma_table_info 探测列是否存在,缺列则一次性
 * ALTER 补齐并把结果写入 db 维度的 WeakMap 缓存,同一函数实例后续调用
 * 直接命中缓存,不再走 pragma / ALTER。
 * 探测或 ALTER 失败时保守按「不支持」处理,旧库仍可走普通投稿 / 审核流程,
 * 只是「修改」会失败并给运维提示。 */
const MODIFY_COLUMNS = ['submission_type', 'parent_play_id'] as const;

const modifySupportCache = new WeakMap<D1Database, boolean>();

export const ensureModifyColumns = async (db: D1Database): Promise<boolean> => {
  const cached = modifySupportCache.get(db);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const rows = await db
      .prepare(`SELECT name FROM pragma_table_info('plays')`)
      .all<{ name?: string }>();
    const existing = new Set(rows.results.map((row) => String(row.name ?? '')));
    const missing = MODIFY_COLUMNS.filter((column) => !existing.has(column));
    if (missing.length === 0) {
      modifySupportCache.set(db, true);
      return true;
    }
    /* 尝试自动补列:ADD COLUMN 对 nullable 列安全。
     * submission_type 是 NOT NULL DEFAULT 'original',在 SQLite/D1 上 ALTER
     * 加 DEFAULT 也允许,但要注意顺序——若表中已有数据,SQLite 会以默认值
     * 回填,所以新加 NOT NULL 列必须给 DEFAULT。 */
    const stmts = missing.map((column) => {
      if (column === 'submission_type') {
        return db
          .prepare(`ALTER TABLE plays ADD COLUMN submission_type TEXT NOT NULL DEFAULT 'original'`)
          .bind();
      }
      return db
        .prepare(
          `ALTER TABLE plays ADD COLUMN parent_play_id TEXT REFERENCES plays(id) ON DELETE CASCADE`,
        )
        .bind();
    });
    await db.batch(stmts);
    const after = await db
      .prepare(`SELECT name FROM pragma_table_info('plays')`)
      .all<{ name?: string }>();
    const afterSet = new Set(after.results.map((row) => String(row.name ?? '')));
    const supported = MODIFY_COLUMNS.every((column) => afterSet.has(column));
    modifySupportCache.set(db, supported);
    return supported;
  } catch {
    modifySupportCache.set(db, false);
    return false;
  }
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
        id, title, author_name, category, summary, content, status, created_at, updated_at,
        submission_type
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'original')`,
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
  /* modification (submission_type='modify') 不允许后台直接编辑,
   * 必须先 approve / reject 处理,避免改动被覆盖到错误对象。 */
  if (currentPlay.submissionType === 'modify') {
    throw new Error('修改草稿请先通过审核或拒绝,不要直接编辑');
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
       SET title = ?, author_name = ?, category = ?, summary = ?, content = ?, updated_at = ?
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

/* 作者「修改」投稿:不再就地写 pending_edit_*,而是创建一条独立的
 * pending 待审核 play,带 submission_type='modify' 和 parent_play_id。
 * 审核通过时由 reviewPlay 把字段合入原 play 并删除这条 modification,
 * 拒绝 / 下线时仅修改本条 status。 */
/* 把一个 play_id 解析到「同 (title + category) 最早一条」的 id。
 *
 * 背景:1.6 主题把衍生版本做成同 title+category 下的多个 plays 行,导致
 * 「修改」流程的 parent_play_id 可能落在衍生版本上而非原文。
 * 合入时就出现「改了一版,反而又多了一版」的体验问题。
 *
 * 这里把 parent_play_id 收敛到同系列最早一条,后续所有 modify 合入、
 * 同系列跟随都基于该 root id,自然就让修改永远作用于原文。
 *
 * 兼容策略:
 * - 原 play 本身已是 root 时,直接返回自己;
 * - 同系列有多条且当前不是最早一条时,取 MIN(created_at);
 * - 若同系列没有其他记录(只剩自己),仍然返回自己。
 * - 旧数据尚未走 submission_type='modify' 路径时,该函数不会
 *   被触发,不影响。 */
export const resolveRootPlayId = async (db: D1Database, playId: string): Promise<string> => {
  const target = await db
    .prepare(`SELECT id, title, category FROM plays WHERE id = ? LIMIT 1`)
    .bind(playId)
    .first<{ id?: string; title?: string; category?: string }>();
  if (!target?.id) {
    return playId;
  }

  const root = await db
    .prepare(
      `SELECT id FROM plays
       WHERE title = ? AND category = ?
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
    .bind(target.title ?? '', target.category ?? '')
    .first<{ id?: string }>();

  return root?.id ?? target.id;
};

export const submitPlayEdit = async (
  db: D1Database,
  parentPlayId: string,
  draft: { title: string; category: string; summary: string; content: string; authorName: string },
) => {
  const modifySupported = await ensureModifyColumns(db);
  if (!modifySupported) {
    throw new Error(
      '作者修改投稿功能依赖 submission_type / parent_play_id 列,当前数据库补列失败,请联系运维检查 D1 ALTER 权限',
    );
  }
  const currentPlay = await getAdminPlayById(db, parentPlayId);
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
  if (nextCategory) {
    await ensureTagByName(db, nextCategory);
  }

  /* 上溯 parent_play_id 到同 title+category 最早一条,避免
   * "点修改时落在衍生版本上、合入后再新增一版"的体验 bug。
   * 终态保证:无论用户在哪个版本点修改,合入目标都是同一组
   * 作品里的「原文」(最早一条)。 */
  const rootPlayId = await resolveRootPlayId(db, parentPlayId);

  const id = makeId('play');
  const timestamp = now();

  await db
    .prepare(
      `INSERT INTO plays (
        id, title, author_name, category, summary, content, status, created_at, updated_at,
        submission_type, parent_play_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'modify', ?)`,
    )
    .bind(
      id,
      nextTitle,
      nextAuthorName,
      nextCategory,
      nextSummary,
      nextContent,
      timestamp,
      timestamp,
      rootPlayId,
    )
    .run();

  return ensurePlay(db, id);
};

/* 列出所有「修改草稿」(submission_type='modify' 且 status='pending'),
 * 按 submittedAt 倒序。旧库缺列时 ensureModifyColumns 会尝试自动 ALTER,
 * 补列失败返回空数组。 */
export const getPendingModifyPlays = async (db: D1Database) => {
  const supported = await ensureModifyColumns(db);
  if (!supported) {
    return [];
  }
  const result = await db
    .prepare(
      `SELECT * FROM plays
       WHERE submission_type = 'modify' AND status = 'pending'
       ORDER BY updated_at DESC`,
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

/* —— 备份恢复(repos / continuations / tags) ——
 *
 * 设计要点:
 * 1. 备份数据来自前端 buildBackup() 序列化(从 localStorage mock-db 导出),
 *    字段名是前端驼峰式(playId / authorName / createdAt ...),与后端
 *    DB 列名(snake_case)不同,所以需要 normalize 函数。
 * 2. 备份表 id 必须唯一(同表内 + 与 plays 之间);整体覆盖前清空对应表
 *    涉及的审计日志,避免孤儿审核记录(review_logs 已由 restoreBackupPlays
 *    清掉,这里只清 repo_review_logs / continuation_review_logs)。
 * 3. tags 表没有审计日志,直接 DELETE + 批量 INSERT 即可;sort_order 按
 *    入参数组顺序重排(前端导出时已经按 sortOrder ASC 排过)。
 * 4. 4 个 helper 都不抛事务;任一失败直接让调用方决定是否回滚。
 *    admin/backup.ts 入口会按 plays → repos → continuations → tags 顺序
 *    调用,如果中途失败,前面已写的数据不会被回滚(简单 + 出错易诊断)。
 */

type BackupRepoDraft = {
  id: string;
  playId: string;
  parentId?: string;
  rootId?: string;
  nickname: string;
  visitorId: string;
  content: string;
  status: RepoStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewNote?: string;
};

const normalizeBackupRepoDraft = (
  draft: BackupRepoDraft,
  fallbackTimestamp: string,
): BackupRepoDraft => {
  const createdAt = normalizeBackupTimestamp(String(draft.createdAt ?? ''), fallbackTimestamp);
  const updatedAt = normalizeBackupTimestamp(String(draft.updatedAt ?? ''), createdAt);
  const normalizedStatus = parseRepoStatus(String(draft.status ?? '')) ?? 'pending';
  const reviewedAtRaw = String(draft.reviewedAt ?? '').trim();
  const reviewNote = String(draft.reviewNote ?? '').trim();

  return {
    id: String(draft.id ?? '').trim() || makeId('repo'),
    playId: String(draft.playId ?? '').trim(),
    parentId: String(draft.parentId ?? '').trim() || undefined,
    rootId: String(draft.rootId ?? '').trim() || undefined,
    nickname: String(draft.nickname ?? '').trim(),
    visitorId: String(draft.visitorId ?? '').trim(),
    content: String(draft.content ?? ''),
    status: normalizedStatus,
    createdAt,
    updatedAt,
    reviewedAt:
      normalizedStatus === 'pending'
        ? undefined
        : reviewedAtRaw
          ? normalizeBackupTimestamp(reviewedAtRaw, updatedAt)
          : updatedAt,
    reviewNote: normalizedStatus === 'pending' ? undefined : reviewNote || undefined,
  };
};

export const restoreBackupRepos = async (db: D1Database, repos: BackupRepoDraft[]) => {
  const normalizedRepos = repos.map((draft) => normalizeBackupRepoDraft(draft, now()));
  const seenIds = new Set<string>();

  for (const repo of normalizedRepos) {
    if (seenIds.has(repo.id)) {
      throw new Error('备份里存在重复 id，请检查压缩包内容');
    }
    if (!repo.playId) {
      throw new Error('备份里存在缺少 playId 的 repo');
    }
    if (!repo.content.trim()) {
      throw new Error('备份里存在正文为空的 repo');
    }
    seenIds.add(repo.id);
  }

  /* repo 引用的 play 可能不存在(备份里 plays 与 repos 顺序写入时,
   * 若先写 repos 再写 plays,FK 会被 SQLite 拒绝)。
   * 由于 restoreBackupPlays 已经先 DELETE+INSERT 完成,这里直接 INSERT。
   * 如果用户只导入了一份只有 repos 的备份(没有 plays),FK 会失败 ——
   * 但这是 admin/backup.ts 层的责任,不归本 helper 管。 */
  await db.prepare(`DELETE FROM repo_review_logs`).run();
  await db.prepare(`DELETE FROM repos`).run();

  for (const repoChunk of chunkItems(normalizedRepos, D1_BACKUP_INSERT_CHUNK_SIZE)) {
    await db.batch(
      repoChunk.map((repo) =>
        db
          .prepare(
            `INSERT INTO repos (
              id, play_id, parent_id, root_id, nickname, visitor_id, content, status,
              created_at, updated_at, reviewed_at, review_note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            repo.id,
            repo.playId,
            repo.parentId ?? null,
            repo.rootId ?? null,
            repo.nickname,
            repo.visitorId,
            repo.content,
            repo.status,
            repo.createdAt,
            repo.updatedAt,
            repo.reviewedAt ?? null,
            repo.reviewNote ?? null,
          ),
      ),
    );
  }

  return { restoredCount: normalizedRepos.length };
};

type BackupContinuationDraft = {
  id: string;
  playId: string;
  nickname: string;
  visitorId: string;
  summary: string;
  content: string;
  status: ContinuationStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewNote?: string;
  lastApprovedNickname?: string;
  lastApprovedSummary?: string;
  lastApprovedContent?: string;
  lastApprovedAt?: string;
  pendingDraftNickname?: string;
  pendingDraftSummary?: string;
  pendingDraftContent?: string;
  pendingDraftUpdatedAt?: string;
};

const normalizeBackupContinuationDraft = (
  draft: BackupContinuationDraft,
  fallbackTimestamp: string,
): BackupContinuationDraft => {
  const createdAt = normalizeBackupTimestamp(String(draft.createdAt ?? ''), fallbackTimestamp);
  const updatedAt = normalizeBackupTimestamp(String(draft.updatedAt ?? ''), createdAt);
  const normalizedStatus = parseContinuationStatus(String(draft.status ?? '')) ?? 'pending';
  const reviewedAtRaw = String(draft.reviewedAt ?? '').trim();
  const reviewNote = String(draft.reviewNote ?? '').trim();

  return {
    id: String(draft.id ?? '').trim() || makeId('cont'),
    playId: String(draft.playId ?? '').trim(),
    nickname: String(draft.nickname ?? '').trim(),
    visitorId: String(draft.visitorId ?? '').trim(),
    summary: String(draft.summary ?? ''),
    content: String(draft.content ?? ''),
    status: normalizedStatus,
    createdAt,
    updatedAt,
    reviewedAt:
      normalizedStatus === 'pending'
        ? undefined
        : reviewedAtRaw
          ? normalizeBackupTimestamp(reviewedAtRaw, updatedAt)
          : updatedAt,
    reviewNote: normalizedStatus === 'pending' ? undefined : reviewNote || undefined,
    lastApprovedNickname: String(draft.lastApprovedNickname ?? '').trim() || undefined,
    lastApprovedSummary: String(draft.lastApprovedSummary ?? '').trim() || undefined,
    lastApprovedContent: String(draft.lastApprovedContent ?? '').trim() || undefined,
    lastApprovedAt: String(draft.lastApprovedAt ?? '').trim() || undefined,
    pendingDraftNickname: String(draft.pendingDraftNickname ?? '').trim() || undefined,
    pendingDraftSummary: String(draft.pendingDraftSummary ?? '').trim() || undefined,
    pendingDraftContent: String(draft.pendingDraftContent ?? '').trim() || undefined,
    pendingDraftUpdatedAt: String(draft.pendingDraftUpdatedAt ?? '').trim() || undefined,
  };
};

export const restoreBackupContinuations = async (
  db: D1Database,
  continuations: BackupContinuationDraft[],
) => {
  const normalized = continuations.map((draft) => normalizeBackupContinuationDraft(draft, now()));
  const seenIds = new Set<string>();

  for (const item of normalized) {
    if (seenIds.has(item.id)) {
      throw new Error('备份里存在重复 id，请检查压缩包内容');
    }
    if (!item.playId) {
      throw new Error('备份里存在缺少 playId 的续写');
    }
    if (!item.summary.trim() || !item.content.trim()) {
      throw new Error('备份里存在简介或正文为空的续写');
    }
    seenIds.add(item.id);
  }

  await db.prepare(`DELETE FROM continuation_review_logs`).run();
  await db.prepare(`DELETE FROM continuations`).run();

  for (const chunk of chunkItems(normalized, D1_BACKUP_INSERT_CHUNK_SIZE)) {
    await db.batch(
      chunk.map((item) =>
        db
          .prepare(
            `INSERT INTO continuations (
              id, play_id, nickname, visitor_id, summary, content, status,
              created_at, updated_at, reviewed_at, review_note,
              last_approved_nickname, last_approved_summary, last_approved_content, last_approved_at,
              pending_draft_nickname, pending_draft_summary, pending_draft_content, pending_draft_updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            item.id,
            item.playId,
            item.nickname,
            item.visitorId,
            item.summary,
            item.content,
            item.status,
            item.createdAt,
            item.updatedAt,
            item.reviewedAt ?? null,
            item.reviewNote ?? null,
            item.lastApprovedNickname ?? null,
            item.lastApprovedSummary ?? null,
            item.lastApprovedContent ?? null,
            item.lastApprovedAt ?? null,
            item.pendingDraftNickname ?? null,
            item.pendingDraftSummary ?? null,
            item.pendingDraftContent ?? null,
            item.pendingDraftUpdatedAt ?? null,
          ),
      ),
    );
  }

  return { restoredCount: normalized.length };
};

type BackupTagDraft = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

const normalizeBackupTagDraft = (
  draft: BackupTagDraft,
  fallbackTimestamp: string,
): BackupTagDraft => {
  const createdAt = normalizeBackupTimestamp(String(draft.createdAt ?? ''), fallbackTimestamp);
  const updatedAt = normalizeBackupTimestamp(String(draft.updatedAt ?? ''), createdAt);
  return {
    id: String(draft.id ?? '').trim() || makeId('tag'),
    name: String(draft.name ?? '').trim(),
    sortOrder: Number.isFinite(Number(draft.sortOrder)) ? Number(draft.sortOrder) : 0,
    createdAt,
    updatedAt,
  };
};

export const restoreBackupTags = async (db: D1Database, tags: BackupTagDraft[]) => {
  const normalized = tags.map((draft) => normalizeBackupTagDraft(draft, now()));
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  for (const tag of normalized) {
    if (seenIds.has(tag.id)) {
      throw new Error('备份里存在重复 id，请检查压缩包内容');
    }
    if (!tag.name) {
      throw new Error('备份里存在名称为空的标签');
    }
    const lowerName = tag.name.toLowerCase();
    if (seenNames.has(lowerName)) {
      throw new Error('备份里存在重复名称的标签');
    }
    seenIds.add(tag.id);
    seenNames.add(lowerName);
  }

  await db.prepare(`DELETE FROM tags`).run();

  /* sort_order 按入参顺序重排:与 mock-db.restoreAdminBackup
   * (对 tags 不重排 sortOrder) 不同 — 后端更严格,保证列表顺序可预测。 */
  for (const [chunkIndex, tagChunk] of chunkItems(
    normalized,
    D1_BACKUP_INSERT_CHUNK_SIZE,
  ).entries()) {
    await db.batch(
      tagChunk.map((tag, index) =>
        db
          .prepare(
            `INSERT INTO tags (id, name, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            tag.id,
            tag.name,
            chunkIndex * D1_BACKUP_INSERT_CHUNK_SIZE + index,
            tag.createdAt,
            tag.updatedAt,
          ),
      ),
    );
  }

  return { restoredCount: normalized.length };
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

  /* 「修改」投稿独立分支:approve 把 modification 字段合入原 play 并删除本条,
   * reject / offline 仅修改本条 status。inline edit 不允许走 modify 路径
   * (admin 看到 diff 直接通过即可,不需要再手动覆盖一次)。 */
  if (currentPlay.submissionType === 'modify') {
    if (input.action === 'approve') {
      if (!currentPlay.parentPlayId) {
        throw new Error('修改草稿缺少 parent_play_id,无法合入');
      }
      const parentPlay = await getAdminPlayById(db, currentPlay.parentPlayId);
      if (!parentPlay) {
        throw new Error('原内容不存在,无法合入修改');
      }
      const nextTitle = currentPlay.title.trim();
      const nextAuthorName = currentPlay.authorName.trim();
      const nextCategory = currentPlay.category.trim() || parentPlay.category;
      const nextSummary = normalizeImportedSummary(currentPlay.summary);
      const nextContent = currentPlay.content.trim();
      if (!nextTitle) throw new Error('标题不能为空');
      if (!nextAuthorName) throw new Error('署名不能为空');
      if (!nextContent) throw new Error('正文不能为空');
      await ensureTagByName(db, nextCategory);

      const stmts = [
        /* 原 play 字段被合入 + 同系列跟随。 */
        db
          .prepare(
            `UPDATE plays
             SET title = ?, author_name = ?, category = ?, summary = ?, content = ?,
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(
            nextTitle,
            nextAuthorName,
            nextCategory,
            nextSummary,
            nextContent,
            timestamp,
            currentPlay.parentPlayId,
          ),
        /* 写审核日志(挂在原 play 上,方便回看是谁改的)。 */
        db
          .prepare(
            `INSERT INTO review_logs (id, play_id, action, operator, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            makeId('review'),
            currentPlay.parentPlayId,
            'approve',
            input.operator,
            `[修改] ${reviewNote}`,
            timestamp,
          ),
        /* 同系列下其他作品 title/category 跟随。 */
        db
          .prepare(
            `UPDATE plays
             SET title = ?, category = ?, updated_at = ?
             WHERE author_name = ? AND title = ? AND category = ? AND id <> ? AND id <> ?`,
          )
          .bind(
            nextTitle,
            nextCategory,
            timestamp,
            parentPlay.authorName,
            parentPlay.title,
            parentPlay.category,
            currentPlay.parentPlayId,
            input.playId,
          ),
        /* modification 自身删除(连同 review_logs 外键级联)。 */
        db.prepare(`DELETE FROM plays WHERE id = ?`).bind(input.playId),
      ];
      await db.batch(stmts);
      return ensurePlay(db, currentPlay.parentPlayId);
    }
    /* reject / offline:仅修改本条 modification status,原 play 不动。 */
    await db
      .prepare(
        `UPDATE plays
         SET status = ?, review_note = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(mappedStatus, reviewNote, timestamp, timestamp, input.playId)
      .run();
    await db
      .prepare(
        `INSERT INTO review_logs (id, play_id, action, operator, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(makeId('review'), input.playId, input.action, input.operator, reviewNote, timestamp)
      .run();
    return ensurePlay(db, input.playId);
  }

  /* 普通投稿 / 衍生:保持原行为,inline edit 优先。 */
  const nextTitle = String(input.edit?.title ?? currentPlay.title).trim();
  const nextAuthorName = String(input.edit?.authorName ?? currentPlay.authorName).trim();
  const nextCategory =
    String(input.edit?.category ?? currentPlay.category).trim() || currentPlay.category;
  const nextSummary = normalizeImportedSummary(String(input.edit?.summary ?? currentPlay.summary));
  const nextContent = String(input.edit?.content ?? currentPlay.content).trim();

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

  const stmts = [
    db
      .prepare(
        `UPDATE plays
         SET title = ?, author_name = ?, category = ?, summary = ?, content = ?,
             status = ?, review_note = ?, reviewed_at = ?, updated_at = ?
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
