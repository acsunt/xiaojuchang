import type { Play } from './play';

export type PlayTimeSortMode = 'created_desc' | 'created_asc' | 'updated_desc' | 'updated_asc';

export const PLAY_TIME_SORT_OPTIONS: Array<{ value: PlayTimeSortMode; label: string }> = [
  { value: 'created_desc', label: '上传时间倒序' },
  { value: 'created_asc', label: '上传时间正序' },
  { value: 'updated_desc', label: '更新时间倒序' },
  { value: 'updated_asc', label: '更新时间正序' },
];

export const DEFAULT_PLAY_TIME_SORT_MODE: PlayTimeSortMode = 'created_desc';

const PLAY_TIME_SORT_VALUES = PLAY_TIME_SORT_OPTIONS.map((item) => item.value);

export const isPlayTimeSortMode = (value: string): value is PlayTimeSortMode =>
  PLAY_TIME_SORT_VALUES.includes(value as PlayTimeSortMode);

export const comparePlaysByTimeSort = (left: Play, right: Play, sortMode: PlayTimeSortMode) => {
  const field = sortMode.startsWith('created') ? 'createdAt' : 'updatedAt';
  const result = left[field].localeCompare(right[field]);
  return sortMode.endsWith('_asc') ? result : -result;
};
