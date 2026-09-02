import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import {
  countPlayBatchItems,
  detectPlayTitleFromContent,
  parsePlayBatchText,
} from '../../services/play-text';
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
import { rememberOwnedPlayId } from '../../services/browser-repo-history';
import { showFloatingToast } from '../../components/floating-toast-store';

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
  existingDerived: Array<{ summary: string; content: string }>;
  appendDerived: boolean;
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
Category: （分类，可留空，默认无分类）
Desc: （简介，可留空，默认无简介）
（正文）`;

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

/* 衍生版本填写块:主表单是"原文",derivedVersions 是原文之下依次追加的衍生。
 * 提交时按顺序调用 uploadPlay(原文) → uploadPlay(版本1) → uploadPlay(版本2)…,
 * 每个版本共享主表单的作者/分类/标题,只维护自己的简介/内容。 */
type DerivedVersionDraft = {
  id: string;
  summary: string;
  content: string;
  locked?: boolean;
};

const makeDerivedVersion = (): DerivedVersionDraft => ({
  id:
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `derived-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
  const [categoryTagsOpen, setCategoryTagsOpen] = useState(() =>
    readUploadBool(UPLOAD_CATEGORY_TAGS_OPEN_KEY, true),
  );
  const [authorHistory, setAuthorHistory] = useState<string[]>([]);
  const [submissionHistory, setSubmissionHistory] = useState<BrowserSubmissionRecord[]>([]);
  const [editingHistoryId, setEditingHistoryId] = useState('');
  const [batchProgress, setBatchProgress] = useState<{ completed: number; total: number } | null>(
    null,
  );
  const [derivedVersions, setDerivedVersions] = useState<DerivedVersionDraft[]>([]);
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
   * appendDerived 时：原文 + 已有衍生只用于展示，末尾追加一个空的新衍生。
   * editOriginalId 时：只预填原文，提交即作为同一标题同分类的下一版。 */
  const prefillKey = JSON.stringify(prefill ?? null);
  const appendDerived = Boolean(prefill?.appendDerived);
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
    const existing = (prefill.existingDerived ?? []).map((item) => ({
      ...makeDerivedVersion(),
      summary: item.summary ?? '',
      content: item.content ?? '',
      locked: true,
    }));
    if (isEditOriginal) {
      /* 「修改」模式只展示原文,不预填任何已有版本,也不在末尾追加新衍生。 */
      setDerivedVersions([]);
    } else {
      setDerivedVersions(appendDerived ? [...existing, makeDerivedVersion()] : existing);
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

  /* 新增的衍生版本（非 locked） */
  const newDerivedVersions = useMemo(
    () => derivedVersions.filter((version) => !version.locked),
    [derivedVersions],
  );

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

  /* appendDerived 模式下,只校验末尾新增的衍生是否都填了内容;
   * 「修改原文」模式不涉及衍生版本。 */
  const derivedInvalid = useMemo(() => {
    if (isEditOriginal) return false;
    if (newDerivedVersions.some((version) => !version.content.trim())) {
      return true;
    }
    return false;
  }, [isEditOriginal, newDerivedVersions]);

  /* appendDerived 模式下,必须至少有一个末尾新增的衍生版本才会允许提交。 */
  const appendHasSomethingToSubmit = !isEditOriginal && newDerivedVersions.length > 0;

  /* 「修改」/「上传衍生」入口下,作者不允许编辑(作者不属于同系列聚合键);
   * 「上传衍生」还要锁定原文与已有衍生版本,标题/分类保持只读;
   * 「修改」开放标题/分类编辑,审核通过后同系列下所有作品会一起重写到新键。 */
  const isLocked = isEditOriginal || appendDerived;
  const lockAuthor = isLocked;
  const lockTitleAndCategory = appendDerived;
  const lockOriginalContent = appendDerived;

  const singleDisabled = useMemo(
    () =>
      submitting ||
      !form.authorName.trim() ||
      !form.title.trim() ||
      (isEditOriginal
        ? !originalChanged
        : appendDerived
          ? !appendHasSomethingToSubmit
          : !form.content.trim()) ||
      derivedInvalid,
    [
      appendDerived,
      appendHasSomethingToSubmit,
      isEditOriginal,
      originalChanged,
      derivedInvalid,
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

  useEffect(() => {
    const loadTags = async () => {
      try {
        const items = await playApi.getTags();
        setTags(items);
      } catch {
        setTags([]);
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

  const syncLocalHistory = (authorName: string) => {
    setAuthorHistory(rememberAuthorName(authorName));
    setSubmissionHistory(getSubmissionHistory());
  };

  const resetEditingState = () => {
    setEditingHistoryId('');
    setForm(initialForm);
    setDerivedVersions([]);
  };

  const handleSingleSubmit = async () => {
    const authorName = form.authorName.trim();
    const title = form.title.trim();
    const category = form.category.trim() || DEFAULT_CATEGORY;

    const originalDraft = {
      authorName,
      title,
      category,
      summary: form.summary.trim(),
      content: form.content.trim(),
    };

    /* 三个模式:
     * 1) isEditOriginal：详情页「修改」入口,直接调用 updatePlay 把改动写入
     *    原 play 的 pendingEdit 字段,不创建新 play。审核通过后
     *    applySeriesRename 会同步更新同系列下其他作品的 title/category。
     * 2) appendDerived：详情页「上传衍生」入口,只追加末尾新增的衍生版本,
     *    携带 submissionType=derived;原文与已有版本锁定为只读。
     * 3) 普通模式:先投原文(submissionType=original),再按顺序投衍生。 */
    if (isEditOriginal) {
      const updated = await playApi.updatePlay(editOriginalId, originalDraft);
      /* 仍是同一 play,只更新本地记录的 latestPlayId(同 id)。 */
      saveSubmissionRecord(originalDraft, { latestPlayId: updated.id });
      rememberOwnedPlayId(updated.id);

      syncLocalHistory(authorName);
      setForm(initialForm);
      setDerivedVersions([]);
      setOriginalSnapshot(null);
      setEditingHistoryId('');

      showFloatingToast('修改已提交,等待审核。');
      return;
    }

    if (!appendDerived) {
      const createdOriginal = await playApi.uploadPlay({
        ...originalDraft,
        submissionType: 'original',
      });
      saveSubmissionRecord(originalDraft, {
        historyId: editingHistoryId || undefined,
        latestPlayId: createdOriginal.id,
      });
      rememberOwnedPlayId(createdOriginal.id);

      const derivedDrafts = derivedVersions.map((version) => ({
        authorName,
        title,
        category,
        summary: version.summary.trim(),
        content: version.content.trim(),
      }));
      for (const draft of derivedDrafts) {
        const created = await playApi.uploadPlay({ ...draft, submissionType: 'derived' });
        saveSubmissionRecord(draft, { latestPlayId: created.id });
        rememberOwnedPlayId(created.id);
      }

      syncLocalHistory(authorName);
      setForm(initialForm);
      setDerivedVersions([]);
      setEditingHistoryId('');

      if (derivedDrafts.length > 0) {
        showFloatingToast(`已提交原文和 ${derivedDrafts.length} 个衍生版本到待审核池。`);
      } else {
        showFloatingToast(editingHistoryId ? '已重新投稿，已再次进入审核。' : '已提交到待审核池。');
      }
      return;
    }

    /* appendDerived 模式:只追加末尾新增的衍生版本。 */
    for (const version of newDerivedVersions) {
      const draft = {
        authorName,
        title,
        category,
        summary: version.summary.trim(),
        content: version.content.trim(),
      };
      const created = await playApi.uploadPlay({ ...draft, submissionType: 'derived' });
      saveSubmissionRecord(draft, { latestPlayId: created.id });
      rememberOwnedPlayId(created.id);
    }

    syncLocalHistory(authorName);
    setForm(initialForm);
    setDerivedVersions([]);
    setOriginalSnapshot(null);
    setEditingHistoryId('');

    showFloatingToast(`已提交 ${newDerivedVersions.length} 个新增衍生版本到待审核池。`);
  };

  const handleBatchSubmit = async () => {
    const items = parsePlayBatchText(batchText, form.authorName);
    if (items.length === 0) {
      throw new Error('批量内容为空');
    }

    setBatchProgress({ completed: 0, total: items.length });

    const createdPlays = [] as Awaited<ReturnType<typeof playApi.uploadPlay>>[];

    try {
      for (const [index, item] of items.entries()) {
        const createdPlay = await playApi.uploadPlay(item);
        createdPlays.push(createdPlay);
        saveSubmissionRecord(item, { latestPlayId: createdPlay.id });
        rememberOwnedPlayId(createdPlay.id);
        setBatchProgress({ completed: index + 1, total: items.length });
      }
    } catch (reason) {
      if (createdPlays.length > 0) {
        syncLocalHistory(form.authorName);
      }

      const baseMessage = reason instanceof Error ? reason.message : '提交失败';
      throw new Error(
        createdPlays.length > 0
          ? `已成功提交 ${createdPlays.length}/${items.length} 篇，剩余内容上传中断：${baseMessage}`
          : baseMessage,
        { cause: reason },
      );
    } finally {
      setBatchProgress(null);
    }

    syncLocalHistory(form.authorName);
    setBatchText('');
    showFloatingToast(`已批量提交 ${items.length} 篇到待审核池。`);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      if (mode === 'single') {
        await handleSingleSubmit();
      } else {
        await handleBatchSubmit();
      }
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
      setMode('batch');
    } catch {
      showFloatingToast('读取 txt 失败', 'error');
    }
  };

  const addDerivedVersion = () => {
    setDerivedVersions((current) => [...current, makeDerivedVersion()]);
  };

  const removeDerivedVersion = (id: string) => {
    setDerivedVersions((current) =>
      current.filter((version) => version.locked || version.id !== id),
    );
  };

  const updateDerivedVersion = (id: string, patch: Partial<DerivedVersionDraft>) => {
    setDerivedVersions((current) =>
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
          {/* 「修改」/「上传衍生」入口下隐藏「单篇 / 批量」切换,
           * 强制只能走 single,不能混进批量流程。 */}
          {isEditOriginal || appendDerived ? null : (
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
            </div>
          )}

          {isEditOriginal ? (
            <div className="callout callout-info upload-mode-banner">
              <strong>「修改」模式</strong>
              <span>
                作者已锁定,标题 / 分类 / 简介 /
                正文可改,审核通过后该作品所属系列下的所有版本会跟着更新。
              </span>
            </div>
          ) : null}

          {appendDerived ? (
            <div className="callout callout-info upload-mode-banner">
              <strong>「上传衍生」模式</strong>
              <span>原文与已有衍生版本已锁定,仅能在末尾追加新的衍生版本</span>
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
                  <button className="button ghost" onClick={handleClearAuthorHistory} type="button">
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
                  {tags.length > 0 && !lockTitleAndCategory ? (
                    <button
                      className="text-button field-inline-action"
                      onClick={() => setCategoryTagsOpen((current) => !current)}
                      type="button"
                    >
                      {categoryTagsOpen ? '收起分类' : '展开分类'}
                    </button>
                  ) : null}
                </div>
                <ClearableField
                  onClear={() => setForm((current) => ({ ...current, category: '' }))}
                  visible={Boolean(form.category) && !lockTitleAndCategory}
                >
                  <input
                    list="category-tags"
                    value={form.category}
                    readOnly={lockTitleAndCategory}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, category: event.target.value }))
                    }
                    placeholder={`可自定义分类，不填会自动记为 ${DEFAULT_CATEGORY}`}
                  />
                </ClearableField>
              </label>
              {tags.length > 0 && !lockTitleAndCategory ? (
                <>
                  <datalist id="category-tags">
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.name} />
                    ))}
                  </datalist>
                  {categoryTagsOpen ? (
                    <div className="tag-cloud compact-tag-cloud">
                      {tags.map((tag) => {
                        const active = form.category === tag.name;

                        return (
                          <button
                            key={tag.id}
                            className={active ? 'tag-chip active' : 'tag-chip'}
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                category: current.category === tag.name ? '' : tag.name,
                              }))
                            }
                            type="button"
                          >
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </>
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

              {/* 衍生版本块:每按一次"衍生"追加一版,可各自填简介 + 内容;
               * 与原文共享 作者/标题/分类,列表页/详情页会按同标题+分类聚合展示。
               * 「上传衍生」模式下,原文与已有版本都不允许改字;
               * 「修改」模式不展示衍生块,不出现「衍生」按钮。 */}
              {derivedVersions.map((version, index) => {
                const headLabel = version.locked
                  ? `已有版本 ${index + 1}`
                  : `衍生版本 ${index + 1}${appendDerived ? '（新增）' : ''}`;
                const versionReadOnly = version.locked;
                return (
                  <div className="upload-derived-block stack-gap-sm" key={version.id}>
                    <div className="upload-derived-head">
                      <strong>{headLabel}</strong>
                      {version.locked ? null : (
                        <button
                          className="text-button"
                          onClick={() => removeDerivedVersion(version.id)}
                          type="button"
                        >
                          删除该版本
                        </button>
                      )}
                    </div>
                    <label>
                      <span>简介（可空）</span>
                      <ClearableField
                        onClear={() => updateDerivedVersion(version.id, { summary: '' })}
                        visible={Boolean(version.summary) && !versionReadOnly}
                      >
                        <input
                          value={version.summary}
                          readOnly={versionReadOnly}
                          onChange={(event) =>
                            updateDerivedVersion(version.id, { summary: event.target.value })
                          }
                          placeholder="不填也可以，列表卡片会直接隐藏简介"
                        />
                      </ClearableField>
                    </label>
                    <label>
                      <span>内容</span>
                      <ClearableField
                        onClear={() => updateDerivedVersion(version.id, { content: '' })}
                        visible={Boolean(version.content) && !versionReadOnly}
                      >
                        <textarea
                          rows={10}
                          value={version.content}
                          readOnly={versionReadOnly}
                          onChange={(event) =>
                            updateDerivedVersion(version.id, { content: event.target.value })
                          }
                          placeholder="写下这一版本的正文，与原文共享作者、标题、分类"
                        />
                      </ClearableField>
                    </label>
                  </div>
                );
              })}

              {/* 单篇模式的底部按钮区:衍生按钮 + 上传小剧场按钮
               * 位置始终在最后一个版本框下方(动态追加时自动往下推)。
               * 「修改」入口下隐藏「衍生」按钮,只允许提交修改;
               * 「上传衍生」入口下保留「衍生」按钮,用于追加更多空版本。 */}
              <div className="inline-actions wrap-mobile upload-single-action-row">
                {isEditOriginal ? null : (
                  <button
                    className="button secondary"
                    onClick={addDerivedVersion}
                    type="button"
                    disabled={submitting}
                  >
                    衍生
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
                        : appendDerived
                          ? `上传衍生（${newDerivedVersions.length} 版）`
                          : derivedVersions.length > 0
                            ? `上传小剧场（原文 + ${derivedVersions.length} 个衍生）`
                            : '上传小剧场'}
                </button>
              </div>
            </div>
          ) : (
            <div className="field-grid">
              <label>
                <span>批量文本</span>
                <ClearableField onClear={() => setBatchText('')} visible={Boolean(batchText)}>
                  <textarea
                    rows={18}
                    value={batchText}
                    onChange={(event) => setBatchText(event.target.value)}
                    placeholder="写了这么多呀，有点看不过来了"
                  />
                </ClearableField>
              </label>
              <div className="template-code subdued-template">{`${batchTemplate}\n\n${batchTemplate}`}</div>
              <div className="inline-actions wrap-mobile upload-batch-action-row">
                <label className="button secondary file-button">
                  <span>上传 txt</span>
                  <input
                    accept=".txt,text/plain"
                    onChange={(event) => void handleTextFile(event.target.files?.[0])}
                    type="file"
                  />
                </label>
                <button className="button primary" disabled={batchDisabled} type="submit">
                  {submitting
                    ? batchProgress
                      ? `上传中 ${batchProgress.completed}/${batchProgress.total}`
                      : '提交中...'
                    : batchItemCount > 0
                      ? `批量上传（${batchItemCount} 篇）`
                      : '批量上传'}
                </button>
              </div>
              {batchItemCount > 0 ? (
                <p className="content-meta">
                  已识别 {batchItemCount} 篇小剧场。
                  {!form.authorName.trim() ? ' 点击上传时会先提示填写作者署名。' : ''}
                </p>
              ) : null}
              {submitting && batchProgress ? (
                <p className="content-meta">
                  正在依次上传 {batchProgress.completed}/{batchProgress.total} 篇，请先别关闭页面。
                </p>
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
        </form>

        <aside className="review-sidebar stack-gap-lg">
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
              <span className="content-meta">提交成功后，这里会按最近时间保存你的投稿草稿。</span>
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
                          <span>处理于 {formatLocalTime(record.latestFeedback.reviewedAt)}</span>
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
        </aside>
      </div>
    </section>
  );
}
