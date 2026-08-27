import type { ThemeKey } from './theme-list';

/**
 * 15 款图床外链字体映射表 —— 与 docs/参考代码/3/code.js 中的 themeFonts 1:1 移植。
 * `default` 主题未配置专属外链字体，统一回退到系统字体栈（在 useThemeController 中处理）。
 */
export interface ThemeFontInfo {
  name: string;
  url: string;
}

export const themeFonts: Record<ThemeKey, ThemeFontInfo | null> = {
  default: null,
  minimal: {
    name: '韩系低饱和苹方黑',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E9%9F%A9%E7%B3%BB%E4%BD%8E%E9%A5%B1%E5%92%8C%E8%8B%B9%E6%96%B9%E9%BB%91.ttf',
  },
  neumorphism: {
    name: '极简小奶圆',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E6%9E%81%E7%AE%80%E5%B0%8F%E5%A5%B6%E5%9C%86.ttf',
  },
  glass: {
    name: '亲一口我的小毛咪',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E4%BA%B2%E4%B8%80%E5%8F%A3%E6%88%91%E7%9A%84%E5%B0%8F%E6%AF%9B%E5%92%AA(1).ttf',
  },
  corporate: {
    name: '方正润黑简约电子风',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E6%96%B9%E6%AD%A3%E6%B6%A6%E9%BB%91%E7%AE%80%E7%BA%A6%E7%94%B5%E5%AD%90%E9%A3%8E(1).ttf',
  },
  gradient: {
    name: '如何忘记你的记忆',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E5%A6%82%E4%BD%95%E5%BF%98%E8%AE%B0%E4%BD%A0%E7%9A%84%E8%AE%B0%E5%BF%86.ttf',
  },
  memphis: {
    name: '玫瑰牵绊断线风筝',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E7%8E%AB%E7%91%B0%E7%89%B5%E7%BB%8A%E6%96%AD%E7%BA%BF%E9%A3%8E%E7%AD%9D(1).ttf',
  },
  cyberpunk: {
    name: '古早聊天室的像素体',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E5%8F%A4%E6%97%A9%E8%81%8A%E5%A4%A9%E5%AE%A4%E7%9A%84%E5%83%8F%E7%B4%A0%E4%BD%93.ttf',
  },
  swiss: {
    name: '方正筑紫A圆体E',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E6%96%B9%E6%AD%A3%E7%AD%91%E7%B4%ABA%E5%9C%86%E4%BD%93E%EF%BC%881%EF%BC%89.ttf',
  },
  editorial: {
    name: '春山与观物 明朝体',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E6%98%A5%E5%B1%B1%E4%B8%8E%E8%A7%82%E7%89%A9%20%E6%98%8E%E6%9C%9D%E4%BD%93.ttf',
  },
  illustration: {
    name: '异次元流浪小猫',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E5%BC%82%E6%AC%A1%E5%85%83%E6%B5%81%E6%B5%AA%E5%B0%8F%E7%8C%AB(1).ttf',
  },
  isometric: {
    name: '云淡风轻雅隶书',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E4%BA%91%E6%B7%A1%E9%A3%8E%E8%BD%BB%E9%9B%85%E9%9A%B6%E4%B9%A6(1).ttf',
  },
  retro: {
    name: '古早小兔叽打字机',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E5%8F%A4%E6%97%A9%E5%B0%8F%E5%85%94%E5%8F%BD%E6%89%93%E5%AD%97%E6%9C%BA(1).ttf',
  },
  futuristic: {
    name: '虚拟的爱正在输入中100',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E8%99%9A%E6%8B%9F%E7%9A%84%E7%88%B1%E6%AD%A3%E5%9C%A8%E8%BE%93%E5%85%A5%E4%B8%AD100(1).ttf',
  },
  pastel: {
    name: '浮世万千欢喜人间',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E6%B5%AE%E4%B8%96%E4%B8%87%E5%8D%83%E6%AC%A2%E5%96%9C%E4%BA%BA%E9%97%B4.ttf',
  },
  brutalism: {
    name: '我偏要一条路走到黑',
    url: 'https://file.garden/aGe4CU9X_j-yMpiG/%E6%88%91%E5%81%8F%E8%A6%81%E4%B8%80%E6%9D%A1%E8%B7%AF%E8%B5%B0%E5%88%B0%E9%BB%91.ttf',
  },
};

/** 仅包含配置了外链字体的主题键（供按需预加载/列表渲染使用）。 */
export const themeFontKeys: ThemeKey[] = (Object.keys(themeFonts) as ThemeKey[]).filter(
  (key) => themeFonts[key] !== null,
);
