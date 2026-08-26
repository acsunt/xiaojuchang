import { listSubmissionFeedbackByIds } from '../../_lib/db';
import { error, json } from '../../_lib/http';

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  const body = (await request.json()) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map((item) => String(item ?? '')) : [];

  if (ids.length === 0) {
    return error('缺少要查询的投稿记录 id');
  }

  const feedback = await listSubmissionFeedbackByIds(env.DB, ids);
  return json(feedback);
};
