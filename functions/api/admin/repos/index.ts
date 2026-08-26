import { getAdminSessionFromRequest, listAdminRepos, parseRepoStatus } from '../../../_lib/db';
import { error, json } from '../../../_lib/http';

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  try {
    const session = await getAdminSessionFromRequest(env.DB, request);
    if (!session) {
      return error('管理员未登录', 401);
    }

    const url = new URL(request.url);
    const rawStatus = url.searchParams.get('status');
    const status = parseRepoStatus(rawStatus);
    if (rawStatus?.trim() && !status) {
      return error('无效的 repo 状态筛选');
    }

    return json(await listAdminRepos(env.DB, status));
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : 'repo 审核数据加载失败', 500);
  }
};
