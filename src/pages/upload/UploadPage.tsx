import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import {
  countPlayBatchItems,
  detectPlayTitleFromContent,
  parsePlayBatchText,
} from '../../services/play-text';
import {
  getVisitorId,
  rememberOwnedPlayId,
  rememberRepoNickname,
} from '../../services/browser-repo-history';
import {
  clearAuthorHistory,
  clearSubmissionHistory,
  getAuthorHistory,
  getSubmissionHistory,
  mergeSubmissionFeedback,
  rememberAuthorName,
  removeSubmissionRecord,
  saveSubmissionRecord,
  type BrowserSubmissionRecord,
} from '../../services/browser-upload-history';
import { playApi } from '../../services/play-api';
import {
  DEFAULT_CATEGORY,
  PLAYS_UPDATED_EVENT,
  TAGS_UPDATED_EVENT,
  statusLabelMap,
  type SubmissionFeedbackStatus,
  type Tag,
  type UploadMode,
} from '../../types/play';
import { showFloatingToast } from '../../components/floating-toast-store';
import { CategoryHierarchyPicker } from '../../components/CategoryHierarchyPicker';
import {
  getChildTagNames,
  getGroupTags,
  joinPlayCategoriesByTags,
  splitPlayCategories,
} from '../../utils/categories';

const initialForm = {
  authorName: '',
  title: '',
  category: '',
  summary: '',
  content: '',
};

export type UploadPrefill = Partial<{
  authorName: string;
  title: string;
  category: string;
  summary: string;
  content: string;
  existingContinuation: Array<{ nickname?: string; summary: string; content: string }>;
  appendContinuation: boolean;
  editOriginalId: string;
}>;

const UPLOAD_CATEGORY_TAGS_OPEN_KEY = 'mini-theater:upload-category-tags-open';

const readUploadBool = (key: string, fallback: boolean) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  if (raw === null) {
    return fallback;
  }

  return raw === 'true';
};

const batchTemplate = `### Title
Title: （标题）
Category: （分类，可留空，默认未分类）
Desc: （简介，可留空，默认无简介）
（正文）`;

type BatchParseFilter = 'all' | 'uncategorized' | 'no-summary' | 'uncategorized-no-summary';
type BatchViewMode = 'preview' | 'edit' | 'both';

type BatchParseItem = {
  id: string;
  title: string;
  category: string;
  summary: string;
  content: string;
};

const BATCH_PARSE_PAGE_SIZE_KEY = 'mini-theater:batch-parse-page-size';
const DEFAULT_BATCH_PARSE_PAGE_SIZE = 20;
const MIN_BATCH_PARSE_PAGE_SIZE = 1;
const MAX_BATCH_PARSE_PAGE_SIZE = 200;
const MOBILE_BATCH_LIST_PREVIEW_COUNT = 2;

const clampBatchParsePageSize = (value: number) =>
  Math.min(MAX_BATCH_PARSE_PAGE_SIZE, Math.max(MIN_BATCH_PARSE_PAGE_SIZE, Math.trunc(value)));

const readBatchParsePageSize = () => {
  if (typeof window === 'undefined') {
    return DEFAULT_BATCH_PARSE_PAGE_SIZE;
  }

  const raw = Number(window.localStorage.getItem(BATCH_PARSE_PAGE_SIZE_KEY));
  return Number.isFinite(raw) && raw > 0
    ? clampBatchParsePageSize(raw)
    : DEFAULT_BATCH_PARSE_PAGE_SIZE;
};

const makeBatchParseId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const isUncategorizedCategory = (category: string) => {
  const names = splitPlayCategories(category);
  return names.length === 0 || (names.length === 1 && names[0] === DEFAULT_CATEGORY);
};

const isEmptySummary = (summary: string) => !summary.trim();

const feedbackLabelMap: Record<SubmissionFeedbackStatus, string> = {
  ...statusLabelMap,
  missing: '已删除',
};

const feedbackEditedFieldLabelMap = {
  title: '标题',
  authorName: '署名',
  category: '分类',
  summary: '简介',
  content: '正文',
} as const;

const formatLocalTime = (value: string) => {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleString();
};

const addCategoryName = (current: string, name: string, tags: Tag[]) =>
  joinPlayCategoriesByTags([...splitPlayCategories(current), name], tags);

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

/* 续写版本填写块:主表单是"原文",continuationVersions 是原文之下依次追加的续写。
 * 每个续写块与详情页 continuation-panel 的 composer 字段一致:
 *   - nickname(作者,可空,与原文作者一致时留空)
 *   - summary(简介,必填)
 *   - content(正文,必填)
 * 提交时按顺序:
 *   1) uploadPlay(原文, submissionType=original)
 *   2) 对每个续写块 createContinuation({playId, nickname, summary, content, visitorId})
 * 原文与每个续写共享同一个 playId,通过不同 submission_type 区分。 */
type ContinuationVersionDraft = {
  id: string;
  nickname: string;
  summary: string;
  content: string;
};

const makeContinuationVersion = (): ContinuationVersionDraft => ({
  id:
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `cont-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  nickname: '',
  summary: '',
  content: '',
});

export function UploadPage() {
  const location = useLocation();
  const locationState = location.state as { prefill?: UploadPrefill } | null;
  const prefill = locationState?.prefill;
  const [form, setForm] = useState(initialForm);
  const [batchText, setBatchText] = useState('');
  const [mode, setMode] = useState<UploadMode>('single');
  const [submitting, setSubmitting] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const sessionCreatedTagsRef = useRef<Tag[]>([]);
  const [categoryTagsOpen, setCategoryTagsOpen] = useState(() =>
    readUploadBool(UPLOAD_CATEGORY_TAGS_OPEN_KEY, true),
  );
  const [categoryQuery, setCategoryQuery] = useState('');
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [createCategoryName, setCreateCategoryName] = useState('');
  const [createCategoryGroupId, setCreateCategoryGroupId] = useState('');
  const [createCategoryBusy, setCreateCategoryBusy] = useState(false);
  const [authorHistory, setAuthorHistory] = useState<string[]>([]);
  const [submissionHistory, setSubmissionHistory] = useState<BrowserSubmissionRecord[]>([]);
  const [editingHistoryId, setEditingHistoryId] = useState('');
  const [batchProgress, setBatchProgress] = useState<{ completed: number; total: number } | null>(
    null,
  );
  const [batchItems, setBatchItems] = useState<BatchParseItem[]>([]);
  const [batchFilter, setBatchFilter] = useState<BatchParseFilter>('all');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [batchViewMode, setBatchViewMode] = useState<BatchViewMode>('both');
  const [batchPageSize, setBatchPageSizeState] = useState(() => readBatchParsePageSize());
  const [batchPageSizeInput, setBatchPageSizeInput] = useState(() =>
    String(readBatchParsePageSize()),
  );
  const [batchCurrentPage, setBatchCurrentPage] = useState(1);
  const [batchPageInput, setBatchPageInput] = useState('1');
  const [isMobileBatchViewport, setIsMobileBatchViewport] = useState(false);
  const [isMobileBatchListExpanded, setIsMobileBatchListExpanded] = useState(false);
  const [batchCategoryOpen, setBatchCategoryOpen] = useState(true);
  const [batchCategoryQuery, setBatchCategoryQuery] = useState('');
  const batchFileInputRef = useRef<HTMLInputElement | null>(null);
  const batchContentRef = useRef<HTMLTextAreaElement | null>(null);
  /* 续写版本填写块：主表单是「原文」，continuationVersions 是原文之下依次追加的续写。
   * 字段与详情页 continuation-panel 的 composer 完全一致：
   *   - nickname（作者，可空，与原文作者为同一人时可留空）
   *   - summary（简介，必填）
   *   - content（正文，必填）
   *
   * 提交时：
   *   1) uploadPlay(原文, submissionType=original)
   *   2) 对每个续写块 createContinuation({ playId, nickname, summary, content, visitorId })
   *      共享同一个原文 playId，作为同系列下挂载的续写版本。 */
  const [continuationVersions, setContinuationVersions] = useState<ContinuationVersionDraft[]>([]);
  /* 「修改」模式下的初始快照：原文的 title / category / summary / content。
   * 提交时拿 form 与之对比,任意字段改动都允许提交,
   * 标题或分类的改动会通过审核后同步到同系列下所有版本。 */
  const [originalSnapshot, setOriginalSnapshot] = useState<{
    title: string;
    category: string;
    summary: string;
    content: string;
  } | null>(null);

  /* 从详情页跳转过来的预填：每次 prefill 变化时覆盖当前 form。
   * 用 JSON 字符串做依赖而不是对象引用，避免 React 浅比较认为未变。
   * appendContinuation 时：原文 + 已有续写只用于展示，末尾追加一个空的新续写。
   * editOriginalId 时：只预填原文，提交即作为同一标题同分类的下一版。 */
  const prefillKey = JSON.stringify(prefill ?? null);
  const appendContinuation = Boolean(prefill?.appendContinuation);
  const editOriginalId = prefill?.editOriginalId ?? '';
  const isEditOriginal = editOriginalId.length > 0;
  useEffect(() => {
    if (!prefill) {
      return;
    }
    setForm({
      authorName: prefill.authorName ?? '',
      title: prefill.title ?? '',
      category: prefill.category ?? '',
      summary: prefill.summary ?? '',
      content: prefill.content ?? '',
    });
    setMode('single');
    const existing = (prefill.existingContinuation ?? []).map((item) => ({
      ...makeContinuationVersion(),
      nickname: item.nickname ?? '',
      summary: item.summary ?? '',
      content: item.content ?? '',
    }));
    if (isEditOriginal) {
      /* 「修改」模式只展示原文,不预填任何已有版本,也不在末尾追加新续写。 */
      setContinuationVersions([]);
    } else {
      setContinuationVersions(
        appendContinuation ? [...existing, makeContinuationVersion()] : existing,
      );
    }
    setOriginalSnapshot(
      isEditOriginal
        ? {
            title: prefill.title ?? '',
            category: prefill.category ?? '',
            summary: prefill.summary ?? '',
            content: prefill.content ?? '',
          }
        : null,
    );
    setEditingHistoryId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillKey]);

  const batchItemCount = useMemo(() => countPlayBatchItems(batchText), [batchText]);

  const batchFilterCounts = useMemo(() => {
    const uncategorized = batchItems.filter((item) =>
      isUncategorizedCategory(item.category),
    ).length;
    const noSummary = batchItems.filter((item) => isEmptySummary(item.summary)).length;
    const both = batchItems.filter(
      (item) => isUncategorizedCategory(item.category) && isEmptySummary(item.summary),
    ).length;
    return {
      all: batchItems.length,
      uncategorized,
      noSummary,
      both,
    };
  }, [batchItems]);

  const filteredBatchItems = useMemo(() => {
    if (batchFilter === 'uncategorized') {
      return batchItems.filter((item) => isUncategorizedCategory(item.category));
    }
    if (batchFilter === 'no-summary') {
      return batchItems.filter((item) => isEmptySummary(item.summary));
    }
    if (batchFilter === 'uncategorized-no-summary') {
      return batchItems.filter(
        (item) => isUncategorizedCategory(item.category) && isEmptySummary(item.summary),
      );
    }
    return batchItems;
  }, [batchFilter, batchItems]);

  const batchTotalPages = Math.max(1, Math.ceil(filteredBatchItems.length / batchPageSize));
  const safeBatchPage = Math.min(batchCurrentPage, batchTotalPages);
  const pagedBatchItems = useMemo(() => {
    const start = (safeBatchPage - 1) * batchPageSize;
    return filteredBatchItems.slice(start, start + batchPageSize);
  }, [batchPageSize, filteredBatchItems, safeBatchPage]);

  const selectedBatchIndex = filteredBatchItems.findIndex((item) => item.id === selectedBatchId);
  const selectedBatchItem =
    selectedBatchIndex >= 0 ? filteredBatchItems[selectedBatchIndex] : undefined;
  const previousBatchId =
    selectedBatchIndex > 0 ? (filteredBatchItems[selectedBatchIndex - 1]?.id ?? '') : '';
  const nextBatchId =
    selectedBatchIndex >= 0 && selectedBatchIndex < filteredBatchItems.length - 1
      ? (filteredBatchItems[selectedBatchIndex + 1]?.id ?? '')
      : '';

  const shouldCollapseMobileBatchList =
    isMobileBatchViewport && pagedBatchItems.length > MOBILE_BATCH_LIST_PREVIEW_COUNT;
  const visibleBatchItems =
    shouldCollapseMobileBatchList && !isMobileBatchListExpanded
      ? pagedBatchItems.slice(0, MOBILE_BATCH_LIST_PREVIEW_COUNT)
      : pagedBatchItems;

  const batchFilterLabel =
    batchFilter === 'uncategorized'
      ? '未分类'
      : batchFilter === 'no-summary'
        ? '无简介'
        : batchFilter === 'uncategorized-no-summary'
          ? '未分类且无简介'
          : '全部';

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const syncViewport = () => {
      setIsMobileBatchViewport(mediaQuery.matches);
    };

    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);
    return () => {
      mediaQuery.removeEventListener('change', syncViewport);
    };
  }, []);

  useEffect(() => {
    if (filteredBatchItems.length === 0) {
      if (selectedBatchId) {
        setSelectedBatchId('');
      }
      return;
    }

    if (!filteredBatchItems.some((item) => item.id === selectedBatchId)) {
      setSelectedBatchId(filteredBatchItems[0]?.id ?? '');
      setBatchCategoryQuery('');
    }
  }, [filteredBatchItems, selectedBatchId]);

  useEffect(() => {
    if (!isMobileBatchViewport) {
      setIsMobileBatchListExpanded(false);
    }
  }, [batchFilter, batchCurrentPage, isMobileBatchViewport, pagedBatchItems.length]);

  /* 编辑态正文框按内容撑开高度，避免固定行数把短文撑出大片空白。 */
  useEffect(() => {
    const element = batchContentRef.current;
    if (!element || batchViewMode === 'preview') {
      return;
    }

    const resize = () => {
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    };
    resize();
    const raf = requestAnimationFrame(resize);
    return () => cancelAnimationFrame(raf);
  }, [batchViewMode, selectedBatchItem?.content, selectedBatchItem?.id]);

  /* 「修改」模式下,与快照对比,用于启用提交按钮与文案。
   * 任意字段(title / category / summary / content)改动都算修改。 */
  const originalChanged = useMemo(() => {
    if (!isEditOriginal || !originalSnapshot) return false;
    if (originalSnapshot.summary !== form.summary) return true;
    if (originalSnapshot.content !== form.content) return true;
    return (
      originalSnapshot.title !== form.title.trim() ||
      originalSnapshot.category !== form.category.trim()
    );
  }, [isEditOriginal, originalSnapshot, form.summary, form.content, form.title, form.category]);

  /* 续写块校验：summary 与 content 都必须非空（与详情页续写 composer 一致）。 */
  const continuationInvalid = useMemo(() => {
    if (isEditOriginal) return false;
    if (continuationVersions.length === 0) return false;
    return continuationVersions.some(
      (version) => !version.summary.trim() || !version.content.trim(),
    );
  }, [continuationVersions, isEditOriginal]);

  /* 「修改」/「上传续写」入口下,作者不允许编辑(作者不属于同系列聚合键);
   * 「上传续写」还要锁定原文与已有续写版本,标题/分类保持只读;
   * 「修改」开放标题/分类编辑,审核通过后同系列下所有作品会一起重写到新键。 */
  const isLocked = isEditOriginal || appendContinuation;
  const lockAuthor = isLocked;
  const lockTitleAndCategory = appendContinuation;
  const lockOriginalContent = appendContinuation;

  const singleDisabled = useMemo(
    () =>
      submitting ||
      !form.authorName.trim() ||
      !form.title.trim() ||
      (isEditOriginal ? !originalChanged : !form.content.trim()) ||
      continuationInvalid,
    [
      isEditOriginal,
      originalChanged,
      continuationInvalid,
      form.authorName,
      form.title,
      form.content,
      submitting,
    ],
  );

  const batchDisabled = useMemo(
    () => submitting || batchItemCount === 0,
    [batchItemCount, submitting],
  );

  const setBatchPageSize = (next: number) => {
    const clamped = clampBatchParsePageSize(next);
    setBatchPageSizeState(clamped);
    setBatchPageSizeInput(String(clamped));
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(BATCH_PARSE_PAGE_SIZE_KEY, String(clamped));
    }
  };

  const jumpBatchPage = (next: number) => {
    const safe = Math.min(batchTotalPages, Math.max(1, Math.trunc(next)));
    setBatchCurrentPage(safe);
    setBatchPageInput(String(safe));
  };

  useEffect(() => {
    if (batchCurrentPage > batchTotalPages) {
      jumpBatchPage(batchTotalPages);
    }
    // 只在总页数收缩时把当前页拉回最后一页。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchCurrentPage, batchTotalPages]);

  const groupTags = useMemo(() => getGroupTags(tags), [tags]);
  const selectedCategoryNames = useMemo(() => splitPlayCategories(form.category), [form.category]);

  const closeCreateCategoryModal = () => {
    setCreateCategoryOpen(false);
    setCreateCategoryName('');
    setCreateCategoryGroupId('');
  };

  const handleCreateCategory = async () => {
    const name = createCategoryName.trim();
    if (!name) {
      showFloatingToast('请填写新分类名称', 'error');
      return;
    }
    if (!createCategoryGroupId) {
      showFloatingToast('请选择所属大类', 'error');
      return;
    }

    setCreateCategoryBusy(true);
    try {
      const created = await playApi.createPublicTag({
        name,
        parentId: createCategoryGroupId,
      });
      const nextTags = tags.some((tag) => tag.id === created.id) ? tags : [...tags, created];
      sessionCreatedTagsRef.current = sessionCreatedTagsRef.current.some(
        (tag) => tag.id === created.id,
      )
        ? sessionCreatedTagsRef.current
        : [...sessionCreatedTagsRef.current, created];
      setTags(nextTags);
      if (mode === 'batch' && selectedBatchId) {
        setBatchItems((current) =>
          current.map((item) =>
            item.id === selectedBatchId
              ? { ...item, category: addCategoryName(item.category, created.name, nextTags) }
              : item,
          ),
        );
        setBatchCategoryQuery('');
        setBatchCategoryOpen(true);
      } else {
        setForm((current) => ({
          ...current,
          category: addCategoryName(current.category, created.name, nextTags),
        }));
        setCategoryQuery('');
        setCategoryTagsOpen(true);
      }
      closeCreateCategoryModal();
      showFloatingToast(`已新增分类「${created.name}」`);
    } catch (reason) {
      showFloatingToast(reason instanceof Error ? reason.message : '新增分类失败', 'error');
    } finally {
      setCreateCategoryBusy(false);
    }
  };

  useEffect(() => {
    const loadTags = async () => {
      try {
        const items = await playApi.getTags();
        const extras = sessionCreatedTagsRef.current.filter(
          (created) => !items.some((item) => item.id === created.id),
        );
        setTags(extras.length > 0 ? [...items, ...extras] : items);
      } catch {
        setTags(sessionCreatedTagsRef.current);
      }
    };

    const loadSubmissionFeedback = async () => {
      const localHistory = getSubmissionHistory();
      setSubmissionHistory(localHistory);

      const trackedIds = localHistory.map((item) => item.latestPlayId).filter(Boolean) as string[];
      if (trackedIds.length === 0) {
        return;
      }

      try {
        const feedbackItems = await playApi.getSubmissionFeedback(trackedIds);
        setSubmissionHistory(mergeSubmissionFeedback(feedbackItems));
      } catch {
        setSubmissionHistory(getSubmissionHistory());
      }
    };

    const handleFocus = () => {
      void loadTags();
      void loadSubmissionFeedback();
    };

    setAuthorHistory(getAuthorHistory());
    void loadSubmissionFeedback();
    void loadTags();
    window.addEventListener(TAGS_UPDATED_EVENT, loadTags);
    window.addEventListener(PLAYS_UPDATED_EVENT, loadSubmissionFeedback);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener(TAGS_UPDATED_EVENT, loadTags);
      window.removeEventListener(PLAYS_UPDATED_EVENT, loadSubmissionFeedback);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(UPLOAD_CATEGORY_TAGS_OPEN_KEY, String(categoryTagsOpen));
  }, [categoryTagsOpen]);

  useEffect(() => {
    if (!createCategoryOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !createCategoryBusy) {
        closeCreateCategoryModal();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [createCategoryBusy, createCategoryOpen]);

  const syncLocalHistory = (authorName: string) => {
    setAuthorHistory(rememberAuthorName(authorName));
    setSubmissionHistory(getSubmissionHistory());
  };

  const resetEditingState = () => {
    setEditingHistoryId('');
    setForm(initialForm);
    setContinuationVersions([]);
  };

  const handleSingleSubmit = async () => {
    const authorName = form.authorName.trim();
    const title = form.title.trim();
    const category = form.category.trim() || DEFAULT_CATEGORY;
    const visitorId = getVisitorId();

    const originalDraft = {
      authorName,
      title,
      category,
      summary: form.summary.trim(),
      content: form.content.trim(),
    };

    /* 两个模式:
     * 1) isEditOriginal：详情页「修改」入口,调用 submitPlayEdit 创建一条
     *    submission_type='modify' 的待审核 play,parent_play_id 指向原 play。
     *    审核通过由 reviewPlay 合入原 play,拒绝/下线则原 play 不动。
     * 2) 普通模式:先投原文(submissionType=original),再按顺序投续写(continuation)。
     *    续写与原文共享 playId,通过 createContinuation 单独审核,
     *    续写字段(作者/简介/正文)与小剧场详情页续写 composer 一致。 */
    if (isEditOriginal) {
      await playApi.submitPlayEdit(editOriginalId, originalDraft);
      /* 保存 submission 记录时,latestPlayId 记成原 play 的 id,
       * 这样下次再点「修改」还能继续针对同一原 play。 */
      saveSubmissionRecord(originalDraft, { latestPlayId: editOriginalId });
      rememberOwnedPlayId(editOriginalId);

      syncLocalHistory(authorName);
      setForm(initialForm);
      setContinuationVersions([]);
      setOriginalSnapshot(null);
      setEditingHistoryId('');

      showFloatingToast('修改已提交,等待审核。');
      return;
    }

    const createdOriginal = await playApi.uploadPlay({
      ...originalDraft,
      submissionType: 'original',
    });
    saveSubmissionRecord(originalDraft, {
      historyId: editingHistoryId || undefined,
      latestPlayId: createdOriginal.id,
    });
    rememberOwnedPlayId(createdOriginal.id);

    /* 续写块:每块独立 createContinuation,共享同一个原文 playId。 */
    for (const version of continuationVersions) {
      const nickname = version.nickname.trim();
      const summary = version.summary.trim();
      const content = version.content.trim();
      if (!summary || !content) {
        continue;
      }
      await playApi.createContinuation({
        playId: createdOriginal.id,
        nickname,
        visitorId,
        summary,
        content,
      });
      if (nickname) {
        rememberRepoNickname(nickname);
      }
    }

    syncLocalHistory(authorName);
    setForm(initialForm);
    setContinuationVersions([]);
    setEditingHistoryId('');

    if (continuationVersions.length > 0) {
      showFloatingToast(`已提交原文和 ${continuationVersions.length} 条续写到待审核池。`);
    } else {
      showFloatingToast(editingHistoryId ? '已重新投稿，已再次进入审核。' : '已提交到待审核池。');
    }
  };

  const handleBatchSubmit = async () => {
    if (submitting) {
      return;
    }

    if (!form.authorName.trim()) {
      showFloatingToast('请写上署名', 'error');
      return;
    }

    const missingTitleCount = batchItems.filter((item) => !item.title.trim()).length;
    const missingContentCount = batchItems.filter((item) => !item.content.trim()).length;
    const items = batchItems.filter((item) => item.title.trim() && item.content.trim());
    if (items.length === 0) {
      if (missingTitleCount > 0 && missingContentCount > 0) {
        showFloatingToast('没有可上传的内容，请补全标题和正文', 'error');
      } else if (missingTitleCount > 0) {
        showFloatingToast('没有可上传的内容，请补全标题', 'error');
      } else if (missingContentCount > 0) {
        showFloatingToast('没有可上传的内容，请补全正文', 'error');
      } else {
        showFloatingToast('没有可上传的内容', 'error');
      }
      return;
    }

    const skippedCount = batchItems.length - items.length;
    const confirmed = window.confirm(
      skippedCount > 0
        ? `有 ${skippedCount} 篇缺少标题或正文，将不会上传。确认上传其余 ${items.length} 篇吗？`
        : `确认上传这 ${items.length} 篇小剧场吗？`,
    );
    if (!confirmed) {
      return;
    }

    setSubmitting(true);
    setBatchProgress({ completed: 0, total: items.length });

    const createdPlays = [] as Awaited<ReturnType<typeof playApi.uploadPlay>>[];

    try {
      for (const [index, item] of items.entries()) {
        const createdPlay = await playApi.uploadPlay({
          authorName: form.authorName.trim(),
          title: item.title.trim(),
          category: item.category.trim() || DEFAULT_CATEGORY,
          summary: item.summary.trim(),
          content: item.content.trim(),
        });
        createdPlays.push(createdPlay);
        saveSubmissionRecord(
          {
            authorName: form.authorName.trim(),
            title: item.title.trim(),
            category: item.category.trim() || DEFAULT_CATEGORY,
            summary: item.summary.trim(),
            content: item.content.trim(),
          },
          { latestPlayId: createdPlay.id },
        );
        rememberOwnedPlayId(createdPlay.id);
        setBatchProgress({ completed: index + 1, total: items.length });
      }
    } catch (reason) {
      if (createdPlays.length > 0) {
        syncLocalHistory(form.authorName);
      }

      const baseMessage = reason instanceof Error ? reason.message : '提交失败';
      showFloatingToast(
        createdPlays.length > 0
          ? `已成功提交 ${createdPlays.length}/${items.length} 篇，剩余内容上传中断：${baseMessage}`
          : baseMessage,
        'error',
      );
      return;
    } finally {
      setSubmitting(false);
      setBatchProgress(null);
    }

    syncLocalHistory(form.authorName);
    setBatchText('');
    setBatchItems([]);
    setSelectedBatchId('');
    setBatchFilter('all');
    jumpBatchPage(1);
    showFloatingToast(`已批量提交 ${items.length} 篇到待审核池。`);
  };

  const handleParseBatch = () => {
    try {
      const items = parsePlayBatchText(batchText, form.authorName.trim() || '待填写');
      if (items.length === 0) {
        showFloatingToast('没有解析到小剧场，请检查批量文本格式', 'error');
        return;
      }

      const nextItems = items.map((item) => ({
        id: makeBatchParseId(),
        title: item.title,
        category: item.category || DEFAULT_CATEGORY,
        summary: item.summary,
        content: item.content,
      }));
      setBatchItems(nextItems);
      setSelectedBatchId(nextItems[0]?.id ?? '');
      setBatchFilter('all');
      jumpBatchPage(1);
      setIsMobileBatchListExpanded(false);
      showFloatingToast(`已解析 ${nextItems.length} 篇小剧场。`);
    } catch (reason) {
      showFloatingToast(reason instanceof Error ? reason.message : '解析失败', 'error');
    }
  };

  const updateBatchItem = (id: string, patch: Partial<BatchParseItem>) => {
    setBatchItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  };

  const selectBatchItem = (id: string) => {
    setSelectedBatchId(id);
    setBatchCategoryQuery('');
    const index = filteredBatchItems.findIndex((item) => item.id === id);
    if (index < 0) {
      return;
    }

    const page = Math.floor(index / batchPageSize) + 1;
    if (page !== batchCurrentPage) {
      jumpBatchPage(page);
    }
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      if (mode === 'history') {
        return;
      }
      if (mode === 'single') {
        await handleSingleSubmit();
      }
      return;
    } catch (reason) {
      showFloatingToast(reason instanceof Error ? reason.message : '提交失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTextFile = async (file?: File | null) => {
    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      setBatchText(content);
      setBatchItems([]);
      setSelectedBatchId('');
      setMode('batch');
      if (batchFileInputRef.current) {
        batchFileInputRef.current.value = '';
      }
    } catch {
      showFloatingToast('读取 txt 失败', 'error');
    }
  };

  const addContinuationVersion = () => {
    setContinuationVersions((current) => [...current, makeContinuationVersion()]);
  };

  const removeContinuationVersion = (id: string) => {
    setContinuationVersions((current) => current.filter((version) => version.id !== id));
  };

  const updateContinuationVersion = (id: string, patch: Partial<ContinuationVersionDraft>) => {
    setContinuationVersions((current) =>
      current.map((version) => (version.id === id ? { ...version, ...patch } : version)),
    );
  };

  const handleClearAuthorHistory = () => {
    setAuthorHistory(clearAuthorHistory());
  };

  const handleDeleteSubmission = (record: BrowserSubmissionRecord) => {
    const confirmed = window.confirm(`确认删除「${record.title}」这条本地投稿记录吗？`);
    if (!confirmed) {
      return;
    }

    setSubmissionHistory(removeSubmissionRecord(record.id));
    if (editingHistoryId === record.id) {
      resetEditingState();
    }
  };

  const handleClearSubmissionHistory = () => {
    if (!submissionHistory.length) {
      return;
    }

    const confirmed = window.confirm('确认清空当前浏览器里的全部投稿记录吗？');
    if (!confirmed) {
      return;
    }

    setSubmissionHistory(clearSubmissionHistory());
    if (editingHistoryId) {
      resetEditingState();
    }
  };

  const handleDetectTitle = () => {
    const detectedTitle = detectPlayTitleFromContent(form.content);

    if (!form.content.trim()) {
      showFloatingToast('先填写正文，再识别标题', 'error');
      return;
    }

    if (!detectedTitle) {
      showFloatingToast(
        '没识别到标题。优先读取第一个双引号内容，其次读取首尾成对的 <标题>...</标题>',
        'error',
      );
      return;
    }

    setForm((current) => ({ ...current, title: detectedTitle }));
    showFloatingToast(`已自动识别标题：${detectedTitle}`);
  };

  return (
    <section className="stack-gap-lg">
      <div className="upload-grid">
        <form className="form-panel stack-gap-lg" onSubmit={handleSubmit}>
          {/* 「修改」入口下隐藏「单篇 / 批量」切换,
           * 强制只能走 single,不能混进批量流程。 */}
          {isEditOriginal ? null : (
            <div className="tab-list">
              <button
                className={mode === 'single' ? 'tab-chip active' : 'tab-chip'}
                onClick={() => setMode('single')}
                type="button"
              >
                单篇上传
              </button>
              <button
                className={mode === 'batch' ? 'tab-chip active' : 'tab-chip'}
                onClick={() => setMode('batch')}
                type="button"
              >
                批量上传
              </button>
              <button
                className={mode === 'history' ? 'tab-chip active' : 'tab-chip'}
                onClick={() => setMode('history')}
                type="button"
              >
                投稿记录
              </button>
            </div>
          )}

          {mode === 'history' && !isEditOriginal ? (
            <div className="stack-gap-lg">
              <div className="stack-gap-md">
                <div className="content-head upload-history-head">
                  <div>
                    <p className="eyebrow">History</p>
                    <h3>投稿记录</h3>
                  </div>
                  <div className="inline-actions wrap-mobile review-log-head-row">
                    {submissionHistory.length > 0 ? (
                      <button
                        className="button ghost upload-history-clear-button"
                        onClick={handleClearSubmissionHistory}
                        type="button"
                      >
                        清空
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="sub-copy">仅保存在当前浏览器,自动同步最新审核结果与审核备注。</p>
              </div>

              {submissionHistory.length === 0 ? (
                <div className="empty-panel stack-gap-md">
                  <p>你还没有本地投稿记录。</p>
                  <span className="content-meta">
                    提交成功后，这里会按最近时间保存你的投稿草稿。
                  </span>
                </div>
              ) : (
                <div className="tag-admin-list">
                  {submissionHistory.map((record) => {
                    const active = editingHistoryId === record.id;

                    return (
                      <article className="play-card stack-gap-md" key={record.id}>
                        <div className="stack-gap-md">
                          <div className="card-topline">
                            <span>{record.category || DEFAULT_CATEGORY}</span>
                            {record.latestFeedback ? (
                              <span
                                className={`status-tag ${record.latestFeedback.status === 'missing' ? 'offline' : record.latestFeedback.status}`}
                              >
                                {feedbackLabelMap[record.latestFeedback.status]}
                              </span>
                            ) : (
                              <span>
                                {active ? '当前回填中' : `已投稿 ${record.submissionCount} 次`}
                              </span>
                            )}
                          </div>
                          <div className="stack-gap-md">
                            <h3>{record.title}</h3>
                            {record.summary ? <p className="summary">{record.summary}</p> : null}
                          </div>
                          {record.latestFeedback ? (
                            <div className="stack-gap-sm">
                              <span className="content-meta">
                                {record.latestFeedback.status === 'pending'
                                  ? '当前还在等待审核。'
                                  : '最新处理结果'}
                              </span>
                              <p className="sub-copy">
                                {record.latestFeedback.reviewNote ||
                                  (record.latestFeedback.status === 'approved'
                                    ? '已通过审核，广场现在可见。'
                                    : record.latestFeedback.status === 'rejected'
                                      ? '已被拒绝，广场不会展示。'
                                      : record.latestFeedback.status === 'offline'
                                        ? '已下线，广场已隐藏。'
                                        : '')}
                              </p>
                              {record.latestFeedback.editedFields &&
                              record.latestFeedback.editedFields.length > 0 ? (
                                <p className="sub-copy">
                                  后台已调整：
                                  {record.latestFeedback.editedFields
                                    .map((field) => feedbackEditedFieldLabelMap[field])
                                    .join('、')}
                                  ，当前浏览器记录已同步最新版本。
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="meta-row">
                            <span>作者 {record.authorName}</span>
                            <span>最近提交 {formatLocalTime(record.lastSubmittedAt)}</span>
                            {record.latestFeedback?.reviewedAt ? (
                              <span>
                                处理于 {formatLocalTime(record.latestFeedback.reviewedAt)}
                              </span>
                            ) : null}
                            {record.missingDetectedAt ? (
                              <span>后台已删除 {formatLocalTime(record.missingDetectedAt)}</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="inline-actions wrap-mobile submission-action-row">
                          <button
                            className="button ghost"
                            onClick={() => handleDeleteSubmission(record)}
                            type="button"
                          >
                            删除本地记录
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              {isEditOriginal ? (
                <div className="callout callout-info upload-mode-banner">
                  <strong>「修改」模式</strong>
                  <span>
                    作者已锁定,标题 / 分类 / 简介 /
                    正文可改,审核通过后该作品所属系列下的所有版本会跟着更新。
                  </span>
                </div>
              ) : null}

              <div className="field-grid">
                <label>
                  <span>作者</span>
                  <ClearableField
                    onClear={() => setForm((current) => ({ ...current, authorName: '' }))}
                    visible={Boolean(form.authorName) && !lockAuthor}
                  >
                    <input
                      list="author-history"
                      value={form.authorName}
                      readOnly={lockAuthor}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, authorName: event.target.value }))
                      }
                      placeholder="在这里签下名字吧，我会乖乖记住"
                    />
                  </ClearableField>
                  <datalist id="author-history">
                    {authorHistory.map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                </label>
                {authorHistory.length > 0 && !lockAuthor ? (
                  <div className="stack-gap-sm">
                    <div className="inline-actions wrap-mobile author-history-inline">
                      <span className="content-meta">历史作者 {authorHistory.length} 个</span>
                      <button
                        className="button ghost"
                        onClick={handleClearAuthorHistory}
                        type="button"
                      >
                        清空作者历史
                      </button>
                    </div>
                    <div className="tag-cloud compact-tag-cloud">
                      {authorHistory.map((item) => {
                        const active = form.authorName === item;

                        return (
                          <button
                            key={item}
                            className={active ? 'tag-chip active' : 'tag-chip'}
                            onClick={() => setForm((current) => ({ ...current, authorName: item }))}
                            type="button"
                          >
                            {item}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>

              {mode === 'single' ? (
                <div className="field-grid">
                  <label>
                    <div className="field-label-row">
                      <span>分类</span>
                      {!lockTitleAndCategory ? (
                        <div className="inline-actions field-inline-actions">
                          <button
                            className="text-button field-inline-action"
                            onClick={() => {
                              setCreateCategoryOpen(true);
                              setCategoryTagsOpen(true);
                            }}
                            type="button"
                          >
                            新增分类
                          </button>
                          {tags.length > 0 ? (
                            <button
                              className="text-button field-inline-action"
                              onClick={() => setCategoryTagsOpen((current) => !current)}
                              type="button"
                            >
                              {categoryTagsOpen ? '收起分类' : '展开分类'}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <ClearableField
                      onClear={() => {
                        if (categoryQuery) {
                          setCategoryQuery('');
                          return;
                        }
                        setForm((current) => ({ ...current, category: '' }));
                      }}
                      visible={
                        (Boolean(categoryQuery) || Boolean(form.category)) && !lockTitleAndCategory
                      }
                    >
                      <input
                        value={
                          lockTitleAndCategory ? selectedCategoryNames.join(' · ') : categoryQuery
                        }
                        readOnly={lockTitleAndCategory}
                        autoComplete="off"
                        onChange={(event) => {
                          setCategoryQuery(event.target.value);
                          setCategoryTagsOpen(true);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                          }
                        }}
                        placeholder={
                          selectedCategoryNames.length > 0
                            ? `已选 ${selectedCategoryNames.join(' · ')}，可搜索已有分类`
                            : `搜索已有分类，不填记为 ${DEFAULT_CATEGORY}`
                        }
                      />
                    </ClearableField>
                  </label>
                  {!lockTitleAndCategory && categoryTagsOpen ? (
                    tags.length > 0 ? (
                      <CategoryHierarchyPicker
                        emptyText="没有匹配的分类"
                        keyword={categoryQuery}
                        tags={tags}
                        value={form.category}
                        onChange={(next) => {
                          setForm((current) => ({ ...current, category: next }));
                          setCategoryQuery('');
                        }}
                      />
                    ) : (
                      <div className="content-meta">还没有分类，可先新增分类</div>
                    )
                  ) : null}
                  <label>
                    <div className="field-label-row">
                      <span>标题</span>
                      {!lockTitleAndCategory ? (
                        <button
                          className="text-button field-inline-action"
                          onClick={handleDetectTitle}
                          type="button"
                        >
                          识别标题
                        </button>
                      ) : null}
                    </div>
                    <ClearableField
                      onClear={() => setForm((current) => ({ ...current, title: '' }))}
                      visible={Boolean(form.title) && !lockTitleAndCategory}
                    >
                      <input
                        value={form.title}
                        readOnly={lockTitleAndCategory}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, title: event.target.value }))
                        }
                        placeholder="想给这个故事，定一个怎样的标题呢？"
                      />
                    </ClearableField>
                  </label>

                  <label>
                    <span>简介（可空）</span>
                    <ClearableField
                      onClear={() => setForm((current) => ({ ...current, summary: '' }))}
                      visible={Boolean(form.summary)}
                    >
                      <input
                        value={form.summary}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, summary: event.target.value }))
                        }
                        placeholder="不填也可以，列表卡片会直接隐藏简介"
                      />
                    </ClearableField>
                  </label>

                  <label>
                    <span>内容</span>
                    <ClearableField
                      onClear={() => setForm((current) => ({ ...current, content: '' }))}
                      visible={Boolean(form.content) && !lockOriginalContent}
                    >
                      <textarea
                        rows={12}
                        value={form.content}
                        readOnly={lockOriginalContent}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, content: event.target.value }))
                        }
                        placeholder="把正文填在这里，我会逐字逐句地认真看"
                      />
                    </ClearableField>
                  </label>

                  {/* 续写版本块:每按一次"续写"追加一版,可各自填作者/简介/正文;
                   * 字段、placeholder、要求与小剧场详情页 continuation-panel 的 composer 一致。
                   * 提交时按顺序 uploadPlay(原文) → createContinuation(续写 1) → createContinuation(续写 2)…
                   * 所有续写与原文共享同一个 playId。
                   * 「修改」模式不展示续写块,也不出现「续写」按钮。 */}
                  {continuationVersions.map((version, index) => (
                    <div className="upload-continuation-block stack-gap-sm" key={version.id}>
                      <div className="upload-continuation-head">
                        <strong>{`续写版本 ${index + 1}`}</strong>
                        <button
                          className="text-button"
                          onClick={() => removeContinuationVersion(version.id)}
                          type="button"
                        >
                          删除该续写
                        </button>
                      </div>
                      <label>
                        <span>作者（与原文作者为同一人可留空）</span>
                        <ClearableField
                          onClear={() => updateContinuationVersion(version.id, { nickname: '' })}
                          visible={Boolean(version.nickname)}
                        >
                          <input
                            value={version.nickname}
                            onChange={(event) =>
                              updateContinuationVersion(version.id, {
                                nickname: event.target.value,
                              })
                            }
                            placeholder="写下你的笔名"
                          />
                        </ClearableField>
                      </label>
                      <label>
                        <span>简介</span>
                        <ClearableField
                          onClear={() => updateContinuationVersion(version.id, { summary: '' })}
                          visible={Boolean(version.summary)}
                        >
                          <input
                            value={version.summary}
                            onChange={(event) =>
                              updateContinuationVersion(version.id, { summary: event.target.value })
                            }
                            placeholder="告诉大家这是哪个版本或者增加的什么类型的指令"
                          />
                        </ClearableField>
                      </label>
                      <label>
                        <span>正文</span>
                        <ClearableField
                          onClear={() => updateContinuationVersion(version.id, { content: '' })}
                          visible={Boolean(version.content)}
                        >
                          <textarea
                            rows={10}
                            value={version.content}
                            onChange={(event) =>
                              updateContinuationVersion(version.id, { content: event.target.value })
                            }
                            placeholder="把续写的正文填在这里"
                          />
                        </ClearableField>
                      </label>
                    </div>
                  ))}

                  {/* 单篇模式的底部按钮区:续写按钮 + 上传小剧场按钮
                   * 位置始终在最后一个续写块下方(动态追加时自动往下推)。
                   * 「修改」入口下隐藏「续写」按钮,只允许提交修改。 */}
                  <div className="inline-actions wrap-mobile upload-single-action-row">
                    {isEditOriginal ? null : (
                      <button
                        className="button secondary"
                        onClick={addContinuationVersion}
                        type="button"
                        disabled={submitting}
                      >
                        续写
                      </button>
                    )}
                    <button
                      className="button primary upload-submit-button"
                      disabled={singleDisabled}
                      type="submit"
                    >
                      {submitting
                        ? '提交中...'
                        : isEditOriginal
                          ? '提交修改'
                          : editingHistoryId
                            ? '重新投稿'
                            : continuationVersions.length > 0
                              ? `上传小剧场（原文 + ${continuationVersions.length} 条续写）`
                              : '上传小剧场'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="field-grid">
                  <label>
                    <span>批量文本</span>
                    <ClearableField
                      onClear={() => {
                        setBatchText('');
                        setBatchItems([]);
                        setSelectedBatchId('');
                      }}
                      visible={Boolean(batchText)}
                    >
                      <textarea
                        rows={18}
                        value={batchText}
                        onChange={(event) => {
                          setBatchText(event.target.value);
                          setBatchItems([]);
                          setSelectedBatchId('');
                        }}
                        placeholder="写了这么多呀，有点看不过来了"
                      />
                    </ClearableField>
                  </label>
                  <div className="template-code subdued-template">{`${batchTemplate}\n\n${batchTemplate}`}</div>
                  <div className="inline-actions wrap-mobile upload-batch-action-row">
                    <label className="button secondary file-button">
                      <span>上传 txt</span>
                      <input
                        ref={batchFileInputRef}
                        accept=".txt,text/plain"
                        onChange={(event) => void handleTextFile(event.target.files?.[0])}
                        type="file"
                      />
                    </label>
                    <button
                      className="button primary"
                      disabled={batchDisabled || submitting}
                      onClick={handleParseBatch}
                      type="button"
                    >
                      {batchItemCount > 0 ? `开始解析（${batchItemCount} 篇）` : '开始解析'}
                    </button>
                  </div>
                  {batchItemCount > 0 ? (
                    <p className="content-meta">
                      已识别 {batchItemCount} 篇小剧场。点击开始解析后可逐篇检查，再确认上传。
                    </p>
                  ) : null}
                  {batchItems.length > 0 ? (
                    <div className="stack-gap-md batch-parse-panel">
                      <div className="content-head wrap-mobile">
                        <div>
                          <h3>批量解析列表</h3>
                          <p className="sub-copy">
                            先检查分类和简介，确认无误后再上传。上传时会使用上方的作者署名。
                          </p>
                        </div>
                        <button
                          className="button primary"
                          disabled={submitting || batchItems.length === 0}
                          onClick={() => void handleBatchSubmit()}
                          type="button"
                        >
                          {submitting
                            ? batchProgress
                              ? `上传中 ${batchProgress.completed}/${batchProgress.total}`
                              : '提交中...'
                            : `确认上传（${batchItems.length} 篇）`}
                        </button>
                      </div>
                      {submitting && batchProgress ? (
                        <p className="content-meta">
                          正在依次上传 {batchProgress.completed}/{batchProgress.total}{' '}
                          篇，请先别关闭页面。
                        </p>
                      ) : null}

                      <div className="inline-actions wrap-mobile admin-status-tabs">
                        {(
                          [
                            { value: 'all', label: `全部（${batchFilterCounts.all}）` },
                            {
                              value: 'uncategorized',
                              label: `未分类（${batchFilterCounts.uncategorized}）`,
                            },
                            {
                              value: 'no-summary',
                              label: `无简介（${batchFilterCounts.noSummary}）`,
                            },
                            {
                              value: 'uncategorized-no-summary',
                              label: `未分类且无简介（${batchFilterCounts.both}）`,
                            },
                          ] as Array<{ value: BatchParseFilter; label: string }>
                        ).map((tab) => (
                          <button
                            className={batchFilter === tab.value ? 'tab-chip active' : 'tab-chip'}
                            key={tab.value}
                            onClick={() => {
                              setBatchFilter(tab.value);
                              jumpBatchPage(1);
                            }}
                            type="button"
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      <div className="review-layout review-layout-wide">
                        <aside className="review-sidebar stack-gap-md">
                          <div className="form-panel compact-panel stack-gap-md plaza-pagination-panel">
                            <div className="plaza-pagination-toolbar">
                              <div className="inline-actions plaza-pagination-nav">
                                <button
                                  className="button secondary icon-page-button"
                                  disabled={safeBatchPage <= 1}
                                  onClick={() => jumpBatchPage(1)}
                                  title="第一页"
                                  type="button"
                                >
                                  ≪
                                </button>
                                <button
                                  className="button secondary icon-page-button"
                                  disabled={safeBatchPage <= 1}
                                  onClick={() => jumpBatchPage(safeBatchPage - 1)}
                                  title="上一页"
                                  type="button"
                                >
                                  ‹
                                </button>
                              </div>
                              <span className="content-meta plaza-page-indicator">
                                第 {safeBatchPage} / {batchTotalPages} 页
                              </span>
                              <div className="inline-actions plaza-pagination-nav plaza-pagination-nav-end">
                                <button
                                  className="button secondary icon-page-button"
                                  disabled={safeBatchPage >= batchTotalPages}
                                  onClick={() => jumpBatchPage(safeBatchPage + 1)}
                                  title="下一页"
                                  type="button"
                                >
                                  ›
                                </button>
                                <button
                                  className="button secondary icon-page-button"
                                  disabled={safeBatchPage >= batchTotalPages}
                                  onClick={() => jumpBatchPage(batchTotalPages)}
                                  title="最后一页"
                                  type="button"
                                >
                                  ≫
                                </button>
                              </div>
                              <div className="inline-actions plaza-page-control-inline">
                                <label
                                  className="plaza-page-size-field"
                                  htmlFor="batch-parse-page-size-input"
                                >
                                  <span className="content-meta plaza-page-size-copy">每页</span>
                                  <input
                                    id="batch-parse-page-size-input"
                                    inputMode="numeric"
                                    max={MAX_BATCH_PARSE_PAGE_SIZE}
                                    min={MIN_BATCH_PARSE_PAGE_SIZE}
                                    onBlur={() => {
                                      if (!/^\d+$/.test(batchPageSizeInput)) {
                                        setBatchPageSizeInput(String(batchPageSize));
                                        return;
                                      }
                                      setBatchPageSize(
                                        clampBatchParsePageSize(Number(batchPageSizeInput)),
                                      );
                                    }}
                                    onChange={(event) => {
                                      const cleaned = event.target.value.replace(/\D+/g, '');
                                      setBatchPageSizeInput(cleaned);
                                      if (/^\d+$/.test(cleaned)) {
                                        setBatchPageSize(clampBatchParsePageSize(Number(cleaned)));
                                        jumpBatchPage(1);
                                      }
                                    }}
                                    value={batchPageSizeInput}
                                  />
                                  <span className="content-meta plaza-page-size-copy">个</span>
                                </label>
                                <div className="inline-actions plaza-page-jump-inline">
                                  <span className="content-meta plaza-page-jump-copy">第</span>
                                  <label className="page-jump-field page-jump-field-compact">
                                    <input
                                      inputMode="numeric"
                                      max={batchTotalPages}
                                      min={1}
                                      onChange={(event) =>
                                        setBatchPageInput(event.target.value.replace(/\D+/g, ''))
                                      }
                                      value={batchPageInput}
                                    />
                                  </label>
                                  <span className="content-meta plaza-page-jump-copy">页</span>
                                  <button
                                    className="button primary plaza-page-jump-button"
                                    onClick={() => {
                                      const next = Number(batchPageInput);
                                      if (
                                        !Number.isFinite(next) ||
                                        next < 1 ||
                                        next > batchTotalPages
                                      ) {
                                        showFloatingToast(
                                          `页数范围是 1 到 ${batchTotalPages}`,
                                          'error',
                                        );
                                        return;
                                      }
                                      jumpBatchPage(next);
                                    }}
                                    type="button"
                                  >
                                    跳转
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="review-list">
                            {shouldCollapseMobileBatchList ? (
                              <div className="inline-actions review-list-mobile-toggle-row">
                                <span className="content-meta">
                                  手机端先显示前 {MOBILE_BATCH_LIST_PREVIEW_COUNT} 条，当前“
                                  {batchFilterLabel}”列表共 {filteredBatchItems.length} 条
                                </span>
                                <button
                                  className="button ghost"
                                  onClick={() =>
                                    setIsMobileBatchListExpanded((current) => !current)
                                  }
                                  type="button"
                                >
                                  {isMobileBatchListExpanded ? '收起' : '展开'}
                                </button>
                              </div>
                            ) : null}
                            {visibleBatchItems.map((item) => (
                              <article className="review-card-shell" key={item.id}>
                                <div
                                  className={
                                    selectedBatchId === item.id
                                      ? 'review-card active'
                                      : 'review-card'
                                  }
                                >
                                  <button
                                    className="review-card-main"
                                    onClick={() => selectBatchItem(item.id)}
                                    type="button"
                                  >
                                    <div className="card-topline">
                                      <span className="status-tag pending">待上传</span>
                                      <div className="compact-meta-row compact-meta-row-small compact-meta-row-end">
                                        <span className="compact-meta-item">
                                          ◈ {item.category || DEFAULT_CATEGORY}
                                        </span>
                                      </div>
                                    </div>
                                    <strong>{item.title}</strong>
                                  </button>
                                  <div className="review-card-summary-row">
                                    <span className="summary review-card-summary-text">
                                      {item.summary.trim() ? item.summary : '无简介'}
                                    </span>
                                  </div>
                                </div>
                              </article>
                            ))}
                            {filteredBatchItems.length === 0 ? (
                              <div className="empty-panel">这个筛选下没有内容。</div>
                            ) : null}
                          </div>
                        </aside>

                        <section className="review-main review-main-wide stack-gap-lg">
                          {selectedBatchItem ? (
                            <>
                              <div className="admin-review-mode-line">
                                <div className="inline-actions wrap-mobile admin-review-view-mode-row admin-mode-lefthalf">
                                  <span className="content-meta">查看模式</span>
                                  <button
                                    className={
                                      batchViewMode === 'preview' ? 'tab-chip active' : 'tab-chip'
                                    }
                                    onClick={() => setBatchViewMode('preview')}
                                    type="button"
                                  >
                                    仅预览
                                  </button>
                                  <button
                                    className={
                                      batchViewMode === 'edit' ? 'tab-chip active' : 'tab-chip'
                                    }
                                    onClick={() => setBatchViewMode('edit')}
                                    type="button"
                                  >
                                    仅编辑
                                  </button>
                                  <button
                                    className={
                                      batchViewMode === 'both' ? 'tab-chip active' : 'tab-chip'
                                    }
                                    onClick={() => setBatchViewMode('both')}
                                    type="button"
                                  >
                                    编辑 + 预览
                                  </button>
                                </div>
                                <div className="inline-actions admin-adjacent-row admin-mode-righthalf">
                                  <button
                                    className="button secondary admin-mode-adjacent-button"
                                    disabled={!previousBatchId}
                                    onClick={() => selectBatchItem(previousBatchId)}
                                    type="button"
                                  >
                                    上一篇
                                  </button>
                                  <button
                                    className="button secondary admin-mode-adjacent-button"
                                    disabled={!nextBatchId}
                                    onClick={() => selectBatchItem(nextBatchId)}
                                    type="button"
                                  >
                                    下一篇
                                  </button>
                                </div>
                              </div>

                              {batchViewMode !== 'edit' ? (
                                <div className="detail-panel stack-gap-md">
                                  <div className="card-topline">
                                    <span className="status-tag pending">待上传</span>
                                    <span>{selectedBatchItem.category || DEFAULT_CATEGORY}</span>
                                  </div>
                                  <div className="preview-section-header">
                                    <h3>{selectedBatchItem.title}</h3>
                                  </div>
                                  {selectedBatchItem.summary.trim() ? (
                                    <p className="sub-copy">{selectedBatchItem.summary}</p>
                                  ) : (
                                    <p className="sub-copy content-meta">（无简介）</p>
                                  )}
                                  <div className="inline-detail-block stack-gap-md preview-content-block">
                                    <div className="preview-section-header">
                                      <span className="content-meta">
                                        正文约 {selectedBatchItem.content.length} 字
                                      </span>
                                    </div>
                                    <p>{selectedBatchItem.content}</p>
                                  </div>
                                </div>
                              ) : null}

                              {batchViewMode !== 'preview' ? (
                                <div className="form-panel stack-gap-md">
                                  <label>
                                    <span>标题</span>
                                    <input
                                      onChange={(event) =>
                                        updateBatchItem(selectedBatchItem.id, {
                                          title: event.target.value,
                                        })
                                      }
                                      placeholder="标题不能为空"
                                      value={selectedBatchItem.title}
                                    />
                                  </label>
                                  <label>
                                    <div className="field-label-row">
                                      <span>分类</span>
                                      <div className="inline-actions field-inline-actions">
                                        <button
                                          className="text-button field-inline-action"
                                          onClick={() => {
                                            setCreateCategoryOpen(true);
                                            setBatchCategoryOpen(true);
                                          }}
                                          type="button"
                                        >
                                          新增分类
                                        </button>
                                        {tags.length > 0 ? (
                                          <button
                                            className="text-button field-inline-action"
                                            onClick={() =>
                                              setBatchCategoryOpen((current) => !current)
                                            }
                                            type="button"
                                          >
                                            {batchCategoryOpen ? '收起分类' : '展开分类'}
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                    <ClearableField
                                      onClear={() => {
                                        if (batchCategoryQuery) {
                                          setBatchCategoryQuery('');
                                          return;
                                        }
                                        updateBatchItem(selectedBatchItem.id, { category: '' });
                                      }}
                                      visible={
                                        Boolean(batchCategoryQuery) ||
                                        Boolean(selectedBatchItem.category)
                                      }
                                    >
                                      <input
                                        autoComplete="off"
                                        onChange={(event) => {
                                          setBatchCategoryQuery(event.target.value);
                                          setBatchCategoryOpen(true);
                                        }}
                                        onKeyDown={(event) => {
                                          if (event.key === 'Enter') {
                                            event.preventDefault();
                                          }
                                        }}
                                        placeholder={
                                          splitPlayCategories(selectedBatchItem.category).length > 0
                                            ? `已选 ${splitPlayCategories(selectedBatchItem.category).join(' · ')}，可搜索已有分类`
                                            : `搜索已有分类，不填记为 ${DEFAULT_CATEGORY}`
                                        }
                                        value={batchCategoryQuery}
                                      />
                                    </ClearableField>
                                  </label>
                                  {batchCategoryOpen ? (
                                    tags.length > 0 ? (
                                      <CategoryHierarchyPicker
                                        emptyText="没有匹配的分类"
                                        keyword={batchCategoryQuery}
                                        onChange={(next) => {
                                          updateBatchItem(selectedBatchItem.id, { category: next });
                                          setBatchCategoryQuery('');
                                        }}
                                        tags={tags}
                                        value={selectedBatchItem.category}
                                      />
                                    ) : (
                                      <div className="content-meta">还没有分类，可先新增分类</div>
                                    )
                                  ) : null}
                                  <label>
                                    <span>简介（可空）</span>
                                    <input
                                      onChange={(event) =>
                                        updateBatchItem(selectedBatchItem.id, {
                                          summary: event.target.value,
                                        })
                                      }
                                      placeholder="留空则前台不展示简介"
                                      value={selectedBatchItem.summary}
                                    />
                                  </label>
                                  <label>
                                    <span>正文</span>
                                    <textarea
                                      className="admin-review-content-textarea batch-parse-content-textarea"
                                      onChange={(event) =>
                                        updateBatchItem(selectedBatchItem.id, {
                                          content: event.target.value,
                                        })
                                      }
                                      placeholder="解析后可直接修正正文"
                                      ref={batchContentRef}
                                      rows={1}
                                      value={selectedBatchItem.content}
                                    />
                                  </label>
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <div className="empty-panel">
                              {isMobileBatchViewport
                                ? '先从上面选择一篇内容。'
                                : '先从左侧选择一篇内容。'}
                            </div>
                          )}
                        </section>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* 只在回填历史时才显示"取消回填"按钮;
               * single 模式的提交按钮已经渲染在原文/衍生版本组的底部按钮区,不再重复。
               * batch 模式的提交按钮由"批量文本"区块内部的 upload-batch-action-row 承担。 */}
              {editingHistoryId ? (
                <div className="action-bar wrap-mobile action-bar-half">
                  <button
                    className="button ghost upload-reset-button"
                    onClick={resetEditingState}
                    type="button"
                  >
                    取消回填
                  </button>
                </div>
              ) : null}
            </>
          )}
        </form>
      </div>
      {createCategoryOpen ? (
        <div className="modal-overlay" onClick={closeCreateCategoryModal} role="presentation">
          <div
            aria-labelledby="create-category-title"
            aria-modal="true"
            className="modal-panel stack-gap-md create-category-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h3 id="create-category-title" className="modal-title">
              新增分类
            </h3>
            <p className="sub-copy">选择所属大类，再填写新的小类名称。</p>
            <label>
              <span>所属大类</span>
              <select
                disabled={createCategoryBusy || groupTags.length === 0}
                onChange={(event) => setCreateCategoryGroupId(event.target.value)}
                value={createCategoryGroupId}
              >
                <option value="">请选择大类</option>
                {groupTags.map((group) => {
                  const childNames = getChildTagNames(tags, group);
                  return (
                    <option key={group.id} value={group.id}>
                      {childNames.length > 0
                        ? `${group.name}（${childNames.join('、')}）`
                        : `${group.name}（暂无小类）`}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              <span>新分类名称</span>
              <ClearableField
                onClear={() => setCreateCategoryName('')}
                visible={Boolean(createCategoryName)}
              >
                <input
                  autoFocus
                  disabled={createCategoryBusy}
                  onChange={(event) => setCreateCategoryName(event.target.value)}
                  placeholder="输入新的小类名"
                  value={createCategoryName}
                />
              </ClearableField>
            </label>
            {groupTags.length === 0 ? (
              <div className="feedback error">当前还没有大类，无法新增分类</div>
            ) : null}
            <div className="inline-actions modal-action-row">
              <button
                className="button ghost"
                disabled={createCategoryBusy}
                onClick={closeCreateCategoryModal}
                type="button"
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={createCategoryBusy || groupTags.length === 0}
                onClick={() => void handleCreateCategory()}
                type="button"
              >
                {createCategoryBusy ? '创建中...' : '确认新增'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {mode === 'batch' && batchItems.length > 0 && isMobileBatchViewport ? (
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
    </section>
  );
}
