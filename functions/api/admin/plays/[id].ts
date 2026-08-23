import { deletePlay, getAdminPlayById, getAdminSessionFromRequest, updateAdminPlay } from '../../../_lib/db';
import { error, json } from '../../../_lib/http';

export const onRequestGet: PagesFunction = async ({ env, request, params }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  const id = String(params.id ?? '').trim();
  if (!id) {
    return error('缺少内容 id');
  }

  const play = await getAdminPlayById(env.DB, id);
  if (!play) {
    return error('内容不存在', 404);
  }

  return json(play);
};

export const onRequestPut: PagesFunction = async ({ env, request, params }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  const id = String(params.id ?? '').trim();
  if (!id) {
    return error('缺少内容 id');
  }

  try {
    const body = (await request.json()) as {
      title?: string;
      authorName?: string;
      category?: string;
      summary?: string;
      content?: string;
    };
    const play = await updateAdminPlay(env.DB, id, body);
    if (!play) {
      return error('内容不存在', 404);
    }

    return json(play);
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '内容更新失败');
  }
};

export const onRequestDelete: PagesFunction = async ({ env, request, params }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  const id = String(params.id ?? '').trim();
  if (!id) {
    return error('缺少内容 id');
  }

  const play = await getAdminPlayById(env.DB, id);
  if (!play) {
    return error('内容不存在', 404);
  }

  await deletePlay(env.DB, id);
  return json({ ok: true });
};
