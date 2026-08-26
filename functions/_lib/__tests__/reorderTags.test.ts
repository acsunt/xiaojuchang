import { beforeEach, describe, expect, it } from 'vitest';
import { reorderTags } from '../db';
import { CORE_SCHEMA_SQL, createTestD1 } from './test-d1';

const insertTag = (
  db: ReturnType<typeof createTestD1>,
  id: string,
  name: string,
  sortOrder: number,
) => {
  db.sqlite
    .prepare(
      `INSERT INTO tags (id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(id, name, sortOrder);
};

describe('reorderTags', () => {
  let db: ReturnType<typeof createTestD1>;

  beforeEach(() => {
    db = createTestD1();
    db.sqlite.exec(CORE_SCHEMA_SQL);
    insertTag(db, 'tag_a', 'A', 0);
    insertTag(db, 'tag_b', 'B', 1);
    insertTag(db, 'tag_c', 'C', 2);
  });

  it('按传入的顺序重新赋值 sort_order，并返回排序后的标签列表', async () => {
    const result = await reorderTags(db, { orderedIds: ['tag_c', 'tag_a', 'tag_b'] });

    expect(result.map((tag) => tag.id)).toEqual(['tag_c', 'tag_a', 'tag_b']);

    const rows = db.sqlite.prepare('SELECT id, sort_order FROM tags ORDER BY sort_order ASC').all();
    expect(rows.map((row: any) => row.id)).toEqual(['tag_c', 'tag_a', 'tag_b']);
  });

  it('传入数量和现有标签数量不一致时应拒绝，且不改动任何 sort_order', async () => {
    await expect(reorderTags(db, { orderedIds: ['tag_a', 'tag_b'] })).rejects.toThrow('数量不匹配');

    const rows = db.sqlite.prepare('SELECT id, sort_order FROM tags ORDER BY sort_order ASC').all();
    expect(rows.map((row: any) => row.id)).toEqual(['tag_a', 'tag_b', 'tag_c']);
  });

  it('传入的 id 里存在重复时应拒绝', async () => {
    await expect(reorderTags(db, { orderedIds: ['tag_a', 'tag_a', 'tag_b'] })).rejects.toThrow(
      '数据无效',
    );
  });

  it('传入不存在的标签 id 时应拒绝', async () => {
    await expect(reorderTags(db, { orderedIds: ['tag_a', 'tag_b', 'tag_ghost'] })).rejects.toThrow(
      '数据无效',
    );
  });

  it('传入的 id 带有多余空白时会被自动 trim', async () => {
    const result = await reorderTags(db, { orderedIds: [' tag_b ', 'tag_a', 'tag_c'] });
    expect(result.map((tag) => tag.id)).toEqual(['tag_b', 'tag_a', 'tag_c']);
  });
});
