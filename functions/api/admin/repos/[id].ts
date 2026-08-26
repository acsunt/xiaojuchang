import { deleteRepo, getAdminSessionFromRequest, reviewRepo } from '../../../_lib/db';
import { error, json } from '../../../_lib/http';

export const onRequestPost: PagesFunction = async ({ env, params, request }) => {
  try {
    const session = await getAdminSessionFromRequest(env.DB, request);
    if (!session) {
      return error('管理员未登录', 401);
    }

    const repoId = String(params.id ?? '').trim();
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? '').trim();
    const note = String(body.note ?? '').trim();

    if (action !== 'approve' && action !== 'reject') {
      return error('无效的 repo 审核动作');
    }

    return json(await reviewRepo(env.DB, repoId, action, note, session.username));
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : 'repo 审核失败', 500);
  }
};

export const onRequestDelete: PagesFunction = async ({ env, params, request }) => {
  try {
    const session = await getAdminSessionFromRequest(env.DB, request);
    if (!session) {
      return error('管理员未登录', 401);
    }

    const deleted = await deleteRepo(env.DB, String(params.id ?? '').trim(), session.username);
    if (!deleted) {
      return error('repo 不存在', 404);
    }
    return json({ ok: true });
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : 'repo 删除失败', 500);
  }
};
