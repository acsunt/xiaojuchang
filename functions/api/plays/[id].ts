import { getPublicPlayById } from '../../_lib/db';
import { error, json } from '../../_lib/http';

export const onRequestGet: PagesFunction = async ({ env, params }) => {
  const id = String(params.id ?? '').trim();
  if (!id) {
    return error('缺少内容 id');
  }

  const play = await getPublicPlayById(env.DB, id);
  if (!play) {
    return error('该内容不存在，或尚未通过审核', 404);
  }

  return json(play);
};
