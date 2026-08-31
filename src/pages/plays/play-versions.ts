import { DEFAULT_CATEGORY, type Play } from '../../types/play';

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

export const buildPlayVersionGroups = (plays: Play[]) => {
  const grouped = new Map<string, Play[]>();

  plays.forEach((play) => {
    const current = grouped.get(getPlayVersionKey(play)) ?? [];
    current.push(play);
    grouped.set(getPlayVersionKey(play), current);
  });

  return [...grouped.entries()]
    .map(([id, groupPlays]) => {
      const sortedPlays = sortPlayVersions(groupPlays);
      const originalPlay = sortedPlays[0];
      return {
        id,
        title: originalPlay.title,
        category: originalPlay.category || DEFAULT_CATEGORY,
        plays: sortedPlays,
      } satisfies PlayVersionGroup;
    })
    .filter((group) => group.plays.length > 1)
    .sort((left, right) => {
      const leftLatest = left.plays[left.plays.length - 1];
      const rightLatest = right.plays[right.plays.length - 1];
      return (
        rightLatest.createdAt.localeCompare(leftLatest.createdAt) ||
        left.title.localeCompare(right.title, 'zh-CN')
      );
    });
};

/**
 * 广场列表折叠：把同 title+category 的多篇合并到"最新版本"这一行,
 * 保留全组用于导出/详情侧栏展示。
 * - 保持来源顺序:按"每组最新版本首次在 items 中出现的位置"排列。
 * - 每组返回 latest = sortPlayVersions 后的最后一项。
 */
export type CollapsedPlayRow = {
  key: string;
  latest: Play;
  versions: Play[];
};

export const collapsePlaysToLatest = (items: Play[]): CollapsedPlayRow[] => {
  const grouped = new Map<string, Play[]>();
  const firstSeenOrder = new Map<string, number>();

  items.forEach((play, index) => {
    const key = getPlayVersionKey(play);
    const current = grouped.get(key);
    if (current) {
      current.push(play);
    } else {
      grouped.set(key, [play]);
      firstSeenOrder.set(key, index);
    }
  });

  /* 用每组"最新版本"在 items 中最早出现的位置作为该行的排序锚点,
   * 保证广场列表按 filteredPlays 的原顺序稳定折叠(排序/筛选逻辑不受破坏)。 */
  const rows = [...grouped.entries()].map(([key, groupPlays]) => {
    const sortedVersions = sortPlayVersions(groupPlays);
    const latest = sortedVersions[sortedVersions.length - 1];
    const latestIndex = items.findIndex((item) => item.id === latest.id);
    return {
      key,
      latest,
      versions: sortedVersions,
      anchor: latestIndex >= 0 ? latestIndex : (firstSeenOrder.get(key) ?? 0),
    };
  });

  return rows
    .sort((left, right) => left.anchor - right.anchor)
    .map(({ key, latest, versions }) => ({ key, latest, versions }));
};
