import type { Play, Tag } from '../types/play';
import { DEFAULT_CATEGORY } from '../types/play';

export const CATEGORY_JOIN = ' | ';
export const BUILTIN_TAG_GROUPS = ['世界观', '感情向', '结局', '尺度', '氛围', '特殊'] as const;

export const splitPlayCategories = (category?: string | null) => {
  const raw = category?.trim() ?? '';
  if (!raw || raw === DEFAULT_CATEGORY) {
    return [] as string[];
  }

  return raw
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const joinPlayCategories = (names: string[]) => {
  const unique: string[] = [];
  const seen = new Set<string>();

  names.forEach((name) => {
    const next = name.trim();
    if (!next || next === DEFAULT_CATEGORY) {
      return;
    }
    const key = next.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    unique.push(next);
  });

  return unique.length > 0 ? unique.join(CATEGORY_JOIN) : DEFAULT_CATEGORY;
};

export const formatPlayCategoryLabels = (category?: string | null) => {
  const names = splitPlayCategories(category);
  return names.length > 0 ? names.join(' · ') : DEFAULT_CATEGORY;
};

export const playHasCategoryName = (play: Pick<Play, 'category'>, name: string) => {
  const target = name.trim();
  if (!target) {
    return true;
  }
  return splitPlayCategories(play.category).some((item) => item === target);
};

export const renameCategoryInValue = (category: string, fromName: string, toName: string) => {
  const next = splitPlayCategories(category).map((item) => (item === fromName ? toName : item));
  return joinPlayCategories(next);
};

export const removeCategoryFromValue = (category: string, name: string) => {
  return joinPlayCategories(splitPlayCategories(category).filter((item) => item !== name));
};

export const isGroupTag = (tag: Tag) => tag.kind === 'group';
export const isLeafTag = (tag: Tag) => tag.kind !== 'group';

export const countTagsByKind = (tags: Tag[]) => ({
  groupCount: tags.filter(isGroupTag).length,
  leafCount: tags.filter(isLeafTag).length,
});

export const sortTagsByOrder = (items: Tag[]) =>
  [...items].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'zh-CN'),
  );

export type TagGroupNode = {
  group: Tag | null;
  children: Tag[];
};

export const buildTagGroupNodes = (tags: Tag[]): TagGroupNode[] => {
  const groups = sortTagsByOrder(tags.filter(isGroupTag));
  const leaves = sortTagsByOrder(tags.filter(isLeafTag));
  const groupIdSet = new Set(groups.map((item) => item.id));
  const childrenByParent = new Map<string, Tag[]>();
  const ungrouped: Tag[] = [];

  leaves.forEach((tag) => {
    const parentId = tag.parentId;
    if (parentId && groupIdSet.has(parentId)) {
      const current = childrenByParent.get(parentId) ?? [];
      current.push(tag);
      childrenByParent.set(parentId, current);
      return;
    }
    ungrouped.push(tag);
  });

  const nodes: TagGroupNode[] = groups.map((group) => ({
    group,
    children: childrenByParent.get(group.id) ?? [],
  }));

  if (ungrouped.length > 0) {
    nodes.push({ group: null, children: ungrouped });
  }

  return nodes;
};

export const sortCategoryNamesByTagOrder = (names: string[], tags: Tag[]) => {
  const unique = splitPlayCategories(joinPlayCategories(names));
  const rank = new Map<string, number>();
  let index = 0;
  buildTagGroupNodes(tags).forEach((node) => {
    node.children.forEach((tag) => {
      rank.set(tag.name.toLowerCase(), index);
      index += 1;
    });
  });

  return [...unique].sort((left, right) => {
    const leftRank = rank.get(left.toLowerCase());
    const rightRank = rank.get(right.toLowerCase());
    if (leftRank == null && rightRank == null) {
      return left.localeCompare(right, 'zh-CN');
    }
    if (leftRank == null) {
      return 1;
    }
    if (rightRank == null) {
      return -1;
    }
    return leftRank - rightRank;
  });
};

export const joinPlayCategoriesByTags = (names: string[], tags: Tag[]) =>
  joinPlayCategories(sortCategoryNamesByTagOrder(names, tags));

export const getLeafTags = (tags: Tag[]) => sortTagsByOrder(tags.filter(isLeafTag));

export const getGroupTags = (tags: Tag[]) => sortTagsByOrder(tags.filter(isGroupTag));

export const findTagByName = (tags: Tag[], name: string) => {
  const target = name.trim().toLowerCase();
  return tags.find((tag) => tag.name.trim().toLowerCase() === target);
};

export const getChildTagNames = (tags: Tag[], group: Tag) =>
  tags.filter((tag) => isLeafTag(tag) && tag.parentId === group.id).map((tag) => tag.name);

export const playMatchesCategoryFilter = (
  play: Pick<Play, 'category'>,
  activeCategory: string,
  tags: Tag[],
) => {
  const target = activeCategory.trim();
  if (!target) {
    return true;
  }
  if (target === DEFAULT_CATEGORY) {
    return splitPlayCategories(play.category).length === 0;
  }

  const matched = findTagByName(tags, target);
  if (matched && isGroupTag(matched)) {
    const childNames = new Set(getChildTagNames(tags, matched));
    return splitPlayCategories(play.category).some((name) => childNames.has(name));
  }

  return playHasCategoryName(play, target);
};

export const playMatchesCategoryFilters = (
  play: Pick<Play, 'category'>,
  activeCategories: string[],
  tags: Tag[],
) => {
  const targets = activeCategories.map((name) => name.trim()).filter(Boolean);
  if (targets.length === 0) {
    return true;
  }
  return targets.every((name) => playMatchesCategoryFilter(play, name, tags));
};

export const collectPlayCategorySearchText = (play: Pick<Play, 'category'>) =>
  formatPlayCategoryLabels(play.category);

export const formatPlayLeafCategoryLabels = (category: string | undefined, tags: Tag[]) => {
  const names = splitPlayCategories(category);
  if (names.length === 0) {
    return DEFAULT_CATEGORY;
  }
  const groupNames = new Set(tags.filter(isGroupTag).map((tag) => tag.name));
  const leafNames = names.filter((name) => !groupNames.has(name));
  return leafNames.length > 0 ? leafNames.join(' · ') : DEFAULT_CATEGORY;
};

export type CategoryCombination = {
  names: string[];
  label: string;
  count: number;
};

export const collectPlayCategoryCombinations = (
  plays: Array<Pick<Play, 'category'>>,
  tags: Tag[],
): CategoryCombination[] => {
  const groupNames = new Set(tags.filter(isGroupTag).map((tag) => tag.name));
  const counts = new Map<string, { names: string[]; count: number }>();

  plays.forEach((play) => {
    const names = sortCategoryNamesByTagOrder(
      splitPlayCategories(play.category).filter((name) => !groupNames.has(name)),
      tags,
    );
    if (names.length < 2) {
      return;
    }

    const key = names.map((name) => name.toLowerCase()).join('\n');
    const current = counts.get(key);
    if (current) {
      current.count += 1;
      return;
    }
    counts.set(key, { names, count: 1 });
  });

  return [...counts.values()]
    .map((item) => ({
      names: item.names,
      label: item.names.join(' · '),
      count: item.count,
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.names.length - right.names.length ||
        left.label.localeCompare(right.label, 'zh-CN'),
    );
};
