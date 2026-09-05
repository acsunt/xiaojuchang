import { DEFAULT_CATEGORY, type Play } from '../../types/play';

/**
 * 广场列表不再按"同标题+同分类"折叠合并:每条 play 单独成行展示
 * (历史遗留的同 title+category 数据自然保留在数据源里,
 * 但前台不再做合并,导出时按 flat 列表走)。
 *
 * `play-versions.ts` 现在只剩下版本键 / 排序工具函数,
 * 真正的折叠/分组(`collapsePlaysToLatest` / `buildPlayVersionGroups`)
 * 已经下线,本文件原本的辅助函数也被一同清理掉。
 *
 * 保留 `getPlayVersionKey` 是为了:评论筛选、统计、repo 等逻辑
 * 里仍可能按相同键引用同系列的小剧场,直接复用同一规范化逻辑。 */

export type PlayVersionGroup = {
  id: string;
  title: string;
  category: string;
  plays: Play[];
};

const normalizeVersionKeyPart = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

export const getPlayVersionKey = (play: Pick<Play, 'title' | 'category'>) =>
  `${normalizeVersionKeyPart(play.title)}\n${normalizeVersionKeyPart(play.category || DEFAULT_CATEGORY)}`;

export const sortPlayVersions = (items: Play[]) => {
  const uniqueItems = new Map<string, Play>();
  items.forEach((item) => uniqueItems.set(item.id, item));

  return [...uniqueItems.values()].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.updatedAt.localeCompare(right.updatedAt) ||
      left.id.localeCompare(right.id),
  );
};

export const getPlayVersionLabel = (index: number) => (index === 0 ? '原文' : `版本${index}`);
