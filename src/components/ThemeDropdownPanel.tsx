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
      style={{
        marginTop: 10,
        background: 'var(--card-bg)',
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
