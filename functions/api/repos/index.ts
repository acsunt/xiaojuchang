import { createRepo, listPublicReposByPlayId, listReceivedRepos, listReposByVisitorId } from '../../_lib/db';
import { error, json } from '../../_lib/http';

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  try {
    const url = new URL(request.url);
    const playId = url.searchParams.get('playId')?.trim() ?? '';
    const visitorId = url.searchParams.get('visitorId')?.trim() ?? '';
    const order = url.searchParams.get('order') === 'desc' ? 'desc' : 'asc';

    if (visitorId) {
      return json(await listReposByVisitorId(env.DB, visitorId, order));
    }

    if (!playId) {
      return error('缺少小剧场 ID');
    }

    return json(await listPublicReposByPlayId(env.DB, playId, order));
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : 'repo 加载失败', 500);
  }
};

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (body.mode === 'received') {
      const playIds = Array.isArray(body.playIds) ? body.playIds.map(String) : [];
      const visitorId = String(body.visitorId ?? '').trim();
      const order = body.order === 'asc' ? 'asc' : 'desc';
      return json(await listReceivedRepos(env.DB, playIds, visitorId, order));
    }

    const playId = String(body.playId ?? '').trim();
    const parentId = String(body.parentId ?? '').trim();
    const nickname = String(body.nickname ?? '').trim();
    const visitorId = String(body.visitorId ?? '').trim();
    const content = String(body.content ?? '').trim();

    if (!playId || !nickname || !visitorId || !content) {
      return error('昵称和内容不能为空');
    }

    return json(
      await createRepo(env.DB, {
        playId,
        parentId: parentId || undefined,
        nickname,
        visitorId,
        content,
      }),
      { status: 201 },
    );
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : 'repo 提交失败', 500);
  }
};