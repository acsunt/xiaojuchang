export const DEFAULT_CATEGORY = '未分类';
/** 旧批量上传兜底值。读到时一律视为未分类，不再作为独立分类存在。 */
export const LEGACY_UNCATEGORIZED = '无分类';
export const CATEGORY_JOIN = ' | ';
export const BUILTIN_TAG_GROUPS = ['世界观', '感情向', '结局', '尺度', '氛围', '特殊'] as const;

export const splitPlayCategories = (category?: string | null) => {
  const raw = category?.trim() ?? '';
  if (!raw || raw === DEFAULT_CATEGORY || raw === LEGACY_UNCATEGORIZED) {
    return [] as string[];
  }

  return raw
    .split('|')
    .map((item) => item.trim())
    .filter((item) => item && item !== DEFAULT_CATEGORY && item !== LEGACY_UNCATEGORIZED);
};

export const joinPlayCategories = (names: string[]) => {
  const unique: string[] = [];
  const seen = new Set<string>();

  names.forEach((name) => {
    const next = name.trim();
    if (!next || next === DEFAULT_CATEGORY || next === LEGACY_UNCATEGORIZED) {
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

export const renameCategoryInValue = (category: string, fromName: string, toName: string) => {
  const next = splitPlayCategories(category).map((item) => (item === fromName ? toName : item));
  return joinPlayCategories(next);
};

export const removeCategoryFromValue = (category: string, name: string) =>
  joinPlayCategories(splitPlayCategories(category).filter((item) => item !== name));
