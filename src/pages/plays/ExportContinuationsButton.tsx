/**
 * 广场「导出续写」按钮。
 *
 * 从 PlayListPage 抽出来,理由:
 *   1. PlayListPage 是个 2000+ 行的超大组件,内联按钮 + 业务逻辑混在里面,
 *      浏览器层冒烟需要 mock 一堆依赖,失去"真实测试"价值。
 *   2. 抽成独立组件后,这个组件本身是个有清晰 props/输出的纯展示组件,
 *      测试只要 mock 外部依赖(playApi / downloadContinuationsArchive)即可。
 *
 * Props 故意不传整个 preferenceStore,而是传 isDisliked 这种判断函数,
 * 是为了让测试可以无视 store 形状,直接控制"哪些 play 被屏蔽"。
 */
import { useCallback, type CSSProperties } from 'react';
import { showFloatingToast } from '../../components/floating-toast-store';
import { isDislikedPlay, type PlayPreferenceStore } from '../../services/browser-play-preferences';
import { playApi } from '../../services/play-api';
import { downloadContinuationsArchive } from '../../services/play-backup';
import type { Play } from '../../types/play';

export type ExportContinuationsButtonProps = {
  /** 经过当前筛选/搜索后的 plays(尚未扣除不喜欢) */
  plays: Play[];
  /** 偏好 store,用于判断不喜欢 */
  preferenceStore: PlayPreferenceStore;
  /** 是否屏蔽不喜欢(checkbox) */
  blockDislikedOnExport: boolean;
  /** 覆盖按钮默认 className,留给 PlayListPage 注入样式 */
  className?: string;
  /** 覆盖按钮默认 style,留给 PlayListPage 注入样式 */
  style?: CSSProperties;
  /** 按钮文字,广场胶囊分组里改成"续写"以省略"导出"前缀。 */
  label?: string;
};

/* 异步,避免一次查询太多 play 时阻塞 UI。 */
export function ExportContinuationsButton({
  plays,
  preferenceStore,
  blockDislikedOnExport,
  className = 'button secondary plaza-toolbar-button',
  style,
  label = '导出续写',
}: ExportContinuationsButtonProps) {
  const handleClick = useCallback(async () => {
    const sourcePlays = blockDislikedOnExport
      ? plays.filter((play) => !isDislikedPlay(play.id, preferenceStore))
      : plays;
    const playIds = sourcePlays.map((play) => play.id);

    if (playIds.length === 0) {
      showFloatingToast('当前没有可导出续写的小剧场', 'error');
      return;
    }

    showFloatingToast(`正在整理 ${playIds.length} 篇小剧场下的续写…`);

    try {
      const continuations = await playApi.getApprovedContinuationsByPlayIds(playIds, 'asc');
      if (continuations.length === 0) {
        showFloatingToast('当前条件下没有可导出的续写', 'error');
        return;
      }
      downloadContinuationsArchive(continuations, '续写');
      showFloatingToast(`已导出 ${continuations.length} 条已审核续写（纯净版）。`);
    } catch (reason) {
      showFloatingToast(reason instanceof Error ? reason.message : '导出续写失败', 'error');
    }
  }, [plays, preferenceStore, blockDislikedOnExport]);

  return (
    <button className={className} onClick={() => void handleClick()} style={style} type="button">
      {label}
    </button>
  );
}
