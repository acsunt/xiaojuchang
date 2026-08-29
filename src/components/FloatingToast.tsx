import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 全局悬浮提示（floating toast）。
 *
 * 用法：
 *   - 在 App 根部挂一次 <FloatingToastHost />
 *   - 任意位置调用 showFloatingToast('文案') / showFloatingToast('文案', 'error')
 *
 * 正确操作提示悬浮 0.5 秒后自动消失；错误提示悬浮 2.5 秒后自动消失。
 */

export type FloatingToastTone = 'success' | 'error';

type ToastItem = {
  id: number;
  text: string;
  tone: FloatingToastTone;
};

/** 正确提示悬浮时长 */
export const TOAST_SUCCESS_MS = 500;
/** 错误提示悬浮时长 */
export const TOAST_ERROR_MS = 2500;
const MAX_STACK = 3;

let seq = 0;
let current: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

const emit = () => {
  listeners.forEach((listener) => listener([...current]));
};

/**
 * 弹一条悬浮提示。tone 省略时按成功处理（0.5 秒），'error' 时 2.5 秒。
 */
export function showFloatingToast(text: string, tone: FloatingToastTone = 'success') {
  if (typeof window === 'undefined' || !text) {
    return;
  }

  const id = ++seq;
  current = [...current, { id, text, tone }].slice(-MAX_STACK);
  emit();

  const duration = tone === 'error' ? TOAST_ERROR_MS : TOAST_SUCCESS_MS;
  window.setTimeout(() => {
    current = current.filter((item) => item.id !== id);
    emit();
  }, duration);
}

/**
 * 悬浮提示挂载点：fixed 定位、pointer-events: none，绝不占位不挤布局。
 */
export function FloatingToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener = (next: ToastItem[]) => setItems(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (items.length === 0) {
    return null;
  }

  return createPortal(
    <div aria-live="polite" className="app-toast-stack">
      {items.map((item) => (
        <div className={`app-toast app-toast-${item.tone}`} key={item.id} role="status">
          {item.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}
