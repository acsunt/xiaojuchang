import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { subscribeFloatingToasts, type FloatingToastTone } from './floating-toast-store';

export type { FloatingToastTone };

type ToastItem = {
  id: number;
  text: string;
  tone: FloatingToastTone;
};

/**
 * 悬浮提示挂载点：fixed 定位、pointer-events: none，绝不占位不挤布局。
 * 把 <FloatingToastHost /> 放在 App 根部一次即可。
 */
export function FloatingToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeFloatingToasts(setItems);
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
