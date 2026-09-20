import { getAdminSessionFromRequest, moveTagToGroup } from '../../../_lib/db';
import { error, json } from '../../../_lib/http';

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  try {
    const body = (await request.json()) as { tagId?: string; parentId?: string };
    const tagId = String(body.tagId ?? '').trim();
    const parentId = String(body.parentId ?? '').trim();
    if (!tagId || !parentId) {
      return error('请选择小类和大类');
    }

    const updated = await moveTagToGroup(env.DB, tagId, parentId);
    if (!updated) {
      return error('小类不存在', 404);
    }

    return json(updated);
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '汇流入海失败');
  }
};
