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

/* 作者「修改」投稿:把改动写入原 play 的 pending_edit_* 字段,不创建新 play。
 * 审核员通过后会应用并把同系列下所有作品的 title/category 一起更新。 */
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
