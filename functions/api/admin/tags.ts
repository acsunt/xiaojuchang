import { createTag, getAdminSessionFromRequest, listTags } from '../../_lib/db';
import { error, json } from '../../_lib/http';

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  const tags = await listTags(env.DB);
  return json(tags);
};

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  try {
    const body = (await request.json()) as { name?: string };
    const tag = await createTag(env.DB, { name: String(body.name ?? '') });
    return json(tag, { status: 201 });
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '标签创建失败');
  }
};
