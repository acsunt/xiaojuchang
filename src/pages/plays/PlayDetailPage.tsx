import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  getDetailFlatView,
  getDetailVersionSelection,
  getPlazaNavigationSnapshot,
  setDetailFlatView,
  setDetailVersionSelection,
  updatePlazaNavigationSnapshot,
} from '../../services/browser-play-preferences';

import {
  clearRepoNicknameHistory,
  getVisitorId,
  getRepoNicknameHistory,
  rememberRepoNickname,
} from '../../services/browser-repo-history';

import { getCachedPublicPlayById, getCachedPublicPlays, playApi } from '../../services/play-api';

import {
  DEFAULT_CATEGORY,
  type Play,
  type Repo,
  type RepoOrder,
  type Continuation,
} from '../../types/play';

import { RepoMarkdown } from '../repos/RepoMarkdown';

import {
  buildPlayVersionGroups,
  getPlayVersionKey,
  getPlayVersionLabel,
  sortPlayVersions,
} from './play-versions';

import { showFloatingToast } from '../../components/floating-toast-store';

const formatDate = (value: string) => new Date(value).toLocaleString('zh-CN');

const copyText = async (value: string) => {
  await navigator.clipboard.writeText(value);
};

type DetailLocationState = {
  playSnapshot?: Play;
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

export function PlayDetailPage() {
  const navigate = useNavigate();

  const location = useLocation();

  const { id = '' } = useParams();

  const locationState = location.state as DetailLocationState | null;

  const [play, setPlay] = useState<Play | null>(null);

  const [versionPlays, setVersionPlays] = useState<Play[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState('');

  const [repos, setRepos] = useState<Repo[]>([]);

  const [repoOrder, setRepoOrder] = useState<RepoOrder>('asc');

  /* 续写区状态:与现有 repo 区平级,挂在小剧场正文下、repo 区之上。
   *
   * 续写 composer 三字段:
   * - nickname(作者/可选,留空表示匿名)
   * - summary(简介/必填)
   * - content(正文/必填)
   *
   * 编辑模式下走 updateContinuationByAuthor(原地改,状态重置为 pending)。
   * 没有 parent/root 链(续写是扁平结构),不能像 repo 那样"回复某条"。 */
  const [continuations, setContinuations] = useState<Continuation[]>([]);
  const [continuationOrder, setContinuationOrder] = useState<RepoOrder>('asc');
  const [continuationComposerOpen, setContinuationComposerOpen] = useState(false);
  const [continuationNickname, setContinuationNickname] = useState('');
  const [continuationSummary, setContinuationSummary] = useState('');
  const [continuationContent, setContinuationContent] = useState('');
  const [continuationEditingId, setContinuationEditingId] = useState('');
  const [continuationSubmitting, setContinuationSubmitting] = useState(false);
  const [continuationNicknameHistory, setContinuationNicknameHistory] = useState<string[]>(() =>
    getRepoNicknameHistory(),
  );

  const [repoNickname, setRepoNickname] = useState('');

  const [repoContent, setRepoContent] = useState('');

  const [repoParentId, setRepoParentId] = useState('');

  const [repoComposerOpen, setRepoComposerOpen] = useState(false);

  const [repoNicknameHistory, setRepoNicknameHistory] = useState<string[]>(() =>
    getRepoNicknameHistory(),
  );

  const [repoSubmitting, setRepoSubmitting] = useState(false);

  /* 详情页衍生版本"平铺"开关（持久化到 localStorage）
   * - 默认关闭：保持原来的 tab-chip 单选切换
   * - 开启后：版本以 checkbox 列表平铺，可多选显示
   * 同步状态被勾选的版本 id 集合（按 getPlayVersionKey 分组） */
  const [flatView, setFlatView] = useState(() => getDetailFlatView());
  const [selectedVersionIds, setSelectedVersionIds] = useState<string[]>([]);
  const versionGroupKey = play ? getPlayVersionKey(play) : '';

  useEffect(() => {
    if (!versionGroupKey || versionPlays.length === 0) {
      return;
    }
    const candidateIds = versionPlays.map((item) => item.id);
    const stored = getDetailVersionSelection(versionGroupKey, id, candidateIds);
    setSelectedVersionIds(stored);
    // 只在版本组/候选集变化时重新读一次，避免勾选时循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionGroupKey, versionPlays.map((item) => item.id).join('|')]);

  const toggleFlatView = () => {
    setFlatView((current) => {
      const next = !current;
      setDetailFlatView(next);
      return next;
    });
  };

  const toggleVersionSelection = (versionId: string) => {
    if (!versionGroupKey) {
      return;
    }
    const next = selectedVersionIds.includes(versionId)
      ? selectedVersionIds.filter((item) => item !== versionId)
      : [...selectedVersionIds, versionId];
    // 当前 url 指向的版本不能被取消（避免分享链接打开看不到正文）
    if (versionId === id && next.length === 0) {
      return;
    }
    setSelectedVersionIds(next);
    setDetailVersionSelection(versionGroupKey, next);
  };

  const visitorId = useMemo(() => getVisitorId(), []);

  // getPlazaNavigationSnapshot reads from localStorage; re-read whenever we enter a new detail page.
  const [plazaSnapshot, setPlazaSnapshot] = useState(() => getPlazaNavigationSnapshot());
  useEffect(() => {
    setPlazaSnapshot(getPlazaNavigationSnapshot());
  }, [location.key]);
  const plazaPanel = useMemo(() => {
    const params = new URLSearchParams(location.search);

    const panel = params.get('panel');

    if (panel === 'calendar' || panel === 'continuations') {
      return panel;
    }

    return null;
  }, [location.search]);

  const navigationIds = useMemo(() => {
    if (plazaPanel === 'continuations' && play) {
      const cachedPlays = getCachedPublicPlays();

      const snapshotIds = plazaSnapshot?.filteredPlayIds ?? [];

      const filteredSource =
        snapshotIds.length > 0
          ? cachedPlays.filter((item) => snapshotIds.includes(item.id))
          : cachedPlays;

      const source = filteredSource.length > 0 ? filteredSource : cachedPlays;

      const groups = buildPlayVersionGroups(source);

      const currentKey = getPlayVersionKey(play);

      const currentGroupIndex = groups.findIndex((group) => group.id === currentKey);

      const representativeIds = groups.map((group, index) =>
        index === currentGroupIndex ? play.id : group.plays[0].id,
      );

      if (currentGroupIndex >= 0) {
        return representativeIds;
      }

      return [play.id, ...representativeIds];
    }

    if (plazaSnapshot?.filteredPlayIds?.length) {
      return plazaSnapshot.filteredPlayIds;
    }

    return getCachedPublicPlays().map((item) => item.id);
  }, [plazaSnapshot, plazaPanel, play]);

  const currentIndex = navigationIds.indexOf(id);

  const previousPlayId = currentIndex > 0 ? navigationIds[currentIndex - 1] : '';

  const nextPlayId =
    currentIndex >= 0 && currentIndex < navigationIds.length - 1
      ? navigationIds[currentIndex + 1]
      : '';

  useEffect(() => {
    updatePlazaNavigationSnapshot({ anchorPlayId: id });
  }, [id]);

  useEffect(() => {
    const cachedPlay =
      locationState?.playSnapshot?.id === id
        ? locationState.playSnapshot
        : getCachedPublicPlayById(id);

    setPlay(cachedPlay ?? null);

    setVersionPlays(cachedPlay ? [cachedPlay] : []);

    setLoading(!cachedPlay);

    setError('');

    playApi

      .getPublicPlayById(id)

      .then((item) => {
        if (!item) {
          throw new Error('该内容不存在，或尚未通过审核');
        }

        setPlay(item);

        const cachedVersions = getCachedPublicPlays().filter(
          (target) => getPlayVersionKey(target) === getPlayVersionKey(item),
        );

        setVersionPlays(sortPlayVersions(cachedVersions.length > 0 ? cachedVersions : [item]));

        return playApi.getPublicPlays().then((items) => {
          setVersionPlays(
            sortPlayVersions(
              items.filter((target) => getPlayVersionKey(target) === getPlayVersionKey(item)),
            ),
          );
        });
      })

      .catch((reason) => setError(reason instanceof Error ? reason.message : '加载失败'))

      .finally(() => setLoading(false));
  }, [id, locationState?.playSnapshot]);

  useEffect(() => {
    playApi

      .getReposByPlayId(id, repoOrder)

      .then(setRepos)

      .catch(() => setRepos([]));
  }, [id, repoOrder]);

  useEffect(() => {
    playApi
      .getContinuationsByPlayId(id, continuationOrder)
      .then(setContinuations)
      .catch(() => setContinuations([]));
  }, [id, continuationOrder]);

  const handleCopy = async (value: string, label: string) => {
    try {
      await copyText(value);

      showFloatingToast(`${label}已复制`);
    } catch {
      showFloatingToast(`${label}复制失败，请检查浏览器权限`, 'error');
    }
  };

  const openAdjacentPlay = (targetId: string) => {
    if (!targetId) {
      return;
    }

    updatePlazaNavigationSnapshot({ anchorPlayId: targetId });

    const cachedTarget = getCachedPublicPlayById(targetId);

    const preservedSearch = plazaPanel === 'continuations' ? '?panel=continuations' : '';

    navigate(`/plays/${targetId}${preservedSearch}`, {
      state: cachedTarget
        ? {
            playSnapshot: cachedTarget,
          }
        : undefined,
    });
  };

  const openVersionPlay = (target: Play) => {
    updatePlazaNavigationSnapshot({ anchorPlayId: target.id });

    const preservedSearch = plazaPanel === 'continuations' ? '?panel=continuations' : '';

    navigate(`/plays/${target.id}${preservedSearch}`, {
      state: {
        playSnapshot: target,
      },
    });
  };

  /* 续写 composer:打开/关闭 helper,跟 repoComposerOpen 行为对齐 */
  const openContinuationComposer = () => {
    setContinuationEditingId('');
    setContinuationNickname('');
    setContinuationSummary('');
    setContinuationContent('');
    setContinuationComposerOpen(true);
    setContinuationNicknameHistory(getRepoNicknameHistory());
  };
  const closeContinuationComposer = () => {
    setContinuationComposerOpen(false);
    setContinuationEditingId('');
  };

  const handleEditContinuation = (target: Continuation) => {
    if (!target) {
      return;
    }
    /* 点"修改"回填所有字段,包括作者/简介/正文;
     * 提交时走 updateContinuationByAuthor(原地覆盖,状态回 pending)。 */
    setContinuationEditingId(target.id);
    setContinuationNickname(target.nickname ?? '');
    setContinuationSummary(target.summary ?? '');
    setContinuationContent(target.content ?? '');
    setContinuationComposerOpen(true);
    setContinuationNicknameHistory(getRepoNicknameHistory());
  };

  const handleSubmitContinuation = async () => {
    if (!play) {
      return;
    }
    const summary = continuationSummary.trim();
    const content = continuationContent.trim();
    const nickname = continuationNickname.trim();
    if (!summary || !content) {
      showFloatingToast('简介和正文不能为空', 'error');
      return;
    }

    setContinuationSubmitting(true);
    try {
      if (continuationEditingId) {
        /* 修改模式:原地覆盖,状态重置为 pending 等待重新审核。 */
        await playApi.updateContinuationByAuthor(continuationEditingId, visitorId, {
          nickname,
          summary,
          content,
        });
        showFloatingToast('续写修改已提交,等待重新审核。');
      } else {
        await playApi.createContinuation({
          playId: play.id,
          nickname,
          visitorId,
          summary,
          content,
        });
        showFloatingToast('续写已提交,审核通过后会显示。');
      }
      setContinuationComposerOpen(false);
      setContinuationEditingId('');
      if (nickname) {
        setContinuationNicknameHistory(rememberRepoNickname(nickname));
      }
      /* 刷新列表:重新拉一次 status='approved' 的续写 */
      setContinuations(await playApi.getContinuationsByPlayId(play.id, continuationOrder));
    } catch (reason) {
      showFloatingToast(reason instanceof Error ? reason.message : '续写提交失败', 'error');
    } finally {
      setContinuationSubmitting(false);
    }
  };

  const handleClearContinuationNicknameHistory = () => {
    setContinuationNicknameHistory(clearRepoNicknameHistory());
  };

  const handleSubmitRepo = async () => {
    const nickname = repoNickname.trim();

    const content = repoContent.trim();

    if (!play) {
      return;
    }

    if (!nickname || !content) {
      showFloatingToast('昵称和内容不能为空', 'error');

      return;
    }

    setRepoSubmitting(true);

    try {
      await playApi.createRepo({
        playId: play.id,

        parentId: repoParentId || undefined,

        nickname,

        visitorId,

        content,
      });

      setRepoContent('');

      setRepoParentId('');

      setRepoComposerOpen(false);

      setRepoNicknameHistory(rememberRepoNickname(nickname));

      showFloatingToast('repo 已提交，审核通过后会显示。');

      setRepos(await playApi.getReposByPlayId(play.id, repoOrder));
    } catch (reason) {
      showFloatingToast(reason instanceof Error ? reason.message : 'repo 提交失败', 'error');
    } finally {
      setRepoSubmitting(false);
    }
  };

  const handleClearRepoNicknameHistory = () => {
    setRepoNicknameHistory(clearRepoNicknameHistory());
  };

  const openRepoComposer = (parentId = '') => {
    setRepoParentId(parentId);

    setRepoComposerOpen(true);

    setRepoNicknameHistory(getRepoNicknameHistory());
  };

  const closeRepoComposer = () => {
    setRepoParentId('');

    setRepoComposerOpen(false);
  };

  useEffect(() => {
    if (!repoComposerOpen) {
      return;
    }

    // 评论填写框展开后，滚到页面最底端，方便用户直接看到填写区

    const raf = window.requestAnimationFrame(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
    });

    // 双重保险：再下一帧也滚一次，避免布局未稳定时高度计算偏小

    const fallback = window.setTimeout(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
    }, 60);

    return () => {
      window.cancelAnimationFrame(raf);

      window.clearTimeout(fallback);
    };
  }, [repoComposerOpen]);

  const versionItems = versionPlays.length > 0 ? versionPlays : play ? [play] : [];
  const isMultiVersion = versionItems.length > 1;
  /* 平铺开启时：按勾选集合渲染（当前 url 指向的版本永远保留）。 */
  const visibleVersionItems =
    isMultiVersion && flatView
      ? versionItems.filter((item) => selectedVersionIds.includes(item.id) || item.id === id)
      : versionItems;

  /* 上传衍生：跳到 /upload 单篇模式。
   * - 原文填进主表单；已有衍生版本按顺序回填到衍生块；
   * - 末尾再追加一个空的新衍生，提交时只上传新增的那几版。
   *
   * 修改任意版本：跳到 /upload,只回填那一版的内容,
   * 提交后会在同 title+category 同组的尾部追加一版。
   */
  /* 旧版的「上传衍生」已下线。
   *
   * 衍生版本从 plays.submission_type='derived' 改造为 continuations 表后,
   * 这里改为「跳到续写区并展开 composer」,语义与原按钮一致:
   * 用户表达「我想在这条原文下面续一段」。
   *
   * 直接打开 composer 而不是新建路由跳转,避免用户在详情页和
   * /upload 页面之间来回切换。 */
  const handleUploadDerived = () => {
    if (typeof document === 'undefined') {
      return;
    }
    openContinuationComposer();
    /* 滚到续写区,让用户直接看到填写框 */
    requestAnimationFrame(() => {
      const target = document.querySelector('.continuation-panel');
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  };

  const handleEditVersion = (target: Play) => {
    if (!target) {
      return;
    }
    navigate('/upload', {
      state: {
        prefill: {
          authorName: target.authorName,
          title: target.title,
          category: target.category,
          summary: target.summary,
          content: target.content,
          editOriginalId: target.id,
        },
      },
    });
  };

  if (loading) {
    return <div className="empty-panel">正在加载详情…</div>;
  }

  if (error || !play) {
    return <div className="empty-panel error">{error || '内容不存在'}</div>;
  }

  return (
    <section className="stack-gap-lg">
      <div className="detail-panel detail-hero-grid">
        <div className="stack-gap-md">
          <div className="card-topline wrap-mobile">
            <span>{play.category || DEFAULT_CATEGORY}</span>
          </div>

          <div className="title-row detail-title-row">
            <h2>{play.title}</h2>

            <button
              aria-label="复制标题"

              className="icon-button"

              onClick={() => void handleCopy(play.title, '标题')}

              type="button"

              title="复制标题"
            >
              ⧉
            </button>
          </div>

          {play.summary ? <p className="sub-copy">{play.summary}</p> : null}

          <div className="detail-meta-switch-wrapper">
            <div className="meta-row wrap-mobile">
              <span>作者 {play.authorName}</span>

              <span>
                {plazaSnapshot?.activeTimeField === 'createdAt'
                  ? `上传时间 ${formatDate(play.createdAt)}`
                  : `最近更新时间 ${formatDate(play.updatedAt)}`}
              </span>
            </div>

            {versionItems.length > 1 ? (
              <div className="detail-version-panel">
                <div className="detail-version-head">
                  <span className="content-meta">同标题/分类版本</span>
                  <label className="detail-version-flat-toggle">
                    <input checked={flatView} onChange={toggleFlatView} type="checkbox" />
                    <span>平铺</span>
                  </label>
                </div>

                {flatView ? (
                  <ul className="detail-version-list">
                    {versionItems.map((item, index) => {
                      const checked = selectedVersionIds.includes(item.id) || item.id === id;
                      const isCurrent = item.id === id;
                      return (
                        <li className="detail-version-item" key={item.id}>
                          <label
                            className={
                              checked
                                ? 'detail-version-row-label checked'
                                : 'detail-version-row-label'
                            }
                          >
                            <input
                              checked={checked}
                              disabled={isCurrent}
                              onChange={() => toggleVersionSelection(item.id)}
                              type="checkbox"
                            />
                            <span className="detail-version-label-text">
                              {getPlayVersionLabel(index)}
                            </span>
                            <span className="detail-version-meta">
                              {formatDate(item.updatedAt)}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="inline-actions wrap-mobile detail-version-row">
                    {versionItems.map((item, index) => (
                      <button
                        className={item.id === play.id ? 'tab-chip active' : 'tab-chip'}
                        key={item.id}
                        onClick={() => openVersionPlay(item)}
                        type="button"
                      >
                        {getPlayVersionLabel(index)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <div className="inline-actions wrap-mobile detail-switch-row">
              <button
                className="button secondary"

                disabled={!previousPlayId}

                onClick={() => openAdjacentPlay(previousPlayId)}

                type="button"
              >
                上一条
              </button>

              <button
                className="button secondary"

                disabled={!nextPlayId}

                onClick={() => openAdjacentPlay(nextPlayId)}

                type="button"
              >
                下一条
              </button>
            </div>
          </div>
        </div>
      </div>

      {isMultiVersion && flatView ? (
        <section className="stack-gap-md detail-version-content-stack">
          {visibleVersionItems.map((item) => {
            const versionIndex = versionItems.findIndex((row) => row.id === item.id);
            const isCurrent = item.id === id;
            const isOriginal = versionIndex === 0;
            return (
              <article
                className={
                  isCurrent
                    ? 'content-panel stack-gap-md detail-version-block current'
                    : 'content-panel stack-gap-md detail-version-block'
                }
                key={item.id}
              >
                <div className="content-head wrap-mobile detail-content-head-with-derived">
                  <div className="detail-content-head-title">
                    <h3>
                      {getPlayVersionLabel(versionIndex >= 0 ? versionIndex : 0)}
                      {isCurrent ? '（当前查看）' : ''}
                    </h3>
                    <button
                      className="button secondary detail-edit-version-button"
                      onClick={() => handleEditVersion(item)}
                      type="button"
                    >
                      修改
                    </button>
                    {isOriginal ? (
                      <button
                        className="button secondary detail-upload-derived-button"
                        onClick={handleUploadDerived}
                        type="button"
                      >
                        续写
                      </button>
                    ) : null}
                  </div>
                  <div className="inline-actions">
                    <span className="content-meta">约 {item.content.length} 字</span>
                    <button
                      aria-label="复制正文"
                      className="icon-button"
                      onClick={() => void handleCopy(item.content, '正文')}
                      type="button"
                      title="复制正文"
                    >
                      ⧉
                    </button>
                  </div>
                </div>
                <p className="play-detail-copy">{item.content}</p>
              </article>
            );
          })}
        </section>
      ) : (
        <article className="content-panel stack-gap-md">
          <div className="content-head wrap-mobile detail-content-head-with-derived">
            <div className="detail-content-head-title">
              <h3>小剧场正文</h3>
              <button
                className="button secondary detail-edit-version-button"
                onClick={() => handleEditVersion(play)}
                type="button"
              >
                修改
              </button>
              <button
                className="button secondary detail-upload-derived-button"
                onClick={handleUploadDerived}
                type="button"
              >
                续写
              </button>
            </div>
            <div className="inline-actions">
              <span className="content-meta">约 {play.content.length} 字</span>
              <button
                aria-label="复制正文"
                className="icon-button"
                onClick={() => void handleCopy(play.content, '正文')}
                type="button"
                title="复制正文"
              >
                ⧉
              </button>
            </div>
          </div>

          <p className="play-detail-copy">{play.content}</p>
        </article>
      )}

      <section className="form-panel stack-gap-md repo-panel">
        <div className="content-head wrap-mobile">
          <div>
            <h3>repo</h3>

            <p className="sub-copy">
              支持 Markdown、普通换行分段、图床链接缩略图。提交后进入独立审核池。
            </p>
          </div>

          <div className="repo-toolbar-row">
            <div className="repo-sort-group">
              <button
                className={repoOrder === 'asc' ? 'tab-chip active' : 'tab-chip'}

                onClick={() => setRepoOrder('asc')}

                type="button"
              >
                正序
              </button>

              <button
                className={repoOrder === 'desc' ? 'tab-chip active' : 'tab-chip'}

                onClick={() => setRepoOrder('desc')}

                type="button"
              >
                倒序
              </button>
            </div>

            <button
              className={repoComposerOpen ? 'button secondary' : 'button primary'}

              onClick={() => (repoComposerOpen ? closeRepoComposer() : openRepoComposer())}

              type="button"
            >
              {repoComposerOpen ? '收起评论' : '评论'}
            </button>
          </div>
        </div>

        {repoComposerOpen ? (
          <div className="repo-form-grid">
            <label>
              <span>昵称</span>

              <ClearableField onClear={() => setRepoNickname('')} visible={Boolean(repoNickname)}>
                <input
                  list="repo-nickname-history"

                  value={repoNickname}

                  onChange={(event) => setRepoNickname(event.target.value)}

                  placeholder="填写 repo 昵称"
                />
              </ClearableField>

              <datalist id="repo-nickname-history">
                {repoNicknameHistory.map((nickname) => (
                  <option key={nickname} value={nickname} />
                ))}
              </datalist>
            </label>

            {repoNicknameHistory.length > 0 ? (
              <div className="stack-gap-sm">
                <div className="inline-actions wrap-mobile author-history-inline">
                  <span className="content-meta">历史昵称 {repoNicknameHistory.length} 个</span>

                  <button
                    className="button ghost"

                    onClick={handleClearRepoNicknameHistory}

                    type="button"
                  >
                    清空昵称历史
                  </button>
                </div>

                <div className="tag-cloud compact-tag-cloud repo-history-row">
                  {repoNicknameHistory.map((nickname) => {
                    const active = repoNickname === nickname;

                    return (
                      <button
                        className={active ? 'tag-chip active' : 'tag-chip'}

                        key={nickname}

                        onClick={() => setRepoNickname(nickname)}

                        type="button"
                      >
                        {nickname}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {repoParentId ? (
              <div className="feedback info">
                正在回复 {repos.find((repo) => repo.id === repoParentId)?.nickname ?? '这条 repo'}
                <button className="text-button" onClick={closeRepoComposer} type="button">
                  取消回复
                </button>
              </div>
            ) : null}

            <label>
              <span>内容</span>

              <textarea
                rows={5}

                value={repoContent}

                onChange={(event) => setRepoContent(event.target.value)}

                placeholder={
                  '写下 repo。示例：\n普通换行会自动分段\n![图](https://example.com/a.jpg)'
                }
              />
            </label>

            <div className="inline-actions wrap-mobile repo-composer-actions">
              <button className="button ghost" onClick={closeRepoComposer} type="button">
                取消
              </button>

              <button
                className="button primary"

                disabled={repoSubmitting}

                onClick={() => void handleSubmitRepo()}

                type="button"
              >
                {repoSubmitting ? '提交中' : '提交 repo'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="repo-list stack-gap-sm">
          {repos.length > 0 ? (
            repos.map((repo) => (
              <article className="repo-card" key={repo.id}>
                <div className="repo-card-head">
                  <div className="repo-card-meta-line">
                    <strong>{repo.nickname}</strong>

                    <span className="content-meta repo-card-date">
                      {repo.replyToNickname ? `回复 ${repo.replyToNickname} · ` : ''}

                      {formatDate(repo.createdAt)}
                    </span>
                  </div>

                  <button
                    className="button secondary repo-reply-button"

                    onClick={() => openRepoComposer(repo.id)}

                    type="button"
                  >
                    回复
                  </button>
                </div>

                <RepoMarkdown content={repo.content} />
              </article>
            ))
          ) : (
            <div className="empty-panel">还没有通过审核的 repo。</div>
          )}
        </div>
      </section>

      {/* 续写区:与 repo 区平级,挂在小剧场正文下、repo 区之上。
       * 续写是扁平结构(没有回复链),只展示已通过条目,
       * 用户通过「续写」按钮展开 composer,
       * 编辑现有续写点击卡片右侧的「修改」按钮原地覆盖提交。 */}
      <section className="form-panel stack-gap-md continuation-panel">
        <div className="content-head wrap-mobile">
          <div>
            <h3>续写</h3>
            <p className="sub-copy">
              续写是直接挂在原文下的独立长文,作者(可选) / 简介(必填) / 正文(必填) 三个字段,
              提交后进入独立审核池;原作者修改会原地覆盖并重新审核。
            </p>
          </div>

          <div className="continuation-toolbar-row">
            <div className="continuation-sort-group">
              <button
                className={continuationOrder === 'asc' ? 'tab-chip active' : 'tab-chip'}
                onClick={() => setContinuationOrder('asc')}
                type="button"
              >
                正序
              </button>
              <button
                className={continuationOrder === 'desc' ? 'tab-chip active' : 'tab-chip'}
                onClick={() => setContinuationOrder('desc')}
                type="button"
              >
                倒序
              </button>
            </div>
            <button
              className={continuationComposerOpen ? 'button secondary' : 'button primary'}
              onClick={() =>
                continuationComposerOpen ? closeContinuationComposer() : openContinuationComposer()
              }
              type="button"
            >
              {continuationComposerOpen ? '收起续写' : '续写'}
            </button>
          </div>
        </div>

        {continuationComposerOpen ? (
          <div className="continuation-form-grid">
            <label>
              <span>作者（可空，留空即匿名，详情页不展示署名）</span>
              <ClearableField
                onClear={() => setContinuationNickname('')}
                visible={Boolean(continuationNickname)}
              >
                <input
                  list="repo-nickname-history"
                  value={continuationNickname}
                  onChange={(event) => setContinuationNickname(event.target.value)}
                  placeholder="留空 = 匿名续写"
                />
              </ClearableField>
            </label>

            {continuationNicknameHistory.length > 0 ? (
              <div className="stack-gap-sm">
                <div className="inline-actions wrap-mobile author-history-inline">
                  <span className="content-meta">
                    历史昵称 {continuationNicknameHistory.length} 个
                  </span>
                  <button
                    className="button ghost"
                    onClick={handleClearContinuationNicknameHistory}
                    type="button"
                  >
                    清空昵称历史
                  </button>
                </div>
                <div className="tag-cloud compact-tag-cloud repo-history-row">
                  {continuationNicknameHistory.map((nickname) => {
                    const active = continuationNickname === nickname;
                    return (
                      <button
                        className={active ? 'tag-chip active' : 'tag-chip'}
                        key={nickname}
                        onClick={() => setContinuationNickname(nickname)}
                        type="button"
                      >
                        {nickname}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <label>
              <span>简介（必填，用于说明这条续写写什么）</span>
              <ClearableField
                onClear={() => setContinuationSummary('')}
                visible={Boolean(continuationSummary)}
              >
                <input
                  value={continuationSummary}
                  onChange={(event) => setContinuationSummary(event.target.value)}
                  placeholder="给续写起个一句话导语"
                />
              </ClearableField>
            </label>

            <label>
              <span>正文（必填）</span>
              <textarea
                rows={8}
                value={continuationContent}
                onChange={(event) => setContinuationContent(event.target.value)}
                placeholder="把续写的正文填在这里"
              />
            </label>

            <div className="inline-actions wrap-mobile continuation-composer-actions">
              <button className="button ghost" onClick={closeContinuationComposer} type="button">
                取消
              </button>
              <button
                className="button primary"
                disabled={continuationSubmitting}
                onClick={() => void handleSubmitContinuation()}
                type="button"
              >
                {continuationSubmitting
                  ? '提交中'
                  : continuationEditingId
                    ? '提交修改'
                    : '提交续写'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="continuation-list stack-gap-sm">
          {continuations.length > 0 ? (
            continuations.map((item) => {
              const showAuthor = item.nickname && item.nickname.trim().length > 0;
              return (
                <article className="continuation-card" key={item.id}>
                  <div className="continuation-card-head">
                    <div className="stack-gap-xs">
                      <div className="card-topline wrap-mobile">
                        <strong>{item.summary}</strong>
                      </div>
                      {showAuthor ? (
                        <span className="content-meta">作者：{item.nickname}</span>
                      ) : (
                        <span className="content-meta">匿名续写</span>
                      )}
                      <span className="content-meta">{formatDate(item.createdAt)}</span>
                    </div>
                    <button
                      className="button secondary continuation-edit-button"
                      onClick={() => handleEditContinuation(item)}
                      type="button"
                    >
                      修改
                    </button>
                  </div>
                  <p className="play-detail-copy continuation-content">{item.content}</p>
                </article>
              );
            })
          ) : (
            <div className="empty-panel">还没有通过审核的续写。</div>
          )}
        </div>
      </section>
    </section>
  );
}
