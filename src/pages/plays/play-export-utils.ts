/**
 * 广场导出按钮的共用工具。
 *
 * 原本散落在 PlayListPage.tsx 顶层,这里抽出来供多个导出按钮组件共用:
 *   - ExportAllButton / ExportFavoritesButton / ExportSelectedButton
 *   - (后续)ExportAuthorModal / ExportCategoryModal
 *
 * 与原 PlayListPage 实现的差异:
 *   - collectExportPlaySet / buildScopedExportFileName 等保持原行为
 *   - 不依赖 React,纯函数,易测
 */
import { DEFAULT_CATEGORY, type Play } from '../../types/play';
import { downloadTextFile, serializePlaysToBatchText } from '../../services/play-text';
import { getPlayVersionKey, sortPlayVersions } from './play-versions';

export type ExportTargetType = 'author' | 'category';

/* 按版本键(同一个 playId 的所有历史版本)收集导出集,避免只导出最新版本漏掉其他版本。 */
export const collectExportPlaySet = (items: Play[], allItems: Play[]) => {
  const versionGroups = allItems.reduce((groups, play) => {
    const key = getPlayVersionKey(play);
    const current = groups.get(key) ?? [];
    current.push(play);
    groups.set(key, current);
    return groups;
  }, new Map<string, Play[]>());

  const exported: Play[] = [];
  const seenIds = new Set<string>();

  items.forEach((play) => {
    const relatedPlays = sortPlayVersions(versionGroups.get(getPlayVersionKey(play)) ?? [play]);
    relatedPlays.forEach((item) => {
      if (seenIds.has(item.id)) {
        return;
      }

      seenIds.add(item.id);
      exported.push(item);
    });
  });

  return exported;
};

/* 共用的导出入口:序列化为 txt + 触发下载,文件名前缀由调用方传入。 */
export function exportPlaysAsTextFile(items: Play[], fileNamePrefix: string) {
  const exportItems = collectExportPlaySet(items, items);
  if (exportItems.length === 0) {
    return { count: 0 };
  }

  const text = serializePlaysToBatchText(exportItems);
  downloadTextFile(`${fileNamePrefix}-${exportItems.length}篇.txt`, text);
  return { count: exportItems.length };
}

/* 作者/分类导出文件名相关 — 留给 ExportAuthorModal / ExportCategoryModal 用 */
const safeExportFileNamePart = (value: string, fallback: string) =>
  (value.trim() || fallback)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80) || fallback;

export const buildScopedExportFileName = (type: ExportTargetType, name: string, count: number) => {
  const typeLabel = type === 'author' ? '作者' : '分类';
  const fallbackName = type === 'author' ? '匿名' : DEFAULT_CATEGORY;
  return `${typeLabel}-${safeExportFileNamePart(name, fallbackName)}-${count}篇小剧场.txt`;
};

export const buildScopedExportArchiveName = (type: ExportTargetType, count: number) =>
  type === 'author' ? `作者导出-${count}位作者.zip` : `分类导出-${count}个分类.zip`;
