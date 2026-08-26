import { getAdminSessionFromRequest, reviewPlay } from '../../../../_lib/db';
import { error, json, type ReviewAction } from '../../../../_lib/http';

const validActions: ReviewAction[] = ['approve', 'reject', 'offline'];

export const onRequestPost: PagesFunction = async ({ params, request, env }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  const playId = String(params.id ?? '').trim();
  if (!playId) {
    return error('缺少内容 id');
  }

  const body = (await request.json()) as {
    action?: string;
    note?: string;
    title?: string;
    authorName?: string;
    category?: string;
    summary?: string;
    content?: string;
  };
  const action = String(body.action ?? '').trim() as ReviewAction;
  const note = String(body.note ?? '').trim();
  const hasTitle = typeof body.title === 'string';
  const hasAuthorName = typeof body.authorName === 'string';
  const hasCategory = typeof body.category === 'string';
  const hasSummary = typeof body.summary === 'string';
  const hasContent = typeof body.content === 'string';
  const title = hasTitle ? String(body.title).trim() : undefined;
  const authorName = hasAuthorName ? String(body.authorName).trim() : undefined;
  const category = hasCategory ? String(body.category).trim() : undefined;
  const summary = hasSummary ? String(body.summary).trim() : undefined;
  const content = hasContent ? String(body.content) : undefined;

  if (!validActions.includes(action)) {
    return error('无效的审核动作');
  }

  const updatedPlay = await reviewPlay(env.DB, {
    playId,
    action,
    note,
    operator: session.username,
    edit:
      hasTitle || hasAuthorName || hasCategory || hasSummary || hasContent
        ? { title, authorName, category, summary, content }
        : undefined,
  });

  if (!updatedPlay) {
    return error('内容不存在', 404);
  }

  return json(updatedPlay);
};
