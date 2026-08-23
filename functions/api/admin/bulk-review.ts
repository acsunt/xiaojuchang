import { bulkReviewPlays, getAdminSessionFromRequest } from '../../_lib/db';
import { error, json, type ReviewAction } from '../../_lib/http';

const validActions: ReviewAction[] = ['approve', 'reject', 'offline'];

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  try {
    const session = await getAdminSessionFromRequest(env.DB, request);
    if (!session) {
      return error('管理员未登录', 401);
    }

    const body = (await request.json()) as {
      ids?: unknown;
      action?: string;
      note?: string;
    };

    const ids = Array.isArray(body.ids) ? body.ids.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
    const action = String(body.action ?? '').trim() as ReviewAction;
    const note = String(body.note ?? '').trim();

    if (!validActions.includes(action)) {
      return error('无效的审核动作');
    }

    if (ids.length === 0) {
      return error('至少选择一篇内容');
    }

    const result = await bulkReviewPlays(env.DB, {
      playIds: ids,
      action,
      note,
      operator: session.username,
    });

    return json(result);
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '批量审核失败', 500);
  }
};