import { getRepoNoticeSummary, listRepoCountsByPlayIds } from '../../_lib/db';
import { json } from '../../_lib/http';

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  try {
    const body = (await request.json()) as {
      playIds?: string[];
      visitorId?: string;
      readAt?: string;
    };
    const playIds = Array.isArray(body.playIds) ? body.playIds.map(String) : [];
    const visitorId = String(body.visitorId ?? '').trim();

    if (visitorId || body.readAt !== undefined) {
      return json(
        await getRepoNoticeSummary(env.DB, playIds, visitorId, String(body.readAt ?? '')),
      );
    }

    return json(await listRepoCountsByPlayIds(env.DB, playIds));
  } catch (reason) {
    return json(
      { message: reason instanceof Error ? reason.message : 'repo 计数加载失败' },
      { status: 500 },
    );
  }
};
