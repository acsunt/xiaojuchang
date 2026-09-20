import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type CustomSelectOption = { value: string; label: string };

type CustomSelectProps = {
  label: string;
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
};

export function CustomSelect({ label, value, options, onChange }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  /* 菜单的位置（fixed 坐标系）。由 trigger 的 getBoundingClientRect 推算。 */
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  /* trigger 的实测宽度(用来给菜单做 minWidth,
   * 不让菜单比 trigger 还窄)。与 menuPos 一起在 effect 里更新。 */
  const [triggerWidth, setTriggerWidth] = useState<number>(0);
  const selectedOption = options.find((item) => item.value === value) ?? options[0];

  /* 打开时：基于 trigger 位置更新菜单 fixed 坐标。
   * 用 fixed 定位而不是 absolute,是为了:
   *   1) 菜单可以逃离任意祖先 stacking context(尤其是 .play-card-shell { overflow: hidden }),
   *      不再被裁剪;
   *   2) 菜单始终绘制在最高层,不会被卡片或兄弟元素遮挡。
   *
   * ⚠️ 必须在 rAF 里再算一次坐标,而不是同步读取:
   *   当 trigger 在 .plaza-pill-body 里,该 body 用
   *     `grid-template-rows: 0fr → 1fr` 做 240ms 展开动画。
   *   useEffect 跑时的同步 layout,grid 容器高度还没追上动画目标,
   *   trigger 的 getBoundingClientRect 拿到的是动画中间位置,
   *   fixed 菜单就会贴在 trigger 错误的位置、看起来「偏移到下面」。
   *   在 requestAnimationFrame 末尾重读一次,能拿到动画落定后的真实坐标。
   *   再额外监听 scroll/resize,把菜单贴回 trigger 跟随滚动。 */
  useEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setMenuPos({
        top: rect.bottom + 8,
        left: rect.left,
        width: 0,
      });
      setTriggerWidth(rect.width);
    };

    updatePosition();
    const frameHandles: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      frameHandles.push(window.requestAnimationFrame(updatePosition));
    }
    let cleanupTransition: (() => void) | null = null;
    const rootElement = rootRef.current;
    const ancestor = rootElement?.closest('.plaza-pill-body');
    const handleAnyEnd = () => {
      updatePosition();
    };
    if (ancestor) {
      ancestor.addEventListener('transitionend', handleAnyEnd);
      ancestor.addEventListener('animationend', handleAnyEnd);
      cleanupTransition = () => {
        ancestor.removeEventListener('transitionend', handleAnyEnd);
        ancestor.removeEventListener('animationend', handleAnyEnd);
      };
    }
    const fallbackTimer = window.setTimeout(handleAnyEnd, 320);

    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      frameHandles.forEach((handle) => window.cancelAnimationFrame(handle));
      if (cleanupTransition) cleanupTransition();
      window.clearTimeout(fallbackTimer);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      /* 菜单用 portal 挂到 document.body,不在 rootRef 子树里。
       * 点选项时如果只检查 trigger 容器,会被当成"点外面"立刻关掉,
       * 选项的 click 来不及触发,看起来就是下拉展开后点不了。 */
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className={open ? 'custom-select open' : 'custom-select'} ref={rootRef}>
      <span>{label}</span>
      <button
        aria-expanded={open}
        className="custom-select-trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span>{selectedOption?.label ?? ''}</span>
        <span aria-hidden="true" className="custom-select-chevron">
          ▾
        </span>
      </button>
      {open && menuPos
        ? createPortal(
            <div
              className="custom-select-menu"
              ref={menuRef}
              role="listbox"
              aria-label={label}
              onPointerDown={(event) => event.stopPropagation()}
              style={{
                position: 'fixed',
                top: menuPos.top,
                left: menuPos.left,
                minWidth: triggerWidth ? `${triggerWidth}px` : undefined,
              }}
            >
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <button
                    aria-selected={active}
                    className={active ? 'custom-select-option active' : 'custom-select-option'}
                    key={option.value}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    role="option"
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
