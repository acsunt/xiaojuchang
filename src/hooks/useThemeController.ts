import { useCallback, useEffect, useState } from 'react';
import type { ThemeEntry, ThemeKey } from '../data/theme-list';
import { DEFAULT_THEME_LIST } from '../data/theme-list';
import { themeFonts } from '../data/theme-fonts';

/* ======================== 存储键 ======================== */
const STYLE_STORAGE_KEY = 'site-style';
const MODE_STORAGE_KEY = 'site-mode';
const LAYOUT_STORAGE_KEY = 'site-layout';
const THEME_CONFIG_STORAGE_KEY = 'site-theme-config';

const DEFAULT_THEME_KEY: ThemeKey = 'default';

export type ThemeMode = 'day' | 'night';
export type LayoutMode = 'scroll' | 'wrap';
export type FontSource = 'theme' | 'system' | 'custom';

export interface ThemeConfig {
  bgType: string;
  bgValue: string;
  lockedImg: boolean;
  lockedContent: boolean;
  fontSource: FontSource;
  fontUrl: string;
  fontName: string;
}

const DEFAULT_THEME_CONFIG: ThemeConfig = {
  bgType: 'none',
  bgValue: '',
  lockedImg: true,
  lockedContent: true,
  fontSource: 'theme',
  fontUrl: '',
  fontName: '',
};

const SAFE_WINDOW = typeof window !== 'undefined';

const readLocalStorage = (key: string): string | null => {
  if (!SAFE_WINDOW) {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeLocalStorage = (key: string, value: string) => {
  if (!SAFE_WINDOW) {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 忽略隐私模式 / 配额限制导致的写入失败 */
  }
};

const readStyle = (): ThemeKey => {
  const stored = readLocalStorage(STYLE_STORAGE_KEY);
  if (stored && stored in themeFonts) {
    return stored as ThemeKey;
  }
  return DEFAULT_THEME_KEY;
};

const readMode = (): ThemeMode => {
  const stored = readLocalStorage(MODE_STORAGE_KEY);
  return stored === 'night' ? 'night' : 'day';
};

const readLayout = (): LayoutMode => {
  const stored = readLocalStorage(LAYOUT_STORAGE_KEY);
  return stored === 'wrap' ? 'wrap' : 'scroll';
};

const readThemeConfig = (): ThemeConfig => {
  const stored = readLocalStorage(THEME_CONFIG_STORAGE_KEY);
  if (!stored) {
    return { ...DEFAULT_THEME_CONFIG };
  }
  try {
    const parsed = JSON.parse(stored) as Partial<ThemeConfig>;
    const merged: ThemeConfig = {
      ...DEFAULT_THEME_CONFIG,
      ...parsed,
    };
    if (
      merged.fontSource !== 'theme' &&
      merged.fontSource !== 'system' &&
      merged.fontSource !== 'custom'
    ) {
      merged.fontSource = 'theme';
    }
    return merged;
  } catch {
    return { ...DEFAULT_THEME_CONFIG };
  }
};

/* ======================== DOM 辅助 ======================== */
const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => {
  if (!SAFE_WINDOW) {
    return null;
  }
  return document.getElementById(id) as T | null;
};

const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const SYSTEM_FONT_FAMILY = `${SYSTEM_FONT_STACK} !important`;

/* ======================== useThemeController 结果 ======================== */
export interface UseThemeControllerResult {
  /** 与 docs/参考代码/3/code.js 的 styles 数组 1:1 对齐,首项已预置 default */
  styles: ReadonlyArray<ThemeEntry>;
  currentStyle: ThemeKey;
  currentMode: ThemeMode;
  currentLayout: LayoutMode;
  themeConfig: ThemeConfig;
  applyState: () => void;
  applyLayout: () => void;
  selectStyle: (key: ThemeKey) => void;
  toggleMode: () => void;
  toggleLayout: () => void;
  resetSettings: () => void;
  /* 字体相关:所有函数均按 code.js 中的语义无损移植 */
  initFontPanel: () => void;
  changeFontSource: (source?: FontSource) => void;
  applyCurrentThemeFontAsCustom: () => void;
  applyCustomFont: (url?: string, name?: string) => boolean;
  refreshCurrentFont: () => void;
  updateFontDOM: (forceReload?: boolean) => Promise<void>;
  toggleFontInputs: () => void;
  saveSettings: () => void;
}

/**
 * 主题 / 日夜 / 排版 / 字体全局状态机。
 *
 * 1. applyState / applyLayout 1:1 移植 docs/参考代码/3/code.js,负责把状态写入
 *    localStorage 与 body 的 data-* 属性。
 * 2. 字体相关函数(initFontPanel / changeFontSource / applyCurrentThemeFontAsCustom /
 *    applyCustomFont / updateFontDOM / loadAndApplyFont / refreshCurrentFont)按参考
 *    code.js 1:1 移植,FontFace API 加载动画(Toast)通过 #fontLoadingOverlay DOM 触发。
 * 3. 仅暴露 React 端需要的副作用 / 回调,DOM 写入全部收敛在此处。
 */
export function useThemeController(): UseThemeControllerResult {
  const [currentStyle, setCurrentStyle] = useState<ThemeKey>(() => readStyle());
  const [currentMode, setCurrentMode] = useState<ThemeMode>(() => readMode());
  const [currentLayout, setCurrentLayout] = useState<LayoutMode>(() => readLayout());
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(() => readThemeConfig());

  /* ---------- 通用持久化 ---------- */
  const saveSettings = useCallback(() => {
    writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(themeConfig));
  }, [themeConfig]);

  /* ---------- 字体加载核心 ---------- */
  const loadAndApplyFont = useCallback(
    async (fontName: string, fontUrl: string, forceReload = false) => {
      if (!SAFE_WINDOW || !fontName || !fontUrl) {
        return;
      }

      const loadingOverlay = $('fontLoadingOverlay');
      const loadingName = $('fontLoadingName');

      if (forceReload) {
        Array.from(document.fonts).forEach((f) => {
          if (f.family === fontName) {
            document.fonts.delete(f);
          }
        });
      }

      let isLoaded = false;
      document.fonts.forEach((f) => {
        if (f.family === fontName && f.status === 'loaded') {
          isLoaded = true;
        }
      });

      if (!isLoaded) {
        try {
          if (loadingName) {
            loadingName.innerText = fontName;
          }
          if (loadingOverlay) {
            loadingOverlay.classList.add('show');
          }
          const font = new FontFace(fontName, `url("${fontUrl}")`);
          await font.load();
          document.fonts.add(font);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('字体加载失败:', err);
        } finally {
          if (loadingOverlay) {
            setTimeout(() => {
              loadingOverlay.classList.remove('show');
            }, 300);
          }
        }
      }
    },
    [],
  );

  const updateFontDOM = useCallback(
    async (forceReload = false) => {
      if (!SAFE_WINDOW) {
        return;
      }

      const source = themeConfig.fontSource;
      let styleTag = $('dynamic-font-style');
      if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'dynamic-font-style';
        document.head.appendChild(styleTag);
      }
      const preview = $('fontPreviewText');

      if (source === 'system') {
        styleTag.innerHTML = `body { font-family: ${SYSTEM_FONT_FAMILY}; }`;
        if (preview) {
          preview.style.fontFamily = SYSTEM_FONT_STACK;
        }
      } else if (source === 'custom' && themeConfig.fontUrl) {
        const { fontUrl: url, fontName: name } = themeConfig;
        await loadAndApplyFont(name || 'MyCustomFont', url, forceReload);
        if (url.includes('.css') || url.includes('fonts.googleapis')) {
          let link = $<HTMLLinkElement>('dynamic-font-link');
          if (link) {
            link.remove();
          }
          link = document.createElement('link');
          link.id = 'dynamic-font-link';
          link.rel = 'stylesheet';
          link.href = url;
          document.head.appendChild(link);
        }
        const safeName = name || 'MyCustomFont';
        styleTag.innerHTML = `body { font-family: '${safeName}', sans-serif !important; }`;
        if (preview) {
          preview.style.fontFamily = `'${safeName}', sans-serif`;
        }
      } else {
        styleTag.innerHTML = '';
        if (preview) {
          preview.style.fontFamily = 'var(--font-family)';
        }
        const themeFontInfo = themeFonts[currentStyle];
        if (themeFontInfo) {
          await loadAndApplyFont(themeFontInfo.name, themeFontInfo.url, forceReload);
        }
      }
    },
    [currentStyle, loadAndApplyFont, themeConfig],
  );

  /* ---------- 主题 / 日夜 / 排版写入 ---------- */
  const applyState = useCallback(() => {
    if (!SAFE_WINDOW) {
      return;
    }
    document.body.setAttribute('data-style', currentStyle);
    document.body.setAttribute('data-mode', currentMode);

    document.querySelectorAll('.switcher button').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.key === currentStyle);
    });

    const modeIcon = $('modeIcon');
    if (modeIcon) {
      modeIcon.className = currentMode === 'day' ? 'fas fa-sun' : 'fas fa-moon';
    }

    writeLocalStorage(STYLE_STORAGE_KEY, currentStyle);
    writeLocalStorage(MODE_STORAGE_KEY, currentMode);

    void updateFontDOM();
  }, [currentMode, currentStyle, updateFontDOM]);

  const applyLayout = useCallback(() => {
    if (!SAFE_WINDOW) {
      return;
    }
    const switcher = $('switcher');
    if (switcher) {
      switcher.className = `switcher layout-${currentLayout}`;
    }
    const layoutIcon = $('layoutIcon');
    if (layoutIcon) {
      layoutIcon.className =
        currentLayout === 'scroll' ? 'fas fa-arrows-alt-h' : 'fas fa-th-large';
    }
    writeLocalStorage(LAYOUT_STORAGE_KEY, currentLayout);
  }, [currentLayout]);

  /* ---------- 字体面板 ---------- */
  const toggleFontInputs = useCallback(() => {
    const cfg = $('customFontConfig');
    if (cfg) {
      cfg.style.display = themeConfig.fontSource === 'custom' ? 'block' : 'none';
    }
  }, [themeConfig.fontSource]);

  const initFontPanel = useCallback(() => {
    if (!SAFE_WINDOW) {
      return;
    }
    const fontRadio = document.querySelector(
      `input[name="fontSource"][value="${themeConfig.fontSource}"]`,
    ) as HTMLInputElement | null;
    if (fontRadio) {
      fontRadio.checked = true;
    }
    const urlInput = $<HTMLInputElement>('customFontUrl');
    if (urlInput) {
      urlInput.value = themeConfig.fontUrl;
    }
    const nameInput = $<HTMLInputElement>('customFontName');
    if (nameInput) {
      nameInput.value = themeConfig.fontName;
    }
    toggleFontInputs();
  }, [themeConfig.fontName, themeConfig.fontSource, themeConfig.fontUrl, toggleFontInputs]);

  const applyCurrentThemeFontAsCustom = useCallback(() => {
    if (!SAFE_WINDOW) {
      return;
    }
    const themeFontInfo = themeFonts[currentStyle];
    if (themeFontInfo) {
      const urlInput = $<HTMLInputElement>('customFontUrl');
      const nameInput = $<HTMLInputElement>('customFontName');
      if (urlInput) {
        urlInput.value = themeFontInfo.url;
      }
      if (nameInput) {
        nameInput.value = themeFontInfo.name;
      }
      const url = urlInput?.value.trim() ?? themeFontInfo.url;
      const name = nameInput?.value.trim() ?? themeFontInfo.name;
      setThemeConfig((prev) => ({
        ...prev,
        fontUrl: url,
        fontName: name,
      }));
      writeLocalStorage(
        THEME_CONFIG_STORAGE_KEY,
        JSON.stringify({
          ...themeConfig,
          fontUrl: url,
          fontName: name,
        }),
      );
    } else {
      // eslint-disable-next-line no-alert
      alert('当前主题未配置专属字体');
    }
  }, [currentStyle, themeConfig]);

  const applyCustomFont = useCallback(
    (urlOverride?: string, nameOverride?: string): boolean => {
      if (!SAFE_WINDOW) {
        return false;
      }
      const urlInput = $<HTMLInputElement>('customFontUrl');
      const nameInput = $<HTMLInputElement>('customFontName');

      let url = (urlOverride ?? urlInput?.value ?? '').trim();
      if (!url) {
        // eslint-disable-next-line no-alert
        alert('请输入有效的字体链接');
        return false;
      }

      let name = (nameOverride ?? nameInput?.value ?? '').trim();
      if (!name) {
        try {
          const pathname = decodeURIComponent(new URL(url).pathname);
          name = pathname.split('/').pop()?.split('.')[0] || 'MyCustomFont';
        } catch {
          const decoded = decodeURIComponent(url);
          name = decoded.split('/').pop()?.split('.')[0] || 'MyCustomFont';
        }
        if (nameInput) {
          nameInput.value = name;
        }
      }

      setThemeConfig((prev) => {
        const next: ThemeConfig = {
          ...prev,
          fontUrl: url,
          fontName: name,
        };
        writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
        return next;
      });

      return true;
    },
    [],
  );

  const changeFontSource = useCallback(
    (source?: FontSource) => {
      const nextSource: FontSource =
        source ??
        ((document.querySelector('input[name="fontSource"]:checked') as HTMLInputElement | null)
          ?.value as FontSource | undefined) ??
        'theme';
      setThemeConfig((prev) => {
        const next: ThemeConfig = { ...prev, fontSource: nextSource };
        writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
      toggleFontInputs();
      void updateFontDOM();
    },
    [toggleFontInputs, updateFontDOM],
  );

  const refreshCurrentFont = useCallback(() => {
    void updateFontDOM(true);
  }, [updateFontDOM]);

  /* ---------- 副作用:state / config 变化时同步 DOM ---------- */
  useEffect(() => {
    applyState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStyle, currentMode]);

  useEffect(() => {
    applyLayout();
  }, [applyLayout]);

  useEffect(() => {
    void updateFontDOM();
    toggleFontInputs();
    saveSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeConfig]);

  /* ---------- 业务回调 ---------- */
  const selectStyle = useCallback((key: ThemeKey) => {
    setCurrentStyle(key);
  }, []);

  const toggleMode = useCallback(() => {
    setCurrentMode((prev) => (prev === 'day' ? 'night' : 'day'));
  }, []);

  const toggleLayout = useCallback(() => {
    setCurrentLayout((prev) => (prev === 'scroll' ? 'wrap' : 'scroll'));
  }, []);

  const resetSettings = useCallback(() => {
    setCurrentStyle(DEFAULT_THEME_KEY);
    setCurrentMode('day');
    setCurrentLayout('scroll');
    setThemeConfig({ ...DEFAULT_THEME_CONFIG });
    writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(DEFAULT_THEME_CONFIG));
  }, []);

  return {
    styles: DEFAULT_THEME_LIST,
    currentStyle,
    currentMode,
    currentLayout,
    themeConfig,
    applyState,
    applyLayout,
    selectStyle,
    toggleMode,
    toggleLayout,
    resetSettings,
    initFontPanel,
    changeFontSource,
    applyCurrentThemeFontAsCustom,
    applyCustomFont,
    refreshCurrentFont,
    updateFontDOM,
    toggleFontInputs,
    saveSettings,
  };
}
