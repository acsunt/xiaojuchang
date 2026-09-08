/**
 * 浏览器层冒烟测试的公共渲染工具。
 *
 * 设计动机:
 * - PlayListPage / AdminReviewPage 等路由组件都依赖 react-router-dom,
 *   直接用 RTL 的 render() 会触发 useNavigate() 找不到 Router 的报错。
 *   这里统一用 MemoryRouter 包一层,测试里就不用每次手写。
 * - 业务代码用 showFloatingToast() 弹 toast,而 toast 由 <FloatingToastHost />
 *   订阅渲染。把它一起挂上,测试里就能用 screen.getByRole('status') 直接断言。
 *
 * 如果以后某些测试不需要 Router(比如测纯展示组件),可以单独调用
 * `@testing-library/react` 的 render(),这里只是给"路由相关"的组件用。
 */
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render as rtlRender, type RenderOptions, type RenderResult } from '@testing-library/react';
import { FloatingToastHost } from './components/FloatingToast';

type CustomRenderOptions = Omit<RenderOptions, 'wrapper'> & {
  /** MemoryRouter 的 initialEntries,默认 ['/']。 */
  initialEntries?: string[];
};

export function render(
  ui: ReactElement,
  { initialEntries, ...rest }: CustomRenderOptions = {},
): RenderResult {
  return rtlRender(
    <MemoryRouter initialEntries={initialEntries ?? ['/']}>
      <FloatingToastHost />
      {ui}
    </MemoryRouter>,
    rest,
  );
}

/* 直接 re-export 常用的 RTL API,避免每个测试都写一长串 import。
 * 好处:换底层库时只改这一处。 */
export { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
/* 真实用户行为模拟(键盘/鼠标/focus),后续按需安装 @testing-library/user-event */
