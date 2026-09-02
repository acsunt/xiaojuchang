import { getPublicPlayById, submitPlayEdit } from '../../_lib/db';
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

const normalizeImportedSummary = (value: string) => {
  const normalized = value.trim();
  return normalized === '导入数据' ? '' : normalized;
};

/* 作者「修改」投稿:创建一条 submission_type='modify' 的待审核 play,
 * 用 parent_play_id 指向被改的原 play。审核通过由 reviewPlay 把字段合入
 * 原 play 并删除本条,审核拒绝/下线仅改 status,原 play 不动。 */
export const onRequestPut: PagesFunction = async ({ env, params, request }) => {
  const id = String(params.id ?? '').trim();
  if (!id) {
    return error('缺少内容 id');
  }
  const body = (await request.json()) as Record<string, unknown>;
  const title = String(body.title ?? '').trim();
  const authorName = String(body.authorName ?? '').trim();
  const category = String(body.category ?? '').trim();
  const summary = normalizeImportedSummary(String(body.summary ?? ''));
  const content = String(body.content ?? '').trim();
  if (!title || !authorName || !content) {
    return error('标题、署名、内容不能为空');
  }
  try {
    const updatedPlay = await submitPlayEdit(env.DB, id, {
      title,
      authorName,
      category,
      summary,
      content,
    });
    if (!updatedPlay) {
      return error('内容不存在', 404);
    }
    return json(updatedPlay);
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '修改投稿失败');
  }
};
