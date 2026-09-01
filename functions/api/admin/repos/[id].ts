import {
  deleteRepo,
  getAdminSessionFromRequest,
  reviewRepo,
  updateRepoContent,
} from '../../../_lib/db';
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

/* 任务 5：管理员可改 repo 的正文与审核备注，状态机不动。
 * 只接受 content / note 两个字段；空字符串视为清空。 */
export const onRequestPatch: PagesFunction = async ({ env, params, request }) => {
  try {
    const session = await getAdminSessionFromRequest(env.DB, request);
    if (!session) {
      return error('管理员未登录', 401);
    }

    const repoId = String(params.id ?? '').trim();
    const body = (await request.json()) as Record<string, unknown>;
    const patch: { content?: string; note?: string } = {};
    if (typeof body.content === 'string') {
      patch.content = body.content;
    }
    if (typeof body.note === 'string') {
      patch.note = body.note;
    }

    if (patch.content === undefined && patch.note === undefined) {
      return error('没有可更新的字段');
    }

    const updated = await updateRepoContent(env.DB, repoId, patch, session.username);
    if (!updated) {
      return error('repo 不存在', 404);
    }
    return json(updated);
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : 'repo 更新失败', 500);
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
