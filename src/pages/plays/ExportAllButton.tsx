/**
 * 广场「导出全部」按钮。
 *
 * 抽取动机与 ExportContinuationsButton 一致:PlayListPage 太大,
 * 拆成可独立渲染的小组件,让浏览器层冒烟能直接模拟按钮点击。
 */
import { useCallback } from 'react';
import { showFloatingToast } from '../../components/floating-toast-store';
import { isDislikedPlay, type PlayPreferenceStore } from '../../services/browser-play-preferences';
import type { Play } from '../../types/play';
import { exportPlaysAsTextFile } from './play-export-utils';

export type ExportAllButtonProps = {
  plays: Play[];
  preferenceStore: PlayPreferenceStore;
  blockDislikedOnExport: boolean;
};

export function ExportAllButton({
  plays,
  preferenceStore,
  blockDislikedOnExport,
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
    <button className="button secondary plaza-toolbar-button" onClick={handleClick} type="button">
      导出全部
    </button>
  );
}
