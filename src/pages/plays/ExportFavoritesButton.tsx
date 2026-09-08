/**
 * 广场「导出收藏」按钮。
 *
 * 收藏数为 0 时直接禁用 + 弹错误 toast,避免用户点了才有反应。
 *
 * className / style 允许父组件传入(例如 .plaza-pill-subitem),
 * 默认值沿用旧 toolbar 的视觉样式以兼容其他场景。
 */
import { useCallback, type CSSProperties } from 'react';
import { showFloatingToast } from '../../components/floating-toast-store';
import type { Play } from '../../types/play';
import { exportPlaysAsTextFile } from './play-export-utils';

export type ExportFavoritesButtonProps = {
  favoritePlays: Play[];
  className?: string;
  style?: CSSProperties;
};

export function ExportFavoritesButton({
  favoritePlays,
  className = 'button secondary plaza-toolbar-button',
  style,
}: ExportFavoritesButtonProps) {
  const handleClick = useCallback(() => {
    if (favoritePlays.length === 0) {
      showFloatingToast('当前没有收藏的小剧场可导出', 'error');
      return;
    }

    const { count } = exportPlaysAsTextFile(favoritePlays, '收藏小剧场');
    if (count > 0) {
      showFloatingToast(`已导出收藏 ${count} 篇小剧场。`);
    }
  }, [favoritePlays]);

  return (
    <button
      className={className}
      disabled={favoritePlays.length === 0}
      onClick={handleClick}
      style={style}
      type="button"
    >
      导出收藏
    </button>
  );
}
