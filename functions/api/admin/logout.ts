import { deleteAdminSession, getAdminSessionFromRequest } from '../../_lib/db';
import { error, json } from '../../_lib/http';

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  await deleteAdminSession(env.DB, request);
  return json({ ok: true });
};
