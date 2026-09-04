import {
  createContinuation,
  listApprovedContinuationsByPlayId,
  listMyContinuations,
  listReceivedContinuations,
} from '../../_lib/db';
import { error, json } from '../../_lib/http';

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  try {
    const url = new URL(request.url);
    const playId = url.searchParams.get('playId')?.trim() ?? '';
    const visitorId = url.searchParams.get('visitorId')?.trim() ?? '';
    const order = url.searchParams.get('order') === 'desc' ? 'desc' : 'asc';

    if (visitorId) {
      return json(await listMyContinuations(env.DB, visitorId, order));
    }

    if (!playId) {
      return error('缺少小剧场 ID');
    }

    return json(await listApprovedContinuationsByPlayId(env.DB, playId, order));
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '续写加载失败', 500);
  }
};

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (body.mode === 'received') {
      const playIds = Array.isArray(body.playIds) ? body.playIds.map(String) : [];
      const visitorId = String(body.visitorId ?? '').trim();
      const order = body.order === 'asc' ? 'asc' : 'desc';
      return json(await listReceivedContinuations(env.DB, playIds, visitorId, order));
    }

    const playId = String(body.playId ?? '').trim();
    const nickname = String(body.nickname ?? '');
    const visitorId = String(body.visitorId ?? '').trim();
    const summary = String(body.summary ?? '');
    const content = String(body.content ?? '');

    if (!playId || !visitorId) {
      return error('缺少小剧场 ID 或访问者 ID');
    }
    /* nickname 可空:空字符串表示「匿名」,后台统一展示「匿名」,
     * 详情页不展示署名(大概率是原作者本人续写,无需显示)。 */
    if (!summary.trim() || !content.trim()) {
      return error('简介和正文不能为空');
    }

    return json(
      await createContinuation(env.DB, {
        playId,
        nickname,
        visitorId,
        summary,
        content,
      }),
      { status: 201 },
    );
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '续写提交失败', 500);
  }
};
