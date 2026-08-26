import { createAdminSession, getAdminSessionFromRequest } from '../../_lib/db';
import { error, json } from '../../_lib/http';

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const body = (await request.json()) as { username?: string; password?: string };
  const adminUsername = String(env.ADMIN_USERNAME ?? '').trim();
  const adminPassword = String(env.ADMIN_PASSWORD ?? '').trim();

  if (!adminUsername || !adminPassword) {
    return error('管理员环境变量未配置', 500);
  }

  if (body.username?.trim() !== adminUsername || body.password?.trim() !== adminPassword) {
    return error('账号或密码错误', 401);
  }

  const session = await createAdminSession(env.DB, adminUsername);
  return json(session);
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  return json(session);
};
