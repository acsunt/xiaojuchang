import { getAdminSessionFromRequest, listAdminPlays, parsePlayStatus } from '../../../_lib/db';
import { error, json } from '../../../_lib/http';

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get('status');
  const status = parsePlayStatus(rawStatus);

  if (rawStatus?.trim() && !status) {
    return error('无效的状态筛选');
  }

  const plays = await listAdminPlays(env.DB, status);
  return json(plays);
};