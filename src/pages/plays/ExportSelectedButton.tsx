/**
 * 广场「导出所选」按钮 — 两种状态:
 *
 *   1. idle:第一次点击进入"选择模式"(由 setSelectionMode 控制)
 *   2. export:已选中的 play 可被导出
 *
 * 选择模式 toggle 和导出动作都需要由 PlayListPage 自己控制(选择状态是页面级的),
 * 所以这里把 setSelectionMode 作为 prop 传入。
 *
 * className / style 允许父组件传入(例如 .plaza-pill-subitem),
 * 默认值沿用旧 toolbar 的视觉样式以兼容其他场景。
 */
import { useCallback, type CSSProperties } from 'react';
import { showFloatingToast } from '../../components/floating-toast-store';
import { isDislikedPlay, type PlayPreferenceStore } from '../../services/browser-play-preferences';
import type { Play } from '../../types/play';
import { exportPlaysAsTextFile } from './play-export-utils';

export type SelectionModeLike = 'idle' | 'export' | 'favorite' | 'disliked';

export type ExportSelectedButtonProps = {
  selectedPlays: Play[];
  /* SelectionMode 来自 PlayListPage,这里接受它的全集;
   * 组件内部只看 'idle' / 'export' 两个状态,其他状态按 idle 处理(用户点了再说)。 */
  selectionMode: SelectionModeLike;
  setSelectionMode: (mode: SelectionModeLike) => void;
  preferenceStore: PlayPreferenceStore;
  blockDislikedOnExport: boolean;
  className?: string;
  style?: CSSProperties;
  /** 按钮默认文字,广场胶囊分组里改成"所选"以省略"导出"前缀。 */
  label?: string;
};

export function ExportSelectedButton({
  selectedPlays,
  selectionMode,
  setSelectionMode,
  preferenceStore,
  blockDislikedOnExport,
  className = 'button secondary plaza-toolbar-button',
  style,
  label = '导出所选',
}: ExportSelectedButtonProps) {
  const handleClick = useCallback(() => {
    if (selectionMode !== 'export') {
      setSelectionMode('export');
      return;
    }

    if (selectedPlays.length === 0) {
      showFloatingToast('先选择要导出的内容', 'error');
      return;
    }

    const sourcePlays = blockDislikedOnExport
      ? selectedPlays.filter((play) => !isDislikedPlay(play.id, preferenceStore))
      : selectedPlays;
    if (sourcePlays.length === 0) {
      showFloatingToast('选中内容全部被标记为不喜欢，已被屏蔽。请先取消不喜欢再导出。', 'error');
      return;
    }

    const { count } = exportPlaysAsTextFile(sourcePlays, '已选小剧场');
    if (count > 0) {
      showFloatingToast(`已导出已选 ${count} 篇小剧场。`);
      setSelectionMode('idle');
    }
  }, [selectedPlays, selectionMode, setSelectionMode, preferenceStore, blockDislikedOnExport]);

  return (
    <button className={className} onClick={handleClick} style={style} type="button">
      {selectionMode === 'export' ? `导出已选（${selectedPlays.length}）` : label}
    </button>
  );
}
