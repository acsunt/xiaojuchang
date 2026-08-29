import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { showFloatingToast } from '../../components/FloatingToast';

const initialForm = {
  authorName: '',
  title: '',
  category: '',
  summary: '',
  content: '',
};

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

export function UploadPage() {
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
  const batchItemCount = useMemo(() => countPlayBatchItems(batchText), [batchText]);

  const singleDisabled = useMemo(
    () => submitting || !form.authorName.trim() || !form.title.trim() || !form.content.trim(),
    [form, submitting],
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
  };

  const handleSingleSubmit = async () => {
    const draft = {
      authorName: form.authorName.trim(),
      title: form.title.trim(),
      category: form.category.trim() || DEFAULT_CATEGORY,
      summary: form.summary.trim(),
      content: form.content.trim(),
    };

    const createdPlay = await playApi.uploadPlay(draft);
    saveSubmissionRecord(draft, {
      historyId: editingHistoryId || undefined,
      latestPlayId: createdPlay.id,
    });
    rememberOwnedPlayId(createdPlay.id);
    syncLocalHistory(draft.authorName);

    setForm(initialForm);
    setEditingHistoryId('');
    showFloatingToast(editingHistoryId ? '已重新投稿，已再次进入审核。' : '已提交到待审核池。');
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

  const handleReuseSubmission = (record: BrowserSubmissionRecord) => {
    setMode('single');
    setEditingHistoryId(record.id);
    setForm({
      authorName: record.authorName,
      title: record.title,
      category: record.category ?? '',
      summary: record.summary,
      content: record.content,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      showFloatingToast('没识别到标题。优先读取第一个双引号内容，其次读取首尾成对的 <标题>...</标题>', 'error');
      return;
    }

    setForm((current) => ({ ...current, title: detectedTitle }));
    showFloatingToast(`已自动识别标题：${detectedTitle}`);
  };

  return (
    <section className="stack-gap-lg">
      <div className="upload-grid">
        <form className="form-panel stack-gap-lg" onSubmit={handleSubmit}>
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

          <div className="field-grid">
            <label>
              <span>作者</span>
              <ClearableField
                onClear={() => setForm((current) => ({ ...current, authorName: '' }))}
                visible={Boolean(form.authorName)}
              >
                <input
                  list="author-history"
                  value={form.authorName}
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
            {authorHistory.length > 0 ? (
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
                <ClearableField
                  onClear={() => setForm((current) => ({ ...current, category: '' }))}
                  visible={Boolean(form.category)}
                >
                  <input
                    list="category-tags"
                    value={form.category}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, category: event.target.value }))
                    }
                    placeholder={`可自定义分类，不填会自动记为 ${DEFAULT_CATEGORY}`}
                  />
                </ClearableField>
              </label>
              {tags.length > 0 ? (
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
                  <button
                    className="text-button field-inline-action"
                    onClick={handleDetectTitle}
                    type="button"
                  >
                    识别标题
                  </button>
                </div>
                <ClearableField
                  onClear={() => setForm((current) => ({ ...current, title: '' }))}
                  visible={Boolean(form.title)}
                >
                  <input
                    value={form.title}
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
                  visible={Boolean(form.content)}
                >
                  <textarea
                    rows={12}
                    value={form.content}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, content: event.target.value }))
                    }
                    placeholder="把正文填在这里，我会逐字逐句地认真看"
                  />
                </ClearableField>
              </label>
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

          <div
            className={`action-bar wrap-mobile ${editingHistoryId ? 'action-bar-half' : 'action-bar-single'}`}
          >
            {editingHistoryId ? (
              <button
                className="button ghost upload-reset-button"
                onClick={resetEditingState}
                type="button"
              >
                取消回填
              </button>
            ) : null}
            {mode === 'single' ? (
              <button
                className="button primary upload-submit-button"
                disabled={singleDisabled}
                type="submit"
              >
                {submitting ? '提交中...' : editingHistoryId ? '重新投稿' : '上传小剧场'}
              </button>
            ) : null}
          </div>







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
            <p className="sub-copy">
              仅保存在当前浏览器，可再次回填，并自动同步最新审核结果与审核备注。
            </p>
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
                        className="button secondary"
                        onClick={() => handleReuseSubmission(record)}
                        type="button"
                      >
                        再次投稿
                      </button>
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

