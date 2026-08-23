import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getOwnedPlayIds,
  getRepoNoticeSettings,
  getVisitorId,
  markRepoReadNow,
  setRepoNoticeSettings,
} from '../../services/browser-repo-history';
import { playApi } from '../../services/play-api';
import type { Repo, RepoNoticeSettings, RepoOrder } from '../../types/play';
import { repoStatusLabelMap } from '../../types/play';
import { RepoMarkdown } from './RepoMarkdown';

const formatDate = (value: string) => new Date(value).toLocaleString('zh-CN');

type RepoView = 'sent' | 'received';

export function RepoPage() {
  const visitorId = useMemo(() => getVisitorId(), []);
  const ownedPlayIds = useMemo(() => getOwnedPlayIds(), []);
  const [activeView, setActiveView] = useState<RepoView>('received');
  const [sentOrder, setSentOrder] = useState<RepoOrder>('desc');
  const [receivedOrder, setReceivedOrder] = useState<RepoOrder>('desc');
  const [sentRepos, setSentRepos] = useState<Repo[]>([]);
  const [receivedRepos, setReceivedRepos] = useState<Repo[]>([]);
  const [noticeSettings, setNoticeSettingsState] = useState<RepoNoticeSettings>(() => getRepoNoticeSettings());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [clearingRejected, setClearingRejected] = useState(false);

  const rejectedSentCount = useMemo(
    () => sentRepos.filter((repo) => repo.status === 'rejected').length,
    [sentRepos],
  );

  const loadRepos = async () => {
    setLoading(true);
    setError('');

    try {
      const [nextSentRepos, nextReceivedRepos] = await Promise.all([
        playApi.getMyRepos(visitorId, sentOrder),
        playApi.getReceivedRepos(ownedPlayIds, visitorId, receivedOrder),
      ]);
      setSentRepos(nextSentRepos);
      setReceivedRepos(nextReceivedRepos);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'repo 加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRepos();
  }, [receivedOrder, sentOrder]);

  const handleMarkRead = () => {
    markRepoReadNow();
    setMessage('已把当前收到的 repo 标记为已读。');
  };

  const handleClearRejected = async () => {
    if (rejectedSentCount === 0) {
      return;
    }
    const confirmed = window.confirm(`确认清空「我发布的」里被拒绝的 ${rejectedSentCount} 条 repo？删除后不可恢复。`);
    if (!confirmed) {
      return;
    }

    setClearingRejected(true);
    setMessage('');
    setError('');
    try {
      const deletedCount = await playApi.deleteRejectedReposByVisitor(visitorId);
      await loadRepos();
      setMessage(deletedCount > 0 ? `已清空 ${deletedCount} 条被拒绝的 repo。` : '当前没有可清空的未通过 repo。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '清空未通过 repo 失败');
    } finally {
      setClearingRejected(false);
    }
  };

  const updateNoticeSettings = (settings: RepoNoticeSettings) => {
    setNoticeSettingsState(setRepoNoticeSettings(settings));
    setMessage(settings === 'off' ? '已关闭 repo 提醒。' : settings === 'dot' ? '已切换为小红点提醒。' : '已切换为数字提醒。');
  };

  const visibleRepos = activeView === 'sent' ? sentRepos : receivedRepos;
  const activeOrder = activeView === 'sent' ? sentOrder : receivedOrder;
  const setActiveOrder = activeView === 'sent' ? setSentOrder : setReceivedOrder;

  return (
    <section className="stack-gap-lg">
      <div className="hero-panel hero-panel-compact stack-gap-md">
        <div className="content-head wrap-mobile">
          <div>
            <h2>repo</h2>
            <p className="sub-copy">这里汇总当前浏览器发出的 repo，以及你投稿作品或被回复时收到的 repo。</p>
          </div>
          <div className="inline-actions wrap-mobile repo-view-switcher-row">
            <button className={activeView === 'received' ? 'tab-chip active' : 'tab-chip'} onClick={() => setActiveView('received')} type="button">
              我收到的 {receivedRepos.length}
            </button>
            <button className={activeView === 'sent' ? 'tab-chip active' : 'tab-chip'} onClick={() => setActiveView('sent')} type="button">
              我发布的 {sentRepos.length}
            </button>
            <button
              className="button secondary repo-clear-rejected-button"
              disabled={clearingRejected || rejectedSentCount === 0 || activeView !== 'sent'}
              onClick={() => void handleClearRejected()}
              type="button"
              title={`清空“我发布的”里被拒绝的 repo（${rejectedSentCount} 条）`}
            >
              清空未通过{rejectedSentCount > 0 ? ` (${rejectedSentCount})` : ''}
            </button>
          </div>
        </div>

        <div className="repo-page-order-row">
          <div className="inline-actions repo-page-order-switcher">
            <button className={activeOrder === 'asc' ? 'tab-chip active' : 'tab-chip'} onClick={() => setActiveOrder('asc')} type="button">
              正序
            </button>
            <button className={activeOrder === 'desc' ? 'tab-chip active' : 'tab-chip'} onClick={() => setActiveOrder('desc')} type="button">
              倒序
            </button>
          </div>
          <button className="button secondary repo-page-mark-read-button" onClick={handleMarkRead} type="button">
            标记已读
          </button>
        </div>

        <div className="inline-actions wrap-mobile">
          <span className="content-meta">提醒方式</span>
          {(['count', 'dot', 'off'] as const).map((settings) => (
            <button
              className={noticeSettings === settings ? 'tab-chip active' : 'tab-chip'}
              key={settings}
              onClick={() => updateNoticeSettings(settings)}
              type="button"
            >
              {settings === 'count' ? '数字' : settings === 'dot' ? '小红点' : '不提醒'}
            </button>
          ))}
        </div>
      </div>

      {message ? <div className="feedback success">{message}</div> : null}
      {error ? <div className="feedback error">{error}</div> : null}
      {loading ? <div className="empty-panel">正在加载 repo…</div> : null}

      {!loading ? (
        visibleRepos.length > 0 ? (
          <div className="stack-gap-md">
            {visibleRepos.map((repo) => (
              <article className="repo-card" key={repo.id}>
                <div className="content-head wrap-mobile">
                  <div className="stack-gap-xs">
                    <strong>{repo.nickname}</strong>
                    <span className="content-meta">
                      《{repo.playTitle ?? repo.playId}》 · {repoStatusLabelMap[repo.status]} · {formatDate(repo.createdAt)}
                    </span>
                    {repo.replyToNickname ? <span className="content-meta">回复 {repo.replyToNickname}</span> : null}
                  </div>
                  <Link
                    aria-label="去详情"
                    className="icon-button repo-go-detail-button"
                    title="去详情"
                    to={`/plays/${repo.playId}`}
                  >
                    ↗
                  </Link>
                </div>
                <RepoMarkdown content={repo.content} />
                {repo.status === 'rejected' && repo.reviewNote ? (
                  <div className="repo-reject-note">
                    <strong>拒绝理由：</strong>
                    <span>{repo.reviewNote}</span>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-panel">当前没有 repo。</div>
        )
      ) : null}
    </section>
  );
}