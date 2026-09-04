import {
  deleteContinuation,
  getAdminSessionFromRequest,
  getContinuationById,
  reviewContinuation,
  updateContinuationByAdmin,
  updateContinuationByAuthor,
} from '../../_lib/db';
import { error, json } from '../../_lib/http';

const requireAdmin = async (request: Request, db: D1Database) =>
  getAdminSessionFromRequest(db, request);

export const onRequestGet: PagesFunction = async ({ env, params }) => {
  const id = String(params.id ?? '').trim();
  if (!id) {
    return error('缺少续写 id');
  }
  try {
    const continuation = await getContinuationById(env.DB, id);
    if (!continuation) {
      return error('续写不存在', 404);
    }
    return json(continuation);
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '续写加载失败', 500);
  }
};

/* 用户「修改」续写:原地覆盖字段,状态回到 pending 等待重新审核。
 * 不需要管理员会话,但要校验 visitorId 必须是原作者,否则拒绝。 */
export const onRequestPut: PagesFunction = async ({ env, params, request }) => {
  const id = String(params.id ?? '').trim();
  if (!id) {
    return error('缺少续写 id');
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const visitorId = String(body.visitorId ?? '').trim();
    if (!visitorId) {
      return error('缺少访问者 ID');
    }
    const updated = await updateContinuationByAuthor(env.DB, id, visitorId, {
      nickname: typeof body.nickname === 'string' ? body.nickname : undefined,
      summary: typeof body.summary === 'string' ? body.summary : undefined,
      content: typeof body.content === 'string' ? body.content : undefined,
    });
    if (!updated) {
      return error('续写不存在', 404);
    }
    return json(updated);
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '续写修改失败', 500);
  }
};

export const onRequestPost: PagesFunction = async ({ env, params, request }) => {
  const id = String(params.id ?? '').trim();
  if (!id) {
    return error('缺少续写 id');
  }
  const session = await requireAdmin(request, env.DB);
  if (!session) {
    return error('管理员未登录', 401);
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? '').trim();
    const note = String(body.note ?? '').trim();
    if (action !== 'approve' && action !== 'reject') {
      return error('无效的续写审核动作');
    }
    return json(await reviewContinuation(env.DB, id, action, note, session.username));
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '续写审核失败', 500);
  }
};

export const onRequestPatch: PagesFunction = async ({ env, params, request }) => {
  const id = String(params.id ?? '').trim();
  if (!id) {
    return error('缺少续写 id');
  }
  const session = await requireAdmin(request, env.DB);
  if (!session) {
    return error('管理员未登录', 401);
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const updated = await updateContinuationByAdmin(
      env.DB,
      id,
      {
        content: typeof body.content === 'string' ? body.content : undefined,
        summary: typeof body.summary === 'string' ? body.summary : undefined,
        nickname: typeof body.nickname === 'string' ? body.nickname : undefined,
        note: typeof body.note === 'string' ? body.note : undefined,
      },
      session.username,
    );
    if (!updated) {
      return error('续写不存在', 404);
    }
    return json(updated);
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '续写更新失败', 500);
  }
};

export const onRequestDelete: PagesFunction = async ({ env, params, request }) => {
  const id = String(params.id ?? '').trim();
  if (!id) {
    return error('缺少续写 id');
  }
  const session = await requireAdmin(request, env.DB);
  if (!session) {
    return error('管理员未登录', 401);
  }
  try {
    const deleted = await deleteContinuation(env.DB, id, session.username);
    if (!deleted) {
      return error('续写不存在', 404);
    }
    return json({ ok: true });
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '续写删除失败', 500);
  }
};
