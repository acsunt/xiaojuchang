import {
  makeId,
  normalizePlay,
  normalizeRepo,
  normalizeRepoAuditLog,
  normalizeReviewLog,
  normalizeSession,
  normalizeSiteSettings,
  normalizeTag,
  now,
  readBearerToken,
  validPlayStatuses,
  type AdminSessionRecord,
  type PlayStatus,
  type RepoAuditAction,
  type RepoReviewAction,
  type RepoStatus,
  type ReviewAction,
} from './http';

type PlayDraft = {
  title: string;
  authorName: string;
  category: string;
  summary: string;
  content: string;
};

type RepoDraft = {
  playId: string;
  parentId?: string;
  nickname: string;
  visitorId: string;
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

type TagDraft = {
  name: string;
};

type TagReorderDraft = {
  orderedIds: string[];
};

type BackgroundCropDraft = {
  positionX: number;
  positionY: number;
  scale: number;
  backgroundOpacity: number;
  overlayOpacity: number;
};

type BackgroundDeviceDraft = {
  backgroundUrl: string;
  crop: BackgroundCropDraft;
};

type ThemeBackgroundDraft = {
  desktop: BackgroundDeviceDraft;
  mobile: BackgroundDeviceDraft;
};

type SiteSettingsDraft = {
  light: ThemeBackgroundDraft;
  dark: ThemeBackgroundDraft;
};

const ensurePlay = async (db: D1Database, id: string) => {
  const play = await getAdminPlayById(db, id);
  if (!play) {
    throw new Error('内容写入后读取失败');
  }

  return play;
};

const ensureTag = async (db: D1Database, id: string) => {
  const tag = await getTagById(db, id);
  if (!tag) {
    throw new Error('标签写入后读取失败');
  }

  return tag;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const chunkItems = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const D1_MAX_BATCH_VARIABLES = 90;
const D1_SELECT_CHUNK_SIZE = D1_MAX_BATCH_VARIABLES;
const D1_TAG_REORDER_CHUNK_SIZE = Math.max(1, Math.floor(D1_MAX_BATCH_VARIABLES / 3));
const D1_BULK_REVIEW_PLAY_CHUNK_SIZE = Math.max(1, Math.floor(D1_MAX_BATCH_VARIABLES / 11));
const D1_BACKUP_INSERT_CHUNK_SIZE = Math.max(1, Math.floor(D1_MAX_BATCH_VARIABLES / 11));

const ensureReposSchema = async (db: D1Database) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        play_id TEXT NOT NULL,
        parent_id TEXT,
        root_id TEXT,
        nickname TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        reviewed_at TEXT,
        review_note TEXT,
        FOREIGN KEY (play_id) REFERENCES plays(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES repos(id) ON DELETE CASCADE
      )`,
    )
    .run();

  await db.batch([
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_repos_play_status_created_at
       ON repos(play_id, status, created_at DESC)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_repos_visitor_created_at
       ON repos(visitor_id, created_at DESC)`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_repos_parent_id ON repos(parent_id)`),
  ]);
};

const ensureRepoAuditLogsSchema = async (db: D1Database) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS repo_review_logs (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        play_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'delete')),
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
      `CREATE INDEX IF NOT EXISTS idx_repo_review_logs_created_at
       ON repo_review_logs(created_at DESC)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_repo_review_logs_repo_id
       ON repo_review_logs(repo_id, created_at DESC)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_repo_review_logs_play_id
       ON repo_review_logs(play_id, created_at DESC)`,
    ),
  ]);
};

const normalizeImportedSummary = (value: string) => {
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

const normalizeBackgroundDeviceDraft = (draft: BackgroundDeviceDraft, overlayOpacity: number) => ({
  backgroundUrl: String(draft.backgroundUrl ?? '').trim(),
  crop: {
    positionX: clamp(Number(draft.crop.positionX ?? 50), 0, 100),
    positionY: clamp(Number(draft.crop.positionY ?? 50), 0, 100),
    scale: clamp(Number(draft.crop.scale ?? 100), 100, 240),
    backgroundOpacity: clamp(Number(draft.crop.backgroundOpacity ?? 1), 0, 1),
    overlayOpacity: clamp(Number(draft.crop.overlayOpacity ?? overlayOpacity), 0, 0.9),
  },
});

const normalizeThemeBackgroundDraft = (draft: ThemeBackgroundDraft, overlayOpacity: number) => ({
  desktop: normalizeBackgroundDeviceDraft(draft.desktop, overlayOpacity),
  mobile: normalizeBackgroundDeviceDraft(draft.mobile, overlayOpacity),
});

const normalizeSiteSettingsDraft = (draft: SiteSettingsDraft) => {
  const light = normalizeThemeBackgroundDraft(draft.light, 0.2);
  const dark = normalizeThemeBackgroundDraft(draft.dark, 0.32);

  return {
    lightBackgroundUrl: JSON.stringify(light),
    lightPositionX: light.desktop.crop.positionX,
    lightPositionY: light.desktop.crop.positionY,
    lightScale: light.desktop.crop.scale,
    lightOverlayOpacity: light.desktop.crop.overlayOpacity,
    darkBackgroundUrl: JSON.stringify(dark),
    darkPositionX: dark.desktop.crop.positionX,
    darkPositionY: dark.desktop.crop.positionY,
    darkScale: dark.desktop.crop.scale,
    darkOverlayOpacity: dark.desktop.crop.overlayOpacity,
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

const repoSelect = `SELECT repos.*,
       plays.title AS play_title,
       plays.author_name AS play_author_name,
       parent.nickname AS reply_to_nickname,
       parent.visitor_id AS reply_to_visitor_id
       FROM repos
       JOIN plays ON plays.id = repos.play_id
       LEFT JOIN repos parent ON parent.id = repos.parent_id`;

export const listPublicReposByPlayId = async (db: D1Database, playId: string, order: 'asc' | 'desc' = 'asc') => {
  await ensureReposSchema(db);
  const result = await db
    .prepare(
      `${repoSelect}
       WHERE repos.play_id = ? AND repos.status = 'approved'
       ORDER BY repos.created_at ${order === 'desc' ? 'DESC' : 'ASC'}`,
    )
    .bind(playId)
    .all<Record<string, unknown>>();

  return result.results.map(normalizeRepo);
};

export const listReposByVisitorId = async (db: D1Database, visitorId: string, order: 'asc' | 'desc' = 'desc') => {
  await ensureReposSchema(db);
  const result = await db
    .prepare(
      `${repoSelect}
       WHERE repos.visitor_id = ?
       ORDER BY repos.created_at ${order === 'desc' ? 'DESC' : 'ASC'}`,
    )
    .bind(visitorId)
    .all<Record<string, unknown>>();

  return result.results.map(normalizeRepo);
};

export const listReceivedRepos = async (
  db: D1Database,
  playIds: string[],
  visitorId: string,
  order: 'asc' | 'desc' = 'desc',
) => {
  await ensureReposSchema(db);
  const normalizedPlayIds = Array.from(new Set(playIds.map((id) => id.trim()).filter(Boolean)));
  const normalizedVisitorId = visitorId.trim();

  if (normalizedPlayIds.length === 0 && !normalizedVisitorId) {
    return [];
  }

  const mergedRepos = new Map<string, ReturnType<typeof normalizeRepo>>();
  const collectRows = (rows: Record<string, unknown>[]) => {
    rows.forEach((row) => {
      const repo = normalizeRepo(row);
      mergedRepos.set(repo.id, repo);
    });
  };

  if (normalizedPlayIds.length > 0) {
    for (const idChunk of chunkItems(normalizedPlayIds, D1_SELECT_CHUNK_SIZE - 1)) {
      const placeholders = idChunk.map(() => '?').join(', ');
      const result = await db
        .prepare(
          `${repoSelect}
           WHERE repos.status IN ('approved', 'rejected')
             AND repos.play_id IN (${placeholders})
             AND repos.visitor_id != ?
           ORDER BY repos.created_at ${order === 'desc' ? 'DESC' : 'ASC'}`,
        )
        .bind(...idChunk, normalizedVisitorId || '__anonymous__')
        .all<Record<string, unknown>>();

      collectRows(result.results);
    }
  }

  if (normalizedVisitorId) {
    const result = await db
      .prepare(
        `${repoSelect}
         WHERE repos.status IN ('approved', 'rejected')
           AND parent.visitor_id = ?
           AND repos.visitor_id != ?
         ORDER BY repos.created_at ${order === 'desc' ? 'DESC' : 'ASC'}`,
      )
      .bind(normalizedVisitorId, normalizedVisitorId)
      .all<Record<string, unknown>>();

    collectRows(result.results);
  }

  return [...mergedRepos.values()].sort((left, right) =>
    order === 'desc'
      ? right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
      : left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
};

export const listRepoCountsByPlayIds = async (db: D1Database, playIds: string[]) => {
  await ensureReposSchema(db);
  const normalizedIds = Array.from(new Set(playIds.map((id) => id.trim()).filter(Boolean)));
  if (normalizedIds.length === 0) {
    return [] as Array<{ playId: string; count: number; firstCreatedAt?: string; lastCreatedAt?: string }>;
  }

  const summaryMap = new Map<string, { count: number; firstCreatedAt?: string; lastCreatedAt?: string }>();
  for (const idChunk of chunkItems(normalizedIds, D1_SELECT_CHUNK_SIZE)) {
    const placeholders = idChunk.map(() => '?').join(', ');
    const result = await db
      .prepare(
        `SELECT play_id,
                COUNT(*) AS count,
                MIN(created_at) AS first_created_at,
                MAX(created_at) AS last_created_at
         FROM repos
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

export const getRepoNoticeSummary = async (
  db: D1Database,
  playIds: string[],
  visitorId: string,
  readAt: string,
) => {
  const receivedRepos = await listReceivedRepos(db, playIds, visitorId, 'desc');
  const readTime = readAt ? new Date(readAt).getTime() : 0;
  return {
    receivedCount: receivedRepos.length,
    unreadCount: receivedRepos.filter((repo) => new Date(repo.createdAt).getTime() > readTime).length,
  };
};

export const createRepo = async (db: D1Database, draft: RepoDraft) => {
  await ensureReposSchema(db);
  const timestamp = now();
  const parent = draft.parentId
    ? await db
        .prepare(`SELECT * FROM repos WHERE id = ? AND play_id = ? LIMIT 1`)
        .bind(draft.parentId, draft.playId)
        .first<Record<string, unknown>>()
    : null;
  const rootId = parent ? String(parent.root_id ?? parent.id) : null;
  const id = makeId('repo');

  await db
    .prepare(
      `INSERT INTO repos (id, play_id, parent_id, root_id, nickname, visitor_id, content, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      id,
      draft.playId,
      draft.parentId ?? null,
      rootId,
      draft.nickname.trim(),
      draft.visitorId.trim(),
      draft.content.trim(),
      timestamp,
      timestamp,
    )
    .run();

  const row = await db.prepare(`${repoSelect} WHERE repos.id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>();
  if (!row) {
    throw new Error('repo 写入后读取失败');
  }

  return normalizeRepo(row);
};

export const listSubmissionFeedbackByIds = async (db: D1Database, ids: string[]) => {
  const normalizedIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean))).slice(0, 60);
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

export const listTags = async (db: D1Database) => {
  const result = await db
    .prepare(
      `SELECT * FROM tags
       ORDER BY sort_order ASC, name COLLATE NOCASE ASC`,
    )
    .all<Record<string, unknown>>();

  return result.results.map(normalizeTag);
};

export const getSiteSettings = async (db: D1Database) => {
  const row = await db
    .prepare(
      `SELECT * FROM site_settings
       WHERE id = 'default'
       LIMIT 1`,
    )
    .first<Record<string, unknown>>();

  if (!row) {
    throw new Error('站点外观配置不存在');
  }

  return normalizeSiteSettings(row);
};

export const updateSiteSettings = async (db: D1Database, draft: SiteSettingsDraft) => {
  const normalized = normalizeSiteSettingsDraft(draft);
  const timestamp = now();

  await db
    .prepare(
      `UPDATE site_settings
       SET light_background_url = ?,
           light_position_x = ?,
           light_position_y = ?,
           light_scale = ?,
           light_overlay_opacity = ?,
           dark_background_url = ?,
           dark_position_x = ?,
           dark_position_y = ?,
           dark_scale = ?,
           dark_overlay_opacity = ?,
           updated_at = ?
       WHERE id = 'default'`,
    )
    .bind(
      normalized.lightBackgroundUrl,
      normalized.lightPositionX,
      normalized.lightPositionY,
      normalized.lightScale,
      normalized.lightOverlayOpacity,
      normalized.darkBackgroundUrl,
      normalized.darkPositionX,
      normalized.darkPositionY,
      normalized.darkScale,
      normalized.darkOverlayOpacity,
      timestamp,
    )
    .run();

  return getSiteSettings(db);
};

export const getTagById = async (db: D1Database, id: string) => {
  const row = await db
    .prepare(
      `SELECT * FROM tags
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<Record<string, unknown>>();

  return row ? normalizeTag(row) : null;
};

const getTagByName = async (db: D1Database, name: string) => {
  const row = await db
    .prepare(
      `SELECT * FROM tags
       WHERE lower(name) = lower(?)
       LIMIT 1`,
    )
    .bind(name)
    .first<Record<string, unknown>>();

  return row ? normalizeTag(row) : null;
};

const getNextTagSortOrder = async (db: D1Database) => {
  const row = await db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) AS max_sort_order
       FROM tags`,
    )
    .first<Record<string, unknown>>();

  return Number(row?.max_sort_order ?? -1) + 1;
};

export const createTag = async (db: D1Database, draft: TagDraft) => {
  const name = draft.name.trim();
  if (!name) {
    throw new Error('标签名不能为空');
  }

  const existing = await getTagByName(db, name);
  if (existing) {
    throw new Error('标签已存在');
  }

  const id = makeId('tag');
  const timestamp = now();
  const sortOrder = await getNextTagSortOrder(db);

  await db
    .prepare(
      `INSERT INTO tags (id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, name, sortOrder, timestamp, timestamp)
    .run();

  return ensureTag(db, id);
};

const ensureTagByName = async (db: D1Database, name: string) => {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName === '未分类') {
    return null;
  }

  const existing = await getTagByName(db, normalizedName);
  if (existing) {
    return existing;
  }

  return createTag(db, { name: normalizedName });
};

export const updateTag = async (db: D1Database, tagId: string, draft: TagDraft) => {
  const current = await getTagById(db, tagId);
  if (!current) {
    return null;
  }

  const name = draft.name.trim();
  if (!name) {
    throw new Error('标签名不能为空');
  }

  const existing = await getTagByName(db, name);
  if (existing && existing.id !== tagId) {
    throw new Error('标签已存在');
  }

  const timestamp = now();

  await db.batch([
    db
      .prepare(
        `UPDATE tags
         SET name = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(name, timestamp, tagId),
    db
      .prepare(
        `UPDATE plays
         SET category = ?, updated_at = ?
         WHERE category = ?`,
      )
      .bind(name, timestamp, current.name),
  ]);

  return ensureTag(db, tagId);
};

export const deleteTag = async (db: D1Database, tagId: string, fallbackCategory: string) => {
  const current = await getTagById(db, tagId);
  if (!current) {
    return false;
  }

  const timestamp = now();

  await db.batch([
    db
      .prepare(
        `UPDATE plays
         SET category = ?, updated_at = ?
         WHERE category = ?`,
      )
      .bind(fallbackCategory, timestamp, current.name),
    db.prepare(`DELETE FROM tags WHERE id = ?`).bind(tagId),
  ]);

  const remainingTags = await listTags(db);
  for (const [chunkIndex, reorderChunk] of chunkItems(remainingTags, D1_TAG_REORDER_CHUNK_SIZE).entries()) {
    await db.batch(
      reorderChunk.map((tag, index) =>
        db
          .prepare(
            `UPDATE tags
             SET sort_order = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(chunkIndex * D1_TAG_REORDER_CHUNK_SIZE + index, timestamp, tag.id),
      ),
    );
  }

  return true;
};

export const reorderTags = async (db: D1Database, draft: TagReorderDraft) => {
  const currentTags = await listTags(db);
  const currentIds = currentTags.map((tag) => tag.id);
  const nextIds = draft.orderedIds.map((id) => id.trim()).filter(Boolean);

  if (currentIds.length !== nextIds.length) {
    throw new Error('标签重排数量不匹配');
  }

  const currentIdSet = new Set(currentIds);
  if (new Set(nextIds).size !== nextIds.length || nextIds.some((id) => !currentIdSet.has(id))) {
    throw new Error('标签重排数据无效');
  }

  const timestamp = now();

  for (const [chunkIndex, reorderChunk] of chunkItems(nextIds, D1_TAG_REORDER_CHUNK_SIZE).entries()) {
    await db.batch(
      reorderChunk.map((tagId, index) =>
        db
          .prepare(
            `UPDATE tags
             SET sort_order = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(chunkIndex * D1_TAG_REORDER_CHUNK_SIZE + index, timestamp, tagId),
      ),
    );
  }

  return listTags(db);
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
    ? db.prepare(
        `SELECT * FROM plays
         WHERE status = ?
         ORDER BY updated_at DESC`,
      ).bind(status)
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

const validRepoStatuses: RepoStatus[] = ['pending', 'approved', 'rejected'];

export const parseRepoStatus = (value?: string | null): RepoStatus | undefined => {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  return validRepoStatuses.includes(normalized as RepoStatus) ? (normalized as RepoStatus) : undefined;
};

export const listAdminRepos = async (db: D1Database, status?: RepoStatus) => {
  await ensureReposSchema(db);
  const statement = status
    ? db.prepare(`${repoSelect} WHERE repos.status = ? ORDER BY repos.created_at DESC`).bind(status)
    : db.prepare(`${repoSelect} ORDER BY repos.created_at DESC`);

  const result = await statement.all<Record<string, unknown>>();
  return result.results.map(normalizeRepo);
};

export const reviewRepo = async (
  db: D1Database,
  repoId: string,
  action: RepoReviewAction,
  note: string,
  operator: string,
) => {
  await ensureReposSchema(db);
  await ensureRepoAuditLogsSchema(db);
  const currentRepo = await db.prepare(`${repoSelect} WHERE repos.id = ? LIMIT 1`).bind(repoId).first<Record<string, unknown>>();
  if (!currentRepo) {
    return null;
  }

  const normalizedRepo = normalizeRepo(currentRepo);
  const timestamp = now();
  const status: RepoStatus = action === 'approve' ? 'approved' : 'rejected';
  const normalizedNote = note.trim() || '无备注';

  await db.batch([
    db
      .prepare(
        `UPDATE repos
         SET status = ?, review_note = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(status, normalizedNote, timestamp, timestamp, repoId),
    db
      .prepare(
        `INSERT INTO repo_review_logs (id, repo_id, play_id, action, operator, note, nickname, play_title, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        makeId('repo_review'),
        normalizedRepo.id,
        normalizedRepo.playId,
        action,
        operator,
        normalizedNote,
        normalizedRepo.nickname,
        normalizedRepo.playTitle ?? null,
        timestamp,
      ),
  ]);

  const row = await db.prepare(`${repoSelect} WHERE repos.id = ? LIMIT 1`).bind(repoId).first<Record<string, unknown>>();
  return row ? normalizeRepo(row) : null;
};

export const deleteRepo = async (db: D1Database, repoId: string, operator: string) => {
  await ensureReposSchema(db);
  await ensureRepoAuditLogsSchema(db);
  const currentRepo = await db.prepare(`${repoSelect} WHERE repos.id = ? LIMIT 1`).bind(repoId).first<Record<string, unknown>>();
  if (!currentRepo) {
    return false;
  }

  const normalizedRepo = normalizeRepo(currentRepo);
  const timestamp = now();

  await db.batch([
    db
      .prepare(
        `INSERT INTO repo_review_logs (id, repo_id, play_id, action, operator, note, nickname, play_title, created_at)
         VALUES (?, ?, ?, 'delete', ?, ?, ?, ?, ?)`,
      )
      .bind(
        makeId('repo_review'),
        normalizedRepo.id,
        normalizedRepo.playId,
        operator,
        '后台删除 repo',
        normalizedRepo.nickname,
        normalizedRepo.playTitle ?? null,
        timestamp,
      ),
    db.prepare(`DELETE FROM repos WHERE id = ?`).bind(repoId),
  ]);

  return true;
};

export const deleteRejectedReposByVisitor = async (db: D1Database, visitorId: string) => {
  await ensureReposSchema(db);
  const normalizedVisitorId = visitorId.trim();
  if (!normalizedVisitorId) {
    return 0;
  }

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM repos WHERE visitor_id = ? AND status = 'rejected'`)
    .bind(normalizedVisitorId)
    .first<{ total: number }>();

  const deletedCount = Number(countRow?.total ?? 0);
  if (deletedCount === 0) {
    return 0;
  }

  await db
    .prepare(`DELETE FROM repos WHERE visitor_id = ? AND status = 'rejected'`)
    .bind(normalizedVisitorId)
    .run();

  return deletedCount;
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

export const listAllRepoAuditLogs = async (db: D1Database) => {
  await ensureRepoAuditLogsSchema(db);
  const result = await db
    .prepare(
      `SELECT * FROM repo_review_logs
       ORDER BY created_at DESC`,
    )
    .all<Record<string, unknown>>();

  return result.results.map(normalizeRepoAuditLog);
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

export const updateAdminPlay = async (db: D1Database, playId: string, draft: AdminPlayEditDraft) => {
  const currentPlay = await getAdminPlayById(db, playId);
  if (!currentPlay) {
    return null;
  }

  const nextTitle = String(draft.title ?? currentPlay.title).trim();
  const nextAuthorName = String(draft.authorName ?? currentPlay.authorName).trim();
  const nextCategory = String(draft.category ?? currentPlay.category).trim() || currentPlay.category;
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
  await db
    .prepare(
      `UPDATE plays
       SET title = ?, author_name = ?, category = ?, summary = ?, content = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(nextTitle, nextAuthorName, nextCategory, nextSummary, nextContent, timestamp, playId)
    .run();

  return ensurePlay(db, playId);
};

export const restoreBackupPlays = async (db: D1Database, plays: BackupPlayDraft[]) => {
  const normalizedPlays = plays.map(normalizeBackupPlayDraft);
  const seenIds = new Set<string>();

  for (const play of normalizedPlays) {
    if (!play.id) {
      throw new Error('备份里存在缺少 id 的内容');
    }

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

export const createAdminSession = async (db: D1Database, username: string) => {
  const token = makeId('session');
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

  await db
    .prepare(
      `INSERT INTO admin_sessions (token, username, expires_at, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(token, username, expiresAt, createdAt)
    .run();

  return { token, username, expiresAt } satisfies AdminSessionRecord;
};

export const getAdminSessionFromRequest = async (db: D1Database, request: Request) => {
  const token = readBearerToken(request);
  if (!token) {
    return null;
  }

  const row = await db
    .prepare(
      `SELECT token, username, expires_at
       FROM admin_sessions
       WHERE token = ?
       LIMIT 1`,
    )
    .bind(token)
    .first<Record<string, unknown>>();

  if (!row) {
    return null;
  }

  const session = normalizeSession(row);
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).bind(token).run();
    return null;
  }

  return session;
};

export const deleteAdminSession = async (db: D1Database, request: Request) => {
  const token = readBearerToken(request);
  if (!token) {
    return;
  }

  await db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).bind(token).run();
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
  const nextTitle = String(input.edit?.title ?? currentPlay.title).trim();
  const nextAuthorName = String(input.edit?.authorName ?? currentPlay.authorName).trim();
  const nextCategory = String(input.edit?.category ?? currentPlay.category).trim() || currentPlay.category;
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

  await db.batch([
    db
      .prepare(
        `UPDATE plays
         SET title = ?, author_name = ?, category = ?, summary = ?, content = ?, status = ?, review_note = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(nextTitle, nextAuthorName, nextCategory, nextSummary, nextContent, mappedStatus, reviewNote, timestamp, timestamp, input.playId),
    db
      .prepare(
        `INSERT INTO review_logs (id, play_id, action, operator, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(makeId('review'), input.playId, input.action, input.operator, reviewNote, timestamp),
  ]);

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