import {
  makeId,
  normalizeRepo,
  normalizeRepoAuditLog,
  now,
  type RepoReviewAction,
  type RepoStatus,
} from './http';
import { chunkItems, D1_SELECT_CHUNK_SIZE } from './db-utils';

type RepoDraft = {
  playId: string;
  parentId?: string;
  nickname: string;
  visitorId: string;
  content: string;
};

export const ensureReposSchema = async (db: D1Database) => {
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
