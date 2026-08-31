import { useMemo } from 'react';
import type { ThemeEntry, ThemeKey } from '../data/theme-list';

export interface ThemeDropdownPanelProps {
  open: boolean;
  themeList?: ReadonlyArray<ThemeEntry>;
  activeThemeKey: ThemeKey;
  isDarkMode: boolean;
  layoutMode: 'scroll' | 'wrap';
  onSelectTheme?: (key: ThemeKey) => void;
  onOpenAdvancedSettings?: () => void;
  onResetSettings?: () => void;
  onToggleMode?: () => void;
  onToggleLayout?: () => void;
}

/**
 * 「主题」按钮下方的下拉控制面板。
 */
export function ThemeDropdownPanel({
  open,
  themeList,
  activeThemeKey,
  isDarkMode,
  layoutMode,
  onSelectTheme,
  onOpenAdvancedSettings,
  onResetSettings,
  onToggleMode,
  onToggleLayout,
}: ThemeDropdownPanelProps) {
  const entries = themeList ?? [];
  const modeIconClass = useMemo(() => (isDarkMode ? 'fas fa-moon' : 'fas fa-sun'), [isDarkMode]);
  const layoutIconClass = useMemo(
    () => (layoutMode === 'scroll' ? 'fas fa-arrows-alt-h' : 'fas fa-th-large'),
    [layoutMode],
  );

  if (!open) {
    return null;
  }

  return (
    <div
      id="themeDropdownPanel"
      className="theme-dropdown-panel"
      style={{
        marginTop: 10,
        /* 主题面板和下面 hero panel 之间的间距:
         * .app-header 的 margin-bottom: 10px 已经在上面留了 10px,
         * 这里只保留少量间距(8px)避免视觉粘连,但不能过大,
         * 否则"主题面板展开时"下面那一行工具按钮会显得脱节 */
        marginBottom: 8,
        /* 改用两套都存在的 token：
         * - 默认主题用 --panel（半透明蓝/米白，与其他面板一致）
         * - 非默认主题用 --card-bg（各主题自定义的卡片色）
         * 这样无论哪个主题，面板背景都能跟同一主题下的其他面板和谐统一。 */
        background: 'var(--panel, var(--card-bg, var(--sp-panel-bg, #ffffff)))',
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      }}
    >
      <div className="topbar-row1">
        <div className="actions">
          <button
            type="button"
            className="toggle-btn"
            id="toggleSettingsBtn"
            title="高级主题设置"
            onClick={onOpenAdvancedSettings}
          >
            <i className="fas fa-sliders-h" />
          </button>
          <button
            type="button"
            className="toggle-btn"
            id="resetBtn"
            title="恢复默认"
            onClick={onResetSettings}
          >
            <i className="fas fa-undo" />
          </button>
          <div className="topbar-divider" />
          <button
            type="button"
            className="toggle-btn"
            id="modeBtn"
            title="切换日夜模式"
            onClick={onToggleMode}
          >
            <i className={modeIconClass} id="modeIcon" />
          </button>
          <button
            type="button"
            className="toggle-btn"
            id="layoutBtn"
            title="切换滑动/换行展示"
            onClick={onToggleLayout}
          >
            <i className={layoutIconClass} id="layoutIcon" />
          </button>
        </div>
      </div>
      <div className={`switcher layout-${layoutMode}`} id="switcher">
        {entries.map((entry) => (
          <button
            type="button"
            key={entry.key}
            data-key={entry.key}
            className={activeThemeKey === entry.key ? 'active' : ''}
            onClick={() => onSelectTheme?.(entry.key)}
          >
            {entry.name}
          </button>
        ))}
      </div>
    </div>
  );
}
