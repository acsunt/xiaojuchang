import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ConfettiCanvas, type ConfettiCanvasHandle } from '../../components/ConfettiCanvas';
import {
  getConfettiPrefs,
  setConfettiEnabled,
  setConfettiSound,
  type ConfettiPrefs,
} from '../../services/confetti-prefs';
import {
  clearRandomSeen,
  getPlazaAutoRefresh,
  getPlazaControlsCollapsed,
  getPlazaNavigationSnapshot,
  getPlazaToolbarCollapsed,
  getPlayPreferenceStore,
  getVisiblePlays,
  isDislikedPlay,
  isFavoritePlay,
  pickRandomPlay,
  savePlazaNavigationSnapshot,
  setDislikedBatch,
  setFavoriteBatch,
  setPlazaAutoRefresh,
  setPlazaControlsCollapsed,
  setPlayPreferenceSetting,
  updatePlazaNavigationSnapshot,
  toggleDislikedPlay,
  toggleFavoritePlay,
  PLAZA_TOOLBAR_UPDATED_EVENT,
  type PlazaNavigationSnapshot,
  type PlazaView,
  type PlayPreferenceStore,
  type RandomMode,
} from '../../services/browser-play-preferences';
import {
  downloadBlobFile,
  downloadTextFile,
  serializePlaysToBatchText,
} from '../../services/play-text';
import { createZipFromTextFiles } from '../../services/simple-zip';
import { getCachedPublicPlays, playApi } from '../../services/play-api';
import { PlazaCalendarPanel } from './PlazaCalendarPanel';
import { PlazaDerivedPanel } from './PlazaDerivedPanel';
import { getPlayVersionKey, sortPlayVersions } from './play-versions';
import {
  DEFAULT_CATEGORY,
  PLAYS_UPDATED_EVENT,
  type Play,
  type RepoSummary,
} from '../../types/play';
import { openVisitorChangelog } from '../../data/visitor-changelog';
import { showFloatingToast } from '../../components/FloatingToast';

type SortMode = 'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc';
type RepoFilterMode = 'all' | 'with' | 'without';
type RepoSortMode =
  'none' | 'count_desc' | 'count_asc' | 'first_desc' | 'first_asc' | 'last_desc' | 'last_asc';
type SelectionMode = 'idle' | 'export' | 'favorite' | 'disliked';
type CategoryStat = { name: string; count: number };
type AuthorStat = { name: string; count: number };
type SelectOption = { value: string; label: string };
type ExportOption = { value: string; label: string; count: number };
type ExportTargetType = 'author' | 'category';

type ExportPickerModalProps = {
  items: ExportOption[];
  onClose: () => void;
  onExportAll: () => void;
  onExportSelected: () => void;
  onToggleItem: (value: string) => void;
  onToggleAll: () => void;
  selectedValues: string[];
  title: string;
};
type RestoreMode = 'top' | 'scroll' | 'anchor';
type PendingRefreshState = {
  nextPlays: Play[];
  addedCount: number;
};

const DEFAULT_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 200;
const PLAZA_PAGE_SIZE_KEY = 'mini-theater:plaza-page-size';
const PLAZA_ACTIVE_VIEW_KEY = 'mini-theater:plaza-active-view';
const PLAZA_ACTIVE_CATEGORY_KEY = 'mini-theater:plaza-active-category';
const PLAZA_CATEGORY_FILTER_OPEN_KEY = 'mini-theater:plaza-category-filter-open';
const PLAZA_ACTIVE_AUTHOR_KEY = 'mini-theater:plaza-active-author';
const PLAZA_COLUMNS_KEY = 'mini-theater:plaza-columns';
const PLAZA_SORT_MODE_KEY = 'mini-theater:plaza-sort-mode';
const PLAZA_SHOW_PREVIEW_KEY = 'mini-theater:plaza-show-preview';
const PLAZA_SHOW_PREFERENCE_ACTIONS_KEY = 'mini-theater:plaza-show-preference-actions';
const PLAZA_REPO_FILTER_KEY = 'mini-theater:plaza-repo-filter';
const PLAZA_REPO_SORT_KEY = 'mini-theater:plaza-repo-sort';
const PLAZA_BLOCK_DISLIKED_ON_EXPORT_KEY = 'mini-theater:plaza-block-disliked-on-export';
const PLAZA_SEARCH_KEYWORD_KEY = 'mini-theater:plaza-search-keyword';
const PLAZA_SEARCH_TIMESTAMP_KEY = 'mini-theater:plaza-search-timestamp';
const PLAZA_SEARCH_TTL_MS = 24 * 60 * 60 * 1000; // 一天后自动清空搜索状态

// 设备逻辑宽度（CSS 像素），优先用 screen.width / devicePixelRatio，
// 该值在 Android Chrome / 微信 X5 的 pinch zoom 期间保持不变。
// 避免浏览器把视觉 viewport 拉大后把手机误判为平板 / 桌面。
const detectDeviceCssWidth = (): number => {
  if (typeof window === 'undefined') {
    return 0;
  }

  const dpr = window.devicePixelRatio || 1;
  const screenWidth = window.screen?.width ?? 0;
  const screenHeight = window.screen?.height ?? 0;
  if (!screenWidth) {
    return window.innerWidth;
  }

  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const isIPad =
    !!nav &&
    (/iPad/i.test(nav.userAgent) ||
      (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1) ||
      (/Macintosh/i.test(nav.userAgent) && nav.maxTouchPoints > 1));

  // iPad 的 screen.width 已是 CSS 像素（竖屏 768），再除以 dpr 会变成 384 被误判成手机
  if (isIPad) {
    return Math.min(screenWidth, screenHeight || screenWidth);
  }

  const divided = dpr > 0 ? Math.round(screenWidth / dpr) : screenWidth;
  // iPhone 同样是 CSS 像素，除以 dpr 会小于 320
  if (divided < 320) {
    return screenWidth;
  }

  return divided || screenWidth;
};

const detectViewportMode = (): 'mobile' | 'tablet' | 'desktop' => {
  if (typeof window === 'undefined') {
    return 'desktop';
  }

  const cssWidth = detectDeviceCssWidth();
  // iPad 9.7/10.2" 竖屏是 768 CSS px，应视为平板（一行最多 3 个），不要当成手机 cap 2 列
  if (cssWidth > 0 && cssWidth < 768) return 'mobile';
  if (cssWidth > 0 && cssWidth <= 1100) return 'tablet';
  if (cssWidth > 0) return 'desktop';

  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width <= 1100) return 'tablet';
  return 'desktop';
};

const readPlazaSearchKeyword = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }

  const saved = window.localStorage.getItem(PLAZA_SEARCH_KEYWORD_KEY) ?? '';
  if (!saved) {
    return '';
  }

  const rawTimestamp = Number(window.localStorage.getItem(PLAZA_SEARCH_TIMESTAMP_KEY));
  const timestamp = Number.isFinite(rawTimestamp) && rawTimestamp > 0 ? rawTimestamp : 0;
  if (Date.now() - timestamp > PLAZA_SEARCH_TTL_MS) {
    // 超过一天，视为清空
    window.localStorage.removeItem(PLAZA_SEARCH_KEYWORD_KEY);
    window.localStorage.removeItem(PLAZA_SEARCH_TIMESTAMP_KEY);
    return '';
  }

  return saved;
};

const orderPlaysByNewest = (items: Play[]) =>
  [...items].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
  );

const countNewPublicPlays = (
  currentPlays: Play[],
  nextPlays: Play[],
  snapshot: PlazaNavigationSnapshot | null,
) => {
  const previousHeadId = snapshot?.latestHeadId || orderPlaysByNewest(currentPlays)[0]?.id || '';
  if (!previousHeadId) {
    return 0;
  }

  const orderedNext = orderPlaysByNewest(nextPlays);
  const previousHeadIndex = orderedNext.findIndex((play) => play.id === previousHeadId);
  if (previousHeadIndex >= 0) {
    return previousHeadIndex;
  }

  const currentIds = new Set(currentPlays.map((play) => play.id));
  return orderedNext.filter((play) => !currentIds.has(play.id)).length;
};

const viewLabels: Record<PlazaView, string> = {
  everything: '全部',
  all: '未标记',
  favorites: '收藏',
  disliked: '不喜欢',
};

const initialPreferenceStore = getPlayPreferenceStore();

const readPlazaBool = (key: string, fallback = false) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  if (raw === null) {
    return fallback;
  }

  return raw === 'true';
};

const readPlazaString = (key: string, fallback = '') => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  return window.localStorage.getItem(key) ?? fallback;
};

const readPlazaNumber = (key: string, fallback: number) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = Number(window.localStorage.getItem(key));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

const clampPageSize = (value: number) =>
  Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.trunc(value)));

type PlaySearchField = 'title' | 'author' | 'category' | 'content';

const playSearchFieldOptions: Array<{ value: PlaySearchField; label: string }> = [
  { value: 'title', label: '标题' },
  { value: 'author', label: '作者' },
  { value: 'category', label: '分类' },
  { value: 'content', label: '正文' },
];

const defaultPlaySearchFields: PlaySearchField[] = playSearchFieldOptions.map((item) => item.value);

const toggleSearchField = <T extends string>(current: T[], field: T) => {
  if (current.includes(field)) {
    return current.filter((item) => item !== field);
  }

  return [...current, field];
};

const isSearchFieldActive = <T extends string>(current: T[], field: T) => current.includes(field);

const matchesPlayKeyword = (
  play: Play,
  normalizedKeyword: string,
  fields: PlaySearchField[] = defaultPlaySearchFields,
) => {
  if (!normalizedKeyword) {
    return true;
  }

  const activeFields = fields.length > 0 ? fields : defaultPlaySearchFields;
  const haystack: string[] = [];

  if (activeFields.includes('title')) {
    haystack.push(play.title);
  }
  if (activeFields.includes('author')) {
    haystack.push(play.authorName);
  }
  if (activeFields.includes('category')) {
    haystack.push(play.category);
  }
  if (activeFields.includes('content')) {
    haystack.push(play.summary, play.content);
  }

  return haystack.join(' ').toLowerCase().includes(normalizedKeyword);
};

const getPlayAuthorName = (play: Play) => play.authorName.trim() || '匿名';
const getPlayCategoryName = (play: Play) => play.category?.trim() || DEFAULT_CATEGORY;

const groupPlaysByExportValue = (items: Play[], pickValue: (play: Play) => string) => {
  const groups = new Map<string, Play[]>();

  items.forEach((play) => {
    const value = pickValue(play);
    const current = groups.get(value);
    if (current) {
      current.push(play);
      return;
    }

    groups.set(value, [play]);
  });

  return groups;
};

const buildExportOptions = (groups: Map<string, Play[]>) =>
  [...groups.entries()]
    .map(([value, items]) => ({ value, label: value, count: items.length }))
    .sort(
      (left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'),
    );

const safeExportFileNamePart = (value: string, fallback: string) =>
  (value.trim() || fallback)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80) || fallback;

const buildScopedExportFileName = (type: ExportTargetType, name: string, count: number) => {
  const typeLabel = type === 'author' ? '作者' : '分类';
  const fallbackName = type === 'author' ? '匿名' : DEFAULT_CATEGORY;
  return `${typeLabel}-${safeExportFileNamePart(name, fallbackName)}-${count}篇小剧场.txt`;
};

const buildScopedExportArchiveName = (type: ExportTargetType, count: number) =>
  type === 'author' ? `作者导出-${count}位作者.zip` : `分类导出-${count}个分类.zip`;

const collectExportPlaySet = (items: Play[], allItems: Play[]) => {
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

const copyText = async (value: string) => {
  await navigator.clipboard.writeText(value);
};

const ClearableField = ({
  children,
  onClear,
  visible,
}: {
  children: ReactNode;
  onClear: () => void;
  visible: boolean;
}) => (
  <div className="clearable-field">
    {children}
    {visible ? (
      <button aria-label="清空输入" className="clear-field-button" onClick={onClear} type="button">
        ×
      </button>
    ) : null}
  </div>
);

type CustomSelectProps = {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
};

function ExportPickerModal({
  items,
  onClose,
  onExportAll,
  onExportSelected,
  onToggleItem,
  onToggleAll,
  selectedValues,
  title,
}: ExportPickerModalProps) {
  const selectedCount = selectedValues.length;
  const allSelected = items.length > 0 && selectedCount === items.length;

  return (
    <div className="plaza-refresh-modal-backdrop" onClick={onClose} role="presentation">
      <section
        aria-labelledby="plaza-export-modal-title"
        aria-modal="true"
        className="form-panel plaza-refresh-modal plaza-export-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="stack-gap-sm">
          <h3 id="plaza-export-modal-title">{title}</h3>
          <p className="sub-copy">
            可勾选单个、多个，或直接全选导出全部。当前共 {items.length} 项，已选 {selectedCount}{' '}
            项。
          </p>
        </div>

        <div className="plaza-export-modal-toolbar">
          <button
            className="button secondary plaza-export-modal-action"
            disabled={items.length === 0}
            onClick={onToggleAll}
            type="button"
          >
            {allSelected ? '取消全选' : '全选'}
          </button>
          <button
            className="button primary plaza-export-modal-action"
            disabled={selectedCount === 0}
            onClick={onExportSelected}
            type="button"
          >
            {selectedCount > 0 ? `导出已选（${selectedCount}）` : '导出已选'}
          </button>
          <button
            className="button secondary plaza-export-modal-action"
            disabled={items.length === 0}
            onClick={onExportAll}
            type="button"
          >
            导出全部
          </button>
          <button
            className="button ghost plaza-export-modal-action"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </div>

        {items.length > 0 ? (
          <div className="plaza-export-modal-list">
            {items.map((item) => {
              const checked = selectedValues.includes(item.value);

              return (
                <label
                  className="checkbox-chip checkbox-chip-wide plaza-export-modal-option"
                  key={item.value}
                >
                  <input
                    checked={checked}
                    onChange={() => onToggleItem(item.value)}
                    type="checkbox"
                  />
                  <span>
                    {item.label} · {item.count} 篇
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="empty-panel">当前条件下没有可导出的项目。</div>
        )}
      </section>
    </div>
  );
}

function CustomSelect({ label, value, options, onChange }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((item) => item.value === value) ?? options[0];

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className={open ? 'custom-select open' : 'custom-select'} ref={rootRef}>
      <span>{label}</span>
      <button
        aria-expanded={open}
        className="custom-select-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{selectedOption?.label ?? ''}</span>
        <span aria-hidden="true" className="custom-select-chevron">
          ▾
        </span>
      </button>
      {open ? (
        <div className="custom-select-menu" role="listbox" aria-label={label}>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                aria-selected={active}
                className={active ? 'custom-select-option active' : 'custom-select-option'}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function PlayListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialNavigationSnapshot = getPlazaNavigationSnapshot();
  const [plays, setPlays] = useState<Play[]>(() => getCachedPublicPlays());
  const [loading, setLoading] = useState(() => getCachedPublicPlays().length === 0);
  const [repoCounts, setRepoCounts] = useState<RepoSummary[]>([]);
  const randomPickedCardRef = useRef<HTMLElement | null>(null);
  const confettiRef = useRef<ConfettiCanvasHandle | null>(null);
  const [keyword, setKeyword] = useState(() => readPlazaSearchKeyword());
  const [playSearchFields, setPlaySearchFields] = useState<PlaySearchField[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const saved = readPlazaString(PLAZA_SORT_MODE_KEY, 'created_desc');
    return (['updated_desc', 'updated_asc', 'created_desc', 'created_asc'] as SortMode[]).includes(
      saved as SortMode,
    )
      ? (saved as SortMode)
      : 'created_desc';
  });
  const [activeRepoFilter, setActiveRepoFilter] = useState<RepoFilterMode>(
    () => readPlazaString(PLAZA_REPO_FILTER_KEY, 'all') as RepoFilterMode,
  );
  const [repoSortMode, setRepoSortMode] = useState<RepoSortMode>(
    () => readPlazaString(PLAZA_REPO_SORT_KEY, 'none') as RepoSortMode,
  );
  const [columns, setColumns] = useState(() => readPlazaNumber(PLAZA_COLUMNS_KEY, 4));
  const [pageSize, setPageSize] = useState(() =>
    clampPageSize(readPlazaNumber(PLAZA_PAGE_SIZE_KEY, DEFAULT_PAGE_SIZE)),
  );
  const [pageSizeInput, setPageSizeInput] = useState(() =>
    String(clampPageSize(readPlazaNumber(PLAZA_PAGE_SIZE_KEY, DEFAULT_PAGE_SIZE))),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('idle');
  const [activeView, setActiveView] = useState<PlazaView>(() => {
    const saved = readPlazaString(PLAZA_ACTIVE_VIEW_KEY, 'everything');
    return (['everything', 'all', 'favorites', 'disliked'] as PlazaView[]).includes(
      saved as PlazaView,
    )
      ? (saved as PlazaView)
      : 'everything';
  });
  const [activeCategory, setActiveCategory] = useState(() =>
    readPlazaString(PLAZA_ACTIVE_CATEGORY_KEY, ''),
  );
  const [activeAuthor, setActiveAuthor] = useState(() =>
    readPlazaString(PLAZA_ACTIVE_AUTHOR_KEY, ''),
  );
  const [showPreview, setShowPreview] = useState(() => readPlazaBool(PLAZA_SHOW_PREVIEW_KEY, true));
  const [showPreferenceActions, setShowPreferenceActions] = useState(() =>
    readPlazaBool(PLAZA_SHOW_PREFERENCE_ACTIONS_KEY),
  );
  const [preferenceStore, setPreferenceStore] =
    useState<PlayPreferenceStore>(initialPreferenceStore);
  const [viewportMode, setViewportMode] = useState<'mobile' | 'tablet' | 'desktop'>(() => {
    if (typeof window === 'undefined') {
      return 'desktop';
    }
    return detectViewportMode();
  });
  const [randomPanelOpen, setRandomPanelOpen] = useState(false);
  const [exportModalType, setExportModalType] = useState<ExportTargetType | ''>('');
  const [selectedExportAuthors, setSelectedExportAuthors] = useState<string[]>([]);
  const [selectedExportCategories, setSelectedExportCategories] = useState<string[]>([]);
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(() =>
    readPlazaBool(PLAZA_CATEGORY_FILTER_OPEN_KEY, false),
  );
  const [authorFilterOpen, setAuthorFilterOpen] = useState(false);
  const [autoRefreshOnNewPlays, setAutoRefreshOnNewPlaysState] = useState(() =>
    getPlazaAutoRefresh(),
  );
  const [blockDislikedOnExport, setBlockDislikedOnExport] = useState(() =>
    readPlazaBool(PLAZA_BLOCK_DISLIKED_ON_EXPORT_KEY, false),
  );
  const [pendingRefresh, setPendingRefresh] = useState<PendingRefreshState | null>(null);
  const plazaPanel = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const panel = params.get('panel');
    if (panel === 'calendar' || panel === 'derived') {
      return panel;
    }

    return params.get('calendar') === 'open' ? 'calendar' : '';
  }, [location.search]);
  const sidePanelVisible = plazaPanel === 'calendar' || plazaPanel === 'derived';
  const previousPlazaPanelRef = useRef(plazaPanel);

  // 手机端：切到衍生/新增面板时，必须在浏览器绘制前同步滚到顶部，
  // 否则会出现“内容被推到屏幕下方，刷新时闪烁一下”的现象。
  useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const previousPanel = previousPlazaPanelRef.current;
    previousPlazaPanelRef.current = plazaPanel;
    if (previousPanel === plazaPanel) {
      return;
    }

    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
    restoreRequestRef.current = null;
    explicitRefreshTriggeredRef.current = false;
    if (getPlazaNavigationSnapshot()?.restorePending) {
      updatePlazaNavigationSnapshot({ restorePending: false });
    }

    // 同步滚动到顶部（在浏览器首次绘制前），避免一闪
    window.scrollTo(0, 0);
  }, [plazaPanel]);

  useLayoutEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'auto';
      }
    };
  }, []);

  const [controlsCollapsed, setControlsCollapsed] = useState(() => getPlazaControlsCollapsed());
  const [toolbarCollapsed, setToolbarCollapsed] = useState(() => getPlazaToolbarCollapsed());
  const [randomMode, setRandomMode] = useState<RandomMode>('repeatable');
  const [randomPickedPlayId, setRandomPickedPlayId] = useState('');
  const [confettiPrefs, setConfettiPrefsState] = useState<ConfettiPrefs>(() => getConfettiPrefs());
  const [currentPage, setCurrentPage] = useState(() =>
    initialNavigationSnapshot?.restorePending ? initialNavigationSnapshot.currentPage : 1,
  );
  const [pageInput, setPageInput] = useState(() =>
    String(initialNavigationSnapshot?.restorePending ? initialNavigationSnapshot.currentPage : 1),
  );
  const restoreRequestRef = useRef<RestoreMode | null>(
    initialNavigationSnapshot?.restorePending ? 'scroll' : null,
  );
  // 关键标志：只有在 applyPendingRefresh / auto-refresh 显式触发时才置 true。
  // mount 时如果 restoreRequestRef 被 snapshot 初始化为 'scroll'，但 explicitTriggered=false，
  // 则视为 stale 恢复 — 跳过（避免 scrollTo 到过期位置导致内容被推到屏幕外）。
  const explicitRefreshTriggeredRef = useRef(false);
  const playsRef = useRef<Play[]>(getCachedPublicPlays());
  const autoRefreshRef = useRef(autoRefreshOnNewPlays);

  const loadRepoCounts = useCallback(async (targetPlays: Play[]) => {
    if (targetPlays.length === 0) {
      setRepoCounts([]);
      return;
    }

    try {
      setRepoCounts(await playApi.getRepoCounts(targetPlays.map((play) => play.id)));
    } catch {
      setRepoCounts([]);
    }
  }, []);

  useEffect(() => {
    playsRef.current = plays;
  }, [plays]);

  useEffect(() => {
    void loadRepoCounts(plays);
  }, [loadRepoCounts, plays]);

  useEffect(() => {
    autoRefreshRef.current = autoRefreshOnNewPlays;
  }, [autoRefreshOnNewPlays]);

  useEffect(() => {
    setPageSizeInput(String(pageSize));
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PLAZA_PAGE_SIZE_KEY, String(pageSize));
    }
  }, [pageSize]);

  const loadPublicPlays = useCallback(
    async ({ showLoading = false }: { showLoading?: boolean } = {}) => {
      if (showLoading && playsRef.current.length === 0) {
        setLoading(true);
      }

      try {
        const items = await playApi.getPublicPlays();
        const previousPlays = playsRef.current;
        const snapshot = getPlazaNavigationSnapshot();
        const orderedItems = orderPlaysByNewest(items);
        const latestPlay = orderedItems[0];
        const addedCount = snapshot ? countNewPublicPlays(previousPlays, items, snapshot) : 0;

        if (addedCount > 0) {
          if (autoRefreshRef.current) {
            setPlays(items);
            setPendingRefresh(null);
            setCurrentPage(1);
            setPageInput('1');
            restoreRequestRef.current = 'top';
            explicitRefreshTriggeredRef.current = true;
            updatePlazaNavigationSnapshot({
              latestHeadId: latestPlay?.id ?? '',
              latestHeadUpdatedAt: latestPlay?.updatedAt ?? '',
              restorePending: true,
            });
            showFloatingToast(`已刷新，新增 ${addedCount} 篇小剧场。`);
          } else {
            setPendingRefresh({ nextPlays: items, addedCount });
          }
          return;
        }

        setPlays(items);
        setPendingRefresh(null);
        if (snapshot) {
          updatePlazaNavigationSnapshot({
            latestHeadId: latestPlay?.id ?? '',
            latestHeadUpdatedAt: latestPlay?.updatedAt ?? '',
          });
        }
      } catch (reason) {
        showFloatingToast(reason instanceof Error ? reason.message : '加载失败', 'error');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadPublicPlays({ showLoading: true });

    const handleRefresh = () => {
      void loadPublicPlays();
      void loadRepoCounts(playsRef.current);
      setPreferenceStore(getPlayPreferenceStore());
    };

    window.addEventListener(PLAYS_UPDATED_EVENT, handleRefresh);
    window.addEventListener('focus', handleRefresh);

    return () => {
      window.removeEventListener(PLAYS_UPDATED_EVENT, handleRefresh);
      window.removeEventListener('focus', handleRefresh);
    };
  }, [loadPublicPlays, loadRepoCounts]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    // 用设备物理宽度换算的逻辑像素作为基准，
    // 避免 Android Chrome / 微信 X5 等浏览器在 pinch zoom 时把 window.innerWidth 拉大，
    // 从而把手机误判成平板/桌面，导致 card-grid 列数变 3-4、内容向右无限扩展。
    const computeMode = () => setViewportMode(detectViewportMode());
    computeMode();
    window.addEventListener('resize', computeMode);
    return () => window.removeEventListener('resize', computeMode);
  }, []);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => plays.some((play) => play.id === id)));
  }, [plays]);

  useEffect(() => {
    if (selectionMode === 'idle') {
      setSelectedIds([]);
    }
  }, [selectionMode]);

  useEffect(() => {
    const syncToolbarCollapsed = () => {
      setToolbarCollapsed(getPlazaToolbarCollapsed());
    };

    window.addEventListener('storage', syncToolbarCollapsed);
    window.addEventListener(PLAZA_TOOLBAR_UPDATED_EVENT, syncToolbarCollapsed);
    return () => {
      window.removeEventListener('storage', syncToolbarCollapsed);
      window.removeEventListener(PLAZA_TOOLBAR_UPDATED_EVENT, syncToolbarCollapsed);
    };
  }, []);

  useEffect(() => {
    setPlazaControlsCollapsed(controlsCollapsed);
  }, [controlsCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(PLAZA_ACTIVE_VIEW_KEY, activeView);
  }, [activeView]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(PLAZA_ACTIVE_CATEGORY_KEY, activeCategory);
  }, [activeCategory]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(PLAZA_CATEGORY_FILTER_OPEN_KEY, String(categoryFilterOpen));
  }, [categoryFilterOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(PLAZA_ACTIVE_AUTHOR_KEY, activeAuthor);
  }, [activeAuthor]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(PLAZA_SORT_MODE_KEY, sortMode);
  }, [sortMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const trimmed = keyword.trim();
    if (!trimmed) {
      // 用户主动清空关键词，清除存储与时间戳，下次进入广场为空状态
      window.localStorage.removeItem(PLAZA_SEARCH_KEYWORD_KEY);
      window.localStorage.removeItem(PLAZA_SEARCH_TIMESTAMP_KEY);
      return;
    }

    // 有值时持久化并刷新时间戳，保持 TTL 续期
    window.localStorage.setItem(PLAZA_SEARCH_KEYWORD_KEY, trimmed);
    window.localStorage.setItem(PLAZA_SEARCH_TIMESTAMP_KEY, String(Date.now()));
  }, [keyword]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(PLAZA_COLUMNS_KEY, String(columns));
  }, [columns]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(PLAZA_SHOW_PREVIEW_KEY, String(showPreview));
  }, [showPreview]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(PLAZA_SHOW_PREFERENCE_ACTIONS_KEY, String(showPreferenceActions));
  }, [showPreferenceActions]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(PLAZA_BLOCK_DISLIKED_ON_EXPORT_KEY, String(blockDislikedOnExport));
  }, [blockDislikedOnExport]);

  useEffect(() => {
    if (!exportModalType) {
      return;
    }

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExportModalType('');
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [exportModalType]);

  const favoritePlays = useMemo(
    () => plays.filter((play) => isFavoritePlay(play.id, preferenceStore)),
    [plays, preferenceStore],
  );
  const dislikedPlays = useMemo(
    () => plays.filter((play) => isDislikedPlay(play.id, preferenceStore)),
    [plays, preferenceStore],
  );

  const viewCounts = useMemo(
    () => ({
      everything: plays.length,
      all: getVisiblePlays(
        plays,
        'all',
        preferenceStore,
        preferenceStore.settings.blockDislikedGlobally,
      ).length,
      favorites: favoritePlays.length,
      disliked: dislikedPlays.length,
    }),
    [dislikedPlays.length, favoritePlays.length, plays, preferenceStore],
  );

  const viewScopedPlays = useMemo(
    () =>
      getVisiblePlays(
        plays,
        activeView,
        preferenceStore,
        preferenceStore.settings.blockDislikedGlobally,
      ),
    [activeView, plays, preferenceStore],
  );

  const categoryScopedPlays = useMemo(
    () =>
      activeAuthor
        ? viewScopedPlays.filter((play) => (play.authorName.trim() || '匿名') === activeAuthor)
        : viewScopedPlays,
    [activeAuthor, viewScopedPlays],
  );

  const authorScopedPlays = useMemo(
    () =>
      activeCategory
        ? viewScopedPlays.filter(
            (play) => (play.category?.trim() || DEFAULT_CATEGORY) === activeCategory,
          )
        : viewScopedPlays,
    [activeCategory, viewScopedPlays],
  );

  const categoryStats = useMemo<CategoryStat[]>(() => {
    const counts = new Map<string, number>();
    categoryScopedPlays.forEach((play) => {
      const name = play.category?.trim() || DEFAULT_CATEGORY;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    });

    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort(
        (left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN'),
      );
  }, [categoryScopedPlays]);

  const orderedCategoryStats = useMemo(() => {
    const unclassified = categoryStats.find((item) => item.name === DEFAULT_CATEGORY);
    const others = categoryStats.filter((item) => item.name !== DEFAULT_CATEGORY);

    return unclassified ? [unclassified, ...others] : others;
  }, [categoryStats]);

  const authorStats = useMemo<AuthorStat[]>(() => {
    const counts = new Map<string, number>();
    authorScopedPlays.forEach((play) => {
      const name = play.authorName.trim() || '匿名';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    });

    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort(
        (left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN'),
      );
  }, [authorScopedPlays]);

  useEffect(() => {
    if (activeCategory && !categoryStats.some((item) => item.name === activeCategory)) {
      setActiveCategory('');
      setCurrentPage(1);
    }
  }, [activeCategory, categoryStats]);

  useEffect(() => {
    if (activeAuthor && !authorStats.some((item) => item.name === activeAuthor)) {
      setActiveAuthor('');
      setCurrentPage(1);
    }
  }, [activeAuthor, authorStats]);

  const normalizedKeyword = keyword.trim().toLowerCase();

  const repoCountMap = useMemo(() => new Map(repoCounts.map((r) => [r.playId, r])), [repoCounts]);

  const filteredPlays = useMemo(() => {
    const nextItems = viewScopedPlays.filter((play) => {
      const categoryName = play.category?.trim() || DEFAULT_CATEGORY;
      const authorName = play.authorName.trim() || '匿名';
      if (activeCategory && categoryName !== activeCategory) {
        return false;
      }

      if (activeAuthor && authorName !== activeAuthor) {
        return false;
      }

      const summary = repoCountMap.get(play.id);
      const count = summary?.count ?? 0;
      if (activeRepoFilter === 'with' && count === 0) {
        return false;
      }

      if (activeRepoFilter === 'without' && count > 0) {
        return false;
      }

      return matchesPlayKeyword(play, normalizedKeyword, playSearchFields);
    });

    const field = sortMode.startsWith('created') ? 'createdAt' : 'updatedAt';

    return [...nextItems].sort((left, right) => {
      if (repoSortMode !== 'none') {
        const l = repoCountMap.get(left.id);
        const r = repoCountMap.get(right.id);

        if (repoSortMode === 'count_desc' || repoSortMode === 'count_asc') {
          const lc = l?.count ?? 0;
          const rc = r?.count ?? 0;
          if (lc !== rc) {
            return repoSortMode.endsWith('_asc') ? lc - rc : rc - lc;
          }
        }

        if (repoSortMode === 'first_desc' || repoSortMode === 'first_asc') {
          const lv = l?.firstCreatedAt ?? '';
          const rv = r?.firstCreatedAt ?? '';
          if (lv !== rv) {
            return repoSortMode.endsWith('_asc') ? lv.localeCompare(rv) : rv.localeCompare(lv);
          }
        }

        if (repoSortMode === 'last_desc' || repoSortMode === 'last_asc') {
          const lv = l?.lastCreatedAt ?? '';
          const rv = r?.lastCreatedAt ?? '';
          if (lv !== rv) {
            return repoSortMode.endsWith('_asc') ? lv.localeCompare(rv) : rv.localeCompare(lv);
          }
        }
      }

      const result = left[field].localeCompare(right[field]);
      return sortMode.endsWith('_asc') ? result : -result;
    });
  }, [
    activeAuthor,
    activeCategory,
    normalizedKeyword,
    playSearchFields,
    sortMode,
    viewScopedPlays,
    repoSortMode,
    activeRepoFilter,
    repoCountMap,
  ]);

  const allPlaysByAuthor = useMemo(
    () => groupPlaysByExportValue(plays, getPlayAuthorName),
    [plays],
  );

  const allPlaysByCategory = useMemo(
    () => groupPlaysByExportValue(plays, getPlayCategoryName),
    [plays],
  );

  const exportAuthorOptions = useMemo(
    () => buildExportOptions(allPlaysByAuthor),
    [allPlaysByAuthor],
  );

  const exportCategoryOptions = useMemo(
    () => buildExportOptions(allPlaysByCategory),
    [allPlaysByCategory],
  );

  useEffect(() => {
    setSelectedExportAuthors((current) =>
      current.filter((value) => exportAuthorOptions.some((item) => item.value === value)),
    );
  }, [exportAuthorOptions]);

  useEffect(() => {
    setSelectedExportCategories((current) =>
      current.filter((value) => exportCategoryOptions.some((item) => item.value === value)),
    );
  }, [exportCategoryOptions]);

  const totalPages = Math.max(1, Math.ceil(filteredPlays.length / pageSize));

  useEffect(() => {
    setCurrentPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  const pagedPlays = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredPlays.slice(startIndex, startIndex + pageSize);
  }, [currentPage, filteredPlays, pageSize]);

  // 控制区面板内部是否仍有可见内容：工具栏展开时含时间排序/搜索/批量操作等；
  // 工具栏收起后，分类/作者条或收藏视图随机选项仍可能显示。三者皆无则不渲染面板外壳，避免残留空白。
  const hasVisibleControls =
    !toolbarCollapsed || categoryFilterOpen || authorFilterOpen || activeView === 'favorites';
  // 工具栏收起时，分类/作者筛选区可能仍有可见内容，单独判定；皆无则不渲染空筛选头。
  const hasFilterHeaderContent = !toolbarCollapsed || categoryFilterOpen || authorFilterOpen;

  useEffect(() => {
    if (loading) {
      return;
    }

    const restoreMode = restoreRequestRef.current;
    const snapshot = getPlazaNavigationSnapshot();
    if (!restoreMode || !snapshot?.restorePending) {
      return;
    }

    // 关键修复：snapshot 是 mount 时 stale 读取的，restoreRequestRef 是初始化时设的，
    // 这种情况下 explicitRefreshTriggeredRef 是 false（用户在当前会话没有显式触发刷新弹窗）。
    // 跳过 scrollTo/scrollIntoView 避免把视图推到屏幕外（用户"看不到内容、往下滑才有"）。
    // 同时强制 scrollTo(0) 把页面移上来对齐顶部导航。
    if (!explicitRefreshTriggeredRef.current) {
      updatePlazaNavigationSnapshot({ restorePending: false });
      restoreRequestRef.current = null;
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));
      return;
    }

    if (restoreMode === 'top') {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));
      updatePlazaNavigationSnapshot({ restorePending: false });
      restoreRequestRef.current = null;
      return;
    }

    const anchorIndex = snapshot.anchorPlayId
      ? filteredPlays.findIndex((play) => play.id === snapshot.anchorPlayId)
      : -1;
    if (anchorIndex >= 0) {
      const anchorPage = Math.floor(anchorIndex / pageSize) + 1;
      if (currentPage !== anchorPage) {
        setCurrentPage(anchorPage);
        return;
      }
    }

    window.requestAnimationFrame(() => {
      if (restoreMode === 'scroll') {
        window.scrollTo({ top: snapshot.scrollY, behavior: 'auto' });
      } else {
        const target = snapshot.anchorPlayId
          ? document.querySelector<HTMLElement>(`[data-play-id="${snapshot.anchorPlayId}"]`)
          : null;

        if (target) {
          target.scrollIntoView({ block: 'center', behavior: 'auto' });
        } else {
          window.scrollTo({ top: snapshot.scrollY, behavior: 'auto' });
        }
      }
    });

    updatePlazaNavigationSnapshot({ restorePending: false });
    restoreRequestRef.current = null;
  }, [currentPage, filteredPlays, loading, pageSize]);

  const selectedPlays = useMemo(
    () => filteredPlays.filter((play) => selectedIds.includes(play.id)),
    [filteredPlays, selectedIds],
  );

  const randomPickedPlay = useMemo(
    () => plays.find((play) => play.id === randomPickedPlayId) ?? null,
    [plays, randomPickedPlayId],
  );

  useEffect(() => {
    if (!randomPickedPlay) {
      return;
    }
    const card = randomPickedCardRef.current;
    if (!card) {
      return;
    }
    const panel = card.closest('.plaza-random-panel') as HTMLElement | null;

    const nextFrame = () => {
      if (viewportMode !== 'mobile') {
        return;
      }
      const length = randomPickedPlay.content.length;
      const cardHeight = card.offsetHeight;
      // 阈值：手机屏高度的 1.2 倍以上视为长正文
      const isLong = cardHeight > window.innerHeight * 1.2 || length > 400;

      if (isLong) {
        // 长正文：滚到抽选模式所在行，让正文多展示
        const target = panel ?? card;
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else {
        // 短正文：滚到最底部
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }
    };

    requestAnimationFrame(nextFrame);
  }, [randomPickedPlay, viewportMode]);

  const renderColumns = useMemo(() => {
    const maxColumns = viewportMode === 'mobile' ? 2 : viewportMode === 'tablet' ? 3 : 4;
    return Math.min(Math.max(columns, 1), maxColumns);
  }, [columns, viewportMode]);
  const availableColumnOptions = useMemo(() => {
    if (viewportMode === 'mobile') return [1, 2];
    if (viewportMode === 'tablet') return [1, 2, 3];
    return [1, 2, 3, 4];
  }, [viewportMode]);
  const sortModeOptions: SelectOption[] = [
    { value: 'updated_desc', label: '更新时间倒序' },
    { value: 'updated_asc', label: '更新时间正序' },
    { value: 'created_desc', label: '上传时间倒序' },
    { value: 'created_asc', label: '上传时间正序' },
  ];
  const columnOptions: SelectOption[] = availableColumnOptions.map((count) => ({
    value: String(count),
    label: `${count} 个`,
  }));
  const randomModeOptions: SelectOption[] = [
    { value: 'repeatable', label: '完全随机' },
    { value: 'unique', label: '不重复随机' },
  ];
  const allSelectedOnPage =
    pagedPlays.length > 0 && pagedPlays.every((play) => selectedIds.includes(play.id));

  const persistStore = (store: PlayPreferenceStore) => {
    setPreferenceStore(store);
  };

  const toggleSelect = (playId: string) => {
    if (selectionMode === 'idle') {
      return;
    }

    setSelectedIds((current) =>
      current.includes(playId) ? current.filter((id) => id !== playId) : [...current, playId],
    );
  };

  const exportPlays = (items: Play[], fileName: string, scopeLabel: string) => {
    const exportItems = collectExportPlaySet(items, plays);
    if (exportItems.length === 0) {
      showFloatingToast(`当前没有可导出的${scopeLabel}`, 'error');
      return;
    }

    const text = serializePlaysToBatchText(exportItems);
    downloadTextFile(`${fileName}-${exportItems.length}篇.txt`, text);
  };

  const handleExportAll = () => {
    const sourcePlays = blockDislikedOnExport
      ? plays.filter((play) => !isDislikedPlay(play.id, preferenceStore))
      : plays;
    if (sourcePlays.length === 0) {
      showFloatingToast('当前没有可导出的内容', 'error');
      return;
    }
    exportPlays(sourcePlays, '全部小剧场', '全部');
  };

  const handleExportFavorites = () => {
    if (favoritePlays.length === 0) {
      showFloatingToast('当前没有收藏的小剧场可导出', 'error');
      return;
    }
    exportPlays(favoritePlays, '收藏小剧场', '收藏');
  };

  const handleExportSelected = () => {
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

    exportPlays(sourcePlays, '已选小剧场', '已选');
    setSelectionMode('idle');
  };

  const exportGroupedPlays = (
    type: ExportTargetType,
    values: string[],
    groups: Map<string, Play[]>,
    emptyMessage: string,
    successLabel: string,
  ) => {
    const normalizedValues = Array.from(
      new Set(values.map((value) => value.trim()).filter(Boolean)),
    );
    if (normalizedValues.length === 0) {
      showFloatingToast(emptyMessage, 'error');
      return;
    }

    const dislikedSet = new Set(preferenceStore.disliked);

    const matchedGroups = normalizedValues
      .map((value) => {
        const rawItems = groups.get(value) ?? [];
        const items = blockDislikedOnExport
          ? rawItems.filter((play) => !dislikedSet.has(play.id))
          : rawItems;
        const collectedItems = collectExportPlaySet(items, plays);
        return collectedItems.length > 0 ? { value, items: collectedItems } : null;
      })
      .filter((group): group is { value: string; items: Play[] } => Boolean(group));

    if (matchedGroups.length === 0) {
      showFloatingToast(`当前没有符合条件的${successLabel}内容可导出`, 'error');
      return;
    }

    if (matchedGroups.length === 1) {
      const [group] = matchedGroups;
      downloadTextFile(
        buildScopedExportFileName(type, group.value, group.items.length),
        serializePlaysToBatchText(group.items),
      );
    } else {
      const archive = createZipFromTextFiles(
        matchedGroups.map((group) => ({
          name: buildScopedExportFileName(type, group.value, group.items.length),
          text: serializePlaysToBatchText(group.items),
        })),
      );
      downloadBlobFile(buildScopedExportArchiveName(type, matchedGroups.length), archive);
    }

    const totalCount = matchedGroups.reduce((sum, group) => sum + group.items.length, 0);
    showFloatingToast(
      matchedGroups.length === 1
        ? `已导出${successLabel}「${matchedGroups[0].value}」的 ${totalCount} 篇小剧场。`
        : `已导出 ${matchedGroups.length} 个${successLabel}，共 ${totalCount} 篇小剧场。`,
    );
    closeExportModal();
  };

  const toggleExportValue = (current: string[], value: string) =>
    current.includes(value) ? current.filter((item) => item !== value) : [...current, value];

  const closeExportModal = () => {
    setExportModalType('');
  };

  const handleOpenExportModal = (type: ExportTargetType) => {
    setExportModalType(type);
  };

  const exportAuthors = (authorNames: string[]) => {
    exportGroupedPlays('author', authorNames, allPlaysByAuthor, '请先选择至少一个作者', '作者');
  };

  const exportCategories = (categoryNames: string[]) => {
    exportGroupedPlays(
      'category',
      categoryNames,
      allPlaysByCategory,
      '请先选择至少一个分类',
      '分类',
    );
  };

  const handleToggleAllAuthors = () => {
    setSelectedExportAuthors((current) =>
      current.length === exportAuthorOptions.length
        ? []
        : exportAuthorOptions.map((item) => item.value),
    );
  };

  const handleToggleAllCategories = () => {
    setSelectedExportCategories((current) =>
      current.length === exportCategoryOptions.length
        ? []
        : exportCategoryOptions.map((item) => item.value),
    );
  };

  const applyBatchPreference = (mode: 'favorite' | 'disliked') => {
    if (selectionMode !== mode) {
      setSelectionMode(mode);
      return;
    }

    if (selectedIds.length === 0) {
      showFloatingToast(
        mode === 'favorite' ? '先选择要批量收藏的内容' : '先选择要批量标记不喜欢的内容',
        'error',
      );
      return;
    }

    const nextState = mode === 'favorite' ? activeView !== 'favorites' : activeView !== 'disliked';

    const nextStore =
      mode === 'favorite'
        ? setFavoriteBatch(selectedIds, nextState, preferenceStore)
        : setDislikedBatch(selectedIds, nextState, preferenceStore);

    persistStore(nextStore);
    setSelectionMode('idle');
    showFloatingToast(
      mode === 'favorite'
        ? nextState
          ? `已批量收藏 ${selectedIds.length} 篇。`
          : `已取消 ${selectedIds.length} 篇收藏。`
        : nextState
          ? `已批量标记 ${selectedIds.length} 篇不喜欢。`
          : `已取消 ${selectedIds.length} 篇不喜欢。`,
    );
  };

  const handleToggleFavorite = (playId: string) => {
    persistStore(toggleFavoritePlay(playId, preferenceStore));
  };

  const handleToggleDisliked = (playId: string) => {
    persistStore(toggleDislikedPlay(playId, preferenceStore));
  };

  const handlePickRandom = () => {
    const result = pickRandomPlay({
      plays: filteredPlays,
      mode: randomMode,
      scope: activeView,
      favoriteOnly: preferenceStore.settings.favoriteOnlyRandom,
      favoriteWeighted: preferenceStore.settings.favoriteWeightedRandom,
      blockDislikedGlobally: preferenceStore.settings.blockDislikedGlobally,
      store: preferenceStore,
    });

    persistStore(result.store);

    if (result.reason === 'empty') {
      setRandomPickedPlayId('');
      showFloatingToast('当前条件下没有可抽取的小剧场。', 'error');
      return;
    }

    if (result.reason === 'exhausted') {
      showFloatingToast('当前候选池已经抽完了，清空记录后可以重新开始。', 'error');
      return;
    }

    setRandomPickedPlayId(result.play?.id ?? '');
    showFloatingToast(randomMode === 'unique' ? '已按不重复模式抽出一篇。' : '已随机抽出一篇。');
    if (result.play) {
      requestAnimationFrame(() => {
        const card = randomPickedCardRef.current;
        const rect = card?.getBoundingClientRect();
        const origin = rect
          ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
          : undefined;
        confettiRef.current?.celebrate(confettiPrefs.enabled, confettiPrefs.sound, origin);
      });
    }
  };

  const handleClearRandomSeen = () => {
    if (randomMode !== 'unique') {
      return;
    }
    const confirmed = window.confirm(
      '确认清空当前视图的不重复抽取记录吗？清空后可以重新开始抽取。',
    );
    if (!confirmed) {
      return;
    }
    persistStore(clearRandomSeen(activeView, preferenceStore));
    showFloatingToast('当前视图的不重复抽取记录已清空。');
  };

  const handleToggleSetting = (key: keyof PlayPreferenceStore['settings'], value: boolean) => {
    persistStore(setPlayPreferenceSetting(key, value, preferenceStore));
  };

  const createNavigationSnapshot = (anchorPlayId: string): PlazaNavigationSnapshot => {
    const newestPlay = orderPlaysByNewest(plays)[0];

    return {
      filteredPlayIds: filteredPlays.map((play) => play.id),
      anchorPlayId,
      currentPage,
      scrollY: typeof window === 'undefined' ? 0 : window.scrollY,
      latestHeadId: newestPlay?.id ?? '',
      latestHeadUpdatedAt: newestPlay?.updatedAt ?? '',
      activeTimeField: sortMode.startsWith('created') ? 'createdAt' : 'updatedAt',
      restorePending: true,
      capturedAt: new Date().toISOString(),
    };
  };

  const jumpToPage = () => {
    const nextPage = Number(pageInput);
    if (!Number.isFinite(nextPage) || nextPage < 1 || nextPage > totalPages) {
      showFloatingToast(`页数范围是 1 到 ${totalPages}`, 'error');
      return;
    }

    setCurrentPage(nextPage);
  };

  const handlePageSizeInputChange = (value: string) => {
    setPageSizeInput(value);

    if (!/^\d+$/.test(value)) {
      return;
    }

    const nextPageSize = clampPageSize(Number(value));
    setPageSize(nextPageSize);
    setCurrentPage(1);

    if (String(nextPageSize) !== value) {
      setPageSizeInput(String(nextPageSize));
    }
  };

  const handlePageSizeInputBlur = () => {
    if (!/^\d+$/.test(pageSizeInput)) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const normalizedPageSize = clampPageSize(Number(pageSizeInput));
    setPageSize(normalizedPageSize);
    setPageSizeInput(String(normalizedPageSize));
  };

  const handleToggleAutoRefresh = () => {
    setAutoRefreshOnNewPlaysState((current) => {
      const next = !current;
      setPlazaAutoRefresh(next);
      return next;
    });
  };

  const applyPendingRefresh = (restoreMode: RestoreMode) => {
    if (!pendingRefresh) {
      return;
    }

    const latestPlay = orderPlaysByNewest(pendingRefresh.nextPlays)[0];
    setPlays(pendingRefresh.nextPlays);
    setPendingRefresh(null);
    restoreRequestRef.current = restoreMode;
    explicitRefreshTriggeredRef.current = true; // 标记为用户显式触发，允许 effect 执行 scroll 恢复
    showFloatingToast(`已加载 ${pendingRefresh.addedCount} 篇新增小剧场。`);

    if (restoreMode === 'top') {
      setCurrentPage(1);
      setPageInput('1');
    }

    updatePlazaNavigationSnapshot({
      latestHeadId: latestPlay?.id ?? '',
      latestHeadUpdatedAt: latestPlay?.updatedAt ?? '',
      restorePending: true,
    });
  };

  const openPlayDetail = (play: Play, fromPanel?: 'calendar' | 'derived') => {
    savePlazaNavigationSnapshot(createNavigationSnapshot(play.id));
    const preservedSearch = fromPanel ? `?panel=${fromPanel}` : '';
    navigate(`/plays/${play.id}${preservedSearch}`, {
      state: {
        playSnapshot: play,
      },
    });
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>, play: Play) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    openPlayDetail(play);
  };

  const stopCardAction = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const handleCopyRandomContent = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    if (!randomPickedPlay) {
      return;
    }

    try {
      await copyText(randomPickedPlay.content);
      showFloatingToast('正文已复制');
    } catch {
      showFloatingToast('正文复制失败，请检查浏览器权限', 'error');
    }
  };

  const renderPreferenceActions = (play: Play) => {
    const favorite = isFavoritePlay(play.id, preferenceStore);
    const disliked = isDislikedPlay(play.id, preferenceStore);

    return (
      <div className="inline-actions wrap-mobile play-marker-menu" onClick={stopCardAction}>
        <button
          aria-label={favorite ? '取消收藏' : '收藏'}
          className={`icon-button play-marker-icon ${favorite ? 'is-active favorite' : ''}`}
          onClick={() => handleToggleFavorite(play.id)}
          title={favorite ? '取消收藏' : '收藏'}
          type="button"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="marker-star-icon"
          >
            <path d="M12 2l2.95 7.36L22 10l-5.92 4.43L18.18 22 12 17.77 5.82 22l2.1-7.57L2 10l7.05-.64L12 2z" />
          </svg>
        </button>
        <button
          aria-label={disliked ? '取消不喜欢' : '不喜欢'}
          className={`icon-button play-marker-icon ${disliked ? 'is-active disliked' : ''}`}
          onClick={() => handleToggleDisliked(play.id)}
          title={disliked ? '取消不喜欢' : '不喜欢'}
          type="button"
        >
          <span aria-hidden="true" className="marker-broken-heart-icon">
            💔
          </span>
        </button>
      </div>
    );
  };

  const renderCompactMeta = (play: Play) => {
    const repoCount = repoCounts.find((item) => item.playId === play.id)?.count ?? 0;

    return (
      <div className="compact-meta-row compact-meta-row-small">
        <span className="compact-meta-item">◈ {play.category?.trim() || DEFAULT_CATEGORY}</span>
        <span className="compact-meta-item compact-meta-item-with-repo">
          <span>✎ {play.authorName}</span>
          {repoCount > 0 ? (
            <span className="repo-count-meta" aria-label={`评论 ${repoCount} 条`}>
              <span aria-hidden="true">💬</span>
              {repoCount}
            </span>
          ) : null}
        </span>
      </div>
    );
  };

  return (
    <section className="stack-gap-lg plaza-page-shell">
      <ConfettiCanvas ref={confettiRef} />
      <div className={sidePanelVisible ? 'plaza-layout' : 'plaza-layout calendar-hidden'}>
        {sidePanelVisible ? (
          <aside className="plaza-sidebar">
            {plazaPanel === 'derived' ? (
              <PlazaDerivedPanel
                plays={filteredPlays}
                onOpenPlay={(play) => openPlayDetail(play, 'derived')}
              />
            ) : (
              <PlazaCalendarPanel
                plays={filteredPlays}
                onOpenPlay={(play) => openPlayDetail(play, 'calendar')}
              />
            )}
          </aside>
        ) : null}

        <div className="stack-gap-lg plaza-main-stack">
          {!toolbarCollapsed ? (
            <div className="hero-panel hero-grid hero-panel-compact">
              <div className="stack-gap-sm plaza-toolbar-stack">
                <div
                  className="plaza-toolbar-row plaza-toolbar-row-desktop"
                  role="group"
                  aria-label="广场桌面端操作"
                >
                  <button
                    aria-label={
                      controlsCollapsed ? '展开搜索、时间排序和筛选' : '折叠搜索、时间排序和筛选'
                    }
                    className={
                      controlsCollapsed
                        ? 'button primary plaza-toolbar-button'
                        : 'button secondary plaza-toolbar-button'
                    }
                    onClick={() => setControlsCollapsed((current) => !current)}
                    title={
                      controlsCollapsed ? '展开搜索、时间排序和筛选' : '折叠搜索、时间排序和筛选'
                    }
                    type="button"
                  >
                    {controlsCollapsed ? '展开' : '折叠'}
                  </button>
                  <button
                    className={
                      randomPanelOpen
                        ? 'button primary plaza-toolbar-button'
                        : 'button secondary plaza-toolbar-button'
                    }
                    onClick={() => setRandomPanelOpen((current) => !current)}
                    type="button"
                  >
                    随机
                  </button>
                  <button
                    className={
                      categoryFilterOpen || activeCategory
                        ? 'button primary plaza-toolbar-button'
                        : 'button secondary plaza-toolbar-button'
                    }
                    onClick={() => setCategoryFilterOpen((current) => !current)}
                    type="button"
                  >
                    分类
                  </button>
                  <button
                    className={
                      authorFilterOpen || activeAuthor
                        ? 'button primary plaza-toolbar-button'
                        : 'button secondary plaza-toolbar-button'
                    }
                    onClick={() => setAuthorFilterOpen((current) => !current)}
                    type="button"
                  >
                    作者
                  </button>
                  <button
                    className={
                      autoRefreshOnNewPlays
                        ? 'button primary plaza-toolbar-button'
                        : 'button secondary plaza-toolbar-button'
                    }
                    onClick={handleToggleAutoRefresh}
                    type="button"
                  >
                    {autoRefreshOnNewPlays ? '默认刷新' : '默认不刷新'}
                  </button>
                  <button
                    className="button secondary plaza-toolbar-button"
                    onClick={openVisitorChangelog}
                    type="button"
                  >
                    更新日志
                  </button>
                  <button
                    className="button secondary plaza-toolbar-button"
                    onClick={handleExportAll}
                    type="button"
                  >
                    导出全部
                  </button>
                  <button
                    className="button secondary plaza-toolbar-button"
                    onClick={handleExportSelected}
                    type="button"
                  >
                    {selectionMode === 'export' ? `导出已选（${selectedIds.length}）` : '导出所选'}
                  </button>
                  <button
                    className="button secondary plaza-toolbar-button"
                    onClick={() => handleOpenExportModal('author')}
                    type="button"
                  >
                    导出作者
                  </button>
                  <button
                    className="button secondary plaza-toolbar-button"
                    onClick={() => handleOpenExportModal('category')}
                    type="button"
                  >
                    导出分类
                  </button>
                  <button
                    className="button secondary plaza-toolbar-button"
                    disabled={favoritePlays.length === 0}
                    onClick={handleExportFavorites}
                    type="button"
                  >
                    导出收藏
                  </button>
                  <label className="checkbox-chip checkbox-chip-wide plaza-block-disliked-export-chip">
                    <input
                      checked={blockDislikedOnExport}
                      onChange={(event) => setBlockDislikedOnExport(event.target.checked)}
                      type="checkbox"
                    />
                    <span>屏蔽不喜欢</span>
                  </label>
                </div>

                <div
                  className="plaza-toolbar-row plaza-toolbar-row-mobile-main"
                  role="group"
                  aria-label="广场手机端主操作"
                >
                  <button
                    aria-label={
                      controlsCollapsed ? '展开搜索、时间排序和筛选' : '折叠搜索、时间排序和筛选'
                    }
                    className={
                      controlsCollapsed
                        ? 'button primary plaza-toolbar-button'
                        : 'button secondary plaza-toolbar-button'
                    }
                    onClick={() => setControlsCollapsed((current) => !current)}
                    title={
                      controlsCollapsed ? '展开搜索、时间排序和筛选' : '折叠搜索、时间排序和筛选'
                    }
                    type="button"
                  >
                    {controlsCollapsed ? '展开' : '折叠'}
                  </button>
                  <button
                    className={
                      randomPanelOpen
                        ? 'button primary plaza-toolbar-button'
                        : 'button secondary plaza-toolbar-button'
                    }
                    onClick={() => setRandomPanelOpen((current) => !current)}
                    type="button"
                  >
                    随机
                  </button>
                  <button
                    className={
                      categoryFilterOpen || activeCategory
                        ? 'button primary plaza-toolbar-button'
                        : 'button secondary plaza-toolbar-button'
                    }
                    onClick={() => setCategoryFilterOpen((current) => !current)}
                    type="button"
                  >
                    分类
                  </button>
                  <button
                    className={
                      authorFilterOpen || activeAuthor
                        ? 'button primary plaza-toolbar-button'
                        : 'button secondary plaza-toolbar-button'
                    }
                    onClick={() => setAuthorFilterOpen((current) => !current)}
                    type="button"
                  >
                    作者
                  </button>
                  <button
                    className={
                      autoRefreshOnNewPlays
                        ? 'button primary plaza-toolbar-button'
                        : 'button secondary plaza-toolbar-button'
                    }
                    onClick={handleToggleAutoRefresh}
                    type="button"
                  >
                    {autoRefreshOnNewPlays ? '默认刷新' : '默认不刷新'}
                  </button>
                  <button
                    className="button secondary plaza-toolbar-button"
                    onClick={openVisitorChangelog}
                    type="button"
                  >
                    更新日志
                  </button>
                </div>

                <div
                  className="plaza-toolbar-row plaza-toolbar-row-mobile-export"
                  role="group"
                  aria-label="广场手机端导出操作"
                >
                  <button
                    className="button secondary plaza-toolbar-button"
                    onClick={handleExportAll}
                    type="button"
                  >
                    导出全部
                  </button>
                  <button
                    className="button secondary plaza-toolbar-button"
                    onClick={handleExportSelected}
                    type="button"
                  >
                    {selectionMode === 'export' ? `导出已选（${selectedIds.length}）` : '导出所选'}
                  </button>
                  <button
                    className="button secondary plaza-toolbar-button"
                    onClick={() => handleOpenExportModal('author')}
                    type="button"
                  >
                    导出作者
                  </button>
                  <button
                    className="button secondary plaza-toolbar-button"
                    onClick={() => handleOpenExportModal('category')}
                    type="button"
                  >
                    导出分类
                  </button>
                  <button
                    className="button secondary plaza-toolbar-button"
                    disabled={favoritePlays.length === 0}
                    onClick={handleExportFavorites}
                    type="button"
                  >
                    导出收藏
                  </button>
                  <label className="checkbox-chip checkbox-chip-wide plaza-block-disliked-export-chip">
                    <input
                      checked={blockDislikedOnExport}
                      onChange={(event) => setBlockDislikedOnExport(event.target.checked)}
                      type="checkbox"
                    />
                    <span>屏蔽不喜欢</span>
                  </label>
                </div>

                {selectionMode === 'export' ? (
                  <div className="inline-actions plaza-export-cancel-row">
                    <button
                      className="button ghost"
                      onClick={() => setSelectionMode('idle')}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {pendingRefresh ? (
            <div className="plaza-refresh-modal-backdrop" role="presentation">
              <div
                aria-modal="true"
                className="detail-panel plaza-refresh-modal"
                role="dialog"
                aria-labelledby="plaza-refresh-title"
              >
                <div className="stack-gap-sm">
                  <h3 id="plaza-refresh-title">发现新增内容</h3>
                  <p className="sub-copy">
                    新增了 {pendingRefresh.addedCount}{' '}
                    条小剧场。你要跳到开头，还是继续之前的浏览位置？
                  </p>
                </div>
                <div className="inline-actions wrap-mobile plaza-refresh-modal-actions">
                  <button
                    className="button primary"
                    onClick={() => applyPendingRefresh('top')}
                    type="button"
                  >
                    跳转到开头
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => applyPendingRefresh('anchor')}
                    type="button"
                  >
                    继续之前浏览位置
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {exportModalType === 'author' ? (
            <ExportPickerModal
              items={exportAuthorOptions}
              onClose={closeExportModal}
              onExportAll={() => exportAuthors(exportAuthorOptions.map((item) => item.value))}
              onExportSelected={() => exportAuthors(selectedExportAuthors)}
              onToggleAll={handleToggleAllAuthors}
              onToggleItem={(value) =>
                setSelectedExportAuthors((current) => toggleExportValue(current, value))
              }
              selectedValues={selectedExportAuthors}
              title="导出作者"
            />
          ) : null}

          {exportModalType === 'category' ? (
            <ExportPickerModal
              items={exportCategoryOptions}
              onClose={closeExportModal}
              onExportAll={() => exportCategories(exportCategoryOptions.map((item) => item.value))}
              onExportSelected={() => exportCategories(selectedExportCategories)}
              onToggleAll={handleToggleAllCategories}
              onToggleItem={(value) =>
                setSelectedExportCategories((current) => toggleExportValue(current, value))
              }
              selectedValues={selectedExportCategories}
              title="导出分类"
            />
          ) : null}

          {!controlsCollapsed && hasVisibleControls ? (
            <div className="form-panel compact-panel stack-gap-md plaza-controls-panel">
              {hasFilterHeaderContent ? (
                <div className="stack-gap-sm plaza-filter-header">
                  {!toolbarCollapsed ? (
                    <div className="plaza-view-primary">
                      {(['everything', 'all', 'favorites', 'disliked'] as const).map((view) => (
                        <button
                          key={view}
                          className={activeView === view ? 'tab-chip active' : 'tab-chip'}
                          onClick={() => {
                            setActiveView(view);
                            setActiveCategory('');
                            setActiveAuthor('');
                            setSelectionMode('idle');
                            setCurrentPage(1);
                          }}
                          type="button"
                        >
                          {viewLabels[view]} {viewCounts[view]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {categoryFilterOpen ? (
                    <div className="plaza-category-strip">
                      <div className="inline-actions wrap-mobile plaza-view-switcher plaza-category-switcher">
                        <button
                          className={activeCategory === '' ? 'tab-chip active' : 'tab-chip'}
                          onClick={() => {
                            setActiveCategory('');
                            setCurrentPage(1);
                          }}
                          type="button"
                        >
                          全部分类 {categoryScopedPlays.length}
                        </button>
                        {orderedCategoryStats.map((item) => (
                          <button
                            key={item.name}
                            className={
                              activeCategory === item.name ? 'tab-chip active' : 'tab-chip'
                            }
                            onClick={() => {
                              setActiveCategory(item.name);
                              setCurrentPage(1);
                            }}
                            type="button"
                          >
                            {item.name} {item.count}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {categoryFilterOpen && authorFilterOpen ? (
                    <div className="plaza-filter-divider" aria-hidden="true" />
                  ) : null}
                  {authorFilterOpen ? (
                    <div className="plaza-category-strip">
                      <div className="inline-actions wrap-mobile plaza-view-switcher plaza-category-switcher">
                        <button
                          className={activeAuthor === '' ? 'tab-chip active' : 'tab-chip'}
                          onClick={() => {
                            setActiveAuthor('');
                            setCurrentPage(1);
                          }}
                          type="button"
                        >
                          全部作者 {authorScopedPlays.length}
                        </button>
                        {authorStats.map((item) => (
                          <button
                            key={item.name}
                            className={activeAuthor === item.name ? 'tab-chip active' : 'tab-chip'}
                            onClick={() => {
                              setActiveAuthor(item.name);
                              setCurrentPage(1);
                            }}
                            type="button"
                          >
                            {item.name} {item.count}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {!toolbarCollapsed ? (
                <div className="toolbar-grid plaza-filter-grid">
                  <div className="plaza-toolbar-row-selects">
                    <CustomSelect
                      label="时间排序"
                      onChange={(nextValue) => {
                        setSortMode(nextValue as SortMode);
                        setCurrentPage(1);
                      }}
                      options={sortModeOptions}
                      value={sortMode}
                    />
                    <CustomSelect
                      label="评论筛选"
                      onChange={(nextValue) => {
                        setActiveRepoFilter(nextValue as RepoFilterMode);
                        setCurrentPage(1);
                        try {
                          window.localStorage.setItem(PLAZA_REPO_FILTER_KEY, nextValue);
                        } catch {
                          /* ignore storage errors */
                        }
                      }}
                      options={[
                        { value: 'all', label: '全部' },
                        { value: 'with', label: '有评论' },
                        { value: 'without', label: '无评论' },
                      ]}
                      value={activeRepoFilter}
                    />
                    <CustomSelect
                      label="评论排序"
                      onChange={(nextValue) => {
                        setRepoSortMode(nextValue as RepoSortMode);
                        try {
                          window.localStorage.setItem(PLAZA_REPO_SORT_KEY, nextValue);
                        } catch {
                          /* ignore storage errors */
                        }
                      }}
                      options={[
                        { value: 'none', label: '默认(时间)' },
                        { value: 'count_desc', label: '评论数 ↓' },
                        { value: 'count_asc', label: '评论数 ↑' },
                        { value: 'first_desc', label: '首评时间 ↓' },
                        { value: 'first_asc', label: '首评时间 ↑' },
                        { value: 'last_desc', label: '最新评论 ↓' },
                        { value: 'last_asc', label: '最新评论 ↑' },
                      ]}
                      value={repoSortMode}
                    />
                    <CustomSelect
                      label="一行几个"
                      onChange={(nextValue) => setColumns(Number(nextValue))}
                      options={columnOptions}
                      value={String(renderColumns)}
                    />
                  </div>
                  <div className="toolbar-toggle-field">
                    <span>列表操作</span>
                    <div className="inline-actions wrap-mobile toolbar-toggle-row">
                      <button
                        className="button secondary"
                        onClick={() => setShowPreview((current) => !current)}
                        type="button"
                      >
                        {showPreview ? '收起正文' : '展开正文'}
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => setShowPreferenceActions((current) => !current)}
                        type="button"
                      >
                        {showPreferenceActions ? '收起标记' : '展开标记'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              {!toolbarCollapsed ? (
                <div className="plaza-search-row">
                  <label>
                    <span>搜索</span>
                    <ClearableField
                      visible={Boolean(keyword.trim())}
                      onClear={() => {
                        setKeyword('');
                        setCurrentPage(1);
                      }}
                    >
                      <input
                        value={keyword}
                        onChange={(event) => {
                          setKeyword(event.target.value);
                          setCurrentPage(1);
                        }}
                        placeholder="默认搜标题、作者、分类或正文"
                      />
                    </ClearableField>
                  </label>
                  <div
                    className="inline-actions wrap-mobile admin-search-field-row"
                    role="group"
                    aria-label="搜索范围"
                  >
                    {playSearchFieldOptions.map((item) => (
                      <button
                        aria-pressed={isSearchFieldActive(playSearchFields, item.value)}
                        className={
                          isSearchFieldActive(playSearchFields, item.value)
                            ? 'tab-chip active'
                            : 'tab-chip'
                        }
                        key={item.value}
                        onClick={() => {
                          setPlaySearchFields((current) => toggleSearchField(current, item.value));
                          setCurrentPage(1);
                        }}
                        type="button"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {!toolbarCollapsed ? (
                <div className="filter-summary wrap-mobile">
                  <span>
                    当前 {filteredPlays.length} 篇，第 {currentPage} / {totalPages} 页
                    {selectionMode !== 'idle' ? `，已选 ${selectedIds.length} 篇` : ''}
                  </span>
                  {selectionMode !== 'idle' ? (
                    <button
                      className="text-button"
                      onClick={() =>
                        setSelectedIds((current) => {
                          if (allSelectedOnPage) {
                            return current.filter(
                              (id) => !pagedPlays.some((play) => play.id === id),
                            );
                          }

                          const next = new Set(current);
                          pagedPlays.forEach((play) => next.add(play.id));
                          return [...next];
                        })
                      }
                      type="button"
                    >
                      {allSelectedOnPage ? '清空本页选择' : '全选本页'}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {!toolbarCollapsed ? (
                <div className="inline-actions wrap-mobile plaza-bulk-action-row">
                  <button
                    className="button secondary"
                    onClick={() => applyBatchPreference('favorite')}
                    type="button"
                  >
                    {selectionMode === 'favorite'
                      ? activeView === 'favorites'
                        ? `取消收藏已选（${selectedIds.length}）`
                        : `收藏已选（${selectedIds.length}）`
                      : activeView === 'favorites'
                        ? '多选取消收藏'
                        : '多选收藏'}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => applyBatchPreference('disliked')}
                    type="button"
                  >
                    {selectionMode === 'disliked'
                      ? activeView === 'disliked'
                        ? `取消不喜欢已选（${selectedIds.length}）`
                        : `不喜欢已选（${selectedIds.length}）`
                      : activeView === 'disliked'
                        ? '多选取消不喜欢'
                        : '多选不喜欢'}
                  </button>
                  {selectionMode === 'favorite' || selectionMode === 'disliked' ? (
                    <button
                      className="button ghost"
                      onClick={() => setSelectionMode('idle')}
                      type="button"
                    >
                      取消多选
                    </button>
                  ) : null}
                  <label className="checkbox-chip checkbox-chip-wide">
                    <input
                      checked={preferenceStore.settings.blockDislikedGlobally}
                      onChange={(event) =>
                        handleToggleSetting('blockDislikedGlobally', event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>屏蔽不喜欢内容</span>
                  </label>
                </div>
              ) : null}

              {activeView === 'favorites' ? (
                <div className="inline-actions wrap-mobile plaza-random-options-row">
                  <label className="checkbox-chip checkbox-chip-wide">
                    <input
                      checked={preferenceStore.settings.favoriteOnlyRandom}
                      onChange={(event) =>
                        handleToggleSetting('favoriteOnlyRandom', event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>仅从收藏池随机</span>
                  </label>
                  <label className="checkbox-chip checkbox-chip-wide">
                    <input
                      checked={preferenceStore.settings.favoriteWeightedRandom}
                      onChange={(event) =>
                        handleToggleSetting('favoriteWeightedRandom', event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>提高收藏出现比重</span>
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          {!toolbarCollapsed && randomPanelOpen ? (
            <section className="form-panel stack-gap-md plaza-random-panel">
              <div className="content-head">
                <div>
                  <h3>随机抽小剧场</h3>
                </div>
                <span className="content-meta">
                  当前范围：{viewLabels[activeView]}
                  {activeCategory ? ` / ${activeCategory}` : ''}
                  {activeAuthor ? ` / ${activeAuthor}` : ''}
                </span>
              </div>

              <div className="inline-actions wrap-mobile plaza-random-actions">
                <CustomSelect
                  label="抽选模式"
                  onChange={(nextValue) => setRandomMode(nextValue as RandomMode)}
                  options={randomModeOptions}
                  value={randomMode}
                />
                <div className="inline-actions wrap-mobile plaza-random-trailing">
                  {randomMode === 'unique' ? (
                    <button
                      className="button ghost plaza-random-clear-button"
                      onClick={handleClearRandomSeen}
                      type="button"
                    >
                      清空记录
                    </button>
                  ) : null}
                  <button
                    className="button primary plaza-random-pick-button"
                    onClick={handlePickRandom}
                    type="button"
                  >
                    抽一篇
                  </button>
                </div>
              </div>

              <div className="inline-actions wrap-mobile plaza-confetti-toggles">
                <label className="checkbox-chip checkbox-chip-wide">
                  <input
                    checked={confettiPrefs.enabled}
                    onChange={(event) =>
                      setConfettiPrefsState(setConfettiEnabled(event.target.checked))
                    }
                    type="checkbox"
                  />
                  <span>礼花特效</span>
                </label>
                <label className="checkbox-chip checkbox-chip-wide">
                  <input
                    checked={confettiPrefs.sound}
                    onChange={(event) =>
                      setConfettiPrefsState(setConfettiSound(event.target.checked))
                    }
                    type="checkbox"
                  />
                  <span>礼花音效</span>
                </label>
              </div>

              {randomPickedPlay ? (
                <article
                  className="play-card random-picked-card play-card-shell play-card-clickable"
                  onClick={() => openPlayDetail(randomPickedPlay)}
                  onKeyDown={(event) => handleCardKeyDown(event, randomPickedPlay)}
                  ref={randomPickedCardRef}
                  role="link"
                  tabIndex={0}
                >
                  <div className="card-topline wrap-mobile align-start">
                    {renderCompactMeta(randomPickedPlay)}
                  </div>
                  <h3>{randomPickedPlay.title}</h3>
                  {randomPickedPlay.summary ? (
                    <p className="summary">{randomPickedPlay.summary}</p>
                  ) : null}
                  <div className="content-head wrap-mobile" onClick={stopCardAction}>
                    <span className="content-meta">
                      正文约 {randomPickedPlay.content.length} 字
                    </span>
                    {renderPreferenceActions(randomPickedPlay)}
                    <button
                      aria-label="复制正文"
                      className="icon-button"
                      onClick={(event) => void handleCopyRandomContent(event)}
                      title="复制正文"
                      type="button"
                    >
                      ⧉
                    </button>
                  </div>
                  <p className="preview-copy">{randomPickedPlay.content}</p>
                </article>
              ) : null}
            </section>
          ) : null}

          {pendingRefresh ? (
            <div className="plaza-refresh-modal-backdrop" role="presentation">
              <section
                aria-labelledby="plaza-refresh-modal-title"
                aria-modal="true"
                className="form-panel plaza-refresh-modal"
                role="dialog"
              >
                <div className="stack-gap-sm">
                  <h3 id="plaza-refresh-modal-title">
                    新增了 {pendingRefresh.addedCount} 条小剧场
                  </h3>
                  <p className="sub-copy">你可以跳到最新内容，也可以保持现在的浏览位置继续看。</p>
                </div>
                <div className="inline-actions wrap-mobile plaza-refresh-modal-actions">
                  <button
                    className="button secondary"
                    onClick={() => applyPendingRefresh('scroll')}
                    type="button"
                  >
                    继续之前浏览位置
                  </button>
                  <button
                    className="button primary"
                    onClick={() => applyPendingRefresh('top')}
                    type="button"
                  >
                    跳转到开头
                  </button>
                </div>
              </section>
            </div>
          ) : null}

          {loading ? <div className="empty-panel">正在加载公开内容…</div> : null}

          {!loading && !(!toolbarCollapsed && randomPanelOpen && randomPickedPlay) ? (
            filteredPlays.length > 0 ? (
              <>
                <div
                  className="card-grid custom-grid"
                  style={{ ['--card-columns' as string]: renderColumns } as CSSProperties}
                >
                  {pagedPlays.map((play) => {
                    const checked = selectedIds.includes(play.id);

                    return (
                      <article
                        key={play.id}
                        className={`play-card play-card-shell play-card-clickable ${checked ? 'selected' : ''}`}
                        data-play-id={play.id}
                        onClick={() => openPlayDetail(play)}
                        onKeyDown={(event) => handleCardKeyDown(event, play)}
                        role="link"
                        tabIndex={0}
                      >
                        <div className="card-topline wrap-mobile align-start">
                          <div className="inline-actions wrap-mobile align-start">
                            {selectionMode !== 'idle' ? (
                              <label className="checkbox-chip" onClick={stopCardAction}>
                                <input
                                  checked={checked}
                                  onChange={() => toggleSelect(play.id)}
                                  type="checkbox"
                                />
                                <span>{selectionMode === 'export' ? '导出' : '选择'}</span>
                              </label>
                            ) : null}
                            {renderCompactMeta(play)}
                          </div>
                        </div>
                        <h3>{play.title}</h3>
                        {play.summary ? (
                          <p className="summary plaza-card-summary">{play.summary}</p>
                        ) : null}
                        {showPreview ? (
                          <p className="preview-copy plaza-card-preview">{play.content}</p>
                        ) : null}
                        {showPreferenceActions ? renderPreferenceActions(play) : null}
                      </article>
                    );
                  })}
                </div>

                <div className="form-panel compact-panel stack-gap-md plaza-pagination-panel">
                  <div className="plaza-pagination-toolbar">
                    <div className="inline-actions plaza-pagination-nav">
                      <button
                        className="button secondary icon-page-button"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage(1)}
                        title="第一页"
                        type="button"
                      >
                        ≪
                      </button>
                      <button
                        className="button secondary icon-page-button"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                        title="上一页"
                        type="button"
                      >
                        ‹
                      </button>
                    </div>
                    <span className="content-meta plaza-page-indicator">
                      第 {currentPage} / {totalPages} 页
                    </span>
                    <div className="inline-actions plaza-pagination-nav plaza-pagination-nav-end">
                      <button
                        className="button secondary icon-page-button"
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                        title="下一页"
                        type="button"
                      >
                        ›
                      </button>
                      <button
                        className="button secondary icon-page-button"
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage(totalPages)}
                        title="最后一页"
                        type="button"
                      >
                        ≫
                      </button>
                    </div>
                    <div className="inline-actions plaza-page-control-inline">
                      <label className="plaza-page-size-field" htmlFor="plaza-page-size-input">
                        <span className="content-meta plaza-page-size-copy">每页</span>
                        <input
                          id="plaza-page-size-input"
                          inputMode="numeric"
                          min={MIN_PAGE_SIZE}
                          max={MAX_PAGE_SIZE}
                          onBlur={handlePageSizeInputBlur}
                          onChange={(event) => handlePageSizeInputChange(event.target.value)}
                          value={pageSizeInput}
                        />
                        <span className="content-meta plaza-page-size-copy">个</span>
                      </label>
                      <div className="inline-actions plaza-page-jump-inline">
                        <span className="content-meta plaza-page-jump-copy">第</span>
                        <label className="page-jump-field page-jump-field-compact">
                          <input
                            inputMode="numeric"
                            min={1}
                            max={totalPages}
                            onChange={(event) => setPageInput(event.target.value)}
                            value={pageInput}
                          />
                        </label>
                        <span className="content-meta plaza-page-jump-copy">页</span>
                        <button
                          className="button primary plaza-page-jump-button"
                          onClick={jumpToPage}
                          type="button"
                        >
                          跳转
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : plays.length > 0 ? (
              <div className="empty-panel">当前条件下没有结果，换个关键词试试。</div>
            ) : (
              <div className="empty-panel">当前还没有公开的小剧场。</div>
            )
          ) : null}
        </div>
      </div>
    </section>
  );
}
