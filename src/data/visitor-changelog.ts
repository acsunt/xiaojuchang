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
    version: '1.6',
    added: [
      '顶部新增「主题」按钮，点开可选 16 套主题：默认 / 极简主义 / 新拟态 / 玻璃拟态 / 商务简约 / 渐变风格 / 孟菲斯 / 赛博朋克 / 瑞士风格 / 杂志排版 / 手绘插画 / 等距插画 / 复古怀旧 / 未来科技 / 温暖治愈 / 粗野主义。',
      '「主题」面板里可一键切换日 / 夜模式，也可在滑动 / 换行两种布局间切换。',
      '「主题」面板里的 ⚙ 高级设置：可单独调节字号、UI 缩放、主题透明度、文字遮罩、背景模糊 / 不透明度 / 暗化层；字体源可选用系统字体、主题默认字体，或粘贴字体链接；可锁定背景或内容滑块防误触。',
      '「主题」面板里支持上传自定义背景图（带裁剪框）、粘贴背景图链接、一键清空。',
      '原来用浏览器原生 alert 的提示（复制成功、提交成功、错误提示等）全部换成顶部居中的悬浮小气泡，半秒 / 两秒半自动消失。',
    ],
    improved: [
      '默认主题下，主题面板背景和按钮颜色与同一主题下的其他面板完全统一。',
      '非默认主题（15 套）的卡片 / 按钮 / 输入框 / 弹窗 / 标题 / 提示文字，全部用主题自己的变量驱动样式，不再残留默认主题的玻璃感。',
      '非默认主题下，勾选框的颜色也跟随主题色（背景 / 边框 / 勾子一致），15 套主题里都看得清。',
      '粗野主义夜间模式完整还原粗野风格：所有卡片、按钮、输入框、弹窗、主题面板都改成黄底 + 黑边 + 粗硬阴影 + 黑字。',
      '渐变风格日间模式：标题从看不清的白色改成深紫色，跟半透明白卡形成对比。',
      '圆角按钮上的 1px 半透明边框在切换主题 / 日夜时偶尔闪的问题（毛刺）已修复。',
      '字体默认改为系统字体（启动更快、不浪费流量），想要主题字体可去高级设置 → 字体源 → 主题默认。',
      '上传页投稿历史记录可回填编辑、重新投稿、删除，或一键清空。',
      '顶部 nav 按钮（repo / 衍生 / 新增 / 广场 / 上传小剧场 / 主题）尺寸与字重统一。',
    ],
    fixed: [
      '粗野主义夜间模式下，小剧场标题、主题切换按钮、复制提示等之前看不见字的问题，全部用粗野风格的硬阴影解决。',
      '默认主题下，复制按钮的提示（浅绿底浅绿字）现在改为深绿字浅绿底，对比度足够。',
      'iPad 不再被误判为手机，「一行几个」可以选到 3。',
    ],
  },
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
