import { makeId, normalizeTag, now } from './http';
import { chunkItems, D1_TAG_REORDER_CHUNK_SIZE } from './db-utils';

type TagDraft = {
  name: string;
};

type TagReorderDraft = {
  orderedIds: string[];
};

const ensureTag = async (db: D1Database, id: string) => {
  const tag = await getTagById(db, id);
  if (!tag) {
    throw new Error('标签写入后读取失败');
  }

  return tag;
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

// 供 plays.ts 复用：小剧场分类需要落到标签表时，按分类名自动创建缺失的标签。
export const ensureTagByName = async (db: D1Database, name: string) => {
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
  for (const [chunkIndex, reorderChunk] of chunkItems(
    remainingTags,
    D1_TAG_REORDER_CHUNK_SIZE,
  ).entries()) {
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

  for (const [chunkIndex, reorderChunk] of chunkItems(
    nextIds,
    D1_TAG_REORDER_CHUNK_SIZE,
  ).entries()) {
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
