import { useEffect, useRef, useState } from 'react';

const UPDATE_CHECK_INTERVAL = 10 * 60 * 1000; // 10 分钟轮询兜底（后台时浏览器节流，实际更少）
const UPDATE_CHECK_INITIAL_DELAY = 800; // 首次几乎即时检查
const DISMISS_SESSION_KEY = 'mini-theater.update-dismissed';

/**
 * 抽取 HTML 中的资源指纹：只比对 /assets/ 下的 script src 和 link href，
 * 排序后拼接成字符串，保证属性顺序差异不影响比较结果。
 */
const extractAssets = (html: string): string => {
  const scriptMatches = Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g));
  const linkMatches = Array.from(html.matchAll(/<link[^>]+href="([^"]+)"/g));
  return [...scriptMatches, ...linkMatches]
    .map((match) => match[1])
    .filter((src) => src.includes('/assets/'))
    .sort()
    .join(',');
};

const fetchCurrentHtml = async (): Promise<string | null> => {
  if (typeof window === 'undefined' || document.visibilityState === 'hidden') {
    return null;
  }

  try {
    // 用当前页面 URL 拿 HTML，no-store 避免缓存脏读
    const response = await fetch(window.location.href, {
      cache: 'no-store',
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
};

const useDismissed = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.sessionStorage.getItem(DISMISS_SESSION_KEY) === '1';
};

/**
 * 打开页面几乎即时检测一次；页面回到前台时再检测一次；前台常驻时每 10 分钟轮询。
 * 初始指纹也来自一次 fetch，避免用本地 DOM outerHTML 序列化（属性顺序、
 * lazy chunk 等差异）与远程 HTML 比较造成假阳性。
 */
export function useUpdateNotifier() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const initialAssetsRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || useDismissed()) {
      return;
    }

    let cancelled = false;

    const checkForUpdate = async () => {
      const html = await fetchCurrentHtml();
      if (cancelled || !html) {
        return;
      }

      const latestAssets = extractAssets(html);
      if (!latestAssets) {
        return;
      }

      if (!initialAssetsRef.current) {
        // 首次：以远程 HTML 为基准指纹，不再与本地 DOM 比较
        initialAssetsRef.current = latestAssets;
        return;
      }

      if (latestAssets !== initialAssetsRef.current) {
        if (!cancelled) {
          setUpdateAvailable(true);
        }
      }
    };

    const timer = window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkForUpdate();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    // 首次 fetch 拿到远程 HTML 作为基准
    const initialTimer = window.setTimeout(checkForUpdate, UPDATE_CHECK_INITIAL_DELAY);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(initialTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const dismiss = () => {
    window.sessionStorage.setItem(DISMISS_SESSION_KEY, '1');
    setUpdateAvailable(false);
  };

  const refresh = () => {
    window.location.reload();
  };

  return { updateAvailable, dismiss, refresh };
}

/**
 * 审核后台使用的精简版 notifier：
 * 仅在打开网页和从后台切回前台时检测一次，不做兜底轮询。
 * 复用相同的 fetch 基准 + 远程 HTML 比较逻辑，避免假阳性。
 */
export function useAdminUpdateNotifier() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const initialAssetsRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || useDismissed()) {
      return;
    }

    let cancelled = false;

    const checkForUpdate = async () => {
      const html = await fetchCurrentHtml();
      if (cancelled || !html) {
        return;
      }

      const latestAssets = extractAssets(html);
      if (!latestAssets) {
        return;
      }

      if (!initialAssetsRef.current) {
        initialAssetsRef.current = latestAssets;
        return;
      }

      if (latestAssets !== initialAssetsRef.current) {
        if (!cancelled) {
          setUpdateAvailable(true);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkForUpdate();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const initialTimer = window.setTimeout(checkForUpdate, UPDATE_CHECK_INITIAL_DELAY);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const dismiss = () => {
    window.sessionStorage.setItem(DISMISS_SESSION_KEY, '1');
    setUpdateAvailable(false);
  };

  const refresh = () => {
    window.location.reload();
  };

  return { updateAvailable, dismiss, refresh };
}