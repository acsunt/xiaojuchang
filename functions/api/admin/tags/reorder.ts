import { getAdminSessionFromRequest, reorderTags } from '../../../_lib/db';
import { error, json } from '../../../_lib/http';

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  const body = (await request.json()) as { orderedIds?: string[] };

  try {
    const tags = await reorderTags(env.DB, { orderedIds: body.orderedIds ?? [] });
    return json(tags);
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '标签排序保存失败');
  }
};
