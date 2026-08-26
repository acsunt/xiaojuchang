import { getAdminSessionFromRequest, restoreBackupPlays } from '../../_lib/db';
import { error, json } from '../../_lib/http';

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  try {
    const session = await getAdminSessionFromRequest(env.DB, request);
    if (!session) {
      return error('管理员未登录', 401);
    }

    const body = (await request.json()) as {
      plays?: unknown;
    };

    const plays = Array.isArray(body.plays) ? body.plays : null;
    if (!plays) {
      return error('备份数据格式无效');
    }

    const result = await restoreBackupPlays(
      env.DB,
      plays as Parameters<typeof restoreBackupPlays>[1],
    );
    return json(result);
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '恢复备份失败', 500);
  }
};
