export type ChangelogCategory = '新增' | '优化' | '修复';

export type ChangelogVersion = {
  version: string;
  added: string[];
  improved: string[];
  fixed: string[];
};

export const OPEN_CHANGELOG_EVENT = 'mini-theater:open-changelog';

export const visitorChangelog: ChangelogVersion[] = [
  {
    version: '1.3',
    added: [
      '搜索框下面可以点选标题、作者、分类、正文。没点选时搜全部，点选后只搜选中的字段。',
      '顶部 repo 左边加了折叠按钮，可以收起随机、分类、导出等工具栏。',
    ],
    improved: [
      '搜索框单独占一行，更好找。',
      '分类和作者同时展开时，中间加了分隔线。',
      '「随机」左边的折叠只收起搜索和筛选，顶部折叠只收起工具栏，两个互不影响。',
    ],
    fixed: [],
  },
  {
    version: '1.1',
    added: [],
    improved: [
      '手机上导出相关按钮排在同一行。宽度不够时，这一行自己左右滑。',
      '从衍生列表点进详情后，上一条 / 下一条按不同小剧场切换。同一篇的不同版本，仍用详情里的版本按钮。',
    ],
    fixed: ['iPad 不再被当成手机，「一行几个」可以选到 3。'],
  },
];

export const currentChangelogVersion = visitorChangelog[0];

export const openVisitorChangelog = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(OPEN_CHANGELOG_EVENT));
};

export const getChangelogCategories = (entry: ChangelogVersion) => {
  const categories: Array<{ label: ChangelogCategory; items: string[] }> = [];

  if (entry.added.length > 0) {
    categories.push({ label: '新增', items: entry.added });
  }
  if (entry.improved.length > 0) {
    categories.push({ label: '优化', items: entry.improved });
  }
  if (entry.fixed.length > 0) {
    categories.push({ label: '修复', items: entry.fixed });
  }

  return categories;
};
