/**
 * 全局悬浮提示（floating toast）的调用入口。
 *
 * 用法：
 *   - 在 App 根部挂一次 <FloatingToastHost />
 *   - 任意位置调用 showFloatingToast('文案') / showFloatingToast('文案', 'error')
 *
 * 成功和错误提示统一悬浮 1.5 秒后自动消失。
 *
 * 这里只放"非组件"导出（常量 + 触发函数），组件本体保留在 FloatingToast.tsx
 * 以满足 react-refresh/only-export-components 规则。
 */

export type FloatingToastTone = 'success' | 'error';

/** 成功提示悬浮时长 */
export const TOAST_SUCCESS_MS = 1500;
/** 错误提示悬浮时长 */
export const TOAST_ERROR_MS = 1500;

type ToastItem = {
  id: number;
  text: string;
  tone: FloatingToastTone;
};

const MAX_STACK = 3;

let seq = 0;
let current: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

const emit = () => {
  listeners.forEach((listener) => listener([...current]));
};

/** 仅供组件内部订阅：取出当前 toast 快照并注册变更回调 */
export const subscribeFloatingToasts = (listener: (items: ToastItem[]) => void): (() => void) => {
  listeners.add(listener);
  listener([...current]);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * 弹一条悬浮提示。tone 省略时按成功处理（1 秒），'error' 时 2.5 秒。
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
