import type { Play, PlayTimeField } from '../types/play';

const PLAY_PREFERENCES_KEY = 'mini-theater.play-preferences';
const PLAZA_NAVIGATION_SNAPSHOT_KEY = 'mini-theater.plaza-navigation-snapshot';
const PLAZA_AUTO_REFRESH_KEY = 'mini-theater.plaza-auto-refresh';
const PLAZA_CONTROLS_COLLAPSED_KEY = 'mini-theater:plaza-controls-collapsed';
const PLAZA_TOOLBAR_COLLAPSED_KEY = 'mini-theater:plaza-toolbar-collapsed';
const PLAZA_TOOLBAR_UPDATED_EVENT = 'mini-theater:plaza-toolbar-updated';
const DETAIL_FLAT_VIEW_KEY = 'mini-theater:detail-flat-view';
const DETAIL_VERSION_SELECTION_KEY = 'mini-theater:detail-version-selection';
const PLAZA_NAVIGATION_SNAPSHOT_TTL = 30 * 60 * 1000;
const FAVORITE_RANDOM_WEIGHT = 3;

export type PlazaView = 'everything' | 'all' | 'favorites' | 'disliked';
export type RandomMode = 'repeatable' | 'unique';
export type RandomScope = PlazaView;

export type PlazaNavigationSnapshot = {
  filteredPlayIds: string[];
  anchorPlayId: string;
  currentPage: number;
  scrollY: number;
  latestHeadId: string;
  latestHeadUpdatedAt: string;
  activeTimeField: PlayTimeField;
  restorePending: boolean;
  capturedAt: string;
};

export type PlayPreferenceStore = {
  favorites: string[];
  disliked: string[];
  randomSeenByScope: Record<RandomScope, string[]>;
  settings: {
    blockDislikedGlobally: boolean;
    favoriteOnlyRandom: boolean;
    favoriteWeightedRandom: boolean;
  };
};

export type RandomPickOptions = {
  favoriteOnly?: boolean;
  favoriteWeighted?: boolean;
  blockDislikedGlobally?: boolean;
  mode: RandomMode;
  plays: Play[];
  scope: RandomScope;
  store?: PlayPreferenceStore;
};

export type RandomPickResult = {
  play: Play | null;
  reason: 'picked' | 'empty' | 'exhausted';
  store: PlayPreferenceStore;
};

const defaultStore: PlayPreferenceStore = {
  favorites: [],
  disliked: [],
  randomSeenByScope: {
    everything: [],
    all: [],
    favorites: [],
    disliked: [],
  },
  settings: {
    blockDislikedGlobally: true,
    favoriteOnlyRandom: false,
    favoriteWeightedRandom: false,
  },
};

const readStore = <T>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeStore = <T>(key: string, value: T) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
};

const readSessionStore = <T>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.sessionStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    window.sessionStorage.removeItem(key);
    return fallback;
  }
};

const writeSessionStore = <T>(key: string, value: T) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(key, JSON.stringify(value));
};

const clearSessionStore = (key: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(key);
};

const uniq = (items: string[]) => Array.from(new Set(items.filter(Boolean)));

const sanitizeStore = (
  raw: Partial<PlayPreferenceStore> | null | undefined,
): PlayPreferenceStore => ({
  favorites: uniq(raw?.favorites ?? []),
  disliked: uniq(raw?.disliked ?? []),
  randomSeenByScope: {
    everything: uniq(raw?.randomSeenByScope?.everything ?? []),
    all: uniq(raw?.randomSeenByScope?.all ?? []),
    favorites: uniq(raw?.randomSeenByScope?.favorites ?? []),
    disliked: uniq(raw?.randomSeenByScope?.disliked ?? []),
  },
  settings: {
    blockDislikedGlobally: raw?.settings?.blockDislikedGlobally ?? true,
    favoriteOnlyRandom: raw?.settings?.favoriteOnlyRandom ?? false,
    favoriteWeightedRandom: raw?.settings?.favoriteWeightedRandom ?? false,
  },
});

const saveStore = (store: PlayPreferenceStore) => {
  writeStore(PLAY_PREFERENCES_KEY, store);
  return store;
};

const sanitizePlazaNavigationSnapshot = (
  raw: Partial<PlazaNavigationSnapshot> | null | undefined,
): PlazaNavigationSnapshot | null => {
  if (!raw) {
    return null;
  }

  const capturedAt = String(raw.capturedAt ?? '');
  const capturedAtMs = Date.parse(capturedAt);
  if (
    !capturedAt ||
    Number.isNaN(capturedAtMs) ||
    Date.now() - capturedAtMs > PLAZA_NAVIGATION_SNAPSHOT_TTL
  ) {
    clearSessionStore(PLAZA_NAVIGATION_SNAPSHOT_KEY);
    return null;
  }

  return {
    filteredPlayIds: uniq(raw.filteredPlayIds ?? []),
    anchorPlayId: String(raw.anchorPlayId ?? ''),
    currentPage: Math.max(1, Number(raw.currentPage ?? 1) || 1),
    scrollY: Math.max(0, Number(raw.scrollY ?? 0) || 0),
    latestHeadId: String(raw.latestHeadId ?? ''),
    latestHeadUpdatedAt: String(raw.latestHeadUpdatedAt ?? ''),
    activeTimeField: raw.activeTimeField === 'createdAt' ? 'createdAt' : 'updatedAt',
    restorePending: Boolean(raw.restorePending),
    capturedAt,
  };
};

export const getPlazaNavigationSnapshot = () =>
  sanitizePlazaNavigationSnapshot(
    readSessionStore<PlazaNavigationSnapshot | null>(PLAZA_NAVIGATION_SNAPSHOT_KEY, null),
  );

export const savePlazaNavigationSnapshot = (snapshot: PlazaNavigationSnapshot) => {
  writeSessionStore(PLAZA_NAVIGATION_SNAPSHOT_KEY, snapshot);
  return snapshot;
};

export const updatePlazaNavigationSnapshot = (patch: Partial<PlazaNavigationSnapshot>) => {
  const current = getPlazaNavigationSnapshot();
  if (!current) {
    return null;
  }

  return savePlazaNavigationSnapshot({
    ...current,
    ...patch,
    capturedAt: patch.capturedAt ?? new Date().toISOString(),
  });
};

export const clearPlazaNavigationSnapshot = () => {
  clearSessionStore(PLAZA_NAVIGATION_SNAPSHOT_KEY);
};

/* ---------- 详情页衍生版本"平铺"开关 ----------
 * 默认关闭：保持原来的 tab-chip 切换。
 * 开启后：版本以 checkbox 列表形式平铺，可多选。 */
export const getDetailFlatView = () => {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.localStorage.getItem(DETAIL_FLAT_VIEW_KEY) === 'true';
};

export const setDetailFlatView = (enabled: boolean) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(DETAIL_FLAT_VIEW_KEY, String(enabled));
  }
  return enabled;
};

/* ---------- 详情页平铺模式下，勾选显示的版本 id 集合 ----------
 * 按 getPlayVersionKey 键存一组「该版本组里被勾选显示的 play id」。
 * 默认全选：读取时用传入的 candidateIds 补齐缺失项；
 * 永远把当前 url 指向的版本保留在勾选里（避免分享链接打开看不到正文）。 */
export const getDetailVersionSelection = (
  groupKey: string,
  currentPlayId: string,
  candidateIds: string[],
): string[] => {
  if (!groupKey || candidateIds.length === 0) {
    return [];
  }

  const raw = readStore<Record<string, string[]>>(DETAIL_VERSION_SELECTION_KEY, {});
  const stored = Array.isArray(raw[groupKey]) ? raw[groupKey] : null;
  const candidateSet = new Set(candidateIds);

  if (!stored || stored.length === 0) {
    return Array.from(new Set([currentPlayId, ...candidateIds]));
  }

  const filtered = stored.filter((id) => candidateSet.has(id));
  if (!filtered.includes(currentPlayId)) {
    filtered.unshift(currentPlayId);
  }
  return filtered;
};

export const setDetailVersionSelection = (groupKey: string, selectedIds: string[]) => {
  if (!groupKey) {
    return;
  }
  const raw = readStore<Record<string, string[]>>(DETAIL_VERSION_SELECTION_KEY, {});
  const next = { ...raw, [groupKey]: uniq(selectedIds) };
  writeStore(DETAIL_VERSION_SELECTION_KEY, next);
  return next[groupKey];
};

export const getPlazaAutoRefresh = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(PLAZA_AUTO_REFRESH_KEY) === 'true';
};

export const setPlazaAutoRefresh = (enabled: boolean) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PLAZA_AUTO_REFRESH_KEY, String(enabled));
  }

  return enabled;
};

export const getPlazaControlsCollapsed = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(PLAZA_CONTROLS_COLLAPSED_KEY) === 'true';
};

export const setPlazaControlsCollapsed = (collapsed: boolean) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PLAZA_CONTROLS_COLLAPSED_KEY, String(collapsed));
  }

  return collapsed;
};

export const getPlazaToolbarCollapsed = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(PLAZA_TOOLBAR_COLLAPSED_KEY) === 'true';
};

export const setPlazaToolbarCollapsed = (collapsed: boolean) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PLAZA_TOOLBAR_COLLAPSED_KEY, String(collapsed));
    window.dispatchEvent(new Event(PLAZA_TOOLBAR_UPDATED_EVENT));
  }

  return collapsed;
};

export { PLAZA_TOOLBAR_UPDATED_EVENT };

export const getPlayPreferenceStore = () =>
  sanitizeStore(readStore<PlayPreferenceStore>(PLAY_PREFERENCES_KEY, defaultStore));

export const setPlayPreferenceSetting = (
  key: keyof PlayPreferenceStore['settings'],
  value: boolean,
  store = getPlayPreferenceStore(),
) =>
  saveStore({
    ...store,
    settings: {
      ...store.settings,
      [key]: value,
    },
  });

export const isFavoritePlay = (playId: string, store = getPlayPreferenceStore()) =>
  store.favorites.includes(playId);

export const isDislikedPlay = (playId: string, store = getPlayPreferenceStore()) =>
  store.disliked.includes(playId);

export const toggleFavoritePlay = (playId: string, store = getPlayPreferenceStore()) => {
  const favorites = store.favorites.includes(playId)
    ? store.favorites.filter((id) => id !== playId)
    : [...store.favorites, playId];

  return saveStore({
    ...store,
    favorites: uniq(favorites),
    disliked: store.disliked.filter((id) => id !== playId),
  });
};

export const toggleDislikedPlay = (playId: string, store = getPlayPreferenceStore()) => {
  const disliked = store.disliked.includes(playId)
    ? store.disliked.filter((id) => id !== playId)
    : [...store.disliked, playId];

  return saveStore({
    ...store,
    disliked: uniq(disliked),
    favorites: store.favorites.filter((id) => id !== playId),
  });
};

export const setFavoriteBatch = (
  ids: string[],
  nextState: boolean,
  store = getPlayPreferenceStore(),
) => {
  const idSet = new Set(ids);
  const favorites = nextState
    ? uniq([...store.favorites, ...ids])
    : store.favorites.filter((id) => !idSet.has(id));

  return saveStore({
    ...store,
    favorites,
    disliked: nextState ? store.disliked.filter((id) => !idSet.has(id)) : store.disliked,
  });
};

export const setDislikedBatch = (
  ids: string[],
  nextState: boolean,
  store = getPlayPreferenceStore(),
) => {
  const idSet = new Set(ids);
  const disliked = nextState
    ? uniq([...store.disliked, ...ids])
    : store.disliked.filter((id) => !idSet.has(id));

  return saveStore({
    ...store,
    disliked,
    favorites: nextState ? store.favorites.filter((id) => !idSet.has(id)) : store.favorites,
  });
};

export const clearRandomSeen = (scope: RandomScope, store = getPlayPreferenceStore()) =>
  saveStore({
    ...store,
    randomSeenByScope: {
      ...store.randomSeenByScope,
      [scope]: [],
    },
  });

export const getVisiblePlays = (
  plays: Play[],
  scope: PlazaView,
  store = getPlayPreferenceStore(),
  blockDislikedOverride?: boolean,
) => {
  const favoriteSet = new Set(store.favorites);
  const dislikedSet = new Set(store.disliked);
  const blockDisliked = blockDislikedOverride ?? store.settings.blockDislikedGlobally;

  return plays.filter((play) => {
    if (scope === 'everything') {
      return true;
    }

    if (scope === 'favorites') {
      return favoriteSet.has(play.id);
    }

    if (scope === 'disliked') {
      return dislikedSet.has(play.id);
    }

    if (favoriteSet.has(play.id) || dislikedSet.has(play.id)) {
      return false;
    }

    if (blockDisliked && dislikedSet.has(play.id)) {
      return false;
    }

    return true;
  });
};

const getWeightedPool = (plays: Play[], favoriteIds: Set<string>, favoriteWeighted: boolean) => {
  if (!favoriteWeighted) {
    return plays;
  }

  return plays.flatMap((play) =>
    favoriteIds.has(play.id) ? Array.from({ length: FAVORITE_RANDOM_WEIGHT }, () => play) : [play],
  );
};

export const pickRandomPlay = ({
  plays,
  mode,
  scope,
  favoriteOnly = false,
  favoriteWeighted = false,
  blockDislikedGlobally,
  store: incomingStore,
}: RandomPickOptions): RandomPickResult => {
  const store = incomingStore ?? getPlayPreferenceStore();
  const favoriteSet = new Set(store.favorites);

  let candidatePlays = getVisiblePlays(plays, scope, store, blockDislikedGlobally);
  if (favoriteOnly) {
    candidatePlays = candidatePlays.filter((play) => favoriteSet.has(play.id));
  }

  if (candidatePlays.length === 0) {
    return { play: null, reason: 'empty', store };
  }

  const seenSet = new Set(store.randomSeenByScope[scope]);
  const uniqueCandidates =
    mode === 'unique' ? candidatePlays.filter((play) => !seenSet.has(play.id)) : candidatePlays;

  if (uniqueCandidates.length === 0) {
    return { play: null, reason: 'exhausted', store };
  }

  const weightedPool = getWeightedPool(uniqueCandidates, favoriteSet, favoriteWeighted);
  const picked = weightedPool[Math.floor(Math.random() * weightedPool.length)] ?? null;
  if (!picked) {
    return { play: null, reason: 'empty', store };
  }

  const nextStore =
    mode === 'unique'
      ? saveStore({
          ...store,
          randomSeenByScope: {
            ...store.randomSeenByScope,
            [scope]: uniq([...store.randomSeenByScope[scope], picked.id]),
          },
        })
      : store;

  return {
    play: picked,
    reason: 'picked',
    store: nextStore,
  };
};
