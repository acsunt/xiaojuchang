import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThemeEntry, ThemeKey } from '../data/theme-list';
import { DEFAULT_THEME_LIST } from '../data/theme-list';
import { themeFonts } from '../data/theme-fonts';
import { showFloatingToast } from '../components/floating-toast-store';
import {
  BACKGROUND_BLOB_KEY,
  clearBackground as clearBackgroundStore,
  createBlobUrl,
  downloadBlob,
  getBackgroundRecord,
  revokeAllBlobUrls,
  saveBackgroundFromDataUrl,
  saveBackgroundUrl,
} from '../services/browser-background-store';

/* ======================== 存储键 ======================== */
const STYLE_STORAGE_KEY = 'site-style';
const MODE_STORAGE_KEY = 'site-mode';
const LAYOUT_STORAGE_KEY = 'site-layout';
const THEME_CONFIG_STORAGE_KEY = 'site-theme-config';
const LEGACY_SLIDER_KEY = 'sp-settings';
/* 一次性迁移标记：把所有老用户的字体源强制重置为 system（之前默认是 theme，
 * 会自动加载主题字体）。标记位只写一次，之后由用户主动设置。 */
const FONT_SOURCE_MIGRATION_KEY = 'site-font-source-default-applied';
/* 一次性迁移标记：老版本把背景图 base64 塞在 localStorage.site-theme-config.bgValue 里,
 * 现在改成图片本体存 IndexedDB,localStorage 只存 key('current') 或远程 URL。
 * 检测到老 data URL 就立刻搬到 IndexedDB 并把 localStorage 里的 bgValue 改写。*/
const BG_BLOB_MIGRATION_KEY = 'site-bg-blob-migrated-to-indexeddb';

const DEFAULT_THEME_KEY: ThemeKey = 'default';

export type ThemeMode = 'day' | 'night';
export type LayoutMode = 'scroll' | 'wrap';
export type FontSource = 'theme' | 'system' | 'custom';

export interface ThemeConfig {
  /* 滑块（与 docs/参考代码/4/code.js 的 loadSettings 完全对齐） */
  textScale: number;
  uiScale: number;
  bgBlur: number;
  bgOpacity: number;
  bgOverlay: number;
  systemTextScale: boolean;
  /* 锁定 */
  lockedImg: boolean;
  lockedContent: boolean;
  /* 自定义背景 */
  bgType: string;
  bgValue: string;
  /* 字体 */
  fontSource: FontSource;
  fontUrl: string;
  fontName: string;
}

const DEFAULT_THEME_CONFIG: ThemeConfig = {
  textScale: 100,
  uiScale: 100,
  bgBlur: 0,
  bgOpacity: 1,
  bgOverlay: 0,
  systemTextScale: false,
  lockedImg: true,
  lockedContent: true,
  bgType: 'none',
  bgValue: '',
  fontSource: 'system',
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
  /* 1) 优先使用新的统一存储 */
  const stored = readLocalStorage(THEME_CONFIG_STORAGE_KEY);
  if (stored) {
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
      /* 落到兼容分支 */
    }
  }
  /* 2) 兼容旧的 sp-* 散列键 + sp-settings 聚合键（与 code.js 完全对齐） */
  const legacySlider = readLocalStorage(LEGACY_SLIDER_KEY);
  let slider: Record<string, unknown> = {};
  if (legacySlider) {
    try {
      slider = JSON.parse(legacySlider) as Record<string, unknown>;
    } catch {
      slider = {};
    }
  }
  const numFrom = (raw: unknown, fallback: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  const merged: ThemeConfig = {
    ...DEFAULT_THEME_CONFIG,
    textScale: numFrom(slider.textScale, DEFAULT_THEME_CONFIG.textScale),
    uiScale: numFrom(slider.uiScale, DEFAULT_THEME_CONFIG.uiScale),
    bgBlur: numFrom(slider.bgBlur, DEFAULT_THEME_CONFIG.bgBlur),
    bgOpacity: numFrom(slider.bgOpacity, DEFAULT_THEME_CONFIG.bgOpacity),
    bgOverlay: numFrom(slider.bgOverlay, DEFAULT_THEME_CONFIG.bgOverlay),
    lockedImg:
      readLocalStorage('sp-locked-img') === 'false' ? false : DEFAULT_THEME_CONFIG.lockedImg,
    lockedContent:
      readLocalStorage('sp-locked-content') === 'false'
        ? false
        : DEFAULT_THEME_CONFIG.lockedContent,
    bgType: readLocalStorage('sp-bg-type') || DEFAULT_THEME_CONFIG.bgType,
    bgValue: readLocalStorage('sp-bg-value') || DEFAULT_THEME_CONFIG.bgValue,
    fontSource:
      (readLocalStorage('sp-font-source') as FontSource | null) || DEFAULT_THEME_CONFIG.fontSource,
    fontUrl: readLocalStorage('sp-font-url') || DEFAULT_THEME_CONFIG.fontUrl,
    fontName: readLocalStorage('sp-font-name') || DEFAULT_THEME_CONFIG.fontName,
  };
  if (
    merged.fontSource !== 'theme' &&
    merged.fontSource !== 'system' &&
    merged.fontSource !== 'custom'
  ) {
    merged.fontSource = 'theme';
  }
  return merged;
};

/* ======================== DOM 辅助 ======================== */
const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => {
  if (!SAFE_WINDOW) {
    return null;
  }
  return document.getElementById(id) as T | null;
};

const $range = (id: string): HTMLInputElement | null => $(id) as HTMLInputElement | null;

const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const SYSTEM_FONT_FAMILY = `${SYSTEM_FONT_STACK} !important`;

/* ======================== 全局 Cropper 实例（与 code.js 同级作用域） ======================== */
interface CropperInstanceLike {
  destroy(): void;
  reset(): void;
  getCroppedCanvas(options?: {
    maxWidth?: number;
    maxHeight?: number;
    [key: string]: unknown;
  }): HTMLCanvasElement;
}

declare global {
  interface Window {
    Cropper?: new (
      target: HTMLImageElement | HTMLCanvasElement,
      options?: Record<string, unknown>,
    ) => CropperInstanceLike;
  }
}

let cropperInstance: CropperInstanceLike | null = null;

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
  /* 高级设置:滑块 / 锁定 / 沉浸特效 */
  loadSettings: () => void;
  initLocks: () => void;
  toggleThemeLock: (type: 'img' | 'content') => void;
  toggleSystemTextScale: () => void;
  updateTextScale: () => void;
  updateUiScale: () => void;
  updateBgAdjustment: () => void;
  initSliderHideEffect: () => void;
  /* 自定义背景:上传 / 裁剪 / URL / 清空 */
  handleBgUpload: (inputOrFile: HTMLInputElement | File) => void;
  openCropperModal: (src: string) => void;
  confirmCrop: () => void;
  applyBgUrl: () => void;
  applyBgUrlFromString: (url: string) => void;
  clearBackground: () => void;
  downloadBackgroundImage: () => Promise<void>;
  updateBgPreviewUI: () => void;
  closeModal: (id: string) => void;
  resetCropper: () => void;
  cropperReady: boolean;
  /* 裁剪模态框的 React 受控状态(由 App.tsx 直接绑定到 <CropperModal>) */
  cropperModalOpen: boolean;
  cropperModalSrc: string;
  closeCropperModal: () => void;
  /* React 受控端直接传值的 setters（与 DOM 解耦） */
  updateTextScaleFromValue: (value: number) => void;
  updateUiScaleFromValue: (value: number) => void;
  updateBgBlurFromValue: (value: number) => void;
  updateBgOpacityFromValue: (value: number) => void;
  updateBgOverlayFromValue: (value: number) => void;
}

/**
 * 主题 / 日夜 / 排版 / 字体全局状态机。
 *
 * 1. applyState / applyLayout 1:1 移植 docs/参考代码/3/code.js,负责把状态写入
 *    localStorage 与 body 的 data-* 属性。
 * 2. 字体相关函数(initFontPanel / changeFontSource / applyCurrentThemeFontAsCustom /
 *    applyCustomFont / updateFontDOM / loadFontsParallel / loadOneFont / refreshCurrentFont)
 *    按参考 code.js 1:1 移植,FontFace API 加载动画(Toast)通过 #fontLoadingOverlay DOM 触发。
 * 3. 仅暴露 React 端需要的副作用 / 回调,DOM 写入全部收敛在此处。
 */
export function useThemeController(): UseThemeControllerResult {
  const [currentStyle, setCurrentStyle] = useState<ThemeKey>(() => readStyle());
  const [currentMode, setCurrentMode] = useState<ThemeMode>(() => readMode());
  const [currentLayout, setCurrentLayout] = useState<LayoutMode>(() => readLayout());
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(() => {
    const cfg = readThemeConfig();
    /* 一次性迁移：把老用户的字体源从默认 'theme' 强制重置为 'system'。
     * 之前默认会自动加载主题字体，现在默认使用系统字体；用户需要时
     * 可在高级设置里把"字体源"切到"主题默认"或"自定义链接"启用。
     * 标记写入 localStorage 后不再触发，保留用户后续主动设置。 */
    if (SAFE_WINDOW && !readLocalStorage(FONT_SOURCE_MIGRATION_KEY)) {
      if (cfg.fontSource !== 'custom') {
        cfg.fontSource = 'system';
      }
      writeLocalStorage(FONT_SOURCE_MIGRATION_KEY, '1');
      writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(cfg));
      writeLocalStorage('sp-font-source', cfg.fontSource);
    }
    /* 标记位置由下面的 useEffect 完成实际搬数据,这里先不修改 cfg.bgValue,
     * 避免 useState init 阶段触发 setState 造成 warning。*/
    return cfg;
  });
  /* 标记 Cropper.js 全局脚本是否就绪（由 index.html 的 defer 脚本提供） */
  const [cropperReady, setCropperReady] = useState<boolean>(() => SAFE_WINDOW && !!window.Cropper);
  /* 裁剪模态框显隐与待裁剪图源(由 controller 内部统一管理,App.tsx 直接绑定即可) */
  const [cropperModalOpen, setCropperModalOpen] = useState(false);
  const [cropperModalSrc, setCropperModalSrc] = useState<string>('');

  /* 一次性迁移:把老版本塞在 localStorage.site-theme-config.bgValue 里的 data URL
   * 背景图搬到 IndexedDB。
   * 之所以放 useEffect 而不是 useState init,是因为这里要异步写 IndexedDB,
   * useState init 阶段调 setState 会触发 React warning;
   * 放 effect 里,迁移完成后用 setThemeConfig 改 bgValue = BACKGROUND_BLOB_KEY,
   * 后续 themeConfig useEffect 会自动调 updateBgPreviewUI 把图刷出来。*/
  useEffect(() => {
    if (!SAFE_WINDOW) return;
    if (readLocalStorage(BG_BLOB_MIGRATION_KEY)) return;
    /* 即便当前没有 data URL 也要写标记位,避免每次启动都走判断分支。*/
    if (themeConfig.bgType !== 'image' || !themeConfig.bgValue.startsWith('data:')) {
      writeLocalStorage(BG_BLOB_MIGRATION_KEY, '1');
      return;
    }
    const legacyDataUrl = themeConfig.bgValue;
    writeLocalStorage(BG_BLOB_MIGRATION_KEY, '1');
    void saveBackgroundFromDataUrl(legacyDataUrl)
      .then(() => {
        setThemeConfig((prev) => {
          if (prev.bgValue === BACKGROUND_BLOB_KEY) return prev;
          const next: ThemeConfig = { ...prev, bgValue: BACKGROUND_BLOB_KEY };
          writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
      })
      .catch((err) => {
        console.warn('[theme] 背景图迁移到 IndexedDB 失败,回退到无背景:', err);
        setThemeConfig((prev) => {
          const next: ThemeConfig = { ...prev, bgType: 'none', bgValue: '' };
          writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!SAFE_WINDOW) {
      return;
    }
    if (window.Cropper) {
      setCropperReady(true);
      return;
    }
    const timer = window.setInterval(() => {
      if (window.Cropper) {
        setCropperReady(true);
        window.clearInterval(timer);
      }
    }, 80);
    /* 至多轮询 5s 后停止,避免内存泄漏 */
    const stop = window.setTimeout(() => window.clearInterval(timer), 5000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, []);

  /* 通用持久化：把当前 state 完整写回 localStorage。
   * 同时把滑块 DOM 端的最新值（用户在拖动时实时变更的值）一并同步,
   * 保证下一次 loadSettings() 能精确还原。 */
  const saveSettings = useCallback(() => {
    setThemeConfig((prev) => {
      writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(prev));
      return prev;
    });
    /* 同步 sp-* 兼容键,使旧代码读取也不丢失（与 code.js 中 saveSettings 行为一致） */
    writeLocalStorage(
      LEGACY_SLIDER_KEY,
      JSON.stringify({
        textScale: themeConfig.textScale,
        uiScale: themeConfig.uiScale,
        bgBlur: themeConfig.bgBlur,
        bgOpacity: themeConfig.bgOpacity,
        bgOverlay: themeConfig.bgOverlay,
      }),
    );
    writeLocalStorage('sp-locked-img', String(themeConfig.lockedImg));
    writeLocalStorage('sp-locked-content', String(themeConfig.lockedContent));
    writeLocalStorage('sp-bg-type', themeConfig.bgType);
    writeLocalStorage('sp-bg-value', themeConfig.bgValue);
    writeLocalStorage('sp-font-source', themeConfig.fontSource);
    writeLocalStorage('sp-font-url', themeConfig.fontUrl);
    writeLocalStorage('sp-font-name', themeConfig.fontName);
  }, [themeConfig]);

  /* ---------- 字体加载核心 ----------
   * 设计：
   * 1. 加载提示（#fontLoadingOverlay）用引用计数控制显示：
   *    进入加载时 count++ => 显示；任意一个加载完成 count--；归零时延迟 300ms 隐藏。
   *    这样默认主题字体 + 自定义链接字体可以并行触发，overlay 也不会被来回闪烁。
   * 2. 每个字体任务由 loadOneFont() 独立完成,内部保证 cache / 失败重试 / overlay 计数++/--。
   * 3. updateFontDOM() 同时加载默认主题字体和自定义链接字体,P即可并行。
   *    自定义源(custom)只加载自定义字体,默认源(theme/system)只加载默认字体。*/
  const loadingCountRef = useRef(0);
  const loadingNamesRef = useRef<string[]>([]);

  /** 推入一个正在加载中的字体名,刷新 overlay 上的文件名展示 */
  const pushLoadingName = (fontName: string) => {
    const list = loadingNamesRef.current;
    if (!list.includes(fontName)) {
      list.push(fontName);
    }
    const loadingName = $('fontLoadingName');
    if (loadingName) {
      loadingName.innerText = list.length === 1 ? list[0] : `${list[0]} 等 ${list.length} 个`;
    }
  };

  /** 加载完成时把字体名从列表中移除,刷新 overlay 上的文件名 */
  const dropLoadingName = (fontName: string) => {
    loadingNamesRef.current = loadingNamesRef.current.filter((name: string) => name !== fontName);
    const loadingName = $('fontLoadingName');
    if (loadingName) {
      const list = loadingNamesRef.current;
      if (list.length === 0) {
        loadingName.innerText = '';
      } else if (list.length === 1) {
        loadingName.innerText = list[0];
      } else {
        loadingName.innerText = `${list[0]} 等 ${list.length} 个`;
      }
    }
  };

  /** 计数 + 显示 overlay */
  const beginLoading = (fontName: string) => {
    loadingCountRef.current += 1;
    pushLoadingName(fontName);
    const loadingOverlay = $('fontLoadingOverlay');
    if (loadingOverlay) {
      loadingOverlay.classList.add('show');
    }
  };

  /** 计数 - 隐藏 overlay */
  const endLoading = (fontName: string) => {
    loadingCountRef.current = Math.max(0, loadingCountRef.current - 1);
    dropLoadingName(fontName);
    if (loadingCountRef.current === 0) {
      const loadingOverlay = $('fontLoadingOverlay');
      if (loadingOverlay) {
        window.setTimeout(() => {
          /* 关掉前再确认一次,避免在过渡空窗中又被新任务拉起 */
          if (loadingCountRef.current === 0) {
            loadingOverlay.classList.remove('show');
          }
        }, 300);
      }
    }
  };

  /**
   * 真正执行一次 FontFace.load 并加入到 document.fonts。失败不抛,只控制台告警。
   *
   * 多线程并行下载：
   *   1) 先尝试 HEAD 请求获取 Content-Length + Accept-Ranges。
   *   2) 如果服务器支持 Range + 文件够大 (>= 256KB),切成 PARALLEL_LIMIT 段并发下载。
   *   3) 任意一段失败 / 服务器不支持 Range / 文件太小 -> 自动降级为单线程 FontFace 直接 load(url)。
   *   4) 小文件（<= 256KB）直接走单线程,避免分段开销比网络节省还大。
   *
   * 注：浏览器对同一 origin 的并发连接有上限(~6),但字体通常跨域 (CDN),实际不会被卡。
   */
  const PARALLEL_LIMIT = 4;
  const PARALLEL_MIN_BYTES = 256 * 1024;

  const isRangeSupported = async (
    url: string,
  ): Promise<{ supported: boolean; totalSize: number | null }> => {
    try {
      const headResp = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (!headResp.ok) {
        return { supported: false, totalSize: null };
      }
      const acceptRanges = headResp.headers.get('accept-ranges');
      const contentLength = Number(headResp.headers.get('content-length'));
      const supported = !!acceptRanges && acceptRanges.toLowerCase() === 'bytes';
      return {
        supported,
        totalSize: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null,
      };
    } catch {
      return { supported: false, totalSize: null };
    }
  };

  const downloadRange = async (url: string, start: number, end: number): Promise<ArrayBuffer> => {
    const resp = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` },
      cache: 'no-store',
    });
    if (!resp.ok && resp.status !== 206) {
      throw new Error(`Range download failed: HTTP ${resp.status}`);
    }
    return await resp.arrayBuffer();
  };

  /**
   * 多线程并行下载整个字体文件,合并成 ArrayBuffer。
   * 返回 null 表示降级（让调用方回退到单线程）。
   */
  const downloadFontParallel = async (url: string): Promise<ArrayBuffer | null> => {
    const { supported, totalSize } = await isRangeSupported(url);
    if (!supported || totalSize === null || totalSize < PARALLEL_MIN_BYTES) {
      return null;
    }

    const chunkSize = Math.ceil(totalSize / PARALLEL_LIMIT);
    const ranges: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < PARALLEL_LIMIT; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize - 1, totalSize - 1);
      if (start <= end) {
        ranges.push({ start, end });
      }
    }

    try {
      const buffers = await Promise.all(
        ranges.map((range) => downloadRange(url, range.start, range.end)),
      );
      /* 把分段直接拼成一个 ArrayBuffer,喂给 FontFace。
       * FontFace 支持 ArrayBuffer / TypedArray / Blob / URL,
       * 不强求具体 mime,交给浏览器嗅探。 */
      const total = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const buf of buffers) {
        merged.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
      }
      return merged.buffer;
    } catch (err) {
      console.warn('[font] 多线程下载失败,降级到单线程:', err);
      return null;
    }
  };

  const loadOneFont = useCallback(
    async (fontName: string, fontUrl: string, forceReload = false): Promise<void> => {
      if (!SAFE_WINDOW || !fontName || !fontUrl) {
        return;
      }

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

      if (isLoaded) {
        return;
      }

      beginLoading(fontName);
      try {
        /* 路径 1:尝试多线程并行下载（HEAD + Range）。
         * 如果服务器不支持 Range 或文件太小 -> 返回 null,回退到路径 2。 */
        const parallelBuffer = await downloadFontParallel(fontUrl);
        const font = parallelBuffer
          ? new FontFace(fontName, parallelBuffer)
          : new FontFace(fontName, `url("${fontUrl}")`);
        await font.load();
        document.fonts.add(font);
      } catch (err) {
        console.error(`字体加载失败 [${fontName}]:`, err);
      } finally {
        endLoading(fontName);
      }
    },
    // downloadFontParallel / beginLoading / endLoading 都是稳定引用（依赖 ref + 不变常量）,
    // 重复声明只会让函数引用随每次渲染变新,反而让 loadOneFont 引用也跟着抖。
    // 此处显式禁用 exhaustive-deps,避免一次性修复即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** 并行加载多组字体(name+url),所有任务都完成后 resolve。空数组直接 resolve。 */
  const loadFontsParallel = useCallback(
    async (fonts: Array<{ name: string; url: string }>, forceReload = false): Promise<void> => {
      if (fonts.length === 0) {
        return;
      }
      await Promise.allSettled(
        fonts.map((entry) => loadOneFont(entry.name, entry.url, forceReload)),
      );
    },
    [loadOneFont],
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
        return;
      }

      /* 自定义字体源(custom):并行加载默认主题字体 + 自定义链接字体。
       * 这样切到自定义源后,字体预览/后备字体可以立即显示,
       * 自定义字体加载完成后无缝替换。 */
      if (source === 'custom' && themeConfig.fontUrl) {
        const { fontUrl: url, fontName: name } = themeConfig;
        const tasks: Array<{ name: string; url: string }> = [];

        /* 1) 默认主题字体（并行） */
        const themeFontInfo = themeFonts[currentStyle];
        if (themeFontInfo && themeFontInfo.url) {
          tasks.push({ name: themeFontInfo.name, url: themeFontInfo.url });
        }

        /* 2) 用户自定义字体（并行） */
        const customName = name || 'MyCustomFont';
        tasks.push({ name: customName, url });

        await loadFontsParallel(tasks, forceReload);

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
        const safeName = customName;
        styleTag.innerHTML = `body { font-family: '${safeName}', sans-serif !important; }`;
        if (preview) {
          preview.style.fontFamily = `'${safeName}', sans-serif`;
        }
        return;
      }

      /* 主题默认字体源(theme):仅加载当前主题默认字体 */
      styleTag.innerHTML = '';
      if (preview) {
        preview.style.fontFamily = 'var(--font-family)';
      }
      const themeFontInfo = themeFonts[currentStyle];
      if (themeFontInfo) {
        await loadOneFont(themeFontInfo.name, themeFontInfo.url, forceReload);
      }
    },
    [currentStyle, loadFontsParallel, loadOneFont, themeConfig],
  );

  /* 刷新按钮:点击重新加载当前生效的所有字体。
   * - 系统字体源:啥也不做
   * - 主题默认源:重载当前主题默认字体
   * - 自定义源:重载默认主题字体 + 自定义字体（并行） */
  const reloadActiveFonts = useCallback(async () => {
    await updateFontDOM(true);
  }, [updateFontDOM]);

  /* 挂载刷新按钮 click -> reloadActiveFonts
   * 顺带加 .spin 触发图标旋转反馈,动画结束后自动移除 */
  useEffect(() => {
    if (!SAFE_WINDOW) {
      return;
    }
    const btn = $<HTMLButtonElement>('fontLoadingRefresh');
    if (!btn) {
      return;
    }
    const handler = () => {
      btn.classList.remove('spin');
      /* 强制 reflow 重启动画,否则连点时不会重新触发 */
      void btn.offsetWidth;
      btn.classList.add('spin');
      window.setTimeout(() => {
        btn.classList.remove('spin');
      }, 650);
      void reloadActiveFonts();
    };
    btn.addEventListener('click', handler);
    return () => {
      btn.removeEventListener('click', handler);
    };
  }, [reloadActiveFonts]);

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
      layoutIcon.className = currentLayout === 'scroll' ? 'fas fa-arrows-alt-h' : 'fas fa-th-large';
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
      showFloatingToast('当前主题未配置专属字体', 'error');
    }
  }, [currentStyle, themeConfig]);

  const applyCustomFont = useCallback((urlOverride?: string, nameOverride?: string): boolean => {
    if (!SAFE_WINDOW) {
      return false;
    }
    const urlInput = $<HTMLInputElement>('customFontUrl');
    const nameInput = $<HTMLInputElement>('customFontName');

    const url = (urlOverride ?? urlInput?.value ?? '').trim();
    if (!url) {
      showFloatingToast('请输入有效的字体链接', 'error');
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
  }, []);

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

  /* ======================== 高级设置:滑块 / 锁定 / 沉浸特效（docs/参考代码/4/code.js） ======================== */
  /* 与参考实现一致,loadSettings 仅在 DOM 上同步数值,不写回 state,
   * 因为 state 已在 hook 初始化阶段由 readThemeConfig() 从 localStorage 反序列化。 */
  const loadSettings = useCallback(() => {
    if (!SAFE_WINDOW) {
      return;
    }
    const map: Record<string, number> = {
      textScaleRange: themeConfig.textScale,
      uiScaleRange: themeConfig.uiScale,
      bgBlurRange: themeConfig.bgBlur,
      bgOpacityRange: themeConfig.bgOpacity,
      bgOverlayRange: themeConfig.bgOverlay,
    };
    Object.entries(map).forEach(([id, value]) => {
      const el = $range(id);
      if (el) {
        el.value = String(value);
      }
    });
    const sysCheck = $<HTMLInputElement>('systemTextScaleCheck');
    if (sysCheck) {
      sysCheck.checked = themeConfig.systemTextScale;
    }
    /* 立刻把 DOM 数值应用到 CSS 变量,刷新时即可生效 */
    updateTextScale();
    updateUiScale();
    updateBgAdjustment();
    updateBgPreviewUI();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateXxx 为函数声明,调用时读取最新 DOM
  }, [
    themeConfig.bgBlur,
    themeConfig.bgOpacity,
    themeConfig.bgOverlay,
    themeConfig.textScale,
    themeConfig.uiScale,
    themeConfig.systemTextScale,
  ]);

  const applyLockState = useCallback(
    (type: 'img' | 'content') => {
      /* 与 AdvancedSettingsPanel.tsx 的 LOCK_OPEN_ICON / LOCK_CLOSED_ICON 严格保持一致,
       * 否则 React 受控 dangerouslySetInnerHTML 会被覆盖为破缺 HTML。
       * 闭合的 </i> 在这里并非必须,但保留以避免某些 React diff 报警告。 */
      const lockedIconHTML = '<i class="fas fa-lock"></i>';
      const unlockedIconHTML = '<i class="fas fa-lock-open"></i>';
      if (type === 'img') {
        const d = themeConfig.lockedImg;
        const blur = $range('bgBlurRange');
        const opa = $range('bgOpacityRange');
        const over = $range('bgOverlayRange');
        if (blur) blur.disabled = d;
        if (opa) opa.disabled = d;
        if (over) over.disabled = d;
        const b = $<HTMLButtonElement>('lockImgBtn');
        if (b) {
          /* 同步 React 受控值:React 端只关心 className 上的 locked,
           * 图标通过 dangerouslySetInnerHTML 同步写入即可。 */
          b.innerHTML = d ? lockedIconHTML : unlockedIconHTML;
          b.classList.toggle('locked', d);
        }
      }
      /* content 分支已随"主题透明度与遮罩"功能一同移除 */
    },
    [themeConfig.lockedContent, themeConfig.lockedImg],
  );

  const initLocks = useCallback(() => {
    applyLockState('img');
  }, [applyLockState]);

  const toggleThemeLock = useCallback((type: 'img' | 'content') => {
    setThemeConfig((prev) => {
      const next: ThemeConfig = {
        ...prev,
        lockedImg: type === 'img' ? !prev.lockedImg : prev.lockedImg,
        lockedContent: type === 'content' ? !prev.lockedContent : prev.lockedContent,
      };
      writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);



  const toggleSystemTextScale = useCallback(() => {
    const sysCheck = $<HTMLInputElement>('systemTextScaleCheck');
    const isChecked = !!sysCheck?.checked;
    const textRange = $range('textScaleRange');
    const uiRange = $range('uiScaleRange');
    if (textRange) textRange.disabled = isChecked;
    if (uiRange) uiRange.disabled = isChecked;
    setThemeConfig((prev) => {
      const next: ThemeConfig = {
        ...prev,
        systemTextScale: isChecked,
        textScale: isChecked ? 100 : prev.textScale,
        uiScale: isChecked ? 100 : prev.uiScale,
      };
      writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
      /* 立刻把禁用后的值刷到 DOM + CSS */
      if (isChecked) {
        if (textRange) textRange.value = '100';
        if (uiRange) uiRange.value = '100';
      }
      return next;
    });
    /* 触发 CSS 变量刷新 */
    window.setTimeout(() => {
      updateTextScale();
      updateUiScale();
    }, 0);
  }, []);

  /* 这些函数需要在 toggleSystemTextScale / loadSettings / resetSettings 中被前置调用,
   * 因此用 function declaration 而非 useCallback,借助声明提升规避 TDZ。 */
  function updateTextScale() {
    const el = $range('textScaleRange');
    if (!el) return;
    const val = Number(el.value);
    const display = $('textScaleDisplay');
    if (display) display.innerText = `${val}%`;
    document.documentElement.style.setProperty('--text-scale', String(val / 100));
    setThemeConfig((prev) => {
      if (prev.textScale === val) return prev;
      const next: ThemeConfig = { ...prev, textScale: val };
      writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function updateUiScale() {
    const el = $range('uiScaleRange');
    if (!el) return;
    const val = Number(el.value);
    const display = $('uiScaleDisplay');
    if (display) display.innerText = `${val}%`;
    document.documentElement.style.setProperty('--ui-scale', String(val / 100));
    setThemeConfig((prev) => {
      if (prev.uiScale === val) return prev;
      const next: ThemeConfig = { ...prev, uiScale: val };
      writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  /* ----- React 受控端直接传入数值时使用的 setters（与 DOM 解耦） ----- */
  const updateTextScaleFromValue = useCallback((value: number) => {
    const el = $range('textScaleRange');
    if (el && Number(el.value) !== value) {
      el.value = String(value);
    }
    const display = $('textScaleDisplay');
    if (display) display.innerText = `${value}%`;
    document.documentElement.style.setProperty('--text-scale', String(value / 100));
    setThemeConfig((prev) => {
      if (prev.textScale === value) return prev;
      const next: ThemeConfig = { ...prev, textScale: value };
      writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const updateUiScaleFromValue = useCallback((value: number) => {
    const el = $range('uiScaleRange');
    if (el && Number(el.value) !== value) {
      el.value = String(value);
    }
    const display = $('uiScaleDisplay');
    if (display) display.innerText = `${value}%`;
    document.documentElement.style.setProperty('--ui-scale', String(value / 100));
    setThemeConfig((prev) => {
      if (prev.uiScale === value) return prev;
      const next: ThemeConfig = { ...prev, uiScale: value };
      writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const updateBgAdjustmentFromValue = useCallback(
    (next: Partial<Pick<ThemeConfig, 'bgBlur' | 'bgOpacity' | 'bgOverlay'>>) => {
      const merge = {
        bgBlur: next.bgBlur ?? themeConfig.bgBlur,
        bgOpacity: next.bgOpacity ?? themeConfig.bgOpacity,
        bgOverlay: next.bgOverlay ?? themeConfig.bgOverlay,
      };
      const blurEl = $range('bgBlurRange');
      const opaEl = $range('bgOpacityRange');
      const overEl = $range('bgOverlayRange');
      if (blurEl) blurEl.value = String(merge.bgBlur);
      if (opaEl) opaEl.value = String(merge.bgOpacity);
      if (overEl) overEl.value = String(merge.bgOverlay);

      const blurDisp = $('blurValDisplay');
      const opaDisp = $('opacityValDisplay');
      const overDisp = $('overlayValDisplay');
      if (blurDisp) blurDisp.innerText = `${merge.bgBlur}px`;
      if (opaDisp) opaDisp.innerText = `${Math.round(merge.bgOpacity * 100)}%`;
      if (overDisp) overDisp.innerText = `${Math.round(merge.bgOverlay * 100)}%`;

      document.documentElement.style.setProperty('--bg-blur', `${merge.bgBlur}px`);
      document.documentElement.style.setProperty('--bg-opacity', String(merge.bgOpacity));
      document.documentElement.style.setProperty('--bg-overlay', String(merge.bgOverlay));

      /* 同步背景预览小窗 */
      const previewImg = $('bgPreviewImage');
      const previewOverlay = $('bgPreviewOverlay');
      if (previewImg) {
        previewImg.style.filter = `blur(${merge.bgBlur}px)`;
        previewImg.style.opacity = String(merge.bgOpacity);
      }
      if (previewOverlay) {
        previewOverlay.style.backgroundColor = `rgba(0, 0, 0, ${merge.bgOverlay})`;
      }

      setThemeConfig((prev) => {
        const after: ThemeConfig = {
          ...prev,
          bgBlur: merge.bgBlur,
          bgOpacity: merge.bgOpacity,
          bgOverlay: merge.bgOverlay,
        };
        writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(after));
        return after;
      });
    },
    [themeConfig],
  );

  const updateBgBlurFromValue = useCallback(
    (value: number) => updateBgAdjustmentFromValue({ bgBlur: value }),
    [updateBgAdjustmentFromValue],
  );
  const updateBgOpacityFromValue = useCallback(
    (value: number) => updateBgAdjustmentFromValue({ bgOpacity: value }),
    [updateBgAdjustmentFromValue],
  );
  const updateBgOverlayFromValue = useCallback(
    (value: number) => updateBgAdjustmentFromValue({ bgOverlay: value }),
    [updateBgAdjustmentFromValue],
  );

  const applyBgUrlFromString = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    /* URL 也走 IndexedDB,这样"清空缓存"时只需清一次 IndexedDB
     * 就能把图片和 URL 配置一起干掉,不会留下半截孤儿状态。*/
    void saveBackgroundUrl(trimmed)
      .then(() => {
        setThemeConfig((prev) => {
          const next: ThemeConfig = {
            ...prev,
            bgType: 'url',
            bgValue: trimmed,
          };
          writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
        /* 立即把 DOM 预览同步成最新值,无需等待 React 重渲染 */
        const previewImg = $('bgPreviewImage');
        const previewText = document.querySelector<HTMLElement>('.bg-preview-text');
        const urlInput = $<HTMLInputElement>('bgUrlInput');
        const globalBg = $('custom-bg-layer');
        if (previewImg) previewImg.style.backgroundImage = `url("${trimmed}")`;
        if (globalBg) globalBg.style.backgroundImage = `url("${trimmed}")`;
        if (previewText) previewText.style.display = 'none';
        if (urlInput) urlInput.value = trimmed;
      })
      .catch((err) => {
        console.error('[theme] IndexedDB 写入失败:', err);
        showFloatingToast('背景图保存失败,请检查浏览器存储权限', 'error');
      });
  }, []);

  /* 与 updateTextScale / updateUiScale 同理,使用 function declaration 提升声明 */
  function updateBgAdjustment() {
    const blurEl = $range('bgBlurRange');
    const opaEl = $range('bgOpacityRange');
    const overEl = $range('bgOverlayRange');
    if (!blurEl || !opaEl || !overEl) return;
    const blur = Number(blurEl.value);
    const opa = Number(opaEl.value);
    const over = Number(overEl.value);

    const blurDisp = $('blurValDisplay');
    const opaDisp = $('opacityValDisplay');
    const overDisp = $('overlayValDisplay');
    if (blurDisp) blurDisp.innerText = `${blur}px`;
    if (opaDisp) opaDisp.innerText = `${Math.round(opa * 100)}%`;
    if (overDisp) overDisp.innerText = `${Math.round(over * 100)}%`;

    document.documentElement.style.setProperty('--bg-blur', `${blur}px`);
    document.documentElement.style.setProperty('--bg-opacity', String(opa));
    document.documentElement.style.setProperty('--bg-overlay', String(over));

    /* 同步背景预览小窗 */
    const previewImg = $('bgPreviewImage');
    const previewOverlay = $('bgPreviewOverlay');
    if (previewImg) {
      previewImg.style.filter = `blur(${blur}px)`;
      previewImg.style.opacity = String(opa);
    }
    if (previewOverlay) {
      previewOverlay.style.backgroundColor = `rgba(0, 0, 0, ${over})`;
    }

    setThemeConfig((prev) => {
      const next: ThemeConfig = {
        ...prev,
        bgBlur: blur,
        bgOpacity: opa,
        bgOverlay: over,
      };
      writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  /* 拖动滑块时,沉浸式隐藏非活动容器(1:1 移植自 docs/参考代码/4/code.js) */
  const initSliderHideEffect = useCallback(() => {
    if (!SAFE_WINDOW) {
      return;
    }
    const ranges = document.querySelectorAll<HTMLInputElement>(
      '#settingsWrapper input[type="range"]',
    );
    const wrapper = $('settingsWrapper');
    const panel = document.querySelector<HTMLElement>('.settings-panel');
    if (!wrapper || !panel) return;

    const onDragStart = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (!target || target.disabled) return;
      wrapper.classList.add('is-dragging');
      panel.classList.add('is-dragging');
      const rg = target.closest<HTMLElement>('.range-group');
      if (rg) rg.classList.add('active-range');
      const ct = target.closest<HTMLElement>('.adjust-container');
      if (ct) ct.classList.add('active-container');
    };
    const onDragEnd = () => {
      wrapper.classList.remove('is-dragging');
      panel.classList.remove('is-dragging');
      document
        .querySelectorAll('.active-range')
        .forEach((el) => el.classList.remove('active-range'));
      document
        .querySelectorAll('.active-container')
        .forEach((el) => el.classList.remove('active-container'));
    };

    ranges.forEach((r) => {
      r.addEventListener('mousedown', onDragStart);
      r.addEventListener('touchstart', onDragStart, { passive: true });
    });
    window.addEventListener('mouseup', onDragEnd);
    window.addEventListener('touchend', onDragEnd);
  }, []);

  /* ======================== 自定义背景:上传 / 裁剪 / URL / 清空 ======================== */
  const updateBgPreviewUI = useCallback(() => {
    if (!SAFE_WINDOW) return;
    const previewImg = $('bgPreviewImage');
    const previewText = document.querySelector<HTMLElement>('.bg-preview-text');
    const urlInput = $<HTMLInputElement>('bgUrlInput');
    /* #custom-bg-layer 是 index.html 中的静态全局背景层,始终存在;
     * 面板未打开时预览 DOM 不存在,但全局背景仍必须同步(否则刷新后背景丢失)。 */
    const globalBg = $('custom-bg-layer');
    if (!globalBg) return;

    const type = themeConfig.bgType;
    const value = themeConfig.bgValue;
    if (type === 'none' || !value) {
      globalBg.style.backgroundImage = 'none';
      if (previewImg) previewImg.style.backgroundImage = 'none';
      if (previewText) previewText.style.display = 'block';
      if (urlInput) urlInput.value = '';
      revokeAllBlobUrls();
      return;
    }

    if (type === 'url') {
      /* 远程 URL:直接用 bgValue 当 background-image 的 url(...) */
      const imgUrl = `url("${value}")`;
      globalBg.style.backgroundImage = imgUrl;
      if (previewImg) previewImg.style.backgroundImage = imgUrl;
      if (previewText) previewText.style.display = 'none';
      if (urlInput) urlInput.value = value;
      revokeAllBlobUrls();
      return;
    }

    /* type === 'image':value 是 IndexedDB 的 key,从库里读出 Blob 后
     * 生成 object URL 喂给 background-image。
     * 异步过程,所以这里把 setStyle 放进 then 里;DOM 端会先短暂空白,
     * 等事务完成就恢复了。 */
    revokeAllBlobUrls();
    void getBackgroundRecord().then((record) => {
      if (!record || record.type !== 'image' || !(record.value instanceof Blob)) {
        globalBg.style.backgroundImage = 'none';
        if (previewImg) previewImg.style.backgroundImage = 'none';
        if (previewText) previewText.style.display = 'block';
        return;
      }
      const url = createBlobUrl(record.value);
      const imgUrl = `url("${url}")`;
      globalBg.style.backgroundImage = imgUrl;
      if (previewImg) previewImg.style.backgroundImage = imgUrl;
      if (previewText) previewText.style.display = 'none';
    });
  }, [themeConfig.bgType, themeConfig.bgValue]);

  const closeModal = useCallback((id: string) => {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';
    /* 关闭裁剪模态框时,顺手销毁实例避免内存泄漏 */
    if (id === 'cropperModal' && cropperInstance) {
      cropperInstance.destroy();
      cropperInstance = null;
    }
    if (id === 'cropperModal') {
      setCropperModalOpen(false);
      setCropperModalSrc('');
    }
  }, []);

  const closeCropperModal = useCallback(() => {
    closeModal('cropperModal');
  }, [closeModal]);

  /* handleBgUpload 同时支持两种调用方式：
   *  - 传入原生 <input type="file"> 元素（与 docs/参考代码/4/code.js 行为 1:1）
   *  - 传入 File 对象（由 AdvancedSettingsPanel 的 onChange 回调直接拿到）
   * 两条路径都会先读 DataURL,再打开裁剪模态框。 */
  const handleBgUpload = useCallback((inputOrFile: HTMLInputElement | File) => {
    const file: File | undefined =
      inputOrFile instanceof File
        ? inputOrFile
        : inputOrFile.files && inputOrFile.files[0]
          ? inputOrFile.files[0]
          : undefined;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = String((e.target?.result as string) ?? '');
      if (src) {
        openCropperModal(src);
      }
      if (!(inputOrFile instanceof File)) {
        inputOrFile.value = '';
      }
    };
    reader.readAsDataURL(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openCropperModal 是稳定引用(空依赖)
  }, []);

  const openCropperModal = useCallback((src: string) => {
    if (!SAFE_WINDOW) return;
    const img = $<HTMLImageElement>('cropperImage');
    const modal = $('cropperModal');
    if (!img || !modal) {
      console.warn('[theme] 裁剪模态框 DOM 未就绪');
      return;
    }
    img.src = src;
    modal.style.display = 'flex';
    /* 同步 React 端 state,让 <CropperModal> 受控显示 */
    setCropperModalSrc(src);
    setCropperModalOpen(true);
    if (cropperInstance) {
      cropperInstance.destroy();
      cropperInstance = null;
    }
    if (!window.Cropper) {
      console.warn('[theme] Cropper.js 尚未加载完成');
      return;
    }
    try {
      cropperInstance = new window.Cropper(img, {
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 1,
        aspectRatio: NaN,
      });
    } catch (err) {
      console.error('[theme] Cropper 初始化失败:', err);
    }
  }, []);

  const confirmCrop = useCallback(() => {
    if (!cropperInstance) return;
    let dataUrl: string;
    try {
      const canvas = cropperInstance.getCroppedCanvas({
        maxWidth: 2000,
        maxHeight: 2000,
      });
      dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    } catch (err) {
      console.error('[theme] 剪裁失败:', err);
      return;
    }
    /* 图片本体存进 IndexedDB,配置里只存 key。
     * 这样 localStorage 不再被 base64 撑爆,体积只剩几十字节。*/
    void saveBackgroundFromDataUrl(dataUrl)
      .then(() => {
        setThemeConfig((prev) => {
          const next: ThemeConfig = {
            ...prev,
            bgType: 'image',
            bgValue: BACKGROUND_BLOB_KEY,
          };
          writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
        /* 立刻把新背景应用到 DOM,避免等待 React 重渲染造成空白 */
        window.setTimeout(() => updateBgPreviewUI(), 0);
        closeModal('cropperModal');
      })
      .catch((err) => {
        console.error('[theme] IndexedDB 写入失败:', err);
        showFloatingToast('背景图保存失败,请检查浏览器存储权限', 'error');
      });
  }, [closeModal, updateBgPreviewUI]);

  const resetCropper = useCallback(() => {
    if (cropperInstance) {
      cropperInstance.reset();
    }
  }, []);

  const applyBgUrl = useCallback(() => {
    const urlInput = $<HTMLInputElement>('bgUrlInput');
    const url = (urlInput?.value ?? '').trim();
    if (!url) return;
    setThemeConfig((prev) => {
      const next: ThemeConfig = { ...prev, bgType: 'url', bgValue: url };
      writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    window.setTimeout(() => updateBgPreviewUI(), 0);
  }, [updateBgPreviewUI]);

  const clearBackground = useCallback(() => {
    setThemeConfig((prev) => {
      const next: ThemeConfig = { ...prev, bgType: 'none', bgValue: '' };
      writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    /* 清掉 IndexedDB 里的图片/URL 记录,以及之前 revoke 掉的 object URL */
    void clearBackgroundStore();
    revokeAllBlobUrls();
    window.setTimeout(() => updateBgPreviewUI(), 0);
    showFloatingToast('背景图缓存已清空');
  }, [updateBgPreviewUI]);

  /* 下载当前自定义背景图(仅 image 类型有效)。
   * URL 类型远程图片不受这里管,需要"图片另存为"请走浏览器右键。*/
  const downloadBackgroundImage = useCallback(async () => {
    if (themeConfig.bgType !== 'image') {
      showFloatingToast('当前没有可下载的自定义图片背景', 'error');
      return;
    }
    const record = await getBackgroundRecord();
    if (!record || record.type !== 'image' || !(record.value instanceof Blob)) {
      showFloatingToast('本地图片记录不存在或已损坏', 'error');
      return;
    }
    downloadBlob(record.value, '自定义背景图');
    showFloatingToast('已触发下载');
  }, [themeConfig.bgType]);
  /* ---------- 副作用:state / config 变化时同步 DOM ---------- */
  useEffect(() => {
    applyState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStyle, currentMode]);

  useEffect(() => {
    applyLayout();
  }, [applyLayout]);

  /* themeConfig 变化时的副作用拆分成三块,按真实依赖分别订阅:
   *
   * 1) 字体 / 锁定 / 全量持久化:依赖字体源、锁定标志等"结构性"字段。
   * 2) 背景图源:仅在 bgType / bgValue 改变时同步 DOM & 预览
   *    (含 revokeAllBlobUrls + 异步从 IndexedDB 读 Blob 生成新的 object URL)。
   *
   * 之前把 updateBgPreviewUI 放在依赖 [themeConfig] 的 effect 里,
   * 拖动 bgBlur / bgOpacity / bgOverlay 滑块会触发新对象 → effect 重跑 →
   * revoke 旧 blob URL、再异步取一次新的,DOM 上就有一小段空白背景,
   * 视觉上就是"闪烁"。这里把图源同步收窄到只观察 bgType / bgValue,
   * 滑块改变时不再重新加载背景图。 */
  useEffect(() => {
    void updateFontDOM();
    toggleFontInputs();
    saveSettings();
    initLocks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    themeConfig.fontSource,
    themeConfig.fontUrl,
    themeConfig.fontName,
    themeConfig.lockedImg,
    themeConfig.lockedContent,
    themeConfig.systemTextScale,
  ]);

  useEffect(() => {
    updateBgPreviewUI();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeConfig.bgType, themeConfig.bgValue]);

  /* 纯 state 驱动的 CSS 变量同步（关键兜底）:
   * AdvancedSettingsPanel 是条件渲染的,面板未打开时 #textScaleRange 等 DOM 不存在,
   * updateTextScale/updateUiScale/updateBgAdjustment 会因 if(!el) return 而跳过,
   * 导致刷新后保存的设置无法应用到页面。这里直接用 themeConfig state 写 CSS 变量,
   * 与 DOM 是否挂载无关,保证刷新/首屏时所有高级设置立即生效。 */
  useEffect(() => {
    if (!SAFE_WINDOW) {
      return;
    }
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--text-scale', String(themeConfig.textScale / 100));
    rootStyle.setProperty('--ui-scale', String(themeConfig.uiScale / 100));
    rootStyle.setProperty('--bg-blur', `${themeConfig.bgBlur}px`);
    rootStyle.setProperty('--bg-opacity', String(themeConfig.bgOpacity));
    rootStyle.setProperty('--bg-overlay', String(themeConfig.bgOverlay));
  }, [
    themeConfig.textScale,
    themeConfig.uiScale,
    themeConfig.bgBlur,
    themeConfig.bgOpacity,
    themeConfig.bgOverlay,
  ]);

  /* ---------- 业务回调 ---------- */
  /* 切换主题不再自动加载主题字体：保持当前 fontSource（通常是 system），
   * 只有当用户主动在高级设置里把"字体源"切到"主题默认"时才会加载主题字体。
   * 这样切换主题更快、不浪费流量，也避免主题自带的字体可能与文字阅读体验冲突。 */
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
    if (typeof window !== 'undefined') {
      const ok = window.confirm('确定要恢复所有默认设置吗？');
      if (!ok) return;
    }
    setCurrentStyle(DEFAULT_THEME_KEY);
    setCurrentMode('day');
    setCurrentLayout('scroll');
    setThemeConfig({ ...DEFAULT_THEME_CONFIG });
    /* 同步清空 IndexedDB 里保存的自定义背景图,否则页面刷新后预览会重新
     * 从 store 里读出旧图,与 DEFAULT_THEME_CONFIG.bgType='none' 不一致。 */
    void clearBackgroundStore().catch(() => {
      /* 忽略 */
    });
    revokeAllBlobUrls();
    /* 同步滑块 DOM */
    if (typeof document !== 'undefined') {
      const sliders: Array<[string, string]> = [
        ['textScaleRange', '100'],
        ['uiScaleRange', '100'],
        ['bgBlurRange', '0'],
        ['bgOpacityRange', '1'],
        ['bgOverlayRange', '0'],
      ];
      sliders.forEach(([id, val]) => {
        const el = $range(id);
        if (el) el.value = val;
      });
      const sysCheck = $<HTMLInputElement>('systemTextScaleCheck');
      if (sysCheck) {
        sysCheck.checked = false;
        const t = $range('textScaleRange');
        const u = $range('uiScaleRange');
        if (t) t.disabled = false;
        if (u) u.disabled = false;
      }
    }
    /* 把默认值刷到 CSS 变量与 DOM 预览 */
    window.setTimeout(() => {
      applyLayout();
      initLocks();
      updateBgAdjustment();
      updateTextScale();
      updateUiScale();
      updateBgPreviewUI();
      initFontPanel();
      applyState();
      /* 显式持久化,与 docs/参考代码/4/code.js 中 resetSettings 末尾
       * 的 saveSettings() 调用 1:1 对齐。 */
      writeLocalStorage(THEME_CONFIG_STORAGE_KEY, JSON.stringify(DEFAULT_THEME_CONFIG));
      writeLocalStorage(STYLE_STORAGE_KEY, DEFAULT_THEME_KEY);
      writeLocalStorage(MODE_STORAGE_KEY, 'day');
      writeLocalStorage(LAYOUT_STORAGE_KEY, 'scroll');
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateXxx 为函数声明,调用时读取最新 DOM
  }, [applyLayout, applyState, initFontPanel, initLocks]);

  /* 卸载时统一 revoke 所有 object URL,避免热更新或路由切换造成内存泄漏。*/
  useEffect(() => {
    return () => {
      revokeAllBlobUrls();
    };
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
    loadSettings,
    initLocks,
    toggleThemeLock,
    toggleSystemTextScale,
    updateTextScale,
    updateUiScale,
    updateBgAdjustment,
    initSliderHideEffect,
    handleBgUpload,
    openCropperModal,
    confirmCrop,
    applyBgUrl,
    applyBgUrlFromString,
    clearBackground,
    downloadBackgroundImage,
    updateBgPreviewUI,
    closeModal,
    resetCropper,
    cropperReady,
    cropperModalOpen,
    cropperModalSrc,
    closeCropperModal,
    /* React 受控端用的 setters（与 DOM 解耦） */
    updateTextScaleFromValue,
    updateUiScaleFromValue,
    updateBgBlurFromValue,
    updateBgOpacityFromValue,
    updateBgOverlayFromValue,
  };
}
