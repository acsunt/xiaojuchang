import { makeId, normalizeTag, now, parseTagKind, type TagKind } from './http';
import { chunkItems, D1_TAG_REORDER_CHUNK_SIZE } from './db-utils';
import {
  BUILTIN_TAG_GROUPS,
  DEFAULT_CATEGORY,
  LEGACY_UNCATEGORIZED,
  removeCategoryFromValue,
  renameCategoryInValue,
  splitPlayCategories,
} from './categories';

type TagDraft = {
  name: string;
  kind?: TagKind;
  parentId?: string | null;
};

type TagReorderDraft = {
  orderedIds: string[];
};

const TAG_HIERARCHY_COLUMNS = ['kind', 'parent_id'] as const;
const tagHierarchyCache = new WeakMap<D1Database, boolean>();
const builtinGroupSeedCache = new WeakMap<D1Database, boolean>();

const ensureTag = async (db: D1Database, id: string) => {
  const tag = await getTagById(db, id);
  if (!tag) {
    throw new Error('标签写入后读取失败');
  }

  return tag;
};

export const ensureTagHierarchyColumns = async (db: D1Database): Promise<boolean> => {
  const cached = tagHierarchyCache.get(db);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const rows = await db
      .prepare(`SELECT name FROM pragma_table_info('tags')`)
      .all<{ name?: string }>();
    const existing = new Set(rows.results.map((row) => String(row.name ?? '')));
    const missing = TAG_HIERARCHY_COLUMNS.filter((column) => !existing.has(column));
    if (missing.length === 0) {
      tagHierarchyCache.set(db, true);
      return true;
    }

    const stmts = missing.map((column) => {
      if (column === 'kind') {
        return db.prepare(`ALTER TABLE tags ADD COLUMN kind TEXT NOT NULL DEFAULT 'tag'`);
      }
      return db.prepare(`ALTER TABLE tags ADD COLUMN parent_id TEXT`);
    });
    await db.batch(stmts);
    tagHierarchyCache.set(db, true);
    return true;
  } catch {
    tagHierarchyCache.set(db, false);
    return false;
  }
};

export const ensureBuiltinTagGroups = async (db: D1Database) => {
  if (builtinGroupSeedCache.get(db)) {
    return;
  }

  await ensureTagHierarchyColumns(db);
  const current = await listTagsRaw(db);
  const existingNames = new Set(current.map((tag) => tag.name));
  const timestamp = now();
  let sortOrder = current.reduce((max, tag) => Math.max(max, tag.sortOrder), -1);

  for (const name of BUILTIN_TAG_GROUPS) {
    if (existingNames.has(name)) {
      continue;
    }
    sortOrder += 1;
    await db
      .prepare(
        `INSERT INTO tags (id, name, kind, parent_id, sort_order, created_at, updated_at)
         VALUES (?, ?, 'group', NULL, ?, ?, ?)`,
      )
      .bind(makeId('tag'), name, sortOrder, timestamp, timestamp)
      .run();
  }

  builtinGroupSeedCache.set(db, true);
};

const listTagsRaw = async (db: D1Database) => {
  await ensureTagHierarchyColumns(db);
  const result = await db
    .prepare(
      `SELECT * FROM tags
       ORDER BY sort_order ASC, name COLLATE NOCASE ASC`,
    )
    .all<Record<string, unknown>>();

  return result.results.map(normalizeTag);
};

export const listTags = async (db: D1Database) => {
  await ensureBuiltinTagGroups(db);
  return listTagsRaw(db);
};

export const getTagById = async (db: D1Database, id: string) => {
  await ensureTagHierarchyColumns(db);
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
  await ensureTagHierarchyColumns(db);
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

const resolveParentId = async (db: D1Database, parentId?: string | null) => {
  const normalized = String(parentId ?? '').trim();
  if (!normalized) {
    return null;
  }

  const parent = await getTagById(db, normalized);
  if (!parent || parent.kind !== 'group') {
    throw new Error('目标大类不存在');
  }

  return parent.id;
};

export const createTag = async (db: D1Database, draft: TagDraft) => {
  await ensureTagHierarchyColumns(db);
  const name = draft.name.trim();
  if (!name) {
    throw new Error('标签名不能为空');
  }
  if (name === DEFAULT_CATEGORY || name === LEGACY_UNCATEGORIZED) {
    throw new Error('「未分类」是固定标签，不能再加入标签库');
  }

  const existing = await getTagByName(db, name);
  if (existing) {
    throw new Error('标签已存在');
  }

  const kind = parseTagKind(draft.kind);
  const parentId = kind === 'group' ? null : await resolveParentId(db, draft.parentId);
  const id = makeId('tag');
  const timestamp = now();
  const sortOrder = await getNextTagSortOrder(db);

  await db
    .prepare(
      `INSERT INTO tags (id, name, kind, parent_id, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, name, kind, parentId, sortOrder, timestamp, timestamp)
    .run();

  return ensureTag(db, id);
};

export const ensureTagByName = async (db: D1Database, name: string) => {
  const normalizedName = name.trim();
  if (
    !normalizedName ||
    normalizedName === DEFAULT_CATEGORY ||
    normalizedName === LEGACY_UNCATEGORIZED
  ) {
    return null;
  }

  await ensureTagHierarchyColumns(db);
  const existing = await getTagByName(db, normalizedName);
  if (existing) {
    return existing;
  }

  return createTag(db, { name: normalizedName, kind: 'tag', parentId: null });
};

export const ensureTagsByCategory = async (db: D1Database, category: string) => {
  const names = splitPlayCategories(category);
  for (const name of names) {
    await ensureTagByName(db, name);
  }
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
  if (name === DEFAULT_CATEGORY || name === LEGACY_UNCATEGORIZED) {
    throw new Error('「未分类」是固定标签，不能用作标签名');
  }

  const existing = await getTagByName(db, name);
  if (existing && existing.id !== tagId) {
    throw new Error('标签已存在');
  }

  const nextKind = draft.kind ? parseTagKind(draft.kind) : current.kind;
  if (nextKind !== current.kind) {
    throw new Error('不能更改标签类型');
  }

  const nextParentId =
    current.kind === 'group'
      ? null
      : draft.parentId === undefined
        ? current.parentId
        : await resolveParentId(db, draft.parentId);
  const timestamp = now();
  const plays = await db
    .prepare(`SELECT id, category FROM plays`)
    .all<{ id: string; category: string }>();
  const playUpdates = plays.results
    .map((row) => ({
      id: String(row.id),
      category: renameCategoryInValue(String(row.category ?? ''), current.name, name),
      previous: String(row.category ?? ''),
    }))
    .filter((row) => row.category !== row.previous);

  await db
    .prepare(
      `UPDATE tags
       SET name = ?, parent_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(name, nextParentId, timestamp, tagId)
    .run();

  for (const chunk of chunkItems(playUpdates, D1_TAG_REORDER_CHUNK_SIZE)) {
    await db.batch(
      chunk.map((row) =>
        db
          .prepare(
            `UPDATE plays
             SET category = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(row.category, timestamp, row.id),
      ),
    );
  }

  return ensureTag(db, tagId);
};

export const moveTagToGroup = async (db: D1Database, tagId: string, parentId: string) => {
  const current = await getTagById(db, tagId);
  if (!current) {
    return null;
  }
  if (current.kind === 'group') {
    throw new Error('大类不能再进入另一个大类');
  }

  const nextParentId = await resolveParentId(db, parentId);
  const timestamp = now();
  await db
    .prepare(
      `UPDATE tags
       SET parent_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(nextParentId, timestamp, tagId)
    .run();

  return ensureTag(db, tagId);
};

export const deleteTag = async (db: D1Database, tagId: string, fallbackCategory: string) => {
  const current = await getTagById(db, tagId);
  if (!current) {
    return false;
  }

  const timestamp = now();
  const children =
    current.kind === 'group'
      ? (await listTagsRaw(db)).filter((tag) => tag.parentId === current.id)
      : [];

  if (current.kind === 'group' && children.length > 0) {
    await db.batch(
      children.map((child) =>
        db
          .prepare(
            `UPDATE tags
             SET parent_id = NULL, updated_at = ?
             WHERE id = ?`,
          )
          .bind(timestamp, child.id),
      ),
    );
  }

  const namesToRemove = current.kind === 'group' ? [] : [current.name];
  if (namesToRemove.length > 0) {
    const plays = await db
      .prepare(`SELECT id, category FROM plays`)
      .all<{ id: string; category: string }>();
    const playUpdates = plays.results
      .map((row) => {
        let next = String(row.category ?? '');
        namesToRemove.forEach((name) => {
          next = removeCategoryFromValue(next, name);
        });
        return {
          id: String(row.id),
          category: next || fallbackCategory,
          previous: String(row.category ?? ''),
        };
      })
      .filter((row) => row.category !== row.previous);

    for (const chunk of chunkItems(playUpdates, D1_TAG_REORDER_CHUNK_SIZE)) {
      await db.batch(
        chunk.map((row) =>
          db
            .prepare(
              `UPDATE plays
               SET category = ?, updated_at = ?
               WHERE id = ?`,
            )
            .bind(row.category, timestamp, row.id),
        ),
      );
    }
  }

  await db.prepare(`DELETE FROM tags WHERE id = ?`).bind(tagId).run();

  const remainingTags = await listTagsRaw(db);
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
  const currentTags = await listTagsRaw(db);
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
