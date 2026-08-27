export type ThemeKey =
  | 'default'
  | 'minimal'
  | 'neumorphism'
  | 'glass'
  | 'corporate'
  | 'gradient'
  | 'memphis'
  | 'cyberpunk'
  | 'swiss'
  | 'editorial'
  | 'illustration'
  | 'isometric'
  | 'retro'
  | 'futuristic'
  | 'pastel'
  | 'brutalism';

export interface ThemeEntry {
  key: ThemeKey;
  name: string;
}

export const DEFAULT_THEME_LIST: ThemeEntry[] = [
  { key: 'default', name: '默认' },
  { key: 'minimal', name: '极简主义' },
  { key: 'neumorphism', name: '新拟态' },
  { key: 'glass', name: '玻璃拟态' },
  { key: 'corporate', name: '商务简约' },
  { key: 'gradient', name: '渐变风格' },
  { key: 'memphis', name: '孟菲斯' },
  { key: 'cyberpunk', name: '赛博朋克' },
  { key: 'swiss', name: '瑞士风格' },
  { key: 'editorial', name: '杂志排版' },
  { key: 'illustration', name: '手绘插画' },
  { key: 'isometric', name: '等距插画' },
  { key: 'retro', name: '复古怀旧' },
  { key: 'futuristic', name: '未来科技' },
  { key: 'pastel', name: '温暖治愈' },
  { key: 'brutalism', name: '粗野主义' },
];
