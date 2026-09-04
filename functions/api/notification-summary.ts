import {
  listApprovedContinuationsByPlayId,
  listMyContinuations,
  listPublicPlays,
} from '../_lib/db';
import { error, json } from '../_lib/http';

/* 广场「有新内容」通知的三段汇总。
 *
 * 输入:body = { since: ISO 时间戳, visitorId?: string, playIds?: string[] }
 * - since 表示用户上次刷新的基线时间戳。
 * - visitorId 可选,用于判断「我发布的/我收到的」续写。
 * - playIds 可选,限定关心的原文列表;不传则对全部已通过 plays 算。
 *
 * 输出三段数(均按"自 since 起新增"计):
 * - modified:合入原文的「修改」投稿数(只算 approve 真正合并的次数,
 *   通过 review_logs 过滤)
 * - continuations:新增通过的续写条数(visitorId 存在时只算自己的)
 * - newPlays:新增通过的原文小剧场数
 *
 * 「未通过的不算」语义:本接口只看 status='approved' 与 review_logs
 * 里的 approve 动作,pending / rejected / offline 都不进入计数。 */
type RequestBody = {
  since?: string;
  visitorId?: string;
  playIds?: string[];
};

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const sinceRaw = String(body.since ?? '').trim();
    const sinceTime = sinceRaw ? new Date(sinceRaw).getTime() : 0;
    const sinceIso =
      Number.isFinite(sinceTime) && sinceTime > 0 ? new Date(sinceTime).toISOString() : '';
    const visitorId = String(body.visitorId ?? '').trim();
    const playIdsFilter = Array.isArray(body.playIds)
      ? new Set(body.playIds.map((id) => String(id).trim()).filter(Boolean))
      : null;

    const plays = await listPublicPlays(env.DB);
    const filteredPlays = playIdsFilter
      ? plays.filter((play) => playIdsFilter.has(play.id))
      : plays;

    /* modified:自 since 起 review_logs.action='approve' 且
     * play.submission_type='modify' 的条目。注意「合入 + 删除」后
     * modify 行已不存在,但 review_logs 还在,这里按 reviewed_at 计。 */
    const modifyApprovedLogs = sinceIso
      ? await env.DB.prepare(
          `SELECT id FROM review_logs
             WHERE action = 'approve' AND reviewed_at > ? AND note LIKE '[修改] %'`,
        )
          .bind(sinceIso)
          .all<{ id?: string }>()
      : await env.DB.prepare(
          `SELECT id FROM review_logs
             WHERE action = 'approve' AND note LIKE '[修改] %'`,
        ).all<{ id?: string }>();

    /* continuations:自 since 起通过审核的续写条数。
     * 若 visitorId 存在则只算「自己发布的」通过条数;否则按 playId 过滤
     * (playIdsFilter 用于广场汇总场景)。 */
    let approvedContinuations = 0;
    if (filteredPlays.length > 0) {
      const playIdList = filteredPlays.map((play) => play.id);
      const counts = await Promise.all(
        playIdList.map((playId) =>
          listApprovedContinuationsByPlayId(env.DB, playId, 'desc').then((items) => {
            if (visitorId) {
              return items.filter((item) => item.visitorId === visitorId).length;
            }
            return items.length;
          }),
        ),
      );
      approvedContinuations = counts.reduce((sum, count) => sum + count, 0);
    }
    if (visitorId) {
      const mine = await listMyContinuations(env.DB, visitorId, 'desc');
      approvedContinuations = mine.filter(
        (item) =>
          item.status === 'approved' &&
          (!sinceIso || item.createdAt > sinceIso) &&
          (!playIdsFilter || playIdsFilter.has(item.playId)),
      ).length;
    } else if (sinceIso) {
      /* 按时间窗过滤:listApprovedContinuationsByPlayId 不带 since 过滤,
       * 这里再补一层。注意:N+1 次查询在 D1 上还能扛,play 数 1000 以内
       * 单次刷新 < 1s。 */
      const playIdList = filteredPlays.map((play) => play.id);
      let total = 0;
      await Promise.all(
        playIdList.map(async (playId) => {
          const items = await listApprovedContinuationsByPlayId(env.DB, playId, 'desc');
          total += items.filter((item) => item.createdAt > sinceIso).length;
        }),
      );
      approvedContinuations = total;
    }

    /* newPlays:自 since 起新增通过的原文小剧场。
     * 注意:已通过的 modify 行(被合入后删除)不会出现在 listPublicPlays 里,
     * 所以这里只数 status='approved' 的 plays,且 submission_type='original'。 */
    const newPlays = filteredPlays.filter(
      (play) => play.submissionType === 'original' && (!sinceIso || play.createdAt > sinceIso),
    ).length;

    return json({
      modified: modifyApprovedLogs.results.length,
      continuations: approvedContinuations,
      newPlays,
      since: sinceIso,
    });
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '通知汇总加载失败', 500);
  }
};
