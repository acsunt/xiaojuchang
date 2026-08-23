import { clearReviewLogs, getAdminSessionFromRequest, listReviewLogs } from '../../../../_lib/db';
import { error, json } from '../../../../_lib/http';

export const onRequestGet: PagesFunction = async ({ params, request, env }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  const playId = String(params.id ?? '').trim();
  if (!playId) {
    return error('缺少内容 id');
  }

  const logs = await listReviewLogs(env.DB, playId);
  return json(logs);
};

export const onRequestDelete: PagesFunction = async ({ params, request, env }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  const playId = String(params.id ?? '').trim();
  if (!playId) {
    return error('缺少内容 id');
  }

  const cleared = await clearReviewLogs(env.DB, playId);
  if (!cleared) {
    return error('内容不存在', 404);
  }

  return json({ ok: true });
};
