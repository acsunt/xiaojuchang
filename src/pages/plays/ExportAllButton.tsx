/**
 * 广场「导出全部」按钮。
 *
 * 抽取动机与 ExportContinuationsButton 一致:PlayListPage 太大,
 * 拆成可独立渲染的小组件,让浏览器层冒烟能直接模拟按钮点击。
 *
 * className / style 允许父组件传入(例如 .plaza-pill-subitem),
 * 默认值沿用旧 toolbar 的视觉样式以兼容其他场景。
 */
import { useCallback, type CSSProperties } from 'react';
import { showFloatingToast } from '../../components/floating-toast-store';
import { isDislikedPlay, type PlayPreferenceStore } from '../../services/browser-play-preferences';
import type { Play } from '../../types/play';
import { exportPlaysAsTextFile } from './play-export-utils';

export type ExportAllButtonProps = {
  plays: Play[];
  preferenceStore: PlayPreferenceStore;
  blockDislikedOnExport: boolean;
  className?: string;
  style?: CSSProperties;
  /** 按钮文字,默认"导出全部"。广场胶囊分组里会被改成"全部"。 */
  label?: string;
};

export function ExportAllButton({
  plays,
  preferenceStore,
  blockDislikedOnExport,
  className = 'button secondary plaza-toolbar-button',
  style,
  label = '导出全部',
}: ExportAllButtonProps) {
  const handleClick = useCallback(() => {
    const sourcePlays = blockDislikedOnExport
      ? plays.filter((play) => !isDislikedPlay(play.id, preferenceStore))
      : plays;
    if (sourcePlays.length === 0) {
      showFloatingToast('当前没有可导出的内容', 'error');
      return;
    }

    const { count } = exportPlaysAsTextFile(sourcePlays, '全部小剧场');
    if (count > 0) {
      showFloatingToast(`已导出全部 ${count} 篇小剧场。`);
    }
  }, [plays, preferenceStore, blockDislikedOnExport]);

  return (
    <button className={className} onClick={handleClick} style={style} type="button">
      {label}
    </button>
  );
}
