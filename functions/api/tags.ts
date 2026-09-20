import { createTag, listTags } from '../_lib/db';
import { error, json } from '../_lib/http';

export const onRequestGet: PagesFunction = async ({ env }) => {
  const tags = await listTags(env.DB);
  return json(tags);
};

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  try {
    const body = (await request.json()) as {
      name?: string;
      parentId?: string | null;
    };
    const parentId = String(body.parentId ?? '').trim();
    if (!parentId) {
      throw new Error('新建分类时请选择所属大类');
    }
    const tag = await createTag(env.DB, {
      name: String(body.name ?? ''),
      kind: 'tag',
      parentId,
    });
    return json(tag, { status: 201 });
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '分类创建失败');
  }
};
