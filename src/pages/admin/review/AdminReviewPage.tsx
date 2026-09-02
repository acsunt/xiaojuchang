import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAdminUpdateNotifier } from '../../../hooks/useUpdateNotifier';
import { UpdatePromptModal } from '../../../components/UpdatePromptModal';
import {
  backupStatusLabelMap,
  downloadBackupArchive,
  downloadMergedBackupArchive,
  flattenBackupArchive,
  getBackupStatusCounts,
  parseBackupArchive,
} from '../../../services/play-backup';
import {
  buildSideBySideDiff,
  clearDuplicateReviewState,
  collectAllDuplicateIds,
  collectSecondDuplicateIds,
  getDuplicateReviewState,
  pruneDuplicateReviewState,
  scanDuplicateGroups,
  setDuplicateCompareTarget,
  setDuplicateScanScope,
  setDuplicateThreshold,
  toggleDuplicateSelection,
  type DuplicateReviewState,
  type DuplicateScanProgress,
  type DuplicateScanScope,
} from '../../../services/admin-duplicate-review';
import { playApi } from '../../../services/play-api';
import {
  getAdminReviewDiffFlat,
  setAdminReviewDiffFlat,
  getAdminReviewDiffRange,
  setAdminReviewDiffRange,
  type AdminReviewDiffRange,
} from '../../../services/browser-play-preferences';
import {
  DEFAULT_CATEGORY,
  PLAYS_UPDATED_EVENT,
  TAGS_UPDATED_EVENT,
  statusLabelMap,
  repoStatusLabelMap,
  type AdminSession,
  type Play,
  type PlayStatus,
  type Repo,
  type RepoAuditAction,
  type RepoAuditLog,
  type RepoReviewAction,
  type RepoStatus,
  type ReviewAction,
  type ReviewLog,
  type Tag,
} from '../../../types/play';
import { showFloatingToast } from '../../../components/floating-toast-store';

const statusTabs: Array<{ label: string; value?: PlayStatus }> = [
  { label: '全部', value: undefined },
  { label: '待审核', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '已拒绝', value: 'rejected' },
  { label: '已下线', value: 'offline' },
];

const repoStatusTabs: Array<{ label: string; value?: RepoStatus }> = [
  { label: '全部', value: undefined },
  { label: '待审核', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '已拒绝', value: 'rejected' },
];

const repoActionMeta: Array<{ action: RepoReviewAction; label: string; style: string }> = [
  { action: 'reject', label: '拒绝', style: 'danger' },
  { action: 'approve', label: '通过', style: 'primary' },
];

const backupStatusOrder: PlayStatus[] = ['pending', 'approved', 'rejected', 'offline'];
const BACKUP_RESTORE_CONFIRM_PHRASE = '确认恢复';

const actionMeta: Array<{
  action: ReviewAction;
  label: string;
  tone: 'primary' | 'danger' | 'secondary';
}> = [
  { action: 'approve', label: '通过', tone: 'primary' },
  { action: 'reject', label: '拒绝', tone: 'danger' },
  { action: 'offline', label: '下线', tone: 'secondary' },
];

type SubmissionTypeBadge = {
  kind: 'original' | 'modify' | 'derived';
  label: string;
  tone: 'pending' | 'approved' | 'derived';
};

const computeSubmissionTypeBadge = (play: Play): SubmissionTypeBadge => {
  const kind = play.submissionType ?? 'original';
  if (kind === 'modify') {
    return { kind, label: '修改', tone: 'approved' };
  }
  if (kind === 'derived') {
    return { kind, label: '新增衍生', tone: 'derived' };
  }
  return { kind, label: '首次投稿', tone: 'pending' };
};

const SUCCESS_TOAST_DURATION_MS = 1800;
const BULK_REVIEW_BATCH_SIZE = 5;
const MOBILE_REVIEW_LIST_PREVIEW_COUNT = 2;
const MOBILE_AUDIT_LOG_PREVIEW_COUNT = 2;

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

// 可搜索的分类下拉框：自由输入 + 过滤现有分类 + 点击选中
function SearchableCategorySelect({
  options,
  placeholder,
  value,
  onChange,
}: {
  options: string[];
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);

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
        inputRef.current?.blur();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const trimmed = value.trim().toLowerCase();
  const filtered = trimmed
    ? options.filter((option) => option.toLowerCase().includes(trimmed))
    : options;

  return (
    <div
      className={
        open
          ? 'custom-select open searchable-category-select'
          : 'custom-select searchable-category-select'
      }
      ref={rootRef}
    >
      <input
        ref={inputRef}
        className="searchable-category-input"
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        value={value}
      />
      {open ? (
        <div
          className="custom-select-menu searchable-category-menu"
          role="listbox"
          aria-label="选择分类"
        >
          {filtered.length > 0 ? (
            filtered.map((option) => (
              <button
                aria-selected={option === value}
                className={
                  option === value ? 'custom-select-option active' : 'custom-select-option'
                }
                key={option}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                {option}
              </button>
            ))
          ) : (
            <div className="searchable-category-empty">
              {value.trim() ? '没有匹配的分类，回车保存为自定义分类' : '暂无分类，直接输入可自定义'}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

const actionResultLabelMap: Record<ReviewAction, string> = {
  approve: '已通过',
  reject: '已拒绝',
  offline: '已下线',
};

const reviewActionLabelMap: Record<ReviewAction, string> = {
  approve: '通过',
  reject: '拒绝',
  offline: '下线',
};

/* 行级 diff：把 before / after 按行切分，公共行 (LCS) 原样，
 * 其余分别标 removed / added。
 * 用 O(n*m) DP 对短文本够用,长文也能跑。 */
type DiffSegment = { kind: 'same' | 'removed' | 'added'; text: string };

/* 把文本切成 "unit"：每个汉字单独成一个 unit,每个英文/数字单词成一个 unit,
 * 连续空白成一个 unit,单个标点/其他符号成一个 unit。
 * 这样 LCS 能在中文长文里精确到"字",在英文段落里精确到"词"。 */
const tokenizeDiffUnits = (value: string): string[] => {
  if (!value) {
    return [];
  }
  /* 正则优先级：
   * 1. 连续 [a-zA-Z0-9_]（含下划线常见于英文标识符）
   * 2. 单个 CJK 汉字
   * 3. 连续空白（不含换行）
   * 4. 换行
   * 5. 单个其他字符（标点、emoji 等） */
  const regex =
    /[A-Za-z0-9_]+|[\u3400-\u9fff\uf900-\ufaff]|[^\S\n]+|\n|[^\u3400-\u9fff\uf900-\ufaffA-Za-z0-9_\s]/gu;
  const matches = value.match(regex);
  return matches ? matches : [];
};

const lcsSegments = (a: string[], b: string[]): DiffSegment[] => {
  const n = a.length;
  const m = b.length;

  /* dp[i][j] = a[0..i-1] 与 b[0..j-1] 的 LCS 长度 */
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const segments: DiffSegment[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      segments.push({ kind: 'same', text: a[i - 1] });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      segments.push({ kind: 'removed', text: a[i - 1] });
      i -= 1;
    } else {
      segments.push({ kind: 'added', text: b[j - 1] });
      j -= 1;
    }
  }
  while (i > 0) {
    segments.push({ kind: 'removed', text: a[i - 1] });
    i -= 1;
  }
  while (j > 0) {
    segments.push({ kind: 'added', text: b[j - 1] });
    j -= 1;
  }
  return segments.reverse();
};

/* Unit-level diff：把前后两段文本按中文字/英文词/数字/标点切成 unit,
 * 再做 LCS,得到一段段 "same / removed / added" 标记的 unit 序列。 */
const buildUnitDiff = (before: string, after: string): DiffSegment[] => {
  const segments = lcsSegments(tokenizeDiffUnits(before ?? ''), tokenizeDiffUnits(after ?? ''));
  /* 合并相邻同 kind 的 unit,渲染时少一些 span。 */
  const merged: DiffSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.kind === segment.kind) {
      last.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
};

const renderDiffSegments = (segments: DiffSegment[]) =>
  segments.map((segment, index) => {
    if (!segment.text) {
      return null;
    }
    if (segment.kind === 'same') {
      return <span key={index}>{segment.text}</span>;
    }
    if (segment.kind === 'removed') {
      return (
        <span className="diff-segment diff-segment-removed" key={index}>
          {segment.text}
        </span>
      );
    }
    return (
      <span className="diff-segment diff-segment-added" key={index}>
        {segment.text}
      </span>
    );
  });

const repoAuditActionLabelMap: Record<RepoAuditAction, string> = {
  approve: '通过',
  reject: '拒绝',
  delete: '删除',
  edit: '编辑',
};

type AdminPanel =
  'review' | 'repo' | 'auditLogs' | 'delete' | 'backup' | 'tags' | 'duplicates' | 'moveCategory';
type AuditLogCategory = 'plays' | 'repos';

type SubmissionDiffItem = {
  label: string;
  changed: boolean;
  before: string;
  after: string;
};

type BulkReviewProgress = {
  completed: number;
  total: number;
  label: string;
};

type DeleteProgress = {
  completed: number;
  total: number;
  label: string;
};

type BulkReviewTaskStatus = 'running' | 'paused' | 'stopping';

type BulkReviewTask = {
  label: string;
  note: string;
  pendingIds: string[];
  skippedIds: string[];
  status: BulkReviewTaskStatus;
  total: number;
  updatedIds: string[];
};

type DuplicateScanProgressState = DuplicateScanProgress & {
  scopeLabel: string;
};

const adminPanelTabs: Array<{ label: string; value: AdminPanel }> = [
  { label: '审核', value: 'review' },
  { label: 'repo', value: 'repo' },
  { label: '审核记录', value: 'auditLogs' },
  { label: '删除', value: 'delete' },
  { label: '移动分类', value: 'moveCategory' },
  { label: '备份', value: 'backup' },
  { label: '标签', value: 'tags' },
  { label: '重复', value: 'duplicates' },
];

const auditLogTabs: Array<{ label: string; value: AuditLogCategory }> = [
  { label: '小剧场', value: 'plays' },
  { label: 'repo', value: 'repos' },
];

const formatAuditLogTime = (value: string) => new Date(value).toLocaleString('zh-CN');

const reorderTagsInMemory = (items: Tag[], sourceId: string, targetId: string) => {
  if (sourceId === targetId) {
    return items;
  }

  const fromIndex = items.findIndex((item) => item.id === sourceId);
  const toIndex = items.findIndex((item) => item.id === targetId);
  if (fromIndex === -1 || toIndex === -1) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems.map((item, index) => ({ ...item, sortOrder: index }));
};

const isTouchLikePointer = (pointerType: string) =>
  pointerType === 'touch' || pointerType === 'pen';

const formatReviewResultMessage = (label: string, count: number) => `${label} ${count} 篇小剧场`;

const notifyPlaysUpdate = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(PLAYS_UPDATED_EVENT));
};

type PlaySearchField = 'title' | 'author' | 'category' | 'content';
type RepoSearchField = 'nickname' | 'content' | 'title' | 'author';

const playSearchFieldOptions: Array<{ value: PlaySearchField; label: string }> = [
  { value: 'title', label: '标题' },
  { value: 'author', label: '作者' },
  { value: 'category', label: '分类' },
  { value: 'content', label: '正文' },
];

const repoSearchFieldOptions: Array<{ value: RepoSearchField; label: string }> = [
  { value: 'nickname', label: '昵称' },
  { value: 'title', label: '标题' },
  { value: 'author', label: '作者' },
  { value: 'content', label: '正文' },
];

const defaultPlaySearchFields: PlaySearchField[] = playSearchFieldOptions.map((item) => item.value);
const defaultRepoSearchFields: RepoSearchField[] = repoSearchFieldOptions.map((item) => item.value);

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

const matchesRepoKeyword = (
  repo: Repo,
  normalizedKeyword: string,
  fields: RepoSearchField[] = defaultRepoSearchFields,
) => {
  if (!normalizedKeyword) {
    return true;
  }

  const activeFields = fields.length > 0 ? fields : defaultRepoSearchFields;
  const haystack: string[] = [];

  if (activeFields.includes('nickname')) {
    haystack.push(repo.nickname, repo.replyToNickname ?? '');
  }
  if (activeFields.includes('title')) {
    haystack.push(repo.playTitle ?? '', repo.playId);
  }
  if (activeFields.includes('author')) {
    haystack.push(repo.playAuthorName ?? '');
  }
  if (activeFields.includes('content')) {
    haystack.push(repo.content);
  }

  return haystack.join(' ').toLowerCase().includes(normalizedKeyword);
};

export function AdminReviewPage() {
  const navigate = useNavigate();
  const {
    updateAvailable,
    dismiss: dismissUpdate,
    refresh: refreshUpdate,
  } = useAdminUpdateNotifier();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [plays, setPlays] = useState<Play[]>([]);
  const [allPlays, setAllPlays] = useState<Play[]>([]);
  const [hasLoadedAllPlays, setHasLoadedAllPlays] = useState(false);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [allRepos, setAllRepos] = useState<Repo[]>([]);
  const [hasLoadedAllRepos, setHasLoadedAllRepos] = useState(false);
  const [selectedRepoStatus, setSelectedRepoStatus] = useState<RepoStatus | undefined>('pending');
  const [repoReviewNote, setRepoReviewNote] = useState('');
  const [repoBusyAction, setRepoBusyAction] = useState<RepoReviewAction | 'delete' | null>(null);
  const [repoDeleteSelectedIds, setRepoDeleteSelectedIds] = useState<string[]>([]);
  const [repoDeleteBusy, setRepoDeleteBusy] = useState(false);
  const [repoDeleteProgress, setRepoDeleteProgress] = useState<DeleteProgress | null>(null);
  const [isRepoMultiSelectMode, setIsRepoMultiSelectMode] = useState(false);
  /* repo 审核的"按作者一键通过"下拉：与小剧场 bulkAuthorName 一一对应。 */
  const [repoBulkAuthorName, setRepoBulkAuthorName] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<PlayStatus | undefined>('pending');
  const [selectedPlayId, setSelectedPlayId] = useState('');
  /* 任务 5：repo 审核面板点击一条卡片后进入"详情查看"，与 selectedPlay 对齐。
   * 切换面板/筛选时清掉，避免选中的 repo 不在新视图里。 */
  const [selectedRepoId, setSelectedRepoId] = useState('');
  /* 任务 5：repo 详情编辑草稿（仅"仅编辑 / 编辑+预览"模式使用）。 */
  const [repoEditContentDraft, setRepoEditContentDraft] = useState('');
  const [repoEditNoteDraft, setRepoEditNoteDraft] = useState('');
  const [repoEditBusy, setRepoEditBusy] = useState(false);
  /* 差异对照：依次排开 + 展示范围。本地持久化，默认 flat=true + 'changed'。
   * flat 勾选后按平铺渲染，不做红绿差异标记；不勾选则用词级红绿 diff。 */
  const [diffFlat, setDiffFlat] = useState<boolean>(() => getAdminReviewDiffFlat());
  const [diffRange, setDiffRange] = useState<AdminReviewDiffRange>(() => getAdminReviewDiffRange());
  const [reviewLogs, setReviewLogs] = useState<ReviewLog[]>([]);
  const [allPlayReviewLogs, setAllPlayReviewLogs] = useState<ReviewLog[]>([]);
  const [allRepoAuditLogs, setAllRepoAuditLogs] = useState<RepoAuditLog[]>([]);
  const [selectedAuditLogCategory, setSelectedAuditLogCategory] =
    useState<AuditLogCategory>('plays');
  const [isMobileAuditLogsExpanded, setIsMobileAuditLogsExpanded] = useState(false);
  const [auditLogsLoading, setAuditLogsLoading] = useState(false);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewAuthorName, setReviewAuthorName] = useState('');
  const [reviewCategory, setReviewCategory] = useState('');
  const [reviewSummary, setReviewSummary] = useState('');
  const [reviewContent, setReviewContent] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const reviewContentRef = useRef<HTMLTextAreaElement | null>(null);
  /* 审核编辑面板底部的"追加衍生"表单:
   * 只对已通过条目生效。每次点"衍生"追加一版,填简介 + 内容;
   * 提交时按顺序 uploadPlay + reviewPlay(approve),让新版本直接落库为已通过。
   * 与前台上传共享一个思路:共享 作者/标题/分类,只维护简介/内容。 */
  const [derivedDrafts, setDerivedDrafts] = useState<
    Array<{ id: string; summary: string; content: string }>
  >([]);
  const [derivedSubmitting, setDerivedSubmitting] = useState(false);
  const makeAdminDerivedDraft = () => ({
    id:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `admin-derived-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    summary: '',
    content: '',
  });

  /* 复制预览里的标题/正文到剪贴板。
   * 失败时降级用 document.execCommand('copy') + 隐藏 textarea,
   * 确保非 https / 老浏览器也能复制成功。*/
  const copyToClipboard = useCallback(async (value: string, label: string) => {
    if (!value) {
      showFloatingToast(`${label}为空,无需复制`, 'error');
      return;
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('execCommand copy failed');
      }
      showFloatingToast(`${label}已复制`);
    } catch (err) {
      console.error('[admin-review] 复制失败:', err);
      showFloatingToast(`${label}复制失败`, 'error');
    }
  }, []);

  const ADMIN_VIEW_MODE_KEY = 'mini-theater:admin-review-view-mode';
  const readAdminViewMode = (): 'preview' | 'edit' | 'both' => {
    if (typeof window === 'undefined') {
      return 'both';
    }
    const saved = window.localStorage.getItem(ADMIN_VIEW_MODE_KEY);
    return saved === 'preview' || saved === 'edit' || saved === 'both' ? saved : 'both';
  };
  const [adminViewMode, setAdminViewModeState] = useState<'preview' | 'edit' | 'both'>(
    readAdminViewMode,
  );
  const setAdminViewMode = (next: 'preview' | 'edit' | 'both') => {
    setAdminViewModeState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ADMIN_VIEW_MODE_KEY, next);
    }
  };

  const ADMIN_PAGE_SIZE_KEY = 'mini-theater:admin-review-page-size';
  const ADMIN_CURRENT_PAGE_KEY = 'mini-theater:admin-review-current-page';
  const DEFAULT_ADMIN_PAGE_SIZE = 20;
  const MIN_ADMIN_PAGE_SIZE = 1;
  const MAX_ADMIN_PAGE_SIZE = 200;
  const clampAdminPageSize = (value: number) =>
    Math.min(MAX_ADMIN_PAGE_SIZE, Math.max(MIN_ADMIN_PAGE_SIZE, Math.trunc(value)));
  const readAdminPageSize = (): number => {
    if (typeof window === 'undefined') {
      return DEFAULT_ADMIN_PAGE_SIZE;
    }
    const raw = Number(window.localStorage.getItem(ADMIN_PAGE_SIZE_KEY));
    return Number.isFinite(raw) && raw > 0 ? clampAdminPageSize(raw) : DEFAULT_ADMIN_PAGE_SIZE;
  };
  const readAdminCurrentPage = (): number => {
    if (typeof window === 'undefined') {
      return 1;
    }
    const raw = Number(window.localStorage.getItem(ADMIN_CURRENT_PAGE_KEY));
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 1;
  };
  const [adminPageSize, setAdminPageSizeState] = useState(() => readAdminPageSize());
  const [adminPageSizeInput, setAdminPageSizeInput] = useState(() => String(readAdminPageSize()));
  const [adminCurrentPage, setAdminCurrentPageState] = useState(() => readAdminCurrentPage());
  const [adminPageInput, setAdminPageInput] = useState(() => String(readAdminCurrentPage()));
  const setAdminPageSize = (next: number) => {
    const clamped = clampAdminPageSize(next);
    setAdminPageSizeState(clamped);
    setAdminPageSizeInput(String(clamped));
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ADMIN_PAGE_SIZE_KEY, String(clamped));
    }
  };
  const setAdminCurrentPage = (next: number) => {
    const safe = Math.max(1, Math.trunc(next));
    setAdminCurrentPageState(safe);
    setAdminPageInput(String(safe));
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ADMIN_CURRENT_PAGE_KEY, String(safe));
    }
  };

  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [playSearchFields, setPlaySearchFields] = useState<PlaySearchField[]>([]);
  const [repoKeyword, setRepoKeyword] = useState('');
  const [repoSearchFields, setRepoSearchFields] = useState<RepoSearchField[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [editingTagId, setEditingTagId] = useState('');
  const [editingTagName, setEditingTagName] = useState('');
  const [tagMessage, setTagMessage] = useState('');
  const [tagMessageTone, setTagMessageTone] = useState<'success' | 'error'>('success');
  const [tagSaving, setTagSaving] = useState(false);
  const [activePanel, setActivePanel] = useState<AdminPanel>('review');
  const [duplicateReview, setDuplicateReview] = useState<DuplicateReviewState>(() =>
    getDuplicateReviewState(),
  );
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [duplicateScanProgress, setDuplicateScanProgress] =
    useState<DuplicateScanProgressState | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkTask, setBulkTask] = useState<BulkReviewTask | null>(null);
  const [bulkProgress, setBulkProgress] = useState<BulkReviewProgress | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<DeleteProgress | null>(null);
  const [processingMessage, setProcessingMessage] = useState('');
  const [feedbackScope, setFeedbackScope] = useState<'bulk' | 'review' | 'delete' | null>(null);
  const [reviewBusyAction, setReviewBusyAction] = useState<ReviewAction | 'delete' | 'save' | null>(
    null,
  );
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [bulkAuthorName, setBulkAuthorName] = useState('');
  const [bulkSelectCountInput, setBulkSelectCountInput] = useState('');
  const [isBulkApproveCollapsed, setIsBulkApproveCollapsed] = useState(false);
  /* repo 一键通过面板的折叠状态,与小剧场审核的 isBulkApproveCollapsed 对齐。 */
  const [isRepoBulkApproveCollapsed, setIsRepoBulkApproveCollapsed] = useState(false);
  const [deleteSelectedIds, setDeleteSelectedIds] = useState<string[]>([]);
  const [deleteAuthorName, setDeleteAuthorName] = useState('');
  const [deleteSelectCountInput, setDeleteSelectCountInput] = useState('');
  const [isTagSorting, setIsTagSorting] = useState(false);
  const [tagSortDraft, setTagSortDraft] = useState<Tag[]>([]);
  const [tagSortSnapshot, setTagSortSnapshot] = useState<Tag[]>([]);
  const [draggingTagId, setDraggingTagId] = useState('');
  const [isMobileReviewViewport, setIsMobileReviewViewport] = useState(false);
  const [isMobilePendingExpanded, setIsMobilePendingExpanded] = useState(false);
  /* repo 审核列表的手机端展开状态,复用 MOBILE_REVIEW_LIST_PREVIEW_COUNT 阈值。
   * 默认收起,与小剧场审核列表 (isMobilePendingExpanded) 一致的交互。 */
  const [isMobileRepoExpanded, setIsMobileRepoExpanded] = useState(false);
  const [showJumpButton, setShowJumpButton] = useState(true);
  const [moveCategoryBusy, setMoveCategoryBusy] = useState(false);
  const [moveCategoryMessage, setMoveCategoryMessage] = useState('');
  const [moveCategoryError, setMoveCategoryError] = useState('');
  const [moveSourceCategories, setMoveSourceCategories] = useState<string[]>([]);
  const [moveTargetCategory, setMoveTargetCategory] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const [backupMessageTone, setBackupMessageTone] = useState<'success' | 'error'>('success');
  const [backupImportName, setBackupImportName] = useState('');
  const [backupImportPlays, setBackupImportPlays] = useState<Play[]>([]);
  const [backupImportCounts, setBackupImportCounts] = useState<Record<PlayStatus, number> | null>(
    null,
  );
  const [mergedBackupIncludeAttachedMeta, setMergedBackupIncludeAttachedMeta] = useState(true);
  const [backupRestoreConfirmOpen, setBackupRestoreConfirmOpen] = useState(false);
  const [backupRestoreConfirmInput, setBackupRestoreConfirmInput] = useState('');
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);
  const playListLoadRequestRef = useRef(0);
  const playTotalsLoadRequestRef = useRef(0);
  const repoListLoadRequestRef = useRef(0);
  const repoTotalsLoadRequestRef = useRef(0);

  const load = async (status = selectedStatus, options?: { silent?: boolean }) => {
    const requestId = ++playListLoadRequestRef.current;
    if (!options?.silent) {
      setLoading(true);
    }
    setError('');

    try {
      const items = await playApi.getAdminPlays(status);
      if (requestId !== playListLoadRequestRef.current) {
        return { items: [] as Play[], nextSelectedId: '' };
      }

      setPlays(items);
      const nextSelectedId =
        selectedPlayId && items.some((item) => item.id === selectedPlayId)
          ? selectedPlayId
          : (items[0]?.id ?? '');
      setSelectedPlayId(nextSelectedId);
      return { items, nextSelectedId };
    } catch (reason) {
      if (requestId !== playListLoadRequestRef.current) {
        return { items: [] as Play[], nextSelectedId: '' };
      }

      setError(reason instanceof Error ? reason.message : '加载审核数据失败');
      return { items: [] as Play[], nextSelectedId: '' };
    } finally {
      if (!options?.silent && requestId === playListLoadRequestRef.current) {
        setLoading(false);
      }
    }
  };

  const loadAllPlays = async () => {
    const requestId = ++playTotalsLoadRequestRef.current;
    try {
      const items = await playApi.getAdminPlays();
      if (requestId !== playTotalsLoadRequestRef.current) {
        return;
      }

      setAllPlays(items);
      setHasLoadedAllPlays(true);
    } catch {
      if (requestId !== playTotalsLoadRequestRef.current) {
        return;
      }

      setAllPlays([]);
    }
  };

  const loadRepos = async (status = selectedRepoStatus) => {
    const requestId = ++repoListLoadRequestRef.current;
    try {
      const items = await playApi.getAdminRepos(status);
      if (requestId !== repoListLoadRequestRef.current) {
        return;
      }

      setRepos(items);
    } catch (reason) {
      if (requestId !== repoListLoadRequestRef.current) {
        return;
      }

      setError(reason instanceof Error ? reason.message : 'repo 审核数据加载失败');
      setRepos([]);
    }
  };

  const loadAllRepos = async () => {
    const requestId = ++repoTotalsLoadRequestRef.current;
    try {
      const items = await playApi.getAdminRepos();
      if (requestId !== repoTotalsLoadRequestRef.current) {
        return;
      }

      setAllRepos(items);
      setHasLoadedAllRepos(true);
    } catch {
      if (requestId !== repoTotalsLoadRequestRef.current) {
        return;
      }

      setAllRepos([]);
    }
  };

  const loadTags = async () => {
    try {
      const items = await playApi.getAdminTags();
      setTags(items);
      if (!isTagSorting) {
        setTagSortDraft(items);
      }
    } catch (reason) {
      setTagMessageTone('error');
      setTagMessage(reason instanceof Error ? reason.message : '标签加载失败');
    }
  };

  const loadReviewLogs = async (playId: string) => {
    try {
      const logs = await playApi.getReviewLogs(playId);
      setReviewLogs(logs);
    } catch {
      setReviewLogs([]);
    }
  };

  const loadAllAuditLogs = async () => {
    setAuditLogsLoading(true);
    try {
      const [playLogs, repoLogs] = await Promise.all([
        playApi.getAllPlayReviewLogs(),
        playApi.getAllRepoAuditLogs(),
      ]);
      setAllPlayReviewLogs(playLogs);
      setAllRepoAuditLogs(repoLogs);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '审核记录加载失败');
      setAllPlayReviewLogs([]);
      setAllRepoAuditLogs([]);
    } finally {
      setAuditLogsLoading(false);
    }
  };

  useEffect(() => {
    playApi.getAdminSession().then((foundSession) => {
      setSession(foundSession);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const syncViewport = () => {
      setIsMobileReviewViewport(mediaQuery.matches);
    };

    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);

    return () => {
      mediaQuery.removeEventListener('change', syncViewport);
    };
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    void load();
    void loadRepos();
    void loadAllPlays();
    void loadAllRepos();
    void loadTags();
    // load/loadRepos/loadAllPlays/loadAllRepos/loadTags 是普通函数（每次渲染重新创建，非 useCallback），
    // 故意不放进依赖数组，只在 session/selectedStatus/selectedRepoStatus 变化时触发，避免死循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, selectedStatus, selectedRepoStatus]);

  useEffect(() => {
    if (!session || activePanel !== 'auditLogs') {
      return;
    }

    void loadAllAuditLogs();
  }, [session, activePanel]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const handlePlayRefresh = () => {
      void load(selectedStatus, { silent: true });
      void loadAllPlays();
      void loadRepos(selectedRepoStatus);
      void loadAllRepos();
      if (selectedPlayId) {
        void loadReviewLogs(selectedPlayId);
      }
      if (activePanel === 'auditLogs') {
        void loadAllAuditLogs();
      }
    };

    const handleTagRefresh = () => {
      void loadTags();
    };

    const handleFocusRefresh = () => {
      void load(selectedStatus, { silent: true });
      void loadAllPlays();
      void loadRepos(selectedRepoStatus);
      void loadAllRepos();
      void loadTags();
      if (selectedPlayId) {
        void loadReviewLogs(selectedPlayId);
      }
      if (activePanel === 'auditLogs') {
        void loadAllAuditLogs();
      }
    };

    const handleVisibilityRefresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }

      handleFocusRefresh();
    };

    window.addEventListener(PLAYS_UPDATED_EVENT, handlePlayRefresh);
    window.addEventListener(TAGS_UPDATED_EVENT, handleTagRefresh);
    window.addEventListener('focus', handleFocusRefresh);
    window.addEventListener('pageshow', handleVisibilityRefresh);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      window.removeEventListener(PLAYS_UPDATED_EVENT, handlePlayRefresh);
      window.removeEventListener(TAGS_UPDATED_EVENT, handleTagRefresh);
      window.removeEventListener('focus', handleFocusRefresh);
      window.removeEventListener('pageshow', handleVisibilityRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
    // load/loadRepos/loadTags 等是普通函数（每次渲染重新创建，非 useCallback），
    // 故意不放进依赖数组，只在下列状态变化时重新绑定事件监听，避免死循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, selectedStatus, selectedRepoStatus, selectedPlayId, activePanel]);

  useEffect(() => {
    bulkTaskRef.current = bulkTask;
  }, [bulkTask]);

  useEffect(
    () => () => {
      duplicateScanRunRef.current += 1;
    },
    [],
  );

  const playMetricsSource = hasLoadedAllPlays ? allPlays : plays;
  const repoMetricsSource = hasLoadedAllRepos ? allRepos : repos;
  const pendingPlayCount = useMemo(
    () =>
      hasLoadedAllPlays
        ? allPlays.filter((play) => play.status === 'pending').length
        : selectedStatus === 'pending'
          ? plays.length
          : 0,
    [allPlays, hasLoadedAllPlays, plays.length, selectedStatus],
  );
  const pendingRepoCount = useMemo(
    () =>
      hasLoadedAllRepos
        ? allRepos.filter((repo) => repo.status === 'pending').length
        : selectedRepoStatus === 'pending'
          ? repos.length
          : 0,
    [allRepos, hasLoadedAllRepos, repos.length, selectedRepoStatus],
  );
  const filteredPlays = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return plays;
    }

    const source = hasLoadedAllPlays ? allPlays : plays;
    return source.filter((play) => matchesPlayKeyword(play, normalizedKeyword, playSearchFields));
  }, [allPlays, hasLoadedAllPlays, keyword, playSearchFields, plays]);
  const currentPlayListCount = useMemo(() => {
    if (!hasLoadedAllPlays) {
      return filteredPlays.length;
    }

    const normalizedKeyword = keyword.trim().toLowerCase();
    if (normalizedKeyword) {
      return filteredPlays.length;
    }

    const statusMatchedPlays = selectedStatus
      ? playMetricsSource.filter((play) => play.status === selectedStatus)
      : playMetricsSource;

    return statusMatchedPlays.length;
  }, [filteredPlays.length, hasLoadedAllPlays, keyword, playMetricsSource, selectedStatus]);
  const filteredRepos = useMemo(() => {
    const normalizedKeyword = repoKeyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return repos;
    }

    const source = hasLoadedAllRepos ? allRepos : repos;
    return source.filter((repo) => matchesRepoKeyword(repo, normalizedKeyword, repoSearchFields));
  }, [allRepos, hasLoadedAllRepos, repoKeyword, repoSearchFields, repos]);
  const currentRepoListCount = useMemo(() => {
    if (!hasLoadedAllRepos) {
      return filteredRepos.length;
    }

    const normalizedKeyword = repoKeyword.trim().toLowerCase();
    if (normalizedKeyword) {
      return filteredRepos.length;
    }

    return selectedRepoStatus
      ? repoMetricsSource.filter((repo) => repo.status === selectedRepoStatus).length
      : repoMetricsSource.length;
  }, [filteredRepos.length, hasLoadedAllRepos, repoKeyword, repoMetricsSource, selectedRepoStatus]);

  const pendingVisiblePlays = useMemo(
    () => filteredPlays.filter((play) => play.status === 'pending'),
    [filteredPlays],
  );
  const pendingVisibleRepos = useMemo(
    () => filteredRepos.filter((repo) => repo.status === 'pending'),
    [filteredRepos],
  );
  const repoDeleteVisibleIds = useMemo(() => filteredRepos.map((repo) => repo.id), [filteredRepos]);
  const repoDeleteSelectedIdSet = useMemo(
    () => new Set(repoDeleteSelectedIds),
    [repoDeleteSelectedIds],
  );
  /* repo 「全选/取消全选」判定：当前视图内所有 repo 都在已选集合里且非空。 */
  const isAllRepoVisibleSelected = useMemo(
    () =>
      repoDeleteVisibleIds.length > 0 &&
      repoDeleteVisibleIds.every((id) => repoDeleteSelectedIdSet.has(id)),
    [repoDeleteVisibleIds, repoDeleteSelectedIdSet],
  );
  const adminTotalPages = Math.max(1, Math.ceil(filteredPlays.length / adminPageSize));
  const adminPagedPlays = useMemo(() => {
    const startIndex = (adminCurrentPage - 1) * adminPageSize;
    return filteredPlays.slice(startIndex, startIndex + adminPageSize);
  }, [adminCurrentPage, adminPageSize, filteredPlays]);
  const shouldCollapseMobileReviewList =
    isMobileReviewViewport && adminPagedPlays.length > MOBILE_REVIEW_LIST_PREVIEW_COUNT;
  const reviewListPlays =
    shouldCollapseMobileReviewList && !isMobilePendingExpanded
      ? adminPagedPlays.slice(0, MOBILE_REVIEW_LIST_PREVIEW_COUNT)
      : adminPagedPlays;
  const mobileReviewListLabel = selectedStatus ? statusLabelMap[selectedStatus] : '全部';
  /* repo 列表：手机端 + 长度超过阈值时，先展示前 MOBILE_REVIEW_LIST_PREVIEW_COUNT 条，
   * 顶部给「展开/收起」按钮切换。桌面端始终全部展示。
   * 逻辑复用小剧场审核列表的 shouldCollapseMobileReviewList 模式。 */
  const shouldCollapseMobileRepoList =
    isMobileReviewViewport && filteredRepos.length > MOBILE_REVIEW_LIST_PREVIEW_COUNT;
  const repoListToRender =
    shouldCollapseMobileRepoList && !isMobileRepoExpanded
      ? filteredRepos.slice(0, MOBILE_REVIEW_LIST_PREVIEW_COUNT)
      : filteredRepos;
  const mobileRepoListLabel = selectedRepoStatus ? repoStatusLabelMap[selectedRepoStatus] : '全部';
  const activeAuditLogs = useMemo(
    () => (selectedAuditLogCategory === 'plays' ? allPlayReviewLogs : allRepoAuditLogs),
    [allPlayReviewLogs, allRepoAuditLogs, selectedAuditLogCategory],
  );
  const shouldCollapseMobileAuditLogs =
    isMobileReviewViewport && activeAuditLogs.length > MOBILE_AUDIT_LOG_PREVIEW_COUNT;
  const visibleAuditLogs =
    shouldCollapseMobileAuditLogs && !isMobileAuditLogsExpanded
      ? activeAuditLogs.slice(0, MOBILE_AUDIT_LOG_PREVIEW_COUNT)
      : activeAuditLogs;

  const shouldHideMobileReviewWorkspace = isMobileReviewViewport && activePanel !== 'review';
  const shouldShowReviewSidebarContent = !shouldHideMobileReviewWorkspace;

  const pendingVisibleIds = useMemo(
    () => pendingVisiblePlays.map((play) => play.id),
    [pendingVisiblePlays],
  );
  const deleteVisibleIds = useMemo(() => filteredPlays.map((play) => play.id), [filteredPlays]);

  const pendingAuthorOptions = useMemo(
    () =>
      Array.from(new Set(pendingVisiblePlays.map((play) => play.authorName).filter(Boolean))).sort(
        (left, right) => left.localeCompare(right, 'zh-CN'),
      ),
    [pendingVisiblePlays],
  );
  const deleteAuthorOptions = useMemo(
    () =>
      Array.from(new Set(filteredPlays.map((play) => play.authorName).filter(Boolean))).sort(
        (left, right) => left.localeCompare(right, 'zh-CN'),
      ),
    [filteredPlays],
  );

  const selectedAuthorPendingIds = useMemo(
    () =>
      pendingVisiblePlays
        .filter((play) => play.authorName === bulkAuthorName)
        .map((play) => play.id),
    [bulkAuthorName, pendingVisiblePlays],
  );
  const selectedAuthorDeleteIds = useMemo(
    () =>
      filteredPlays.filter((play) => play.authorName === deleteAuthorName).map((play) => play.id),
    [deleteAuthorName, filteredPlays],
  );

  /* repo 审核"按作者一键通过":以待审核 repo 里的作者集合作为下拉候选。
   * 备注:repo 的作者字段是 playAuthorName(所属小剧场作者),按作者过滤更符合直觉。 */
  const pendingRepoAuthorOptions = useMemo(
    () =>
      Array.from(
        new Set(pendingVisibleRepos.map((repo) => repo.playAuthorName ?? '').filter(Boolean)),
      ).sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [pendingVisibleRepos],
  );
  const selectedAuthorPendingRepoIds = useMemo(
    () =>
      pendingVisibleRepos
        .filter((repo) => (repo.playAuthorName ?? '') === repoBulkAuthorName)
        .map((repo) => repo.id),
    [pendingVisibleRepos, repoBulkAuthorName],
  );

  const parsedBulkSelectCount = Number.parseInt(bulkSelectCountInput.trim(), 10);
  const bulkSelectCount = Number.isFinite(parsedBulkSelectCount)
    ? Math.max(0, parsedBulkSelectCount)
    : 0;
  const parsedDeleteSelectCount = Number.parseInt(deleteSelectCountInput.trim(), 10);
  const deleteSelectCount = Number.isFinite(parsedDeleteSelectCount)
    ? Math.max(0, parsedDeleteSelectCount)
    : 0;
  const bulkTaskCompletedCount = bulkTask
    ? bulkTask.updatedIds.length + bulkTask.skippedIds.length
    : 0;
  const bulkTaskStatus = bulkTask?.status ?? null;
  const bulkTaskRef = useRef<BulkReviewTask | null>(null);
  const duplicateScanRunRef = useRef(0);

  const bulkSelectedIdSet = useMemo(() => new Set(bulkSelectedIds), [bulkSelectedIds]);
  const deleteSelectedIdSet = useMemo(() => new Set(deleteSelectedIds), [deleteSelectedIds]);
  /* 「全选/取消全选」判定：当前列表所有待审核都在已选集合里,且非空。
   * pendingVisibleIds 是当前视图可见的待审核 id 列表,长度为 0 时按钮 disabled。 */
  const isAllPendingVisibleSelected = useMemo(
    () =>
      pendingVisibleIds.length > 0 && pendingVisibleIds.every((id) => bulkSelectedIdSet.has(id)),
    [pendingVisibleIds, bulkSelectedIdSet],
  );
  const duplicateApprovedPlays = useMemo(
    () => allPlays.filter((play) => play.status === 'approved'),
    [allPlays],
  );
  const moveCategoryStats = useMemo(() => {
    const counts = new Map<string, number>();
    allPlays.forEach((play) => {
      const name = play.category?.trim() || DEFAULT_CATEGORY;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort(
        (left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN'),
      );
  }, [allPlays]);
  const moveCategoryTargetIds = useMemo(() => {
    if (moveSourceCategories.length === 0) {
      return [];
    }

    return allPlays
      .filter((play) => moveSourceCategories.includes(play.category?.trim() || DEFAULT_CATEGORY))
      .map((play) => play.id);
  }, [allPlays, moveSourceCategories]);
  const duplicateScanSourcePlays = useMemo(
    () => (duplicateReview.scanScope === 'approved' ? duplicateApprovedPlays : allPlays),
    [allPlays, duplicateApprovedPlays, duplicateReview.scanScope],
  );
  const duplicateScanScopeLabel = duplicateReview.scanScope === 'approved' ? '已通过' : '整个库';

  const reviewMutationBusy =
    bulkBusy || bulkTask !== null || deleteBusy || reviewBusyAction !== null;

  const selectedPlay = useMemo(
    () => filteredPlays.find((play) => play.id === selectedPlayId) ?? null,
    [filteredPlays, selectedPlayId],
  );

  /* 「作者提交的修改」面板:diff 由 selectedPlay.pendingEdit 与 selectedPlay
   * 自身字段对比得出,无需查询 parent play。 */

  /* 任务 5：repo 详情视图当前选中的 repo，与列表 filteredRepos 对齐。 */
  const selectedRepo = useMemo(
    () => filteredRepos.find((repo) => repo.id === selectedRepoId) ?? null,
    [filteredRepos, selectedRepoId],
  );
  /* 同步选中的 repo 变更时把草稿初始化为它的当前内容/备注，方便编辑。 */
  useEffect(() => {
    if (selectedRepo) {
      setRepoEditContentDraft(selectedRepo.content);
      setRepoEditNoteDraft(selectedRepo.reviewNote ?? '');
    }
  }, [selectedRepo]);
  /* 切换面板或筛选时清掉选中的 repo。 */
  useEffect(() => {
    setSelectedRepoId('');
  }, [activePanel, selectedRepoStatus]);

  // 在当前过滤后的全集里取上一篇/下一篇 id；不在当前页时跳到对应页
  const findAdjacentPlayId = (plays: Play[], currentId: string, offset: -1 | 1): string => {
    if (!currentId) {
      return '';
    }

    const currentIndex = plays.findIndex((play) => play.id === currentId);
    if (currentIndex < 0) {
      return '';
    }

    const targetIndex = currentIndex + offset;
    if (targetIndex < 0 || targetIndex >= plays.length) {
      return '';
    }

    return plays[targetIndex].id;
  };
  const adminPrevPlayId = useMemo(
    () => findAdjacentPlayId(filteredPlays, selectedPlayId, -1),
    [filteredPlays, selectedPlayId],
  );
  const adminNextPlayId = useMemo(
    () => findAdjacentPlayId(filteredPlays, selectedPlayId, 1),
    [filteredPlays, selectedPlayId],
  );

  const selectAdminPlayById = (playId: string) => {
    if (!playId) {
      return;
    }

    setSelectedPlayId(playId);
    setSuccessMessage('');
    setActivePanel('review');

    // 跳到目标所在页
    const targetIndex = filteredPlays.findIndex((play) => play.id === playId);
    if (targetIndex >= 0) {
      const targetPage = Math.floor(targetIndex / adminPageSize) + 1;
      if (targetPage !== adminCurrentPage) {
        setAdminCurrentPage(targetPage);
      }
    }
  };

  const previousSubmission = useMemo(() => {
    if (!selectedPlay) {
      return null;
    }

    return (
      [...allPlays]
        .filter(
          (play) =>
            play.id !== selectedPlay.id &&
            play.authorName === selectedPlay.authorName &&
            play.title === selectedPlay.title &&
            play.createdAt < selectedPlay.createdAt,
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
    );
  }, [allPlays, selectedPlay]);

  const submissionDiffItems = useMemo<SubmissionDiffItem[]>(() => {
    if (!selectedPlay || !previousSubmission) {
      return [];
    }

    return [
      {
        label: '分类',
        changed:
          (previousSubmission.category || DEFAULT_CATEGORY) !==
          (selectedPlay.category || DEFAULT_CATEGORY),
        before: previousSubmission.category || DEFAULT_CATEGORY,
        after: selectedPlay.category || DEFAULT_CATEGORY,
      },
      {
        label: '简介',
        changed: previousSubmission.summary.trim() !== selectedPlay.summary.trim(),
        before: previousSubmission.summary,
        after: selectedPlay.summary,
      },
      {
        label: '正文',
        changed: previousSubmission.content.trim() !== selectedPlay.content.trim(),
        before: previousSubmission.content,
        after: selectedPlay.content,
      },
    ];
  }, [previousSubmission, selectedPlay]);

  /* 直接读取 selectedPlay.submissionType,审核员据此判断本次为「修改」或「新增衍生」。
   * 不再依赖内容改动比例,避免被「局部小幅重投但实为衍生」的情况误判。 */
  const submissionTypeBadge = useMemo<
    | { kind: 'original'; label: string; tone: 'pending' | 'approved' | 'derived' }
    | { kind: 'modify'; label: string; tone: 'pending' | 'approved' | 'derived' }
    | { kind: 'derived'; label: string; tone: 'pending' | 'approved' | 'derived' }
    | null
  >(() => {
    if (!selectedPlay) return null;
    return computeSubmissionTypeBadge(selectedPlay);
  }, [selectedPlay]);

  const metrics = useMemo(() => {
    const total = hasLoadedAllPlays ? allPlays.length : playMetricsSource.length;
    const approved = hasLoadedAllPlays
      ? allPlays.filter((play) => play.status === 'approved').length
      : selectedStatus === 'approved'
        ? plays.length
        : 0;

    return [
      { label: '当前列表', value: `${currentPlayListCount} 篇` },
      { label: '待审核', value: `${pendingPlayCount} 篇` },
      { label: '已通过', value: `${approved} 篇` },
      { label: '标签库', value: `${tags.length} 个` },
      { label: '总内容量', value: `${total} 篇` },
    ];
  }, [
    allPlays,
    currentPlayListCount,
    hasLoadedAllPlays,
    pendingPlayCount,
    playMetricsSource.length,
    plays.length,
    selectedStatus,
    tags.length,
  ]);

  const repoMetrics = useMemo(() => {
    const total = hasLoadedAllRepos ? allRepos.length : repoMetricsSource.length;
    const approved = hasLoadedAllRepos
      ? allRepos.filter((repo) => repo.status === 'approved').length
      : selectedRepoStatus === 'approved'
        ? repos.length
        : 0;

    return [
      { label: '当前列表', value: `${currentRepoListCount} 条` },
      { label: '待审核', value: `${pendingRepoCount} 条` },
      { label: '已通过', value: `${approved} 条` },
      { label: '总内容量', value: `${total} 条` },
    ];
  }, [
    allRepos,
    currentRepoListCount,
    hasLoadedAllRepos,
    pendingRepoCount,
    repoMetricsSource.length,
    repos.length,
    selectedRepoStatus,
  ]);

  const backupCounts = useMemo(() => getBackupStatusCounts(allPlays), [allPlays]);
  const backupImportTotal = backupImportPlays.length;

  const displayTags = isTagSorting ? tagSortDraft : tags;

  useEffect(() => {
    if (!selectedPlay) {
      setReviewLogs([]);
      return;
    }

    void loadReviewLogs(selectedPlay.id);
  }, [selectedPlay]);

  useEffect(() => {
    if (!selectedPlay) {
      setReviewTitle('');
      setReviewAuthorName('');
      setReviewCategory('');
      setReviewSummary('');
      setReviewContent('');
      setDerivedDrafts([]);
      return;
    }

    setReviewTitle(selectedPlay.title);
    setReviewAuthorName(selectedPlay.authorName);
    setReviewCategory(selectedPlay.category || DEFAULT_CATEGORY);
    setReviewSummary(selectedPlay.summary);
    setReviewContent(selectedPlay.content);
    /* 切换选中条目时清空待追加的衍生版本,避免误提交到别的作品下。 */
    setDerivedDrafts([]);
  }, [selectedPlay]);

  useEffect(() => {
    const element = reviewContentRef.current;
    if (!element) {
      return;
    }

    const resize = () => {
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    };
    resize();
    // textarea 刚挂载时 scrollHeight 可能尚未稳定，下一帧再校准一次
    const raf = requestAnimationFrame(resize);
    return () => cancelAnimationFrame(raf);
  }, [reviewContent, adminViewMode]);

  useEffect(() => {
    if (selectedPlay) {
      return;
    }

    const fallback = filteredPlays[0]?.id ?? '';
    if (fallback !== selectedPlayId) {
      setSelectedPlayId(fallback);
    }
  }, [filteredPlays, selectedPlay, selectedPlayId]);

  useEffect(() => {
    if (!isMobileReviewViewport) {
      setIsMobilePendingExpanded(false);
      return;
    }

    setIsMobilePendingExpanded(false);
  }, [filteredPlays.length, isMobileReviewViewport, selectedStatus, keyword]);

  useEffect(() => {
    if (!isMobileReviewViewport || activePanel !== 'auditLogs') {
      setIsMobileAuditLogsExpanded(false);
      return;
    }

    setIsMobileAuditLogsExpanded(false);
  }, [
    activePanel,
    isMobileReviewViewport,
    selectedAuditLogCategory,
    allPlayReviewLogs.length,
    allRepoAuditLogs.length,
  ]);

  useEffect(() => {
    const pendingIdSet = new Set(pendingVisibleIds);
    setBulkSelectedIds((current) => current.filter((id) => pendingIdSet.has(id)));
  }, [pendingVisibleIds]);

  useEffect(() => {
    const visibleIdSet = new Set(deleteVisibleIds);
    setDeleteSelectedIds((current) => current.filter((id) => visibleIdSet.has(id)));
  }, [deleteVisibleIds]);

  useEffect(() => {
    const visibleIdSet = new Set(repoDeleteVisibleIds);
    setRepoDeleteSelectedIds((current) => current.filter((id) => visibleIdSet.has(id)));
  }, [repoDeleteVisibleIds]);

  useEffect(() => {
    if (bulkAuthorName && !pendingAuthorOptions.includes(bulkAuthorName)) {
      setBulkAuthorName('');
    }
  }, [bulkAuthorName, pendingAuthorOptions]);

  useEffect(() => {
    if (repoBulkAuthorName && !pendingRepoAuthorOptions.includes(repoBulkAuthorName)) {
      setRepoBulkAuthorName('');
    }
  }, [repoBulkAuthorName, pendingRepoAuthorOptions]);

  useEffect(() => {
    if (deleteAuthorName && !deleteAuthorOptions.includes(deleteAuthorName)) {
      setDeleteAuthorName('');
    }
  }, [deleteAuthorName, deleteAuthorOptions]);

  // 列表过滤条件变化导致总页数缩小时，把当前页拉回到最后一页
  useEffect(() => {
    if (adminCurrentPage > adminTotalPages) {
      setAdminCurrentPage(adminTotalPages);
    }
  }, [adminCurrentPage, adminTotalPages]);

  // selectedStatus 或 keyword 变化时，列表重置回第一页
  useEffect(() => {
    setAdminCurrentPage(1);
  }, [selectedStatus, keyword, playSearchFields]);

  useEffect(() => {
    if (!successMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSuccessMessage('');
    }, SUCCESS_TOAST_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [successMessage]);

  const syncSelectedReviewLogs = async (playId = selectedPlayId) => {
    if (playId) {
      await loadReviewLogs(playId);
      return;
    }

    setReviewLogs([]);
  };

  const syncPlayStateLocally = useCallback(
    (updatedPlay: Play | null) => {
      if (!updatedPlay) {
        return;
      }

      setAllPlays((current) =>
        current.map((play) => (play.id === updatedPlay.id ? updatedPlay : play)),
      );
      setPlays((current) => {
        const exists = current.some((play) => play.id === updatedPlay.id);
        /* 「待审核」面板下也要保留带 pendingEdit 的已通过作品,
         * 它们走就地修改语义需要 admin 二次确认。 */
        const shouldStayInCurrentList =
          selectedStatus === undefined ||
          updatedPlay.status === selectedStatus ||
          (selectedStatus === 'pending' && Boolean(updatedPlay.pendingEdit));

        if (!exists) {
          return current;
        }

        if (!shouldStayInCurrentList) {
          return current.filter((play) => play.id !== updatedPlay.id);
        }

        return current.map((play) => (play.id === updatedPlay.id ? updatedPlay : play));
      });
    },
    [selectedStatus],
  );

  const removePlayStateLocally = useCallback((playId: string) => {
    setAllPlays((current) => current.filter((play) => play.id !== playId));
    setPlays((current) => current.filter((play) => play.id !== playId));
  }, []);

  const markPlaysApprovedLocally = useCallback((playIds: string[]) => {
    if (playIds.length === 0) {
      return;
    }

    const idSet = new Set(playIds);
    setAllPlays((current) =>
      current.map((play) => (idSet.has(play.id) ? { ...play, status: 'approved' } : play)),
    );
    setPlays((current) => current.filter((play) => !idSet.has(play.id)));
  }, []);

  const syncRepoStateLocally = useCallback(
    (updatedRepo: Repo | null) => {
      if (!updatedRepo) {
        return;
      }

      setAllRepos((current) =>
        current.map((repo) => (repo.id === updatedRepo.id ? updatedRepo : repo)),
      );
      setRepos((current) => {
        const exists = current.some((repo) => repo.id === updatedRepo.id);
        const shouldStayInCurrentList =
          selectedRepoStatus === undefined || updatedRepo.status === selectedRepoStatus;

        if (!exists) {
          return current;
        }

        if (!shouldStayInCurrentList) {
          return current.filter((repo) => repo.id !== updatedRepo.id);
        }

        return current.map((repo) => (repo.id === updatedRepo.id ? updatedRepo : repo));
      });
    },
    [selectedRepoStatus],
  );

  const removeRepoStateLocally = useCallback((repoId: string) => {
    setAllRepos((current) => current.filter((repo) => repo.id !== repoId));
    setRepos((current) => current.filter((repo) => repo.id !== repoId));
  }, []);

  const markReposApprovedLocally = useCallback((repoIds: string[]) => {
    if (repoIds.length === 0) {
      return;
    }

    const idSet = new Set(repoIds);
    setAllRepos((current) =>
      current.map((repo) => (idSet.has(repo.id) ? { ...repo, status: 'approved' } : repo)),
    );
    setRepos((current) => current.filter((repo) => !idSet.has(repo.id)));
  }, []);

  const refreshAdminAfterReviewMutation = useCallback(
    async (nextPlayId?: string) => {
      const { items, nextSelectedId } = await load(selectedStatus, { silent: true });
      await Promise.all([
        loadAllPlays(),
        activePanel === 'auditLogs' ? loadAllAuditLogs() : Promise.resolve(),
      ]);

      const resolvedPlayId =
        typeof nextPlayId === 'string'
          ? items.some((item) => item.id === nextPlayId)
            ? nextPlayId
            : nextSelectedId
          : nextSelectedId;

      setSelectedPlayId(resolvedPlayId);
      await syncSelectedReviewLogs(resolvedPlayId);
      notifyPlaysUpdate();
    },
    // load/loadAllPlays/loadAllAuditLogs/syncSelectedReviewLogs 是普通函数（每次渲染重新创建，非
    // useCallback），故意不放进依赖数组：wrap 成 useCallback 只是为了让引用在 selectedStatus/activePanel
    // 不变时保持稳定，避免下游 useCallback（finishBulkReviewTask）每次渲染都重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedStatus, activePanel],
  );

  const clearBackupImportSelection = useCallback(() => {
    setBackupImportName('');
    setBackupImportPlays([]);
    setBackupImportCounts(null);
    setBackupRestoreConfirmOpen(false);
    setBackupRestoreConfirmInput('');
    if (backupFileInputRef.current) {
      backupFileInputRef.current.value = '';
    }
  }, []);

  const handleExportBackup = () => {
    try {
      downloadBackupArchive(allPlays, tags);
      setBackupMessageTone('success');
      setBackupMessage(`备份已导出，共 ${allPlays.length} 篇内容，附带 ${tags.length} 个标签。`);
    } catch (reason) {
      setBackupMessageTone('error');
      setBackupMessage(reason instanceof Error ? reason.message : '导出备份失败');
    }
  };

  const handleExportMergedBackup = () => {
    try {
      downloadMergedBackupArchive(allPlays, {
        includeAttachedMeta: mergedBackupIncludeAttachedMeta,
      });
      setBackupMessageTone('success');
      setBackupMessage(
        `合并备份已导出，共 ${allPlays.length} 篇内容，按作者和分类分别成组，${mergedBackupIncludeAttachedMeta ? '保留' : '不保留'}附带信息。`,
      );
    } catch (reason) {
      setBackupMessageTone('error');
      setBackupMessage(reason instanceof Error ? reason.message : '导出合并备份失败');
    }
  };

  const handleBackupFileChange = async (event: ReactChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      clearBackupImportSelection();
      return;
    }

    setBackupBusy(true);
    setBackupMessage('');

    try {
      const archive = await parseBackupArchive(file);
      const importedPlays = flattenBackupArchive(archive);
      if (importedPlays.length === 0) {
        throw new Error('备份压缩包里没有可导入内容');
      }

      setBackupImportName(file.name);
      setBackupImportPlays(importedPlays);
      setBackupImportCounts(getBackupStatusCounts(importedPlays));
      setBackupMessageTone('success');
      setBackupMessage(`已识别备份，共 ${importedPlays.length} 篇内容。`);
    } catch (reason) {
      clearBackupImportSelection();
      setBackupMessageTone('error');
      setBackupMessage(reason instanceof Error ? reason.message : '解析备份压缩包失败');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (backupImportPlays.length === 0) {
      setBackupMessageTone('error');
      setBackupMessage('先选择一个可解析的备份压缩包');
      return;
    }

    setBackupMessage('');
    setBackupRestoreConfirmInput('');
    setBackupRestoreConfirmOpen(true);
  };

  const handleCancelRestoreBackup = () => {
    setBackupRestoreConfirmOpen(false);
    setBackupRestoreConfirmInput('');
  };

  const handleConfirmRestoreBackup = async () => {
    if (backupRestoreConfirmInput.trim() !== BACKUP_RESTORE_CONFIRM_PHRASE) {
      return;
    }

    setBackupRestoreConfirmOpen(false);
    setBackupRestoreConfirmInput('');
    setBackupBusy(true);
    setBackupMessage('');

    try {
      const result = await playApi.restoreAdminBackup(backupImportPlays);
      setBulkSelectedIds([]);
      setDeleteSelectedIds([]);
      setReviewNote('');
      await refreshAdminAfterReviewMutation();
      clearBackupImportSelection();
      setBackupMessageTone('success');
      setBackupMessage(`备份已恢复，共导入 ${result.restoredCount} 篇内容。`);
    } catch (reason) {
      setBackupMessageTone('error');
      setBackupMessage(reason instanceof Error ? reason.message : '恢复备份失败');
    } finally {
      setBackupBusy(false);
    }
  };

  const finishBulkReviewTask = useCallback(
    async (
      task: BulkReviewTask,
      options?: {
        errorMessage?: string;
        stopped?: boolean;
      },
    ) => {
      const completedCount = task.updatedIds.length + task.skippedIds.length;

      setBulkTask(null);
      setBulkBusy(false);
      setBulkProgress({ completed: completedCount, total: task.total, label: task.label });
      setProcessingMessage('');
      await refreshAdminAfterReviewMutation();

      if (options?.errorMessage) {
        setError(
          `${task.label}已完成 ${completedCount} / ${task.total} 篇，剩余内容审核中断：${options.errorMessage}`,
        );
        return;
      }

      if (options?.stopped) {
        setSuccessMessage(`${task.label}已停止，已完成 ${completedCount} / ${task.total} 篇`);
        return;
      }

      setReviewNote('');
      setSuccessMessage(
        `${formatReviewResultMessage(actionResultLabelMap.approve, task.updatedIds.length)}${
          task.skippedIds.length > 0 ? `，跳过 ${task.skippedIds.length} 篇` : ''
        }`,
      );
    },
    [refreshAdminAfterReviewMutation],
  );

  useEffect(() => {
    if (!bulkTask || bulkTask.status !== 'running' || bulkBusy) {
      return;
    }

    if (bulkTask.pendingIds.length === 0) {
      void finishBulkReviewTask(bulkTask);
      return;
    }

    const batchIds = bulkTask.pendingIds.slice(0, BULK_REVIEW_BATCH_SIZE);
    const completedCount = bulkTask.updatedIds.length + bulkTask.skippedIds.length;

    setBulkBusy(true);
    setBulkProgress({ completed: completedCount, total: bulkTask.total, label: bulkTask.label });
    setProcessingMessage(`正在处理：已完成 ${completedCount} / ${bulkTask.total}`);

    void playApi
      .bulkReviewPlays(batchIds, 'approve', bulkTask.note)
      .then(async (result) => {
        const latestTask = bulkTaskRef.current;
        if (!latestTask) {
          return;
        }

        const handledIds = Array.from(new Set([...result.updatedIds, ...result.skippedIds]));
        const nextTask: BulkReviewTask = {
          ...latestTask,
          pendingIds: latestTask.pendingIds.filter((id) => !handledIds.includes(id)),
          skippedIds: [...latestTask.skippedIds, ...result.skippedIds],
          updatedIds: [...latestTask.updatedIds, ...result.updatedIds],
        };
        markPlaysApprovedLocally(result.updatedIds);
        const nextCompletedCount = nextTask.updatedIds.length + nextTask.skippedIds.length;

        setBulkSelectedIds((current) => current.filter((id) => !result.updatedIds.includes(id)));
        setBulkProgress({
          completed: nextCompletedCount,
          total: nextTask.total,
          label: nextTask.label,
        });

        if (latestTask.status === 'stopping') {
          await finishBulkReviewTask(nextTask, { stopped: true });
          return;
        }

        if (latestTask.status === 'paused') {
          setBulkTask({ ...nextTask, status: 'paused' });
          setBulkBusy(false);
          setProcessingMessage(`已暂停，已完成 ${nextCompletedCount} / ${nextTask.total}`);
          return;
        }

        if (nextTask.pendingIds.length === 0) {
          await finishBulkReviewTask(nextTask);
          return;
        }

        setBulkTask({ ...nextTask, status: 'running' });
        setBulkBusy(false);
      })
      .catch(async (reason) => {
        const latestTask = bulkTaskRef.current;
        if (!latestTask) {
          return;
        }

        await finishBulkReviewTask(latestTask, {
          errorMessage: reason instanceof Error ? reason.message : '批量通过失败',
        });
      });
  }, [bulkBusy, bulkTask, finishBulkReviewTask, markPlaysApprovedLocally]);

  useEffect(() => {
    if (typeof document === 'undefined' || !draggingTagId) {
      return;
    }

    document.body.classList.add('tag-sort-dragging');

    return () => {
      document.body.classList.remove('tag-sort-dragging');
    };
  }, [draggingTagId]);

  if (!loading && !session) {
    return <Navigate to="/admin/login" replace />;
  }

  const getNextPendingPlayId = (currentPlayId: string) => {
    const currentIndex = pendingVisiblePlays.findIndex((play) => play.id === currentPlayId);
    if (currentIndex === -1) {
      return pendingVisiblePlays[0]?.id ?? '';
    }

    return (
      pendingVisiblePlays[currentIndex + 1]?.id ?? pendingVisiblePlays[currentIndex - 1]?.id ?? ''
    );
  };

  const handleToggleBulkSelection = (playId: string) => {
    setBulkSelectedIds((current) =>
      current.includes(playId) ? current.filter((id) => id !== playId) : [...current, playId],
    );
  };

  const handleSelectAllPendingVisible = () => {
    setBulkSelectedIds(pendingVisibleIds);
  };

  const handleInvertBulkSelection = () => {
    const pendingIdSet = new Set(pendingVisibleIds);
    setBulkSelectedIds((current) => {
      const currentSet = new Set(current.filter((id) => pendingIdSet.has(id)));
      return pendingVisibleIds.filter((id) => !currentSet.has(id));
    });
  };

  const handleClearBulkSelection = () => {
    setBulkSelectedIds([]);
  };

  const handleSelectTopPendingVisible = () => {
    setFeedbackScope('bulk');

    if (bulkSelectCount <= 0) {
      setError('先输入大于 0 的条数');
      return;
    }

    const nextIds = pendingVisibleIds.slice(0, bulkSelectCount);
    if (nextIds.length === 0) {
      setError('当前列表没有可选的待审核内容');
      return;
    }

    setError('');
    setBulkSelectedIds(nextIds);
  };

  const handleToggleDeleteSelection = (playId: string) => {
    setDeleteSelectedIds((current) =>
      current.includes(playId) ? current.filter((id) => id !== playId) : [...current, playId],
    );
  };

  const handleSelectAllVisibleForDelete = () => {
    setDeleteSelectedIds(deleteVisibleIds);
  };

  const handleInvertDeleteSelection = () => {
    const visibleIdSet = new Set(deleteVisibleIds);
    setDeleteSelectedIds((current) => {
      const currentSet = new Set(current.filter((id) => visibleIdSet.has(id)));
      return deleteVisibleIds.filter((id) => !currentSet.has(id));
    });
  };

  const handleClearDeleteSelection = () => {
    setDeleteSelectedIds([]);
  };

  const handleToggleRepoDeleteSelection = (repoId: string) => {
    setRepoDeleteSelectedIds((current) =>
      current.includes(repoId) ? current.filter((id) => id !== repoId) : [...current, repoId],
    );
  };

  const handleSelectAllVisibleForRepoDelete = () => {
    setRepoDeleteSelectedIds(repoDeleteVisibleIds);
  };

  const handleClearRepoDeleteSelection = () => {
    setRepoDeleteSelectedIds([]);
  };

  const handleToggleRepoMultiSelectMode = () => {
    setIsRepoMultiSelectMode((current) => {
      const next = !current;
      if (!next) {
        setRepoDeleteSelectedIds([]);
      }
      return next;
    });
  };

  const handleSelectTopVisibleForDelete = () => {
    setFeedbackScope('delete');

    if (deleteSelectCount <= 0) {
      setError('先输入大于 0 的条数');
      return;
    }

    const nextIds = deleteVisibleIds.slice(0, deleteSelectCount);
    if (nextIds.length === 0) {
      setError('当前列表没有可删除的内容');
      return;
    }

    setError('');
    setDeleteSelectedIds(nextIds);
  };

  const handleBatchDelete = async (playIds: string[], label: string) => {
    const normalizedIds = Array.from(new Set(playIds.map((id) => id.trim()).filter(Boolean)));
    if (normalizedIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `确认删除${label}吗？共 ${normalizedIds.length} 篇。删除后内容和审核记录都会一起清掉。`,
    );
    if (!confirmed) {
      return;
    }

    setFeedbackScope('delete');
    setDeleteBusy(true);
    setDeleteProgress({ completed: 0, total: normalizedIds.length, label });
    setProcessingMessage(`正在删除：已完成 0 / ${normalizedIds.length}`);
    setError('');
    setSuccessMessage('');

    const deletedIds: string[] = [];
    let completed = 0;

    try {
      for (const playId of normalizedIds) {
        await playApi.deleteAdminPlay(playId);
        removePlayStateLocally(playId);
        deletedIds.push(playId);
        completed += 1;
        setDeleteProgress({ completed, total: normalizedIds.length, label });
        setProcessingMessage(`正在删除：已完成 ${completed} / ${normalizedIds.length}`);
      }

      setDeleteSelectedIds((current) => current.filter((id) => !deletedIds.includes(id)));
      await refreshAdminAfterReviewMutation();
      setProcessingMessage('');
      setDeleteProgress({ completed: normalizedIds.length, total: normalizedIds.length, label });
      setSuccessMessage(formatReviewResultMessage('已删除', deletedIds.length));
    } catch (reason) {
      setProcessingMessage('');
      setDeleteProgress({ completed, total: normalizedIds.length, label });
      setError(
        `${label}已完成 ${completed} / ${normalizedIds.length} 篇，剩余内容删除中断：${
          reason instanceof Error ? reason.message : '批量删除失败'
        }`,
      );
      await refreshAdminAfterReviewMutation();
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleBulkApprove = async (playIds: string[], label: string) => {
    const normalizedIds = Array.from(new Set(playIds.map((id) => id.trim()).filter(Boolean)));
    if (normalizedIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(`确认一键通过${label}吗？共 ${normalizedIds.length} 篇。`);
    if (!confirmed) {
      return;
    }

    setFeedbackScope('bulk');
    setBulkProgress({ completed: 0, total: normalizedIds.length, label });
    setProcessingMessage(`正在处理：已完成 0 / ${normalizedIds.length}`);
    setError('');
    setSuccessMessage('');
    setBulkTask({
      label,
      note: reviewNote.trim(),
      pendingIds: normalizedIds,
      skippedIds: [],
      status: 'running',
      total: normalizedIds.length,
      updatedIds: [],
    });
  };

  const handlePauseBulkApprove = () => {
    setFeedbackScope('bulk');
    setBulkTask((current) =>
      current && current.status === 'running' ? { ...current, status: 'paused' } : current,
    );
    setProcessingMessage(
      bulkBusy
        ? '当前这一小批完成后暂停'
        : `已暂停，已完成 ${bulkTaskCompletedCount} / ${bulkTask?.total ?? 0}`,
    );
  };

  const handleContinueBulkApprove = () => {
    if (!bulkTask || bulkTask.status !== 'paused') {
      return;
    }

    setFeedbackScope('bulk');
    setError('');
    setProcessingMessage(`继续处理：已完成 ${bulkTaskCompletedCount} / ${bulkTask.total}`);
    setBulkTask({ ...bulkTask, status: 'running' });
  };

  const handleStopBulkApprove = async () => {
    const currentTask = bulkTaskRef.current;
    if (!currentTask) {
      return;
    }

    setFeedbackScope('bulk');
    if (currentTask.status === 'paused' && !bulkBusy) {
      await finishBulkReviewTask(currentTask, { stopped: true });
      return;
    }

    setBulkTask((task) => (task ? { ...task, status: 'stopping' } : task));
    setProcessingMessage('正在停止，当前这一小批完成后结束');
  };

  const handleReviewForPlay = async (
    play: Play,
    action: ReviewAction,
    options?: {
      title?: string;
      authorName?: string;
      category?: string;
      summary?: string;
      content?: string;
      note?: string;
    },
  ) => {
    const currentPlayId = play.id;
    const nextPendingPlayId = getNextPendingPlayId(currentPlayId);
    const nextTitle = options?.title ?? play.title;
    const nextAuthorName = options?.authorName ?? play.authorName;
    const nextCategory = options?.category ?? play.category ?? DEFAULT_CATEGORY;
    const nextSummary = options?.summary ?? play.summary;
    const nextContent = options?.content ?? play.content;
    const nextNote = options?.note ?? '';

    setFeedbackScope('review');
    setReviewBusyAction(action);
    setProcessingMessage('正在处理');
    setError('');
    setSuccessMessage('');
    try {
      /* modify 类型的「审核修改」不允许 admin 自己 inline 覆盖字段,
       * 服务端会忽略 edit。这里把 edit 设为 undefined 让 reviewPlay 走 modify 分支。 */
      const editPayload =
        play.submissionType === 'modify'
          ? undefined
          : {
              title: nextTitle.trim(),
              authorName: nextAuthorName.trim(),
              category: nextCategory.trim() || DEFAULT_CATEGORY,
              summary: nextSummary.trim(),
              content: nextContent,
            };
      const updatedPlay = await playApi.reviewPlay(
        currentPlayId,
        action,
        nextNote.trim(),
        editPayload,
      );
      syncPlayStateLocally(updatedPlay);
      setReviewNote('');
      /* modify approve 返回的是被合入的原 play(不是 modification 记录),
       * 这里把详情面板定位到原 play 上,这样用户看到的就是已合并后的内容。 */
      if (action === 'approve' && play.submissionType === 'modify' && updatedPlay) {
        setSelectedPlayId(updatedPlay.id);
        setReviewTitle(updatedPlay.title);
        setReviewAuthorName(updatedPlay.authorName);
        setReviewCategory(updatedPlay.category);
        setReviewSummary(updatedPlay.summary);
        setReviewContent(updatedPlay.content);
      } else if (selectedPlayId === currentPlayId) {
        setReviewTitle(updatedPlay?.title ?? nextTitle);
        setReviewAuthorName(updatedPlay?.authorName ?? nextAuthorName);
        setReviewCategory(updatedPlay?.category ?? nextCategory);
        setReviewSummary(updatedPlay?.summary ?? nextSummary);
        setReviewContent(updatedPlay?.content ?? nextContent);
      }
      setProcessingMessage('');
      setSuccessMessage(
        action === 'approve' && play.submissionType === 'modify'
          ? '已通过修改,内容已合入原作品'
          : formatReviewResultMessage(actionResultLabelMap[action], 1),
      );
      const shouldAutoJumpNextPending = play.status === 'pending';
      await refreshAdminAfterReviewMutation(
        shouldAutoJumpNextPending && !(action === 'approve' && play.submissionType === 'modify')
          ? nextPendingPlayId
          : updatedPlay?.id,
      );
      await loadTags();
    } catch (reason) {
      setProcessingMessage('');
      setError(reason instanceof Error ? reason.message : '审核失败');
    } finally {
      setReviewBusyAction(null);
    }
  };

  const handleReview = async (action: ReviewAction) => {
    if (!selectedPlay) {
      return;
    }

    await handleReviewForPlay(selectedPlay, action, {
      title: reviewTitle,
      authorName: reviewAuthorName,
      category: reviewCategory,
      summary: reviewSummary,
      content: reviewContent,
      note: reviewNote,
    });
  };

  const handleSaveAdminEdit = async () => {
    if (!selectedPlay) {
      return;
    }

    setFeedbackScope('review');
    setReviewBusyAction('save');
    setProcessingMessage('正在保存修改');
    setError('');
    setSuccessMessage('');

    try {
      const updatedPlay = await playApi.updateAdminPlay(selectedPlay.id, {
        title: reviewTitle.trim(),
        authorName: reviewAuthorName.trim(),
        category: reviewCategory.trim() || DEFAULT_CATEGORY,
        summary: reviewSummary.trim(),
        content: reviewContent,
      });

      if (updatedPlay) {
        setReviewTitle(updatedPlay.title);
        setReviewAuthorName(updatedPlay.authorName);
        setReviewCategory(updatedPlay.category || DEFAULT_CATEGORY);
        setReviewSummary(updatedPlay.summary);
        setReviewContent(updatedPlay.content);
      }

      setProcessingMessage('');
      setSuccessMessage('修改已保存');
      await refreshAdminAfterReviewMutation(selectedPlay.id);
      await loadTags();
    } catch (reason) {
      setProcessingMessage('');
      setError(reason instanceof Error ? reason.message : '保存修改失败');
    } finally {
      setReviewBusyAction(null);
    }
  };

  const addAdminDerivedDraft = () => {
    setDerivedDrafts((current) => [...current, makeAdminDerivedDraft()]);
  };

  const removeAdminDerivedDraft = (id: string) => {
    setDerivedDrafts((current) => current.filter((draft) => draft.id !== id));
  };

  const updateAdminDerivedDraft = (
    id: string,
    patch: Partial<{ summary: string; content: string }>,
  ) => {
    setDerivedDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    );
  };

  /* 审核后台"追加衍生":
   * 只对已通过条目开放。共享作者/标题/分类,每版单独简介/内容;
   * 提交时按顺序 uploadPlay + reviewPlay(approve, 自动通过备注),
   * 让新版本直接落库为已通过,前台列表页会自动聚合到同一组。 */
  const handleSubmitDerivedDrafts = async () => {
    if (!selectedPlay || selectedPlay.status !== 'approved') {
      return;
    }
    const drafts = derivedDrafts
      .map((draft) => ({ ...draft, summary: draft.summary.trim(), content: draft.content.trim() }))
      .filter((draft) => draft.content.length > 0);
    if (drafts.length === 0) {
      setError('每个衍生版本都需要填写正文');
      setFeedbackScope('review');
      return;
    }

    const authorName = reviewAuthorName.trim() || selectedPlay.authorName;
    const title = reviewTitle.trim() || selectedPlay.title;
    const category = reviewCategory.trim() || selectedPlay.category || DEFAULT_CATEGORY;

    setDerivedSubmitting(true);
    setFeedbackScope('review');
    setError('');
    setSuccessMessage('');
    setProcessingMessage(`正在追加 ${drafts.length} 个衍生版本`);

    try {
      for (const draft of drafts) {
        const created = await playApi.uploadPlay({
          authorName,
          title,
          category,
          summary: draft.summary,
          content: draft.content,
        });
        await playApi.reviewPlay(created.id, 'approve', '管理员追加衍生版本，自动通过');
      }

      setDerivedDrafts([]);
      setProcessingMessage('');
      setSuccessMessage(`已追加并通过 ${drafts.length} 个衍生版本。`);
      await refreshAdminAfterReviewMutation(selectedPlay.id);
    } catch (reason) {
      setProcessingMessage('');
      setError(reason instanceof Error ? reason.message : '追加衍生版本失败');
    } finally {
      setDerivedSubmitting(false);
    }
  };

  const handleQuickApprove = async (playId: string) => {
    const targetPlay = filteredPlays.find((item) => item.id === playId);
    if (!targetPlay || targetPlay.status !== 'pending') {
      return;
    }

    setSelectedPlayId(playId);
    setActivePanel('review');

    await handleReviewForPlay(targetPlay, 'approve', {
      title: targetPlay.id === selectedPlayId ? reviewTitle : targetPlay.title,
      authorName: targetPlay.id === selectedPlayId ? reviewAuthorName : targetPlay.authorName,
      category: targetPlay.id === selectedPlayId ? reviewCategory : targetPlay.category,
      summary: targetPlay.id === selectedPlayId ? reviewSummary : targetPlay.summary,
      content: targetPlay.id === selectedPlayId ? reviewContent : targetPlay.content,
      note: targetPlay.id === selectedPlayId ? reviewNote : '',
    });
  };

  const handleScrollToTop = () => {
    if (typeof window === 'undefined') {
      return;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleScrollToBottom = () => {
    if (typeof window === 'undefined') {
      return;
    }

    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  };

  const handleToggleJumpButton = () => {
    setShowJumpButton((current) => !current);
  };

  const handleRepoReview = async (repoId: string, action: RepoReviewAction) => {
    if (action === 'reject') {
      const reason = window.prompt(
        '确认拒绝这条 repo 吗？可填写拒绝理由（会反馈给提交者）：',
        repoReviewNote || '',
      );
      if (reason === null) {
        return;
      }
      setRepoReviewNote(reason);
      if (!window.confirm('确认提交拒绝？')) {
        return;
      }
    }

    setRepoBusyAction(action);
    setError('');
    setSuccessMessage('');
    try {
      const note = action === 'reject' ? repoReviewNote || '' : repoReviewNote;
      const updatedRepo = await playApi.reviewRepo(repoId, action, note);
      syncRepoStateLocally(updatedRepo);
      await Promise.all([loadRepos(selectedRepoStatus), loadAllRepos()]);
      setRepoReviewNote('');
      setSuccessMessage(action === 'approve' ? 'repo 已通过。' : 'repo 已拒绝。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'repo 审核失败');
    } finally {
      setRepoBusyAction(null);
    }
  };

  /* 任务 5：保存 repo 编辑（仅"仅编辑/编辑+预览"模式）。 */
  const handleSaveRepoEdit = async () => {
    if (!selectedRepo) {
      return;
    }
    const content = repoEditContentDraft.trim();
    const note = repoEditNoteDraft.trim();
    if (content.length === 0) {
      setError('repo 正文不能为空');
      return;
    }
    if (!window.confirm('确认保存对这条 repo 的修改？')) {
      return;
    }
    setRepoEditBusy(true);
    setError('');
    setSuccessMessage('');
    try {
      const updated = await playApi.updateRepo(selectedRepo.id, { content, note });
      if (updated) {
        syncRepoStateLocally(updated);
        await Promise.all([loadRepos(selectedRepoStatus), loadAllRepos()]);
        setSuccessMessage('repo 已更新。');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'repo 更新失败');
    } finally {
      setRepoEditBusy(false);
    }
  };

  const handleRepoDelete = async (repoId: string) => {
    if (!window.confirm('确认删除这条 repo 吗？删除后不可恢复。')) {
      return;
    }

    setRepoBusyAction('delete');
    setError('');
    setSuccessMessage('');
    try {
      await playApi.deleteRepo(repoId);
      removeRepoStateLocally(repoId);
      await Promise.all([loadRepos(selectedRepoStatus), loadAllRepos()]);
      setSuccessMessage('repo 已删除。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'repo 删除失败');
    } finally {
      setRepoBusyAction(null);
    }
  };

  const handleBatchDeleteRepos = async (repoIds: string[], label: string) => {
    const normalizedIds = Array.from(new Set(repoIds.map((id) => id.trim()).filter(Boolean)));
    if (normalizedIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `确认删除${label}吗？共 ${normalizedIds.length} 条。删除后不可恢复。`,
    );
    if (!confirmed) {
      return;
    }

    setRepoDeleteBusy(true);
    setRepoDeleteProgress({ completed: 0, total: normalizedIds.length, label });
    setProcessingMessage(`正在删除 repo：已完成 0 / ${normalizedIds.length}`);
    setError('');
    setSuccessMessage('');

    const deletedIds: string[] = [];
    let completed = 0;

    try {
      for (const repoId of normalizedIds) {
        await playApi.deleteRepo(repoId);
        removeRepoStateLocally(repoId);
        deletedIds.push(repoId);
        completed += 1;
        setRepoDeleteProgress({ completed, total: normalizedIds.length, label });
        setProcessingMessage(`正在删除 repo：已完成 ${completed} / ${normalizedIds.length}`);
      }

      setRepoDeleteSelectedIds((current) => current.filter((id) => !deletedIds.includes(id)));
      await Promise.all([loadRepos(selectedRepoStatus), loadAllRepos()]);
      setProcessingMessage('');
      setRepoDeleteProgress({
        completed: normalizedIds.length,
        total: normalizedIds.length,
        label,
      });
      setSuccessMessage(`已删除 ${deletedIds.length} 条 repo。`);
    } catch (reason) {
      setProcessingMessage('');
      setRepoDeleteProgress({ completed, total: normalizedIds.length, label });
      setError(
        `${label}已完成 ${completed} / ${normalizedIds.length} 条，剩余 repo 删除中断：${
          reason instanceof Error ? reason.message : 'repo 批量删除失败'
        }`,
      );
      await Promise.all([loadRepos(selectedRepoStatus), loadAllRepos()]);
    } finally {
      setRepoDeleteBusy(false);
    }
  };

  /* repo 批量通过：可选传入一组 repoIds + label,配合"通过当前待审核 / 通过该作者 / 通过已选"三种入口。
   * 兼容旧签名(无参 = 通过当前列表所有待审核 repo)。 */
  const handleBulkApproveRepos = async (repoIds?: string[], label?: string) => {
    const normalizedIds = repoIds
      ? Array.from(new Set(repoIds.map((id) => id.trim()).filter(Boolean)))
      : pendingVisibleRepos.map((repo) => repo.id);
    if (normalizedIds.length === 0) {
      setError(repoKeyword.trim() ? '当前搜索结果里没有可通过的 repo' : '当前没有可通过的 repo');
      return;
    }

    const targetLabel = label ?? '当前待审核 repo';
    if (!window.confirm(`确认一键通过${targetLabel}吗？共 ${normalizedIds.length} 条。`)) {
      return;
    }

    setRepoBusyAction('approve');
    setError('');
    setSuccessMessage('');
    try {
      for (const repoId of normalizedIds) {
        await playApi.reviewRepo(repoId, 'approve', repoReviewNote);
      }
      markReposApprovedLocally(normalizedIds);
      await Promise.all([loadRepos(selectedRepoStatus), loadAllRepos()]);
      setRepoReviewNote('');
      setSuccessMessage(`已通过 ${normalizedIds.length} 条 repo。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'repo 批量通过失败');
    } finally {
      setRepoBusyAction(null);
    }
  };

  const handleLogout = async () => {
    await playApi.logoutAdmin();
    setSession(null);
    navigate('/admin/login');
  };

  const handleCreateTag = async () => {
    if (!tagDraft.trim()) {
      setTagMessageTone('error');
      setTagMessage('先输入标签名');
      return;
    }

    setTagSaving(true);
    setTagMessage('');
    try {
      await playApi.createAdminTag({ name: tagDraft.trim() });
      setTagDraft('');
      setTagMessageTone('success');
      setTagMessage('标签已加入字典');
      await loadTags();
    } catch (reason) {
      setTagMessageTone('error');
      setTagMessage(reason instanceof Error ? reason.message : '标签创建失败');
    } finally {
      setTagSaving(false);
    }
  };

  const startEditTag = (tag: Tag) => {
    setEditingTagId(tag.id);
    setEditingTagName(tag.name);
    setTagMessage('');
    setTagMessageTone('success');
  };

  const cancelEditTag = () => {
    setEditingTagId('');
    setEditingTagName('');
  };

  const handleUpdateTag = async () => {
    if (!editingTagId) {
      return;
    }

    setTagSaving(true);
    setTagMessage('');
    try {
      await playApi.updateAdminTag(editingTagId, { name: editingTagName.trim() });
      setTagMessageTone('success');
      setTagMessage('标签已更新，历史内容已同步新标签');
      cancelEditTag();
      await loadTags();
      await load(selectedStatus, { silent: true });
    } catch (reason) {
      setTagMessageTone('error');
      setTagMessage(reason instanceof Error ? reason.message : '标签更新失败');
    } finally {
      setTagSaving(false);
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    setTagSaving(true);
    setTagMessage('');
    try {
      await playApi.deleteAdminTag(tagId);
      setTagMessageTone('success');
      setTagMessage(`标签已删除，相关内容已回退到 ${DEFAULT_CATEGORY}`);
      if (editingTagId === tagId) {
        cancelEditTag();
      }
      await loadTags();
      await load(selectedStatus, { silent: true });
    } catch (reason) {
      setTagMessageTone('error');
      setTagMessage(reason instanceof Error ? reason.message : '标签删除失败');
    } finally {
      setTagSaving(false);
    }
  };

  const enterTagSortMode = () => {
    setTagMessage('');
    setTagSortSnapshot(tags);
    setTagSortDraft(tags);
    setDraggingTagId('');
    setIsTagSorting(true);
    cancelEditTag();
  };

  const cancelTagSort = () => {
    setTagSortDraft(tagSortSnapshot);
    setDraggingTagId('');
    setIsTagSorting(false);
    setTagMessageTone('success');
    setTagMessage('已取消本次标签排序');
  };

  const saveTagSort = async () => {
    setTagSaving(true);
    setTagMessage('');
    try {
      const savedTags = await playApi.reorderAdminTags(tagSortDraft.map((tag) => tag.id));
      setTags(savedTags);
      setTagSortDraft(savedTags);
      setTagSortSnapshot(savedTags);
      setIsTagSorting(false);
      setDraggingTagId('');
      setTagMessageTone('success');
      setTagMessage('标签顺序已更新');
    } catch (reason) {
      setTagMessageTone('error');
      setTagMessage(reason instanceof Error ? reason.message : '标签排序保存失败');
      await loadTags();
      setTagSortDraft(tagSortSnapshot);
      setIsTagSorting(false);
      setDraggingTagId('');
    } finally {
      setTagSaving(false);
    }
  };

  const toggleTagSortMode = async () => {
    if (!isTagSorting) {
      enterTagSortMode();
      return;
    }

    await saveTagSort();
  };

  const moveDraftTag = (sourceId: string, targetId: string) => {
    if (!isTagSorting || sourceId === targetId) {
      return;
    }

    setTagSortDraft((current) => reorderTagsInMemory(current, sourceId, targetId));
  };

  const handleTagPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, tagId: string) => {
    if (!isTagSorting || tagSaving || editingTagId || !isTouchLikePointer(event.pointerType)) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingTagId(tagId);
  };

  const handleTagPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isTagSorting || !draggingTagId || !isTouchLikePointer(event.pointerType)) {
      return;
    }

    event.preventDefault();

    const element = document.elementFromPoint(event.clientX, event.clientY);
    const target = element?.closest('[data-tag-id]');
    const targetId = target?.getAttribute('data-tag-id') ?? '';
    if (!targetId || targetId === draggingTagId) {
      return;
    }

    moveDraftTag(draggingTagId, targetId);
  };

  const handleTagPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setDraggingTagId('');
  };

  const handleStatusTabChange = (nextStatus?: PlayStatus) => {
    if (nextStatus === selectedStatus) {
      void load(nextStatus, { silent: true });
      void loadAllPlays();
      return;
    }

    setSelectedStatus(nextStatus);
  };

  const handleRepoStatusTabChange = (nextStatus?: RepoStatus) => {
    if (nextStatus === selectedRepoStatus) {
      void loadRepos(nextStatus);
      void loadAllRepos();
      return;
    }

    setSelectedRepoStatus(nextStatus);
  };

  const handleDeletePlayItem = async (play: Play) => {
    if (!window.confirm(`确认删除《${play.title}》吗？删除后内容和审核记录都会一起清掉。`)) {
      return;
    }

    const deletingPlayId = play.id;
    const isDeletingSelectedPlay = selectedPlayId === deletingPlayId;
    const nextPendingPlayId =
      isDeletingSelectedPlay && play.status === 'pending'
        ? getNextPendingPlayId(deletingPlayId)
        : undefined;

    setFeedbackScope('review');
    setReviewBusyAction('delete');
    setProcessingMessage('正在处理');
    setError('');
    setSuccessMessage('');
    try {
      await playApi.deleteAdminPlay(deletingPlayId);
      removePlayStateLocally(deletingPlayId);
      setProcessingMessage('');
      setSuccessMessage(formatReviewResultMessage('已删除', 1));
      if (isDeletingSelectedPlay) {
        setSelectedPlayId('');
        setReviewLogs([]);
      }
      await refreshAdminAfterReviewMutation(nextPendingPlayId);
    } catch (reason) {
      setProcessingMessage('');
      setError(reason instanceof Error ? reason.message : '删除失败');
    } finally {
      setReviewBusyAction(null);
    }
  };

  const handleDeletePlay = async () => {
    if (!selectedPlay) {
      return;
    }

    await handleDeletePlayItem(selectedPlay);
  };

  const handleBulkMoveCategory = async () => {
    if (moveCategoryTargetIds.length === 0) {
      setMoveCategoryError('请先勾选至少一个源分类');
      return;
    }

    if (!moveTargetCategory.trim() && moveTargetCategory.trim() !== '') {
      // 未分类用空字符串保存后端会自行 fallback；这里允许 ""
    }

    const targetCategory = moveTargetCategory.trim();
    const label = targetCategory || DEFAULT_CATEGORY;

    if (!window.confirm(`确认将 ${moveCategoryTargetIds.length} 篇小剧场移动到「${label}」吗？`)) {
      return;
    }

    setMoveCategoryBusy(true);
    setMoveCategoryError('');
    setMoveCategoryMessage('');

    let completed = 0;
    let failed = 0;
    try {
      for (const playId of moveCategoryTargetIds) {
        try {
          await playApi.updateAdminPlay(playId, { category: targetCategory });
          completed += 1;
        } catch {
          failed += 1;
        }
      }

      await Promise.all([load(selectedStatus, { silent: true }), loadAllPlays()]);
      notifyPlaysUpdate();

      setMoveCategoryMessage(
        `已移动 ${completed} 篇到「${label}」${failed > 0 ? `，${failed} 篇失败` : ''}`,
      );
    } finally {
      setMoveCategoryBusy(false);
    }
  };

  const handleClearReviewLogs = async () => {
    if (!selectedPlay) {
      return;
    }

    if (!window.confirm(`确认清空《${selectedPlay.title}》的审核记录吗？`)) {
      return;
    }

    setError('');
    setSuccessMessage('');
    try {
      await playApi.clearReviewLogs(selectedPlay.id);
      setReviewLogs([]);
      setSuccessMessage(`《${selectedPlay.title}》的审核记录已清空。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '清空审核记录失败');
    }
  };

  const handleScanDuplicates = async () => {
    const scanRunId = duplicateScanRunRef.current + 1;
    const scanScope = duplicateReview.scanScope;
    const scopeLabel = scanScope === 'approved' ? '已通过内容' : '整个库';
    const sourcePlays = duplicateScanSourcePlays;

    duplicateScanRunRef.current = scanRunId;
    setDuplicateBusy(true);
    setDuplicateScanProgress({
      completedAnchors: 0,
      totalAnchors: sourcePlays.length,
      processedPairs: 0,
      totalPairs:
        sourcePlays.length <= 1
          ? 0
          : Math.floor((sourcePlays.length * (sourcePlays.length - 1)) / 2),
      scopeLabel,
    });
    setError('');
    setSuccessMessage('');

    try {
      const nextState = await scanDuplicateGroups(allPlays, duplicateReview.threshold, {
        onProgress: (progress) => {
          if (duplicateScanRunRef.current !== scanRunId) {
            return;
          }

          setDuplicateScanProgress({
            ...progress,
            scopeLabel,
          });
        },
        scanScope,
        shouldStop: () => duplicateScanRunRef.current !== scanRunId,
      });

      if (duplicateScanRunRef.current !== scanRunId) {
        return;
      }

      setDuplicateReview(nextState);
      setSuccessMessage(
        nextState.groups.length > 0
          ? `已在${scopeLabel}里找到 ${nextState.groups.length} 组重复候选。`
          : `扫描完成，当前${scopeLabel} ${sourcePlays.length} 篇里没有达到 ${duplicateReview.threshold}% 的重复候选。`,
      );
    } catch (reason) {
      if (duplicateScanRunRef.current !== scanRunId) {
        return;
      }

      setError(reason instanceof Error ? reason.message : '重复扫描失败');
    } finally {
      if (duplicateScanRunRef.current === scanRunId) {
        setDuplicateBusy(false);
      }
    }
  };

  const handleClearDuplicateSearch = () => {
    duplicateScanRunRef.current += 1;
    setDuplicateBusy(false);
    setDuplicateScanProgress(null);
    setDuplicateReview((current) => clearDuplicateReviewState(current));
    setSuccessMessage('重复检索结果已清空。');
    setError('');
  };

  const handleDuplicateThresholdChange = (value: number) => {
    setDuplicateReview(setDuplicateThreshold(value));
  };

  const handleDuplicateScanScopeChange = (scanScope: DuplicateScanScope) => {
    setDuplicateScanProgress(null);
    setDuplicateReview(setDuplicateScanScope(scanScope));
  };

  const handleToggleDuplicateSelection = (playId: string) => {
    setDuplicateReview((current) => toggleDuplicateSelection(current, playId));
  };

  const handleOpenDuplicateCompare = (groupId: string, playId: string) => {
    setDuplicateReview((current) => setDuplicateCompareTarget(current, groupId, playId));
  };

  const refreshAdminAfterDuplicateDelete = async () => {
    await load(selectedStatus, { silent: true });
    const nextAllPlays = await playApi.getAdminPlays();
    setAllPlays(nextAllPlays);
    setDuplicateReview((current) => pruneDuplicateReviewState(current, nextAllPlays));
    if (selectedPlayId) {
      await loadReviewLogs(selectedPlayId);
    }
    notifyPlaysUpdate();
  };

  const handleDeleteDuplicateIds = async (ids: string[], message: string) => {
    const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
    if (normalizedIds.length === 0) {
      return;
    }

    setDuplicateBusy(true);
    setError('');
    setSuccessMessage('');
    try {
      for (const playId of normalizedIds) {
        await playApi.deleteAdminPlay(playId);
      }
      await refreshAdminAfterDuplicateDelete();
      setSuccessMessage(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批量剔除重复失败');
    } finally {
      setDuplicateBusy(false);
    }
  };

  const handleDeleteSelectedDuplicates = async () => {
    if (duplicateReview.selectedIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `确认剔除已勾选的 ${duplicateReview.selectedIds.length} 篇重复内容吗？`,
    );
    if (!confirmed) {
      return;
    }

    await handleDeleteDuplicateIds(
      duplicateReview.selectedIds,
      `已剔除 ${duplicateReview.selectedIds.length} 篇勾选的重复内容。`,
    );
  };

  const handleDeleteAllDuplicates = async () => {
    const ids = collectAllDuplicateIds(duplicateReview.groups);
    if (ids.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `确认一键剔除全部重复内容吗？将保留每组的第一篇，共删除 ${ids.length} 篇。`,
    );
    if (!confirmed) {
      return;
    }

    await handleDeleteDuplicateIds(ids, `已一键剔除全部重复内容，共删除 ${ids.length} 篇。`);
  };

  const handleDeleteAllGroupSeconds = async () => {
    const ids = collectSecondDuplicateIds(duplicateReview.groups);
    if (ids.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `确认删除每个相似组里的第二篇内容吗？共删除 ${ids.length} 篇。`,
    );
    if (!confirmed) {
      return;
    }

    await handleDeleteDuplicateIds(ids, `已删除全部相似组的第二篇内容，共删除 ${ids.length} 篇。`);
  };

  return (
    <>
      <section className="review-layout review-layout-wide">
        <aside
          className={
            shouldHideMobileReviewWorkspace
              ? 'review-sidebar review-sidebar-mobile-compact'
              : 'review-sidebar'
          }
        >
          <div className="sidebar-head sidebar-head-admin sidebar-head-admin-header">
            <div className="stack-gap-sm sidebar-head-title-block">
              <p className="eyebrow">Admin Loop</p>
              <h2>审核后台</h2>
            </div>
            <div className="inline-actions sidebar-head-account-row">
              <p className="sub-copy">登录账号：{session?.username ?? '-'}</p>
              <div className="inline-actions sidebar-head-account-actions">
                <button className="button ghost" onClick={handleLogout} type="button">
                  退出登录
                </button>
                <button
                  className={showJumpButton ? 'button secondary' : 'button ghost'}
                  onClick={handleToggleJumpButton}
                  type="button"
                >
                  跳转
                </button>
              </div>
            </div>
          </div>
          <div className="admin-panel-tab-grid">
            {adminPanelTabs.map((panel) => {
              const showPendingDot =
                (panel.value === 'review' && pendingPlayCount > 0) ||
                (panel.value === 'repo' && pendingRepoCount > 0);

              return (
                <button
                  key={panel.value}
                  className={
                    activePanel === panel.value
                      ? 'tab-chip active admin-panel-tab-button'
                      : 'tab-chip admin-panel-tab-button'
                  }
                  onClick={() => {
                    setActivePanel(panel.value);
                    if (panel.value === 'moveCategory' && !hasLoadedAllPlays) {
                      void loadAllPlays();
                    }
                  }}
                  type="button"
                >
                  <span>{panel.label}</span>
                  {showPendingDot ? (
                    <span className="admin-panel-tab-dot" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>

          {shouldShowReviewSidebarContent ? (
            <>
              <div className="metric-strip metric-strip-admin metric-strip-admin-responsive">
                {metrics.map((item) => (
                  <div key={item.label} className="metric-card-lite">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>

              <div className="tab-list">
                {statusTabs.map((tab) => (
                  <button
                    key={tab.label}
                    className={selectedStatus === tab.value ? 'tab-chip active' : 'tab-chip'}
                    onClick={() => handleStatusTabChange(tab.value)}
                    type="button"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <label>
                <span>后台搜索</span>
                <ClearableField visible={Boolean(keyword.trim())} onClear={() => setKeyword('')}>
                  <input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="默认从全部内容里搜标题、作者、分类或正文"
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
                    onClick={() =>
                      setPlaySearchFields((current) => toggleSearchField(current, item.value))
                    }
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {keyword.trim() ? (
                <div className="inline-actions admin-search-action-row">
                  <button
                    className="button secondary"
                    disabled={reviewMutationBusy || deleteVisibleIds.length === 0}
                    onClick={handleSelectAllVisibleForDelete}
                    type="button"
                  >
                    全选
                  </button>
                  <button
                    className="button danger"
                    disabled={reviewMutationBusy || deleteSelectedIds.length === 0}
                    onClick={() => void handleBatchDelete(deleteSelectedIds, '已勾选搜索结果')}
                    type="button"
                  >
                    删除（{deleteSelectedIds.length}）
                  </button>
                  <button
                    className="button ghost"
                    disabled={reviewMutationBusy || deleteSelectedIds.length === 0}
                    onClick={handleClearDeleteSelection}
                    type="button"
                  >
                    清选
                  </button>
                </div>
              ) : null}

              <div className="form-panel stack-gap-md admin-bulk-review-panel">
                <div className="content-head admin-bulk-review-head">
                  <div>
                    <strong>一键通过</strong>
                    <span className="content-meta">
                      当前列表待审核 {pendingVisiblePlays.length} 篇，已选 {bulkSelectedIds.length}{' '}
                      篇
                    </span>
                  </div>
                  <div className="inline-actions admin-bulk-review-head-actions">
                    {/* 全选 / 取消全选：把「展开/折叠」左侧同行的操作抽出来，
                     * 已经全选（当前待审核 == 已选，且非空）时按钮变成「取消全选」，
                     * 再点一下相当于走 handleClearBulkSelection 清空。 */}
                    <button
                      className="button secondary admin-bulk-review-head-select-all-button"
                      disabled={reviewMutationBusy || pendingVisibleIds.length === 0}
                      onClick={
                        isAllPendingVisibleSelected
                          ? handleClearBulkSelection
                          : handleSelectAllPendingVisible
                      }
                      type="button"
                    >
                      {isAllPendingVisibleSelected ? '取消全选' : '全选'}
                    </button>
                    <button
                      className="button ghost"
                      onClick={() => setIsBulkApproveCollapsed((current) => !current)}
                      type="button"
                    >
                      {isBulkApproveCollapsed ? '展开' : '折叠'}
                    </button>
                  </div>
                </div>

                {!isBulkApproveCollapsed ? (
                  <>
                    <div className="stack-gap-sm admin-bulk-review-progress-block">
                      {bulkProgress ? (
                        <div className="admin-bulk-review-progress" role="status">
                          <div className="inline-actions wrap-mobile admin-bulk-review-progress-head">
                            <strong>{bulkProgress.label}</strong>
                            <span className="content-meta">
                              已完成 {bulkProgress.completed} / {bulkProgress.total}
                              {bulkTaskStatus === 'paused' ? ' · 已暂停' : ''}
                              {bulkTaskStatus === 'stopping' ? ' · 正在停止' : ''}
                            </span>
                          </div>
                          <div aria-hidden="true" className="admin-bulk-review-progress-track">
                            <div
                              className="admin-bulk-review-progress-fill"
                              style={{
                                width: `${bulkProgress.total === 0 ? 0 : (bulkProgress.completed / bulkProgress.total) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                      ) : null}
                      {feedbackScope === 'bulk' && processingMessage ? (
                        <div className="feedback info">{processingMessage}</div>
                      ) : null}
                      {feedbackScope === 'bulk' && successMessage ? (
                        <div className="feedback success">{successMessage}</div>
                      ) : null}
                      {feedbackScope === 'bulk' && error ? (
                        <div className="feedback error">{error}</div>
                      ) : null}
                    </div>

                    <div className="inline-actions wrap-mobile admin-bulk-review-row admin-bulk-review-selection-toggle-row">
                      <button
                        className="button secondary"
                        disabled={reviewMutationBusy || pendingVisibleIds.length === 0}
                        onClick={handleSelectAllPendingVisible}
                        type="button"
                      >
                        全选
                      </button>
                      <button
                        className="button secondary"
                        disabled={reviewMutationBusy || pendingVisibleIds.length === 0}
                        onClick={handleInvertBulkSelection}
                        type="button"
                      >
                        反选
                      </button>
                    </div>

                    <div className="inline-actions wrap-mobile admin-bulk-review-row admin-bulk-review-selection-top-row">
                      <div
                        className="admin-bulk-review-top-count"
                        role="group"
                        aria-label="选中前几条待审核"
                      >
                        <button
                          className="button secondary admin-bulk-review-top-count-button"
                          disabled={
                            reviewMutationBusy ||
                            bulkSelectCount <= 0 ||
                            pendingVisibleIds.length === 0
                          }
                          onClick={handleSelectTopPendingVisible}
                          type="button"
                        >
                          选中
                        </button>
                        <span>前</span>
                        <input
                          aria-label="选中前几条"
                          inputMode="numeric"
                          min="1"
                          onChange={(event) =>
                            setBulkSelectCountInput(event.target.value.replace(/\D+/g, ''))
                          }
                          placeholder="x"
                          value={bulkSelectCountInput}
                        />
                        <span>条</span>
                      </div>
                      <button
                        className="button ghost admin-bulk-review-clear-button"
                        disabled={reviewMutationBusy || bulkSelectedIds.length === 0}
                        onClick={handleClearBulkSelection}
                        type="button"
                      >
                        清空已选
                      </button>
                    </div>

                    <div className="inline-actions wrap-mobile admin-bulk-review-row admin-bulk-review-row-compact">
                      <button
                        className="button secondary"
                        disabled={!bulkTask || bulkTask.status !== 'running'}
                        onClick={handlePauseBulkApprove}
                        type="button"
                      >
                        暂停
                      </button>
                      <button
                        className="button secondary"
                        disabled={!bulkTask || bulkTask.status !== 'paused'}
                        onClick={handleContinueBulkApprove}
                        type="button"
                      >
                        继续
                      </button>
                      <button
                        className="button ghost"
                        disabled={!bulkTask || bulkTask.status === 'stopping'}
                        onClick={() => void handleStopBulkApprove()}
                        type="button"
                      >
                        {bulkTaskStatus === 'stopping' ? '正在停止' : '停止'}
                      </button>
                    </div>

                    <div className="field-grid two-columns admin-bulk-review-grid">
                      <label>
                        <span>按作者一键通过</span>
                        <select
                          value={bulkAuthorName}
                          onChange={(event) => setBulkAuthorName(event.target.value)}
                        >
                          <option value="">先选作者</option>
                          {pendingAuthorOptions.map((authorName) => (
                            <option key={authorName} value={authorName}>
                              {authorName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="stack-gap-sm admin-bulk-review-actions">
                        <button
                          className="button primary admin-approve-all-button"
                          disabled={reviewMutationBusy || pendingVisibleIds.length === 0}
                          onClick={() =>
                            void handleBulkApprove(pendingVisibleIds, '当前列表待审核')
                          }
                          type="button"
                        >
                          {bulkTask
                            ? '批量处理中'
                            : `通过当前待审核（${pendingVisibleIds.length}）`}
                        </button>
                        <button
                          className="button primary"
                          disabled={reviewMutationBusy || selectedAuthorPendingIds.length === 0}
                          onClick={() =>
                            void handleBulkApprove(
                              selectedAuthorPendingIds,
                              `作者 ${bulkAuthorName} 的待审核内容`,
                            )
                          }
                          type="button"
                        >
                          {bulkTask
                            ? '批量处理中'
                            : `通过该作者（${selectedAuthorPendingIds.length}）`}
                        </button>
                        <div className="inline-actions admin-bulk-review-select-actions">
                          <button
                            className="button danger admin-bulk-delete-selected-button"
                            disabled={reviewMutationBusy || bulkSelectedIds.length === 0}
                            onClick={() =>
                              void handleBatchDelete(bulkSelectedIds, '已勾选待审核内容')
                            }
                            type="button"
                          >
                            {deleteBusy ? '删除处理中' : `删除已选（${bulkSelectedIds.length}）`}
                          </button>
                          <button
                            className="button primary"
                            disabled={reviewMutationBusy || bulkSelectedIds.length === 0}
                            onClick={() => void handleBulkApprove(bulkSelectedIds, '已勾选内容')}
                            type="button"
                          >
                            {bulkTask ? '批量处理中' : `通过已选（${bulkSelectedIds.length}）`}
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>

              {loading ? <div className="empty-panel">正在加载审核池…</div> : null}
              {feedbackScope !== 'bulk' && feedbackScope !== 'delete' && processingMessage ? (
                <div className="feedback info" role="status">
                  {processingMessage}
                </div>
              ) : null}
              {feedbackScope !== 'bulk' && feedbackScope !== 'delete' && error ? (
                <div className="feedback error">{error}</div>
              ) : null}
              {successMessage && feedbackScope !== 'bulk' && feedbackScope !== 'delete' ? (
                <div className="feedback success floating-toast" role="status">
                  {successMessage}
                </div>
              ) : null}

              {activePanel === 'review' ? (
                <div className="form-panel compact-panel stack-gap-md plaza-pagination-panel">
                  <div className="plaza-pagination-toolbar">
                    <div className="inline-actions plaza-pagination-nav">
                      <button
                        className="button secondary icon-page-button"
                        disabled={adminCurrentPage <= 1}
                        onClick={() => setAdminCurrentPage(1)}
                        title="第一页"
                        type="button"
                      >
                        ≪
                      </button>
                      <button
                        className="button secondary icon-page-button"
                        disabled={adminCurrentPage <= 1}
                        onClick={() => setAdminCurrentPage(adminCurrentPage - 1)}
                        title="上一页"
                        type="button"
                      >
                        ‹
                      </button>
                    </div>
                    <span className="content-meta plaza-page-indicator">
                      第 {adminCurrentPage} / {adminTotalPages} 页
                    </span>
                    <div className="inline-actions plaza-pagination-nav plaza-pagination-nav-end">
                      <button
                        className="button secondary icon-page-button"
                        disabled={adminCurrentPage >= adminTotalPages}
                        onClick={() => setAdminCurrentPage(adminCurrentPage + 1)}
                        title="下一页"
                        type="button"
                      >
                        ›
                      </button>
                      <button
                        className="button secondary icon-page-button"
                        disabled={adminCurrentPage >= adminTotalPages}
                        onClick={() => setAdminCurrentPage(adminTotalPages)}
                        title="最后一页"
                        type="button"
                      >
                        ≫
                      </button>
                    </div>
                    <div className="inline-actions plaza-page-control-inline">
                      <label
                        className="plaza-page-size-field"
                        htmlFor="admin-review-page-size-input"
                      >
                        <span className="content-meta plaza-page-size-copy">每页</span>
                        <input
                          id="admin-review-page-size-input"
                          inputMode="numeric"
                          min={MIN_ADMIN_PAGE_SIZE}
                          max={MAX_ADMIN_PAGE_SIZE}
                          onBlur={() => {
                            if (!/^\d+$/.test(adminPageSizeInput)) {
                              setAdminPageSizeInput(String(adminPageSize));
                              return;
                            }
                            setAdminPageSize(clampAdminPageSize(Number(adminPageSizeInput)));
                          }}
                          onChange={(event) => {
                            const cleaned = event.target.value.replace(/\D+/g, '');
                            setAdminPageSizeInput(cleaned);
                            if (/^\d+$/.test(cleaned)) {
                              setAdminPageSize(clampAdminPageSize(Number(cleaned)));
                              setAdminCurrentPage(1);
                            }
                          }}
                          value={adminPageSizeInput}
                        />
                        <span className="content-meta plaza-page-size-copy">个</span>
                      </label>
                      <div className="inline-actions plaza-page-jump-inline">
                        <span className="content-meta plaza-page-jump-copy">第</span>
                        <label className="page-jump-field page-jump-field-compact">
                          <input
                            inputMode="numeric"
                            min={1}
                            max={adminTotalPages}
                            onChange={(event) =>
                              setAdminPageInput(event.target.value.replace(/\D+/g, ''))
                            }
                            value={adminPageInput}
                          />
                        </label>
                        <span className="content-meta plaza-page-jump-copy">页</span>
                        <button
                          className="button primary plaza-page-jump-button"
                          onClick={() => {
                            const next = Number(adminPageInput);
                            if (!Number.isFinite(next) || next < 1 || next > adminTotalPages) {
                              setError(`页数范围是 1 到 ${adminTotalPages}`);
                              return;
                            }
                            setError('');
                            setAdminCurrentPage(next);
                          }}
                          type="button"
                        >
                          跳转
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="review-list">
                {shouldCollapseMobileReviewList ? (
                  <div className="inline-actions review-list-mobile-toggle-row">
                    <span className="content-meta">
                      手机端先显示前 {MOBILE_REVIEW_LIST_PREVIEW_COUNT} 条，当前“
                      {mobileReviewListLabel}”列表共 {filteredPlays.length} 条
                    </span>
                    <button
                      className="button ghost"
                      onClick={() => setIsMobilePendingExpanded((current) => !current)}
                      type="button"
                    >
                      {isMobilePendingExpanded ? '收起' : '展开'}
                    </button>
                  </div>
                ) : null}
                {reviewListPlays.map((play) => {
                  const isBulkSelectable = play.status === 'pending';
                  const isBulkSelected = bulkSelectedIdSet.has(play.id);
                  const isDeleteSelectable = activePanel === 'delete' || keyword.trim().length > 0;
                  const isDeleteSelected = deleteSelectedIdSet.has(play.id);

                  return (
                    <article className="review-card-shell" key={play.id}>
                      {isDeleteSelectable ? (
                        <div className="review-card-select-row">
                          <label
                            className="checkbox-chip review-card-checkbox"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <input
                              checked={isDeleteSelected}
                              disabled={reviewMutationBusy}
                              onChange={() => handleToggleDeleteSelection(play.id)}
                              type="checkbox"
                            />
                            <span>{isDeleteSelected ? '已选' : '多选删除'}</span>
                          </label>
                        </div>
                      ) : isBulkSelectable ? (
                        <div className="review-card-select-row">
                          <label
                            className="checkbox-chip review-card-checkbox"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <input
                              checked={isBulkSelected}
                              disabled={reviewMutationBusy}
                              onChange={() => handleToggleBulkSelection(play.id)}
                              type="checkbox"
                            />
                            <span>{isBulkSelected ? '已选' : '多选通过'}</span>
                          </label>
                        </div>
                      ) : null}
                      <div
                        className={
                          selectedPlayId === play.id ? 'review-card active' : 'review-card'
                        }
                      >
                        <button
                          className="review-card-main"
                          onClick={() => {
                            setSelectedPlayId(play.id);
                            setSuccessMessage('');
                            setActivePanel('review');
                          }}
                          type="button"
                        >
                          <div className="card-topline">
                            <span className={`status-tag ${play.status}`}>
                              {statusLabelMap[play.status]}
                            </span>
                            {(() => {
                              const badge = computeSubmissionTypeBadge(play);
                              if (badge.kind === 'original') {
                                return null;
                              }
                              const className =
                                badge.tone === 'derived'
                                  ? 'status-tag derived'
                                  : badge.tone === 'approved'
                                    ? 'status-tag approved'
                                    : 'status-tag pending';
                              return (
                                <span className={className} title={badge.label}>
                                  {badge.label}
                                </span>
                              );
                            })()}
                            {play.pendingEdit ? (
                              <span
                                className="status-tag pending"
                                title={`作者于 ${new Date(
                                  play.pendingEdit.submittedAt,
                                ).toLocaleString(
                                  'zh-CN',
                                )} 提交了待处理修改,审核通过后才会替换为修改后内容`}
                              >
                                待处理修改
                              </span>
                            ) : null}
                            <div className="compact-meta-row compact-meta-row-small compact-meta-row-end">
                              <span className="compact-meta-item">
                                ◈ {play.category || DEFAULT_CATEGORY}
                              </span>
                              <span className="compact-meta-item">✎ {play.authorName}</span>
                            </div>
                          </div>
                          <strong>{play.title}</strong>
                        </button>
                        {play.summary || play.status === 'pending' ? (
                          <div className="review-card-summary-row">
                            {play.summary ? (
                              <span className="summary review-card-summary-text">
                                {play.summary}
                              </span>
                            ) : (
                              <span className="summary review-card-summary-text">&nbsp;</span>
                            )}
                            {play.status === 'pending' ? (
                              <div className="inline-actions review-card-summary-actions">
                                <button
                                  className="button warning review-card-delete-button"
                                  disabled={reviewMutationBusy}
                                  onClick={() => void handleDeletePlayItem(play)}
                                  type="button"
                                >
                                  {reviewBusyAction === 'delete' && selectedPlayId === play.id
                                    ? '正在处理'
                                    : '删除'}
                                </button>
                                <button
                                  className="button primary review-card-approve-button"
                                  disabled={reviewMutationBusy}
                                  onClick={() => void handleQuickApprove(play.id)}
                                  type="button"
                                >
                                  {reviewBusyAction === 'approve' && selectedPlayId === play.id
                                    ? '正在处理'
                                    : '通过'}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {allPlays.some(
                          (item) =>
                            item.id !== play.id &&
                            item.authorName === play.authorName &&
                            item.title === play.title &&
                            item.createdAt < play.createdAt,
                        ) ? (
                          <span className="status-tag approved">有改动</span>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
                {!loading && filteredPlays.length === 0 ? (
                  <div className="empty-panel">
                    {keyword.trim() ? '没有匹配的内容。' : '这个状态下没有内容。'}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </aside>

        {showJumpButton ? (
          <div className="admin-scroll-jump-stack">
            <button
              aria-label="一键置顶"
              className="icon-button admin-scroll-top-button"
              onClick={handleScrollToTop}
              title="一键置顶"
              type="button"
            >
              ↑
            </button>
            <button
              aria-label="一键置底"
              className="icon-button admin-scroll-bottom-button"
              onClick={handleScrollToBottom}
              title="一键置底"
              type="button"
            >
              ↓
            </button>
          </div>
        ) : null}

        <section className="review-main review-main-wide stack-gap-lg">
          {activePanel === 'repo' ? (
            <div className="stack-gap-md">
              <div className="form-panel stack-gap-md admin-bulk-review-panel">
                {/* 对齐小剧场审核：一键通过标题 + 计数 + 展开/收起 + 全选。
                 * 折叠内的 field-grid 与操作按钮和 activePanel === 'review' 分支保持一致。 */}
                <div className="content-head admin-bulk-review-head">
                  <div>
                    <strong>一键通过</strong>
                    <span className="content-meta">
                      当前列表待审核 {pendingVisibleRepos.length} 篇，已选{' '}
                      {repoDeleteSelectedIds.length} 篇
                    </span>
                  </div>
                  <div className="inline-actions admin-bulk-review-head-actions">
                    <button
                      className="button secondary admin-bulk-review-head-select-all-button"
                      disabled={repoBusyAction !== null || repoDeleteVisibleIds.length === 0}
                      onClick={
                        isAllRepoVisibleSelected
                          ? handleClearRepoDeleteSelection
                          : handleSelectAllVisibleForRepoDelete
                      }
                      type="button"
                    >
                      {isAllRepoVisibleSelected ? '取消全选' : '全选'}
                    </button>
                    <button
                      className="button ghost"
                      onClick={() => setIsRepoBulkApproveCollapsed((current) => !current)}
                      type="button"
                    >
                      {isRepoBulkApproveCollapsed ? '展开' : '折叠'}
                    </button>
                  </div>
                </div>

                {!isRepoBulkApproveCollapsed ? (
                  <>
                    {/* 复刻小剧场审核：左侧「按作者一键通过」下拉 + 右侧三竖列按钮
                     * (当前待审核 / 通过该作者 / 通过已选)。「通过已选」左侧同样加
                     * 「删除已选」并做二次确认，与小剧场审核保持一致。 */}
                    <div className="field-grid two-columns admin-bulk-review-grid">
                      <label>
                        <span>按作者一键通过</span>
                        <select
                          value={repoBulkAuthorName}
                          onChange={(event) => setRepoBulkAuthorName(event.target.value)}
                        >
                          <option value="">先选作者</option>
                          {pendingRepoAuthorOptions.map((authorName) => (
                            <option key={authorName} value={authorName}>
                              {authorName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="stack-gap-sm admin-bulk-review-actions">
                        <button
                          className="button primary admin-approve-all-button"
                          disabled={repoBusyAction !== null || pendingVisibleRepos.length === 0}
                          onClick={() =>
                            void handleBulkApproveRepos(
                              pendingVisibleRepos.map((repo) => repo.id),
                              '当前列表待审核 repo',
                            )
                          }
                          type="button"
                        >
                          {repoBusyAction === 'approve'
                            ? '处理中'
                            : `通过当前待审核（${pendingVisibleRepos.length}）`}
                        </button>
                        <button
                          className="button primary"
                          disabled={
                            repoBusyAction !== null || selectedAuthorPendingRepoIds.length === 0
                          }
                          onClick={() =>
                            void handleBulkApproveRepos(
                              selectedAuthorPendingRepoIds,
                              `作者 ${repoBulkAuthorName} 的待审核 repo`,
                            )
                          }
                          type="button"
                        >
                          {repoBusyAction === 'approve'
                            ? '处理中'
                            : `通过该作者（${selectedAuthorPendingRepoIds.length}）`}
                        </button>
                        <div className="inline-actions admin-bulk-review-select-actions">
                          <button
                            className="button danger admin-bulk-delete-selected-button"
                            disabled={
                              repoBusyAction !== null ||
                              repoDeleteBusy ||
                              !isRepoMultiSelectMode ||
                              repoDeleteSelectedIds.length === 0
                            }
                            onClick={() =>
                              void handleBatchDeleteRepos(repoDeleteSelectedIds, '已勾选 repo')
                            }
                            type="button"
                          >
                            {repoDeleteBusy
                              ? '删除处理中'
                              : `删除已选（${repoDeleteSelectedIds.length}）`}
                          </button>
                          <button
                            className="button primary"
                            disabled={
                              repoBusyAction !== null ||
                              !isRepoMultiSelectMode ||
                              repoDeleteSelectedIds.length === 0
                            }
                            onClick={() =>
                              void handleBulkApproveRepos(repoDeleteSelectedIds, '已勾选 repo')
                            }
                            type="button"
                          >
                            {repoBusyAction === 'approve'
                              ? '处理中'
                              : `通过已选（${repoDeleteSelectedIds.length}）`}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="inline-actions wrap-mobile">
                      {repoStatusTabs.map((tab) => (
                        <button
                          className={
                            selectedRepoStatus === tab.value ? 'tab-chip active' : 'tab-chip'
                          }
                          key={tab.label}
                          onClick={() => handleRepoStatusTabChange(tab.value)}
                          type="button"
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <label>
                      <span>repo 搜索</span>
                      <ClearableField
                        visible={Boolean(repoKeyword.trim())}
                        onClear={() => setRepoKeyword('')}
                      >
                        <input
                          value={repoKeyword}
                          onChange={(event) => setRepoKeyword(event.target.value)}
                          placeholder="默认从全部 repo 里搜昵称、标题、作者或正文"
                        />
                      </ClearableField>
                    </label>
                    <div
                      className="inline-actions wrap-mobile admin-search-field-row"
                      role="group"
                      aria-label="repo 搜索范围"
                    >
                      {repoSearchFieldOptions.map((item) => (
                        <button
                          aria-pressed={isSearchFieldActive(repoSearchFields, item.value)}
                          className={
                            isSearchFieldActive(repoSearchFields, item.value)
                              ? 'tab-chip active'
                              : 'tab-chip'
                          }
                          key={item.value}
                          onClick={() =>
                            setRepoSearchFields((current) => toggleSearchField(current, item.value))
                          }
                          type="button"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <div className="metric-strip metric-strip-admin metric-strip-admin-responsive">
                      {repoMetrics.map((item) => (
                        <div key={item.label} className="metric-card-lite">
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </div>
                      ))}
                    </div>
                    <label>
                      <span>repo 审核备注</span>
                      <textarea
                        rows={3}
                        value={repoReviewNote}
                        onChange={(event) => setRepoReviewNote(event.target.value)}
                        placeholder="可填写通过或拒绝说明"
                      />
                    </label>
                    {/* 多选控制条：多选 / 全选 / 清空已选。删除已选和通过已选已上移到
                     * 「按作者一键通过」右侧的三竖列按钮里，这里不再重复。 */}
                    <div className="inline-actions admin-search-action-row">
                      <button
                        className={
                          isRepoMultiSelectMode ? 'button secondary active' : 'button secondary'
                        }
                        disabled={repoDeleteBusy}
                        onClick={handleToggleRepoMultiSelectMode}
                        type="button"
                      >
                        多选
                      </button>
                      <button
                        className="button secondary"
                        disabled={
                          repoDeleteBusy ||
                          !isRepoMultiSelectMode ||
                          repoDeleteVisibleIds.length === 0
                        }
                        onClick={handleSelectAllVisibleForRepoDelete}
                        type="button"
                      >
                        全选
                      </button>
                      <button
                        className="button ghost"
                        disabled={
                          repoDeleteBusy ||
                          !isRepoMultiSelectMode ||
                          repoDeleteSelectedIds.length === 0
                        }
                        onClick={handleClearRepoDeleteSelection}
                        type="button"
                      >
                        清空已选
                      </button>
                    </div>
                    {repoDeleteProgress ? (
                      <div className="admin-bulk-review-progress" role="status">
                        <div className="inline-actions wrap-mobile admin-bulk-review-progress-head">
                          <strong>{repoDeleteBusy ? '删除中' : '删除结果'}</strong>
                          <span className="content-meta">
                            {repoDeleteProgress.label} · 已完成 {repoDeleteProgress.completed} /{' '}
                            {repoDeleteProgress.total} 条
                          </span>
                        </div>
                        <div aria-hidden="true" className="admin-bulk-review-progress-track">
                          <div
                            className="admin-bulk-review-progress-fill"
                            style={{
                              width: `${repoDeleteProgress.total === 0 ? 0 : (repoDeleteProgress.completed / repoDeleteProgress.total) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                    {processingMessage && repoDeleteBusy ? (
                      <div className="feedback info">{processingMessage}</div>
                    ) : null}
                    {successMessage ? (
                      <div className="feedback success">{successMessage}</div>
                    ) : null}
                    {error ? <div className="feedback error">{error}</div> : null}
                  </>
                ) : null}
              </div>

              {filteredRepos.length > 0 ? (
                <div className="stack-gap-md">
                  {shouldCollapseMobileRepoList ? (
                    <div className="inline-actions review-list-mobile-toggle-row">
                      <span className="content-meta">
                        手机端先显示前 {MOBILE_REVIEW_LIST_PREVIEW_COUNT} 条，当前“
                        {mobileRepoListLabel}”repo 列表共 {filteredRepos.length} 条
                      </span>
                      <button
                        className="button ghost"
                        onClick={() => setIsMobileRepoExpanded((current) => !current)}
                        type="button"
                      >
                        {isMobileRepoExpanded ? '收起' : '展开'}
                      </button>
                    </div>
                  ) : null}
                  {/* 任务 5：列表在上, 选中条目后详情面板在下 (在 map 后面)。 */}

                  {repoListToRender.map((repo) => {
                    const isRepoSelected = selectedRepoId === repo.id;
                    return (
                      <article
                        className={
                          isRepoSelected
                            ? 'review-card repo-review-card active'
                            : 'review-card repo-review-card'
                        }
                        key={repo.id}
                        onClick={() => {
                          if (isRepoMultiSelectMode) {
                            return;
                          }
                          setSelectedRepoId((current) => (current === repo.id ? '' : repo.id));
                        }}
                      >
                        <div className="content-head wrap-mobile">
                          <div className="stack-gap-xs">
                            {isRepoMultiSelectMode ? (
                              <label
                                className="checkbox-chip review-card-checkbox"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <input
                                  checked={repoDeleteSelectedIdSet.has(repo.id)}
                                  disabled={repoDeleteBusy}
                                  onChange={() => handleToggleRepoDeleteSelection(repo.id)}
                                  type="checkbox"
                                />
                                <span>
                                  {repoDeleteSelectedIdSet.has(repo.id) ? '已选' : '多选删除'}
                                </span>
                              </label>
                            ) : null}
                            <span className={`status-tag ${repo.status}`}>
                              {repoStatusLabelMap[repo.status]}
                            </span>
                            <strong>{repo.nickname}</strong>
                            <span className="content-meta">
                              《{repo.playTitle ?? repo.playId}》 ·{' '}
                              {new Date(repo.createdAt).toLocaleString('zh-CN')}
                            </span>
                            {repo.replyToNickname ? (
                              <span className="content-meta">回复 {repo.replyToNickname}</span>
                            ) : null}
                          </div>
                          <div className="inline-actions wrap-mobile repo-action-row">
                            {repoActionMeta.map((item, index) => (
                              <Fragment key={item.action}>
                                <button
                                  className={
                                    item.action === 'reject'
                                      ? 'button danger repo-reject-button'
                                      : item.action === 'approve'
                                        ? 'button primary repo-approve-button'
                                        : `button ${item.style}`
                                  }
                                  disabled={repoBusyAction !== null}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleRepoReview(repo.id, item.action);
                                  }}
                                  type="button"
                                >
                                  {repoBusyAction === item.action ? '处理中' : item.label}
                                </button>
                                {index === 0 ? (
                                  <button
                                    className="button warning repo-delete-single-button"
                                    disabled={repoBusyAction !== null}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleRepoDelete(repo.id);
                                    }}
                                    type="button"
                                  >
                                    {repoBusyAction === 'delete' ? '处理中' : '删除'}
                                  </button>
                                ) : null}
                              </Fragment>
                            ))}
                          </div>
                        </div>
                        <p>{repo.content}</p>
                        {repo.reviewNote ? (
                          <p className="sub-copy">审核备注：{repo.reviewNote}</p>
                        ) : null}
                        <div className="content-meta">
                          {isRepoSelected ? '正在编辑这条 repo' : '单击查看详情与编辑'}
                        </div>
                      </article>
                    );
                  })}

                  {selectedRepo ? (
                    <section className="form-panel stack-gap-md admin-review-detail-panel">
                      {/* 与小剧场审核完全对齐：上半行 = admin-review-mode-line,
                       * 左半 = admin-mode-lefthalf (查看模式 + 3 个 tab-chip),
                       * 右半 = admin-mode-righthalf (repo 没有"上一篇/下一篇"也不展示 diff,
                       * 但容器结构保持一致)。 */}
                      <div className="admin-review-mode-line">
                        <div className="inline-actions wrap-mobile admin-review-view-mode-row admin-mode-lefthalf">
                          <span className="content-meta">查看模式</span>
                          <button
                            className={adminViewMode === 'preview' ? 'tab-chip active' : 'tab-chip'}
                            onClick={() => setAdminViewMode('preview')}
                            type="button"
                          >
                            仅预览
                          </button>
                          <button
                            className={adminViewMode === 'edit' ? 'tab-chip active' : 'tab-chip'}
                            onClick={() => setAdminViewMode('edit')}
                            type="button"
                          >
                            仅编辑
                          </button>
                          <button
                            className={adminViewMode === 'both' ? 'tab-chip active' : 'tab-chip'}
                            onClick={() => setAdminViewMode('both')}
                            type="button"
                          >
                            编辑 + 预览
                          </button>
                        </div>
                        {/* 右半空壳：与小剧场审核的 admin-mode-righthalf 容器结构对齐,
                         * repo 没有"上一篇/下一篇"按钮,留空壳保持两半布局。 */}
                        <div className="inline-actions admin-adjacent-row admin-mode-righthalf" />
                      </div>

                      <div
                        className={
                          adminViewMode === 'preview'
                            ? 'admin-review-detail-grid admin-review-detail-grid-preview'
                            : adminViewMode === 'edit'
                              ? 'admin-review-detail-grid admin-review-detail-grid-edit'
                              : 'admin-review-detail-grid admin-review-detail-grid-both'
                        }
                      >
                        {adminViewMode !== 'edit' ? (
                          <div className="detail-panel stack-gap-md admin-review-detail-preview">
                            <div className="card-topline">
                              <span className={`status-tag ${selectedRepo.status}`}>
                                {repoStatusLabelMap[selectedRepo.status]}
                              </span>
                              <span>{selectedRepo.playTitle ?? selectedRepo.playId}</span>
                            </div>
                            <div className="preview-section-header">
                              <strong>{selectedRepo.nickname}</strong>
                              <span className="content-meta">
                                {new Date(selectedRepo.createdAt).toLocaleString('zh-CN')}
                              </span>
                            </div>
                            {selectedRepo.replyToNickname ? (
                              <p className="sub-copy">回复 {selectedRepo.replyToNickname}</p>
                            ) : null}
                            <div className="inline-detail-block stack-gap-md preview-content-block">
                              <div className="preview-section-header">
                                <span className="content-meta">
                                  正文约 {selectedRepo.content.length} 字
                                </span>
                              </div>
                              <p className="admin-review-detail-content">{selectedRepo.content}</p>
                            </div>
                            {selectedRepo.reviewNote ? (
                              <p className="sub-copy">审核备注：{selectedRepo.reviewNote}</p>
                            ) : null}
                          </div>
                        ) : null}

                        {adminViewMode !== 'preview' ? (
                          <div className="detail-panel stack-gap-md admin-review-detail-edit">
                            <div className="preview-section-header">
                              <strong>编辑 repo</strong>
                              <span className="content-meta">
                                原 {selectedRepo.content.length} 字
                              </span>
                            </div>
                            <label className="stack-gap-xs">
                              <span>repo 正文</span>
                              <textarea
                                disabled={repoEditBusy || repoBusyAction !== null}
                                onChange={(event) => setRepoEditContentDraft(event.target.value)}
                                rows={6}
                                value={repoEditContentDraft}
                              />
                            </label>
                            <label className="stack-gap-xs">
                              <span>审核备注</span>
                              <textarea
                                disabled={repoEditBusy || repoBusyAction !== null}
                                onChange={(event) => setRepoEditNoteDraft(event.target.value)}
                                placeholder="可写空，会清空原备注"
                                rows={3}
                                value={repoEditNoteDraft}
                              />
                            </label>
                          </div>
                        ) : null}
                      </div>

                      {/* 底部动作行：删除 / 拒绝 / 保存 / 通过。
                       * 把保存按钮从原"仅编辑"模式独立区域移到此处, 与拒绝/删除/通过同行,
                       * 顺序从左到右: 删除 → 拒绝 → 保存 → 通过。
                       * 当草稿等于原始内容/备注时保存按钮 disabled，避免误点。 */}
                      <div className="inline-actions wrap-mobile repo-action-row admin-review-detail-action-row">
                        <button
                          className="button warning repo-delete-single-button"
                          disabled={repoBusyAction !== null || repoEditBusy}
                          onClick={() => void handleRepoDelete(selectedRepo.id)}
                          type="button"
                        >
                          {repoBusyAction === 'delete' ? '处理中' : '删除'}
                        </button>
                        <button
                          className="button danger repo-reject-button"
                          disabled={repoBusyAction !== null || repoEditBusy}
                          onClick={() => void handleRepoReview(selectedRepo.id, 'reject')}
                          type="button"
                        >
                          {repoBusyAction === 'reject' ? '处理中' : '拒绝'}
                        </button>
                        <button
                          className="button primary admin-review-detail-save-button"
                          disabled={
                            repoBusyAction !== null ||
                            repoEditBusy ||
                            repoEditContentDraft.trim().length === 0 ||
                            (repoEditContentDraft === selectedRepo.content &&
                              repoEditNoteDraft === (selectedRepo.reviewNote ?? ''))
                          }
                          onClick={() => void handleSaveRepoEdit()}
                          type="button"
                        >
                          {repoEditBusy ? '保存中' : '保存'}
                        </button>
                        <button
                          className="button primary repo-approve-button"
                          disabled={repoBusyAction !== null || repoEditBusy}
                          onClick={() => void handleRepoReview(selectedRepo.id, 'approve')}
                          type="button"
                        >
                          {repoBusyAction === 'approve' ? '处理中' : '通过'}
                        </button>
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : (
                <div className="empty-panel">
                  {repoKeyword.trim() ? '没有匹配的 repo。' : '当前筛选没有 repo。'}
                </div>
              )}
            </div>
          ) : null}

          {activePanel === 'auditLogs' ? (
            <section className="stack-gap-md">
              <div className="form-panel stack-gap-md">
                <div className="content-head wrap-mobile">
                  <div>
                    <h3>审核记录</h3>
                    <p className="sub-copy">
                      这里展示全部审核记录，不受左侧当前筛选、当前选中内容和 repo 状态筛选影响。
                    </p>
                  </div>
                  <span className="content-meta">
                    小剧场 {allPlayReviewLogs.length} 条 · repo {allRepoAuditLogs.length} 条
                  </span>
                </div>
                <div className="inline-actions wrap-mobile">
                  {auditLogTabs.map((tab) => (
                    <button
                      key={tab.value}
                      className={
                        selectedAuditLogCategory === tab.value ? 'tab-chip active' : 'tab-chip'
                      }
                      onClick={() => setSelectedAuditLogCategory(tab.value)}
                      type="button"
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {shouldCollapseMobileAuditLogs ? (
                <div className="inline-actions review-list-mobile-toggle-row">
                  <span className="content-meta">
                    手机端先显示前 {MOBILE_AUDIT_LOG_PREVIEW_COUNT} 条，当前“
                    {selectedAuditLogCategory === 'plays' ? '小剧场' : 'repo'}”记录共{' '}
                    {activeAuditLogs.length} 条
                  </span>
                  <button
                    className="button ghost"
                    onClick={() => setIsMobileAuditLogsExpanded((current) => !current)}
                    type="button"
                  >
                    {isMobileAuditLogsExpanded ? '收起' : '展开'}
                  </button>
                </div>
              ) : null}

              {auditLogsLoading ? (
                <div className="empty-panel">正在加载审核记录…</div>
              ) : visibleAuditLogs.length > 0 ? (
                <div className="log-list">
                  {selectedAuditLogCategory === 'plays'
                    ? (visibleAuditLogs as ReviewLog[]).map((log) => (
                        <article key={log.id} className="detail-panel log-item">
                          <strong>{log.operator}</strong>
                          <span>
                            {reviewActionLabelMap[log.action]} · {formatAuditLogTime(log.createdAt)}
                          </span>
                          {log.playTitle ? (
                            <span>小剧场：《{log.playTitle}》</span>
                          ) : (
                            <span>小剧场 ID：{log.playId}</span>
                          )}
                          <p>{log.note}</p>
                        </article>
                      ))
                    : (visibleAuditLogs as RepoAuditLog[]).map((log) => (
                        <article key={log.id} className="detail-panel log-item">
                          <strong>{log.operator}</strong>
                          <span>
                            {repoAuditActionLabelMap[log.action]} ·{' '}
                            {formatAuditLogTime(log.createdAt)}
                          </span>
                          {log.playTitle ? (
                            <span>小剧场：《{log.playTitle}》</span>
                          ) : (
                            <span>小剧场 ID：{log.playId}</span>
                          )}
                          {log.nickname ? (
                            <span>repo 昵称：{log.nickname}</span>
                          ) : (
                            <span>repo ID：{log.repoId}</span>
                          )}
                          <p>{log.note}</p>
                        </article>
                      ))}
                </div>
              ) : (
                <div className="empty-panel">
                  当前还没有{selectedAuditLogCategory === 'plays' ? '小剧场' : 'repo'}审核记录。
                </div>
              )}
            </section>
          ) : null}

          {activePanel === 'review' ? (
            selectedPlay ? (
              <>
                <div className="admin-review-mode-line">
                  <div className="inline-actions wrap-mobile admin-review-view-mode-row admin-mode-lefthalf">
                    <span className="content-meta">查看模式</span>
                    <button
                      className={adminViewMode === 'preview' ? 'tab-chip active' : 'tab-chip'}
                      onClick={() => setAdminViewMode('preview')}
                      type="button"
                    >
                      仅预览
                    </button>
                    <button
                      className={adminViewMode === 'edit' ? 'tab-chip active' : 'tab-chip'}
                      onClick={() => setAdminViewMode('edit')}
                      type="button"
                    >
                      仅编辑
                    </button>
                    <button
                      className={adminViewMode === 'both' ? 'tab-chip active' : 'tab-chip'}
                      onClick={() => setAdminViewMode('both')}
                      type="button"
                    >
                      编辑 + 预览
                    </button>
                  </div>
                  <div className="inline-actions admin-adjacent-row admin-mode-righthalf">
                    {previousSubmission ? (
                      <>
                        <div
                          className="inline-actions admin-diff-range-group"
                          role="group"
                          aria-label="差异展示范围"
                        >
                          {(
                            [
                              { value: 'changed', label: '有改动' },
                              { value: 'unchanged', label: '无改动' },
                              { value: 'all', label: '全部' },
                            ] as Array<{ value: AdminReviewDiffRange; label: string }>
                          ).map((option) => (
                            <button
                              key={option.value}
                              className={
                                diffRange === option.value ? 'tab-chip active' : 'tab-chip'
                              }
                              onClick={() => {
                                setDiffRange(option.value);
                                setAdminReviewDiffRange(option.value);
                                if (option.value === 'changed') {
                                  setDiffFlat(true);
                                  setAdminReviewDiffFlat(true);
                                }
                              }}
                              type="button"
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                        <label className="detail-version-flat-toggle admin-diff-flat-toggle">
                          <input
                            checked={diffFlat}
                            onChange={(event) => {
                              const next = event.target.checked;
                              setDiffFlat(next);
                              setAdminReviewDiffFlat(next);
                            }}
                            type="checkbox"
                          />
                          <span>依次排开</span>
                        </label>
                      </>
                    ) : null}
                    <button
                      className="button secondary admin-mode-adjacent-button"
                      disabled={!adminPrevPlayId}
                      onClick={() => selectAdminPlayById(adminPrevPlayId)}
                      type="button"
                    >
                      上一篇
                    </button>
                    <button
                      className="button secondary admin-mode-adjacent-button"
                      disabled={!adminNextPlayId}
                      onClick={() => selectAdminPlayById(adminNextPlayId)}
                      type="button"
                    >
                      下一篇
                    </button>
                  </div>
                </div>

                {adminViewMode !== 'edit' ? (
                  <div className="detail-panel stack-gap-md">
                    <div className="card-topline">
                      <span className={`status-tag ${selectedPlay.status}`}>
                        {statusLabelMap[selectedPlay.status]}
                      </span>
                      <span>{selectedPlay.category || DEFAULT_CATEGORY}</span>
                    </div>
                    <div className="preview-section-header">
                      <h3>{selectedPlay.title}</h3>
                      <button
                        type="button"
                        className="preview-copy-btn"
                        title="复制标题"
                        aria-label="复制标题"
                        onClick={() => {
                          void copyToClipboard(selectedPlay.title, '标题');
                        }}
                      >
                        <i className="fas fa-copy" />
                      </button>
                    </div>
                    {selectedPlay.summary ? (
                      <p className="sub-copy">{selectedPlay.summary}</p>
                    ) : null}
                    <div className="inline-detail-block stack-gap-md preview-content-block">
                      <div className="preview-section-header">
                        <span className="content-meta">
                          正文约 {selectedPlay.content.length} 字
                        </span>
                        <button
                          type="button"
                          className="preview-copy-btn"
                          title="复制正文"
                          aria-label="复制正文"
                          onClick={() => {
                            void copyToClipboard(selectedPlay.content, '正文');
                          }}
                        >
                          <i className="fas fa-copy" />
                        </button>
                      </div>
                      <p>{selectedPlay.content}</p>
                    </div>
                    {selectedPlay.status !== 'pending' && selectedPlay.reviewNote ? (
                      <div className="stack-gap-sm">
                        <span className="content-meta">审核备注</span>
                        <p className="sub-copy">{selectedPlay.reviewNote}</p>
                      </div>
                    ) : null}
                    <div className="meta-row">
                      <span>作者 {selectedPlay.authorName}</span>
                      <span>创建于 {new Date(selectedPlay.createdAt).toLocaleString('zh-CN')}</span>
                      {selectedPlay.reviewedAt ? (
                        <span>
                          审核于 {new Date(selectedPlay.reviewedAt).toLocaleString('zh-CN')}
                        </span>
                      ) : null}
                    </div>
                    {/* 「本次投稿类型」:独立面板,根据作者上传的 submissionType 直接判定,
                     * 与上下版 diff 互不干扰。无 previousSubmission 时也照常显示。 */}
                    <div className="stack-gap-md review-submission-type-panel">
                      <div className="content-head">
                        <div>
                          <h3>本次投稿类型</h3>
                        </div>
                        {submissionTypeBadge ? (
                          <span
                            className={
                              submissionTypeBadge.tone === 'derived'
                                ? 'status-tag derived'
                                : submissionTypeBadge.tone === 'approved'
                                  ? 'status-tag approved'
                                  : 'status-tag pending'
                            }
                          >
                            {submissionTypeBadge.label}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* 「作者提交的修改」:仅当 selectedPlay.pendingEdit 存在时出现,
                     * 以 selectedPlay(原 play) 的字段作为「当前」,以 pendingEdit
                     * 作为「待改为」。审核 approve 时合入 + 同系列跟随,
                     * reject/offline 时清空。 */}
                    {selectedPlay.pendingEdit ? (
                      <div className="stack-gap-md review-pending-edit-panel">
                        <div className="content-head">
                          <h3>作者提交的修改</h3>
                          <span className="content-meta">
                            {`作者于 ${new Date(selectedPlay.pendingEdit.submittedAt).toLocaleString('zh-CN')} 就地发起的修改,不会创建新版本`}
                          </span>
                        </div>
                        <div className="stack-gap-sm">
                          <div className="diff-card">
                            <strong>标题</strong>
                            <p>
                              <span className="content-meta">当前：</span>
                              {selectedPlay.title}
                              {selectedPlay.pendingEdit.title !== selectedPlay.title ? (
                                <>
                                  <span className="content-meta"> / 待改为：</span>
                                  <strong>{selectedPlay.pendingEdit.title}</strong>
                                </>
                              ) : null}
                            </p>
                          </div>
                          <div className="diff-card">
                            <strong>分类</strong>
                            <p>
                              <span className="content-meta">当前：</span>
                              {selectedPlay.category}
                              {selectedPlay.pendingEdit.category !== selectedPlay.category ? (
                                <>
                                  <span className="content-meta"> / 待改为：</span>
                                  <strong>{selectedPlay.pendingEdit.category}</strong>
                                </>
                              ) : null}
                            </p>
                          </div>
                          <div className="diff-card">
                            <strong>署名</strong>
                            <p>
                              <span className="content-meta">当前：</span>
                              {selectedPlay.authorName}
                              {selectedPlay.pendingEdit.authorName !== selectedPlay.authorName ? (
                                <>
                                  <span className="content-meta"> / 待改为：</span>
                                  <strong>{selectedPlay.pendingEdit.authorName}</strong>
                                </>
                              ) : null}
                            </p>
                          </div>
                          <div className="diff-card">
                            <strong>简介</strong>
                            <p>{selectedPlay.pendingEdit.summary}</p>
                          </div>
                          <div className="diff-card">
                            <strong>正文</strong>
                            <p style={{ whiteSpace: 'pre-wrap' }}>
                              {selectedPlay.pendingEdit.content}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {/* 「与上一版文本对比」:独立面板,只有存在 previousSubmission 才显示。
                     * 与「本次投稿类型」完全分离,不再混入「修改/新增衍生」判断。 */}
                    {previousSubmission ? (
                      <div className="stack-gap-md diff-panel">
                        <div className="content-head">
                          <h3>与上一版文本对比</h3>
                        </div>
                        <div className="inline-actions wrap-mobile diff-chip-row">
                          {submissionDiffItems.map((item) => (
                            <span
                              key={item.label}
                              className={
                                item.changed ? 'status-tag approved' : 'status-tag offline'
                              }
                            >
                              {item.label}
                              {item.changed ? ' 已改' : ' 未改'}
                            </span>
                          ))}
                        </div>
                        <div className="stack-gap-sm">
                          {submissionDiffItems
                            .filter((item) => {
                              if (diffRange === 'changed') return item.changed;
                              if (diffRange === 'unchanged') return !item.changed;
                              return true;
                            })
                            .map((item) => {
                              /* diffFlat = true：像详情页平铺一样，上下两栏依次排开原文/新版，
                               *              不做红绿差异标记；
                               * diffFlat = false：单栏词级 diff，红色删除、绿色新增。 */
                              if (diffFlat) {
                                return (
                                  <article className="diff-card" key={item.label}>
                                    <strong>{item.label}</strong>
                                    <div className="stack-gap-sm admin-diff-flat-body">
                                      <div className="admin-diff-flat-row">
                                        <div className="admin-diff-flat-row-head">
                                          <span className="content-meta">上一版</span>
                                          <button
                                            type="button"
                                            className="preview-copy-btn admin-diff-flat-copy-btn"
                                            title={`复制上一版${item.label}`}
                                            aria-label={`复制上一版${item.label}`}
                                            onClick={() => {
                                              void copyToClipboard(
                                                item.before,
                                                `上一版${item.label}`,
                                              );
                                            }}
                                          >
                                            <i className="fas fa-copy" />
                                          </button>
                                        </div>
                                        <p>{item.before || '（空）'}</p>
                                      </div>
                                      <div className="admin-diff-flat-row">
                                        <div className="admin-diff-flat-row-head">
                                          <span className="content-meta">当前版本</span>
                                          <button
                                            type="button"
                                            className="preview-copy-btn admin-diff-flat-copy-btn"
                                            title={`复制当前版本${item.label}`}
                                            aria-label={`复制当前版本${item.label}`}
                                            onClick={() => {
                                              void copyToClipboard(
                                                item.after,
                                                `当前版本${item.label}`,
                                              );
                                            }}
                                          >
                                            <i className="fas fa-copy" />
                                          </button>
                                        </div>
                                        <p>{item.after || '（空）'}</p>
                                      </div>
                                    </div>
                                  </article>
                                );
                              }
                              const segments = renderDiffSegments(
                                buildUnitDiff(item.before, item.after),
                              );
                              return (
                                <article className="diff-card" key={item.label}>
                                  <strong>{item.label}</strong>
                                  <div className="diff-copy-row">
                                    <p>{item.before || item.after ? segments : '（空）'}</p>
                                  </div>
                                </article>
                              );
                            })}
                        </div>
                      </div>
                    ) : null}
                    {adminViewMode === 'preview' ? (
                      <div className="action-bar split-actions review-action-layout">
                        <div className="inline-actions review-action-row">
                          {actionMeta.map((item) => (
                            <button
                              key={item.action}
                              className={`button ${item.tone} review-primary-action-button`}
                              disabled={reviewMutationBusy}
                              onClick={() => void handleReview(item.action)}
                              type="button"
                            >
                              {reviewBusyAction === item.action ? '正在处理' : item.label}
                            </button>
                          ))}
                          <button
                            className="button warning review-delete-action-button"
                            disabled={reviewMutationBusy}
                            onClick={() => void handleDeletePlay()}
                            type="button"
                          >
                            {reviewBusyAction === 'delete' ? '正在处理' : '删除'}
                          </button>
                        </div>
                        {feedbackScope === 'review' && processingMessage ? (
                          <div className="feedback info">{processingMessage}</div>
                        ) : null}
                        {feedbackScope === 'review' && successMessage ? (
                          <div className="feedback success">{successMessage}</div>
                        ) : null}
                        {feedbackScope === 'review' && error ? (
                          <div className="feedback error">{error}</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {adminViewMode !== 'preview' ? (
                  <>
                    <div className="form-panel stack-gap-md">
                      <div className="stack-gap-sm">
                        <span className="content-meta">
                          管理员可修改标题、作者、分类、简介和正文；审核后也可以继续保存修改。
                        </span>
                      </div>
                      <label>
                        <span>标题</span>
                        <input
                          value={reviewTitle}
                          onChange={(event) => setReviewTitle(event.target.value)}
                          placeholder="标题不能为空"
                        />
                      </label>
                      <label>
                        <span>作者</span>
                        <input
                          value={reviewAuthorName}
                          onChange={(event) => setReviewAuthorName(event.target.value)}
                          placeholder="作者不能为空"
                        />
                      </label>
                      <label>
                        <span>分类</span>
                        <input
                          value={reviewCategory}
                          onChange={(event) => setReviewCategory(event.target.value)}
                          placeholder={DEFAULT_CATEGORY}
                        />
                      </label>
                      <label>
                        <span>简介（可空）</span>
                        <input
                          value={reviewSummary}
                          onChange={(event) => setReviewSummary(event.target.value)}
                          placeholder="留空则前台不展示简介"
                        />
                      </label>
                      <label>
                        <span>正文</span>
                        <textarea
                          ref={reviewContentRef}
                          className="admin-review-content-textarea"
                          value={reviewContent}
                          onChange={(event) => setReviewContent(event.target.value)}
                          placeholder="审核时可直接修正正文后再发布"
                        />
                      </label>
                      <label>
                        <span>审核备注</span>
                        <textarea
                          rows={4}
                          value={reviewNote}
                          onChange={(event) => setReviewNote(event.target.value)}
                          placeholder="可填写通过原因、拒绝原因或下线说明"
                        />
                      </label>

                      {/* 追加衍生版本:仅对已通过条目开放。
                       * 每按一次"衍生"追加一版,填简介 + 内容;
                       * 提交时会依次上传并自动通过,前台列表页按同标题+分类聚合。 */}
                      {selectedPlay?.status === 'approved' ? (
                        <div className="stack-gap-sm admin-derived-section">
                          <div className="stack-gap-sm">
                            <span className="content-meta">
                              追加衍生版本:与本篇共享作者/标题/分类,提交后会自动通过并出现在前台"衍生"聚合里。
                            </span>
                          </div>
                          {derivedDrafts.map((draft, index) => (
                            <div className="upload-derived-block stack-gap-sm" key={draft.id}>
                              <div className="upload-derived-head">
                                <strong>{`衍生版本 ${index + 1}`}</strong>
                                <button
                                  className="text-button"
                                  disabled={derivedSubmitting}
                                  onClick={() => removeAdminDerivedDraft(draft.id)}
                                  type="button"
                                >
                                  删除该版本
                                </button>
                              </div>
                              <label>
                                <span>简介(可空)</span>
                                <input
                                  value={draft.summary}
                                  onChange={(event) =>
                                    updateAdminDerivedDraft(draft.id, {
                                      summary: event.target.value,
                                    })
                                  }
                                  placeholder="留空则前台不展示简介"
                                />
                              </label>
                              <label>
                                <span>正文</span>
                                <textarea
                                  rows={8}
                                  value={draft.content}
                                  onChange={(event) =>
                                    updateAdminDerivedDraft(draft.id, {
                                      content: event.target.value,
                                    })
                                  }
                                  placeholder="写下这一版本的正文"
                                />
                              </label>
                            </div>
                          ))}
                          <div className="inline-actions wrap-mobile admin-derived-action-row">
                            <button
                              className="button secondary"
                              disabled={derivedSubmitting}
                              onClick={addAdminDerivedDraft}
                              type="button"
                            >
                              衍生
                            </button>
                            {derivedDrafts.length > 0 ? (
                              <button
                                className="button primary"
                                disabled={
                                  derivedSubmitting ||
                                  derivedDrafts.every((draft) => !draft.content.trim())
                                }
                                onClick={() => void handleSubmitDerivedDrafts()}
                                type="button"
                              >
                                {derivedSubmitting
                                  ? '提交中'
                                  : `提交并通过（${derivedDrafts.length} 版）`}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      <div className="action-bar split-actions review-action-layout">
                        <div className="inline-actions review-action-row">
                          {actionMeta.map((item) => (
                            <button
                              key={item.action}
                              className={`button ${item.tone} review-primary-action-button`}
                              disabled={reviewMutationBusy}
                              onClick={() => void handleReview(item.action)}
                              type="button"
                            >
                              {reviewBusyAction === item.action ? '正在处理' : item.label}
                            </button>
                          ))}
                          <button
                            className="button secondary review-save-action-button"
                            disabled={reviewMutationBusy}
                            onClick={() => void handleSaveAdminEdit()}
                            type="button"
                          >
                            {reviewBusyAction === 'save' ? '保存中' : '保存'}
                          </button>
                          <button
                            className="button warning review-delete-action-button"
                            disabled={reviewMutationBusy}
                            onClick={() => void handleDeletePlay()}
                            type="button"
                          >
                            {reviewBusyAction === 'delete' ? '正在处理' : '删除'}
                          </button>
                        </div>
                      </div>
                      {feedbackScope === 'review' && processingMessage ? (
                        <div className="feedback info">{processingMessage}</div>
                      ) : null}
                      {feedbackScope === 'review' && successMessage ? (
                        <div className="feedback success">{successMessage}</div>
                      ) : null}
                      {feedbackScope === 'review' && error ? (
                        <div className="feedback error">{error}</div>
                      ) : null}
                    </div>

                    <div className="log-panel stack-gap-md">
                      <div className="content-head">
                        <h3>审核记录</h3>
                        <div className="inline-actions wrap-mobile review-log-head-row">
                          <span className="content-meta">
                            共 {reviewLogs.length} 条，跨设备同步
                          </span>
                          {reviewLogs.length > 0 ? (
                            <button
                              className="button ghost review-log-action-button"
                              onClick={() => void handleClearReviewLogs()}
                              type="button"
                            >
                              清空
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {reviewLogs.length > 0 ? (
                        <div className="log-list">
                          {reviewLogs.map((log) => (
                            <article key={log.id} className="log-item">
                              <strong>{log.operator}</strong>
                              <span>
                                {reviewActionLabelMap[log.action]} ·{' '}
                                {new Date(log.createdAt).toLocaleString('zh-CN')}
                              </span>
                              {log.playTitle ? <span>小剧场：《{log.playTitle}》</span> : null}
                              <p>{log.note}</p>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-panel">当前内容还没有审核记录。</div>
                      )}
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <div className="empty-panel">
                {isMobileReviewViewport ? '先从上面选择一篇内容。' : '先从左侧选择一篇内容。'}
              </div>
            )
          ) : null}

          {activePanel === 'delete' ? (
            <section className="stack-gap-lg">
              <div className="form-panel stack-gap-md">
                <div className="content-head">
                  <div>
                    <p className="eyebrow">Bulk Delete</p>
                    <h3>批量删除</h3>
                    <p className="sub-copy">
                      删除作用域基于左侧当前列表，也就是当前状态筛选和关键词筛选后的结果。
                    </p>
                  </div>
                </div>

                <div className="duplicate-toolbar-grid">
                  <div className="duplicate-summary-card stack-gap-sm">
                    <span>当前列表</span>
                    <strong>{filteredPlays.length} 篇</strong>
                    <span className="content-meta">
                      删除面板里的“删除全部 / 删除前 x 条 / 按作者删除”都以这里为准。
                    </span>
                  </div>
                  <div className="duplicate-summary-card stack-gap-sm">
                    <span>已多选</span>
                    <strong>{deleteSelectedIds.length} 篇</strong>
                    <span className="content-meta">左侧卡片会切换成“多选删除”。</span>
                  </div>
                  <div className="duplicate-summary-card stack-gap-sm">
                    <span>作者数</span>
                    <strong>{deleteAuthorOptions.length} 位</strong>
                    <span className="content-meta">可按当前列表中的某位作者整批删除。</span>
                  </div>
                </div>

                {deleteProgress ? (
                  <div className="admin-bulk-review-progress" role="status">
                    <div className="inline-actions wrap-mobile admin-bulk-review-progress-head">
                      <strong>{deleteBusy ? '删除中' : '删除结果'}</strong>
                      <span className="content-meta">
                        {deleteProgress.label} · 已完成 {deleteProgress.completed} /{' '}
                        {deleteProgress.total} 篇
                      </span>
                    </div>
                    <div aria-hidden="true" className="admin-bulk-review-progress-track">
                      <div
                        className="admin-bulk-review-progress-fill"
                        style={{
                          width: `${deleteProgress.total === 0 ? 0 : (deleteProgress.completed / deleteProgress.total) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
                {feedbackScope === 'delete' && processingMessage ? (
                  <div className="feedback info">{processingMessage}</div>
                ) : null}
                {feedbackScope === 'delete' && successMessage ? (
                  <div className="feedback success">{successMessage}</div>
                ) : null}
                {feedbackScope === 'delete' && error ? (
                  <div className="feedback error">{error}</div>
                ) : null}

                <div className="inline-actions wrap-mobile admin-bulk-review-row">
                  <button
                    className="button secondary"
                    disabled={reviewMutationBusy || deleteVisibleIds.length === 0}
                    onClick={handleSelectAllVisibleForDelete}
                    type="button"
                  >
                    全选当前列表
                  </button>
                  <button
                    className="button secondary"
                    disabled={reviewMutationBusy || deleteVisibleIds.length === 0}
                    onClick={handleInvertDeleteSelection}
                    type="button"
                  >
                    反选
                  </button>
                  <label className="admin-bulk-review-top-count">
                    <span>删除前</span>
                    <input
                      inputMode="numeric"
                      min="1"
                      onChange={(event) =>
                        setDeleteSelectCountInput(event.target.value.replace(/\D+/g, ''))
                      }
                      placeholder="x"
                      value={deleteSelectCountInput}
                    />
                    <span>条</span>
                  </label>
                  <button
                    className="button secondary"
                    disabled={
                      reviewMutationBusy || deleteSelectCount <= 0 || deleteVisibleIds.length === 0
                    }
                    onClick={handleSelectTopVisibleForDelete}
                    type="button"
                  >
                    选中前 {deleteSelectCount > 0 ? deleteSelectCount : 'x'} 条
                  </button>
                  <button
                    className="button ghost"
                    disabled={reviewMutationBusy || deleteSelectedIds.length === 0}
                    onClick={handleClearDeleteSelection}
                    type="button"
                  >
                    清空已选
                  </button>
                </div>

                <div className="field-grid two-columns admin-bulk-review-grid">
                  <label>
                    <span>按作者删除</span>
                    <select
                      value={deleteAuthorName}
                      onChange={(event) => setDeleteAuthorName(event.target.value)}
                    >
                      <option value="">先选作者</option>
                      {deleteAuthorOptions.map((authorName) => (
                        <option key={authorName} value={authorName}>
                          {authorName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="stack-gap-sm admin-bulk-review-actions">
                    <button
                      className="button danger"
                      disabled={reviewMutationBusy || deleteVisibleIds.length === 0}
                      onClick={() => void handleBatchDelete(deleteVisibleIds, '当前列表全部内容')}
                      type="button"
                    >
                      {deleteBusy ? '删除处理中' : `删除当前列表全部（${deleteVisibleIds.length}）`}
                    </button>
                    <button
                      className="button danger"
                      disabled={reviewMutationBusy || selectedAuthorDeleteIds.length === 0}
                      onClick={() =>
                        void handleBatchDelete(
                          selectedAuthorDeleteIds,
                          `作者 ${deleteAuthorName} 的内容`,
                        )
                      }
                      type="button"
                    >
                      {deleteBusy
                        ? '删除处理中'
                        : `删除该作者（${selectedAuthorDeleteIds.length}）`}
                    </button>
                    <button
                      className="button danger"
                      disabled={reviewMutationBusy || deleteSelectedIds.length === 0}
                      onClick={() => void handleBatchDelete(deleteSelectedIds, '已勾选内容')}
                      type="button"
                    >
                      {deleteBusy ? '删除处理中' : `删除已选（${deleteSelectedIds.length}）`}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {activePanel === 'moveCategory' ? (
            <section className="stack-gap-lg">
              <div className="form-panel stack-gap-md">
                <div className="content-head">
                  <div>
                    <p className="eyebrow">Bulk Move Category</p>
                    <h3>批量移动分类</h3>
                    <p className="sub-copy">
                      勾选一个或多个源分类，把其中已加载的全部小剧场整体移动到目标分类（留空代表未分类）。仅在已加载全部
                      plays 后可用，第一次进入会自动加载。
                    </p>
                  </div>
                </div>

                {!hasLoadedAllPlays ? (
                  <div className="feedback info">正在加载全部小剧场数据，请稍候…</div>
                ) : (
                  <>
                    <div className="stack-gap-sm">
                      <strong>源分类</strong>
                      <span className="content-meta">
                        当前已加载 {allPlays.length} 篇，共 {moveCategoryStats.length} 个分类
                      </span>
                    </div>
                    <div className="plaza-export-modal-list">
                      {moveCategoryStats.map((item) => {
                        const checked = moveSourceCategories.includes(item.name);
                        return (
                          <label
                            className="checkbox-chip checkbox-chip-wide plaza-export-modal-option"
                            key={item.name}
                          >
                            <input
                              checked={checked}
                              onChange={() =>
                                setMoveSourceCategories((current) =>
                                  current.includes(item.name)
                                    ? current.filter((value) => value !== item.name)
                                    : [...current, item.name],
                                )
                              }
                              type="checkbox"
                            />
                            <span>
                              {item.name} · {item.count} 篇
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="stack-gap-sm">
                      <strong>目标分类</strong>
                      <span className="content-meta">
                        留空则归入「未分类」（{DEFAULT_CATEGORY}）
                      </span>
                    </div>
                    <SearchableCategorySelect
                      options={moveCategoryStats.map((item) => item.name)}
                      placeholder={DEFAULT_CATEGORY}
                      value={moveTargetCategory}
                      onChange={setMoveTargetCategory}
                    />

                    <div className="inline-actions wrap-mobile">
                      <button
                        className="button primary"
                        disabled={moveCategoryBusy || moveCategoryTargetIds.length === 0}
                        onClick={() => void handleBulkMoveCategory()}
                        type="button"
                      >
                        {moveCategoryBusy
                          ? '移动中…'
                          : `移动 ${moveCategoryTargetIds.length} 篇到「${moveTargetCategory.trim() || DEFAULT_CATEGORY}」`}
                      </button>
                      <button
                        className="button ghost"
                        disabled={moveCategoryBusy}
                        onClick={() => {
                          setMoveSourceCategories([]);
                          setMoveTargetCategory('');
                          setMoveCategoryError('');
                          setMoveCategoryMessage('');
                        }}
                        type="button"
                      >
                        重置
                      </button>
                    </div>

                    {moveCategoryMessage ? (
                      <div className="feedback success">{moveCategoryMessage}</div>
                    ) : null}
                    {moveCategoryError ? (
                      <div className="feedback error">{moveCategoryError}</div>
                    ) : null}
                  </>
                )}
              </div>
            </section>
          ) : null}

          {activePanel === 'backup' ? (
            <section className="stack-gap-lg">
              <div className="form-panel stack-gap-md">
                <div className="content-head">
                  <div>
                    <p className="eyebrow">Backup Restore</p>
                    <h3>备份恢复</h3>
                    <p className="sub-copy">
                      导出会把待审核、已通过、已拒绝、已下线分别写进压缩包里的 4 个
                      TXT。导入会覆盖当前内容库，适合故障后整体恢复。
                    </p>
                  </div>
                </div>

                <div className="backup-summary-grid">
                  {backupStatusOrder.map((status) => (
                    <div
                      className="duplicate-summary-card stack-gap-sm"
                      key={`backup_current_${status}`}
                    >
                      <span>{backupStatusLabelMap[status]}</span>
                      <strong>{backupCounts[status]} 篇</strong>
                      <span className="content-meta">
                        当前库里 {backupStatusLabelMap[status]} 的数量。
                      </span>
                    </div>
                  ))}
                </div>

                <div className="inline-actions wrap-mobile backup-action-row">
                  <button
                    className="button primary"
                    disabled={backupBusy}
                    onClick={handleExportBackup}
                    type="button"
                  >
                    导出备份压缩包
                  </button>
                  <button
                    className="button secondary"
                    disabled={backupBusy}
                    onClick={handleExportMergedBackup}
                    type="button"
                  >
                    合并导出
                  </button>
                  <button
                    className="button secondary"
                    disabled={backupBusy}
                    onClick={() => backupFileInputRef.current?.click()}
                    type="button"
                  >
                    选择备份压缩包
                  </button>
                  <button
                    className="button warning"
                    disabled={backupBusy || backupImportTotal === 0}
                    onClick={() => void handleRestoreBackup()}
                    type="button"
                  >
                    {backupBusy ? '恢复中' : `导入并恢复（${backupImportTotal}）`}
                  </button>
                  <button
                    className="button ghost"
                    disabled={backupBusy || !backupImportName}
                    onClick={clearBackupImportSelection}
                    type="button"
                  >
                    清空选择
                  </button>
                  <input
                    accept=".zip,application/zip"
                    hidden
                    onChange={(event) => void handleBackupFileChange(event)}
                    ref={backupFileInputRef}
                    type="file"
                  />
                </div>

                <label className="checkbox-chip backup-merge-meta-toggle">
                  <input
                    checked={mergedBackupIncludeAttachedMeta}
                    disabled={backupBusy}
                    onChange={(event) => setMergedBackupIncludeAttachedMeta(event.target.checked)}
                    type="checkbox"
                  />
                  <span>合并导出时保留附带信息</span>
                </label>

                <div className="stack-gap-sm backup-notes-panel">
                  <span className="content-meta">
                    当前备份包会保留标题、作者、分类、简介、正文、状态、创建时间、更新时间、审核时间、审核备注和标签顺序。
                  </span>
                  <span className="content-meta">
                    合并导出会额外生成 authors/ 和 categories/ 两个文件夹，每位作者、每个分类各一个
                    TXT，便于人工查看与整理。
                  </span>
                  <span className="content-meta">
                    关闭“保留附带信息”后，合并导出的 TXT 会去掉
                    Id、Status、CreatedAt、UpdatedAt、ReviewedAt、ReviewNote，只保留阅读整理需要的正文信息。
                  </span>
                  <span className="content-meta">审核日志不在这次 TXT 备份里。</span>
                  {backupImportName ? (
                    <span className="content-meta">已选择 {backupImportName}</span>
                  ) : null}
                </div>

                {backupImportCounts ? (
                  <div className="backup-summary-grid">
                    {backupStatusOrder.map((status) => (
                      <div
                        className="duplicate-summary-card stack-gap-sm"
                        key={`backup_import_${status}`}
                      >
                        <span>待导入 {backupStatusLabelMap[status]}</span>
                        <strong>{backupImportCounts[status]} 篇</strong>
                        <span className="content-meta">压缩包里该状态的内容数量。</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {backupMessage ? (
                  <div
                    className={
                      backupMessageTone === 'error' ? 'feedback error' : 'feedback success'
                    }
                  >
                    {backupMessage}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {activePanel === 'duplicates' ? (
            <section className="stack-gap-lg">
              <div className="form-panel stack-gap-md">
                <div className="content-head">
                  <div>
                    <p className="eyebrow">Duplicate Review</p>
                    <h3>重复检测</h3>
                    <p className="sub-copy">
                      按 70% 到 100% 相似度扫描全文，切换面板后仍保留结果。user / char
                      对调的占位文本会自动忽略。
                    </p>
                  </div>
                  <div className="inline-actions wrap-mobile duplicate-scan-actions">
                    <button
                      className="button primary"
                      disabled={duplicateBusy}
                      onClick={() => void handleScanDuplicates()}
                      type="button"
                    >
                      {duplicateBusy ? '扫描中...' : '开始扫描'}
                    </button>
                    <button
                      className="button ghost"
                      onClick={handleClearDuplicateSearch}
                      type="button"
                    >
                      清空检索
                    </button>
                  </div>
                </div>

                <div className="duplicate-toolbar-grid">
                  <div className="duplicate-summary-card stack-gap-sm">
                    <span>扫描范围</span>
                    <div className="inline-actions wrap-mobile">
                      <button
                        className={
                          duplicateReview.scanScope === 'all' ? 'tab-chip active' : 'tab-chip'
                        }
                        disabled={duplicateBusy}
                        onClick={() => handleDuplicateScanScopeChange('all')}
                        type="button"
                      >
                        整个库
                      </button>
                      <button
                        className={
                          duplicateReview.scanScope === 'approved' ? 'tab-chip active' : 'tab-chip'
                        }
                        disabled={duplicateBusy}
                        onClick={() => handleDuplicateScanScopeChange('approved')}
                        type="button"
                      >
                        已通过
                      </button>
                    </div>
                    <span className="content-meta">
                      当前会扫描 {duplicateScanScopeLabel} {duplicateScanSourcePlays.length} 篇。
                    </span>
                  </div>
                  <label className="duplicate-threshold-field">
                    <span>相似度 {duplicateReview.threshold}%</span>
                    <input
                      max={100}
                      min={70}
                      onChange={(event) =>
                        handleDuplicateThresholdChange(Number(event.target.value))
                      }
                      type="range"
                      value={duplicateReview.threshold}
                    />
                  </label>
                  <div className="duplicate-summary-card">
                    <span>整个库</span>
                    <strong>{allPlays.length} 篇</strong>
                  </div>
                  <div className="duplicate-summary-card">
                    <span>已通过</span>
                    <strong>{duplicateApprovedPlays.length} 篇</strong>
                  </div>
                  <div className="duplicate-summary-card">
                    <span>重复组</span>
                    <strong>{duplicateReview.groups.length} 组</strong>
                  </div>
                  <div className="duplicate-summary-card">
                    <span>已勾选</span>
                    <strong>{duplicateReview.selectedIds.length} 篇</strong>
                  </div>
                </div>

                {duplicateScanProgress ? (
                  <div className="admin-bulk-review-progress" role="status">
                    <div className="inline-actions wrap-mobile admin-bulk-review-progress-head">
                      <strong>{duplicateBusy ? '扫描中' : '扫描结果'}</strong>
                      <span className="content-meta">
                        {duplicateScanProgress.scopeLabel} · 已扫描{' '}
                        {duplicateScanProgress.completedAnchors} /{' '}
                        {duplicateScanProgress.totalAnchors} 篇
                      </span>
                    </div>
                    <div aria-hidden="true" className="admin-bulk-review-progress-track">
                      <div
                        className="admin-bulk-review-progress-fill"
                        style={{
                          width: `${
                            duplicateScanProgress.totalAnchors === 0
                              ? 0
                              : (duplicateScanProgress.completedAnchors /
                                  duplicateScanProgress.totalAnchors) *
                                100
                          }%`,
                        }}
                      />
                    </div>
                    <span className="content-meta">
                      已比较 {duplicateScanProgress.processedPairs} /{' '}
                      {duplicateScanProgress.totalPairs} 对
                    </span>
                  </div>
                ) : null}

                <div className="inline-actions wrap-mobile duplicate-bulk-row">
                  <button
                    className="button danger"
                    disabled={duplicateBusy || duplicateReview.selectedIds.length === 0}
                    onClick={() => void handleDeleteSelectedDuplicates()}
                    type="button"
                  >
                    剔除勾选重复
                  </button>
                  <button
                    className="button danger"
                    disabled={duplicateBusy || duplicateReview.groups.length === 0}
                    onClick={() => void handleDeleteAllDuplicates()}
                    type="button"
                  >
                    一键剔除全部重复（保留一个）
                  </button>
                  <button
                    className="button secondary"
                    disabled={duplicateBusy || duplicateReview.groups.length === 0}
                    onClick={() => void handleDeleteAllGroupSeconds()}
                    type="button"
                  >
                    删除全部相似组的第二个小剧场
                  </button>
                </div>

                {duplicateReview.scannedAt ? (
                  <p className="content-meta">
                    最近扫描：{new Date(duplicateReview.scannedAt).toLocaleString('zh-CN')}，基于{' '}
                    {duplicateReview.scanScope === 'approved' ? '已通过' : '整个库'}{' '}
                    {duplicateReview.scannedCount} 篇内容。
                  </p>
                ) : null}
              </div>

              {duplicateReview.groups.length === 0 ? (
                <div className="empty-panel">先开始扫描，重复候选会显示在这里。</div>
              ) : (
                <div className="stack-gap-lg">
                  {duplicateReview.groups.map((group) => {
                    const compareTarget =
                      duplicateReview.activeGroupId === group.id
                        ? (group.duplicates.find(
                            (item) => item.play.id === duplicateReview.activeComparedPlayId,
                          ) ?? group.duplicates[0])
                        : null;
                    const compareDiff = compareTarget
                      ? buildSideBySideDiff(group.anchor.content, compareTarget.play.content)
                      : null;

                    return (
                      <article
                        className="form-panel stack-gap-md duplicate-group-card"
                        key={group.id}
                      >
                        <div className="content-head">
                          <div>
                            <h3>{group.anchor.title}</h3>
                            <p className="sub-copy">
                              保留首篇：{group.anchor.authorName} ·{' '}
                              {group.anchor.category || DEFAULT_CATEGORY} ·{' '}
                              {new Date(group.anchor.createdAt).toLocaleString('zh-CN')}
                            </p>
                          </div>
                          <span className="status-tag approved">
                            重复 {group.duplicates.length} 篇
                          </span>
                        </div>

                        <div className="duplicate-compare-grid">
                          <article className="duplicate-play-pane">
                            <div className="stack-gap-sm">
                              <strong>保留内容</strong>
                              <span className="content-meta">{group.anchor.title}</span>
                              {group.anchor.summary ? (
                                <p className="summary">{group.anchor.summary}</p>
                              ) : null}
                              <div className="duplicate-content-pane">
                                {compareDiff
                                  ? compareDiff.leftSegments.map((segment, index) => (
                                      <span
                                        className={
                                          segment.changed
                                            ? 'diff-token changed removed'
                                            : 'diff-token'
                                        }
                                        key={`left_${group.id}_${index}`}
                                      >
                                        {segment.value}
                                      </span>
                                    ))
                                  : group.anchor.content}
                              </div>
                            </div>
                          </article>

                          <article className="duplicate-play-pane">
                            <div className="stack-gap-sm">
                              <strong>{compareTarget ? '当前对比内容' : '候选重复内容'}</strong>
                              {compareTarget ? (
                                <>
                                  <span className="content-meta">
                                    {compareTarget.play.title} · 相似度 {compareTarget.similarity}%
                                  </span>
                                  {compareTarget.play.summary ? (
                                    <p className="summary">{compareTarget.play.summary}</p>
                                  ) : null}
                                  <div className="duplicate-content-pane">
                                    {compareDiff
                                      ? compareDiff.rightSegments.map((segment, index) => (
                                          <span
                                            className={
                                              segment.changed
                                                ? 'diff-token changed added'
                                                : 'diff-token'
                                            }
                                            key={`right_${group.id}_${index}`}
                                          >
                                            {segment.value}
                                          </span>
                                        ))
                                      : compareTarget.play.content}
                                  </div>
                                </>
                              ) : (
                                <div className="empty-panel">先从右下角选一篇候选内容对比。</div>
                              )}
                            </div>
                          </article>
                        </div>

                        <div className="stack-gap-md duplicate-match-list">
                          {group.duplicates.map((item, index) => {
                            const checked = duplicateReview.selectedIds.includes(item.play.id);
                            const active =
                              duplicateReview.activeGroupId === group.id &&
                              duplicateReview.activeComparedPlayId === item.play.id;

                            return (
                              <div
                                className={
                                  active ? 'duplicate-match-row active' : 'duplicate-match-row'
                                }
                                key={item.play.id}
                              >
                                <label className="checkbox-chip checkbox-chip-wide">
                                  <input
                                    checked={checked}
                                    onChange={() => handleToggleDuplicateSelection(item.play.id)}
                                    type="checkbox"
                                  />
                                  <span>勾选剔除</span>
                                </label>
                                <div className="stack-gap-sm duplicate-match-meta">
                                  <strong>
                                    #{index + 2} {item.play.title}
                                  </strong>
                                  <span className="content-meta">
                                    {item.play.authorName} ·{' '}
                                    {item.play.category || DEFAULT_CATEGORY} · 相似度{' '}
                                    {item.similarity}%
                                  </span>
                                </div>
                                <div className="inline-actions wrap-mobile duplicate-match-actions">
                                  <button
                                    className={active ? 'button primary' : 'button secondary'}
                                    onClick={() =>
                                      handleOpenDuplicateCompare(group.id, item.play.id)
                                    }
                                    type="button"
                                  >
                                    全文对比
                                  </button>
                                  <button
                                    className="button danger"
                                    disabled={duplicateBusy}
                                    onClick={() => {
                                      if (!window.confirm(`确认剔除《${item.play.title}》吗？`)) {
                                        return;
                                      }
                                      void handleDeleteDuplicateIds(
                                        [item.play.id],
                                        `已剔除《${item.play.title}》。`,
                                      );
                                    }}
                                    type="button"
                                  >
                                    剔除这篇
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          ) : null}

          {activePanel === 'tags' ? (
            <div className="stack-gap-lg">
              <section className="form-panel stack-gap-md">
                <div>
                  <p className="eyebrow">Tag Dictionary</p>
                  <h3>标签</h3>
                  <p className="sub-copy">
                    这里维护上传页可复用的标签词表。改名会同步历史内容，删除会回退到未分类。
                  </p>
                </div>

                <label>
                  <span>新增标签</span>
                  <input
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    placeholder="输入新标签名"
                  />
                </label>
                <button
                  className="button primary"
                  disabled={tagSaving || isTagSorting}
                  onClick={() => void handleCreateTag()}
                  type="button"
                >
                  新增标签
                </button>

                {tagMessage ? (
                  <div className={`feedback ${tagMessageTone}`}>{tagMessage}</div>
                ) : null}
              </section>

              <section className="form-panel stack-gap-md">
                <div className="content-head tag-library-head">
                  <div className="inline-actions wrap-mobile tag-library-title-row">
                    <h3>当前标签库</h3>
                    <button
                      className="button ghost drag-toggle-button"
                      disabled={tagSaving}
                      onClick={() => void toggleTagSortMode()}
                      type="button"
                    >
                      {isTagSorting ? '保存拖拽' : '拖拽排序'}
                    </button>
                    {isTagSorting ? (
                      <button
                        className="button ghost"
                        disabled={tagSaving}
                        onClick={cancelTagSort}
                        type="button"
                      >
                        取消
                      </button>
                    ) : null}
                  </div>
                  <span className="content-meta">共 {displayTags.length} 个</span>
                </div>

                <div className={isTagSorting ? 'tag-admin-list is-sorting' : 'tag-admin-list'}>
                  {displayTags.map((tag) => {
                    const editing = editingTagId === tag.id;

                    return (
                      <article
                        key={tag.id}
                        className={
                          draggingTagId === tag.id
                            ? 'tag-admin-card dragging is-sorting'
                            : isTagSorting
                              ? 'tag-admin-card is-sorting'
                              : 'tag-admin-card'
                        }
                        data-tag-id={tag.id}
                        draggable={isTagSorting && !editing && !tagSaving}
                        onDragEnd={() => setDraggingTagId('')}
                        onDragOver={(event) => {
                          if (isTagSorting) {
                            event.preventDefault();
                          }
                        }}
                        onDragStart={() => setDraggingTagId(tag.id)}
                        onDrop={() => {
                          if (draggingTagId) {
                            moveDraftTag(draggingTagId, tag.id);
                          }
                          setDraggingTagId('');
                        }}
                      >
                        {editing ? (
                          <label>
                            <span>编辑标签</span>
                            <input
                              value={editingTagName}
                              onChange={(event) => setEditingTagName(event.target.value)}
                              placeholder="输入新的标签名"
                            />
                          </label>
                        ) : (
                          <div className="tag-chip-row tag-card-head">
                            <div className="tag-chip-row tag-card-title-group">
                              {isTagSorting ? (
                                <button
                                  className="tag-drag-handle"
                                  onPointerCancel={handleTagPointerUp}
                                  onPointerDown={(event) => handleTagPointerDown(event, tag.id)}
                                  onPointerMove={handleTagPointerMove}
                                  onPointerUp={handleTagPointerUp}
                                  type="button"
                                >
                                  拖拽
                                </button>
                              ) : null}
                              <span className="content-meta tag-floor-order">
                                #{tag.sortOrder + 1}
                              </span>
                              <strong>{tag.name}</strong>
                            </div>
                            {!isTagSorting ? (
                              <span className="content-meta">
                                更新于 {new Date(tag.updatedAt).toLocaleString('zh-CN')}
                              </span>
                            ) : null}
                          </div>
                        )}

                        {!isTagSorting ? (
                          <div className="inline-actions wrap-mobile tag-card-actions">
                            {editing ? (
                              <>
                                <button
                                  className="button primary"
                                  disabled={tagSaving}
                                  onClick={() => void handleUpdateTag()}
                                  type="button"
                                >
                                  保存标签
                                </button>
                                <button
                                  className="button ghost"
                                  onClick={cancelEditTag}
                                  type="button"
                                >
                                  取消
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="button secondary"
                                  disabled={isTagSorting || tagSaving}
                                  onClick={() => startEditTag(tag)}
                                  type="button"
                                >
                                  改名
                                </button>
                                <button
                                  className="button danger"
                                  disabled={isTagSorting || tagSaving}
                                  onClick={() => void handleDeleteTag(tag.id)}
                                  type="button"
                                >
                                  删除
                                </button>
                              </>
                            )}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                  {displayTags.length === 0 ? (
                    <div className="empty-panel">当前还没有可用标签。</div>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}
        </section>
      </section>

      {backupRestoreConfirmOpen ? (
        <div className="modal-overlay" role="presentation" onClick={handleCancelRestoreBackup}>
          <div
            aria-labelledby="backup-restore-confirm-title"
            aria-modal="true"
            className="modal-panel stack-gap-md"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h3 id="backup-restore-confirm-title" className="modal-title">
              确认恢复备份
            </h3>
            <div className="update-prompt-warning">
              <strong>⚠ 这是一个危险操作：</strong>
              恢复备份会先清空当前内容库，再整体导入压缩包内容，此操作无法撤销。
            </div>
            <p className="sub-copy">
              即将导入 <strong>{backupImportTotal}</strong> 篇内容（
              {backupImportName || '未命名压缩包'}），覆盖当前库内全部内容。
            </p>
            <p className="sub-copy">请输入「{BACKUP_RESTORE_CONFIRM_PHRASE}」以继续：</p>
            <input
              autoFocus
              onChange={(event) => setBackupRestoreConfirmInput(event.target.value)}
              placeholder={BACKUP_RESTORE_CONFIRM_PHRASE}
              value={backupRestoreConfirmInput}
            />
            <div className="inline-actions modal-action-row">
              <button
                className="button secondary"
                onClick={handleCancelRestoreBackup}
                type="button"
              >
                取消
              </button>
              <button
                className="button danger"
                disabled={backupRestoreConfirmInput.trim() !== BACKUP_RESTORE_CONFIRM_PHRASE}
                onClick={() => void handleConfirmRestoreBackup()}
                type="button"
              >
                确认覆盖并恢复
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {updateAvailable ? (
        <UpdatePromptModal onCancel={dismissUpdate} onRefresh={refreshUpdate} />
      ) : null}
    </>
  );
}
