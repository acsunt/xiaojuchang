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
