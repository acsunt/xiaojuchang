import { deleteTag, getAdminSessionFromRequest, updateTag } from '../../../_lib/db';
import { error, json } from '../../../_lib/http';

const fallbackCategory = '未分类';

export const onRequestPut: PagesFunction = async ({ env, request, params }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  const tagId = String(params.id ?? '').trim();
  if (!tagId) {
    return error('缺少标签 id');
  }

  try {
    const body = (await request.json()) as { name?: string };
    const updated = await updateTag(env.DB, tagId, { name: String(body.name ?? '') });
    if (!updated) {
      return error('标签不存在', 404);
    }

    return json(updated);
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '标签更新失败');
  }
};

export const onRequestDelete: PagesFunction = async ({ env, request, params }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  const tagId = String(params.id ?? '').trim();
  if (!tagId) {
    return error('缺少标签 id');
  }

  const ok = await deleteTag(env.DB, tagId, fallbackCategory);
  if (!ok) {
    return error('标签不存在', 404);
  }

  return json({ ok: true });
};
