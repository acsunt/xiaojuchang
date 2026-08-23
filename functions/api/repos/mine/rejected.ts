import { deleteRejectedReposByVisitor } from '../../../_lib/db';
import { error, json } from '../../../_lib/http';

export const onRequestDelete: PagesFunction = async ({ env, request }) => {
  try {
    const url = new URL(request.url);
    const visitorId = (url.searchParams.get('visitorId') ?? '').trim();

    if (!visitorId) {
      return error('缺少 visitorId');
    }

    const deletedCount = await deleteRejectedReposByVisitor(env.DB, visitorId);
    return json({ ok: true, deletedCount });
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '清空失败', 500);
  }
};