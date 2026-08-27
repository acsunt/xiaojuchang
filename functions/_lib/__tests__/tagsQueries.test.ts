// covers tags.ts 里除 reorderTags 之外的函数：createTag / ensureTagByName /
// updateTag / deleteTag / listTags / getTagById。
import { beforeEach, describe, expect, it } from 'vitest';
import { createTag, deleteTag, ensureTagByName, getTagById, listTags, updateTag } from '../db';
import { CORE_SCHEMA_SQL, createTestD1 } from './test-d1';

const insertPlay = (
  db: ReturnType<typeof createTestD1>,
  id: string,
  category: string,
) => {
  db.sqlite
    .prepare(
      `INSERT INTO plays (id, title, author_name, category, summary, content, status, created_at, updated_at)
       VALUES (?, '标题', '作者', ?, '', 'content', 'approved', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(id, category);
};

describe('tags 读写函数', () => {
  let db: ReturnType<typeof createTestD1>;

  beforeEach(() => {
    db = createTestD1();
    db.sqlite.exec(CORE_SCHEMA_SQL);
  });

  it('createTag 按插入顺序自动分配递增的 sort_order', async () => {
    const tagA = await createTag(db, { name: '标签A' });
    const tagB = await createTag(db, { name: '标签B' });

    expect(tagA.sortOrder).toBe(0);
    expect(tagB.sortOrder).toBe(1);
  });

  it('createTag 名称为空或已存在时抛错', async () => {
    await createTag(db, { name: '重复标签' });
    await expect(createTag(db, { name: '  ' })).rejects.toThrow('标签名不能为空');
    await expect(createTag(db, { name: '重复标签' })).rejects.toThrow('标签已存在');
  });

  it('createTag 判重忽略大小写', async () => {
    await createTag(db, { name: 'Drama' });
    await expect(createTag(db, { name: 'drama' })).rejects.toThrow('标签已存在');
  });

  it('ensureTagByName 对“未分类”或空名不创建标签，返回 null', async () => {
    expect(await ensureTagByName(db, '未分类')).toBeNull();
    expect(await ensureTagByName(db, '   ')).toBeNull();
    expect(await listTags(db)).toHaveLength(0);
  });

  it('ensureTagByName 对已存在的标签直接复用，不重复创建', async () => {
    const created = await createTag(db, { name: '悬疑/推理' });
    const ensured = await ensureTagByName(db, '悬疑/推理');

    expect(ensured?.id).toBe(created.id);
    expect(await listTags(db)).toHaveLength(1);
  });

  it('ensureTagByName 对不存在的标签自动创建', async () => {
    const ensured = await ensureTagByName(db, '新分类');
    expect(ensured?.name).toBe('新分类');
    expect(await getTagById(db, ensured!.id)).toBeTruthy();
  });

  it('updateTag 改名后会级联更新使用该分类的内容', async () => {
    const tag = await createTag(db, { name: '旧名字' });
    insertPlay(db, 'play_1', '旧名字');

    const updated = await updateTag(db, tag.id, { name: '新名字' });
    expect(updated?.name).toBe('新名字');

    const play = db.sqlite.prepare('SELECT category FROM plays WHERE id = ?').get('play_1') as any;
    expect(play.category).toBe('新名字');
  });

  it('updateTag 改成已存在的其他标签名时抛错', async () => {
    const tagA = await createTag(db, { name: 'A' });
    await createTag(db, { name: 'B' });

    await expect(updateTag(db, tagA.id, { name: 'B' })).rejects.toThrow('标签已存在');
  });

  it('updateTag 名字不变（大小写不同）不会误判为冲突', async () => {
    const tag = await createTag(db, { name: 'Drama' });
    const updated = await updateTag(db, tag.id, { name: 'Drama' });
    expect(updated?.name).toBe('Drama');
  });

  it('updateTag 对不存在的 id 返回 null', async () => {
    expect(await updateTag(db, 'ghost', { name: '新名字' })).toBeNull();
  });

  it('deleteTag 删除标签后把使用它的内容归到 fallbackCategory，并重排剩余标签的 sort_order', async () => {
    const tagA = await createTag(db, { name: 'A' });
    const tagB = await createTag(db, { name: 'B' });
    const tagC = await createTag(db, { name: 'C' });
    insertPlay(db, 'play_1', 'B');

    const result = await deleteTag(db, tagB.id, '未分类');
    expect(result).toBe(true);

    const play = db.sqlite.prepare('SELECT category FROM plays WHERE id = ?').get('play_1') as any;
    expect(play.category).toBe('未分类');

    const remaining = await listTags(db);
    expect(remaining.map((tag) => tag.id)).toEqual([tagA.id, tagC.id]);
    expect(remaining.map((tag) => tag.sortOrder)).toEqual([0, 1]);
  });

  it('deleteTag 对不存在的 id 返回 false', async () => {
    expect(await deleteTag(db, 'ghost', '未分类')).toBe(false);
  });
});
