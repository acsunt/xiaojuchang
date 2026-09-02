import { getAdminSessionFromRequest, getPendingModifyPlays } from '../../../_lib/db';
import { error, json } from '../../../_lib/http';

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }
  const plays = await getPendingModifyPlays(env.DB);
  return json(plays);
};
