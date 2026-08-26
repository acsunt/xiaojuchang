import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  getPlazaNavigationSnapshot,
  updatePlazaNavigationSnapshot,
} from '../../services/browser-play-preferences';
import {
  clearRepoNicknameHistory,
  getVisitorId,
  getRepoNicknameHistory,
  rememberRepoNickname,
} from '../../services/browser-repo-history';
import { getCachedPublicPlayById, getCachedPublicPlays, playApi } from '../../services/play-api';
import { DEFAULT_CATEGORY, type Play, type Repo, type RepoOrder } from '../../types/play';
import { RepoMarkdown } from '../repos/RepoMarkdown';
import {
  buildPlayVersionGroups,
  getPlayVersionKey,
  getPlayVersionLabel,
  sortPlayVersions,
} from './play-versions';

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
  const [copyMessage, setCopyMessage] = useState('');
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repoOrder, setRepoOrder] = useState<RepoOrder>('asc');
  const [repoNickname, setRepoNickname] = useState('');
  const [repoContent, setRepoContent] = useState('');
  const [repoParentId, setRepoParentId] = useState('');
  const [repoComposerOpen, setRepoComposerOpen] = useState(false);
  const [repoNicknameHistory, setRepoNicknameHistory] = useState<string[]>(() =>
    getRepoNicknameHistory(),
  );
  const [repoSubmitting, setRepoSubmitting] = useState(false);
  const [repoMessage, setRepoMessage] = useState('');
  const [repoError, setRepoError] = useState('');
  const visitorId = useMemo(() => getVisitorId(), []);

  // getPlazaNavigationSnapshot 从 localStorage 读取，不依赖 location，
  // 但需要 location.key 变化（每次进入详情页）时强制重新读取最新快照。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plazaSnapshot = useMemo(() => getPlazaNavigationSnapshot(), [location.key]);
  const plazaPanel = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const panel = params.get('panel');
    if (panel === 'calendar' || panel === 'derived') {
      return panel;
    }

    return null;
  }, [location.search]);
  const navigationIds = useMemo(() => {
    if (plazaPanel === 'derived' && play) {
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
    setCopyMessage('');

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

  const handleCopy = async (value: string, label: string) => {
    try {
      await copyText(value);
      setCopyMessage(`${label}已复制`);
    } catch {
      setCopyMessage(`${label}复制失败，请检查浏览器权限`);
    }
  };

  const openAdjacentPlay = (targetId: string) => {
    if (!targetId) {
      return;
    }

    updatePlazaNavigationSnapshot({ anchorPlayId: targetId });
    const cachedTarget = getCachedPublicPlayById(targetId);
    const preservedSearch = plazaPanel === 'derived' ? '?panel=derived' : '';
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
    const preservedSearch = plazaPanel === 'derived' ? '?panel=derived' : '';
    navigate(`/plays/${target.id}${preservedSearch}`, {
      state: {
        playSnapshot: target,
      },
    });
  };

  const handleSubmitRepo = async () => {
    const nickname = repoNickname.trim();
    const content = repoContent.trim();
    if (!play) {
      return;
    }

    if (!nickname || !content) {
      setRepoError('昵称和内容不能为空');
      return;
    }

    setRepoSubmitting(true);
    setRepoError('');
    setRepoMessage('');

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
      setRepoMessage('repo 已提交，审核通过后会显示。');
      setRepos(await playApi.getReposByPlayId(play.id, repoOrder));
    } catch (reason) {
      setRepoError(reason instanceof Error ? reason.message : 'repo 提交失败');
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
    setRepoMessage('');
    setRepoError('');
  };

  const closeRepoComposer = () => {
    setRepoParentId('');
    setRepoComposerOpen(false);
    setRepoError('');
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
                <span className="content-meta">同标题/分类版本</span>
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
          {copyMessage ? <div className="feedback success">{copyMessage}</div> : null}
        </div>
      </div>

      <article className="content-panel stack-gap-md">
        <div className="content-head wrap-mobile">
          <h3>小剧场正文</h3>
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

        {repoMessage ? <div className="feedback success">{repoMessage}</div> : null}
        {repoError ? <div className="feedback error">{repoError}</div> : null}

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
    </section>
  );
}
