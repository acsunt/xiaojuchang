import { createPlay, listPublicPlays } from '../../_lib/db';
import { error, json } from '../../_lib/http';

const normalizeImportedSummary = (value: string) => {
  const normalized = value.trim();
  return normalized === '导入数据' ? '' : normalized;
};

export const onRequestGet: PagesFunction = async ({ env }) => {
  const plays = await listPublicPlays(env.DB);
  return json(plays);
};

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  const body = (await request.json()) as Record<string, unknown>;
  const title = String(body.title ?? '').trim();
  const authorName = String(body.authorName ?? '').trim();
  const category = String(body.category ?? '未分类').trim() || '未分类';
  const summary = normalizeImportedSummary(String(body.summary ?? ''));
  const content = String(body.content ?? '').trim();

  if (!title || !authorName || !content) {
    return error('标题、署名、内容不能为空');
  }

  const play = await createPlay(env.DB, {
    title,
    authorName,
    category,
    summary,
    content,
  });

  return json(play, { status: 201 });
};
