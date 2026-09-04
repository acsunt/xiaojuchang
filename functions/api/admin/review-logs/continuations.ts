import { getAdminSessionFromRequest, listAllContinuationAuditLogs } from '../../../_lib/db';
import { error, json } from '../../../_lib/http';

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  try {
    const session = await getAdminSessionFromRequest(env.DB, request);
    if (!session) {
      return error('管理员未登录', 401);
    }
    return json(await listAllContinuationAuditLogs(env.DB));
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '续写审核记录加载失败', 500);
  }
};
