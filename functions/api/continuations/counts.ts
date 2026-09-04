import { listContinuationCountsByPlayIds } from '../../_lib/db';
import { error, json } from '../../_lib/http';

/* 与 repos/counts 并列的续写计数接口。
 * 前端广场卡片徽章用:每张原文小剧场展示「续写 N」,
 * 替代旧版「衍生 N」徽章(新版本不再走 submission_type='derived')。 */
export const onRequestPost: PagesFunction = async ({ env, request }) => {
  try {
    const body = (await request.json()) as { playIds?: string[] };
    const playIds = Array.isArray(body.playIds) ? body.playIds.map(String) : [];
    return json(await listContinuationCountsByPlayIds(env.DB, playIds));
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '续写计数加载失败', 500);
  }
};
