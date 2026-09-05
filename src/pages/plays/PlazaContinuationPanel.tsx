import { useMemo } from 'react';
import { DEFAULT_CATEGORY, type Play, type RepoSummary } from '../../types/play';

type PlazaContinuationPanelProps = {
  plays: Play[];
  continuationCounts: RepoSummary[];
  onOpenPlay: (play: Play) => void;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(date);
};

/* 广场「续写」面板:
 * 列出当前筛选范围里「有任意一条已通过续写」的原文小剧场,
 * 按「最新一条续写的时间」倒序排列。
 *
 * 数据源:PlayListPage 已加载的 continuationCounts(playApi.getContinuationCounts),
 * 每条 RepoSummary 含 lastCreatedAt(该 play 最新续写的 createdAt),
 * 不再额外发请求。
 *
 * 卡片版式:与广场 play-card 同款(play-card-shell / play-card-clickable),
 * 让用户能直接复用熟悉的列表布局;手机端把「续写 N」徽标和标题放在同一行,
 * 标题占满剩余宽度,徽标贴在右侧,跟随主题风格显示。
 */
export function PlazaContinuationPanel({
  plays,
  continuationCounts,
  onOpenPlay,
}: PlazaContinuationPanelProps) {
  const items = useMemo(() => {
    const countMap = new Map(continuationCounts.map((item) => [item.playId, item]));
    return plays
      .map((play) => {
        const summary = countMap.get(play.id);
        const count = summary?.count ?? 0;
        const lastCreatedAt = summary?.lastCreatedAt ?? '';
        return { play, count, lastCreatedAt };
      })
      .filter((item) => item.count > 0)
      .sort((a, b) => {
        /* 「最新续写时间」降序:晚的在前。
         * 没有 lastCreatedAt 的(数据缺失)排到末尾。 */
        if (!a.lastCreatedAt && !b.lastCreatedAt) return 0;
        if (!a.lastCreatedAt) return 1;
        if (!b.lastCreatedAt) return -1;
        return b.lastCreatedAt.localeCompare(a.lastCreatedAt);
      });
  }, [plays, continuationCounts]);

  return (
    <section className="form-panel plaza-derived-panel">
      <div className="sidebar-head plaza-derived-head">
        <div className="stack-gap-sm">
          <h3>查看有续写的小剧场</h3>
          <p className="sub-copy">
            列出当前筛选范围里至少有一条已通过续写的原文小剧场，按「最新一条续写的时间」倒序排列。
          </p>
        </div>
      </div>

      {items.length ? (
        <div className="plaza-derived-group-list">
          {items.map(({ play, count, lastCreatedAt }) => (
            <article
              className="play-card play-card-shell play-card-clickable plaza-continuation-card"
              key={play.id}
              onClick={() => onOpenPlay(play)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpenPlay(play);
                }
              }}
              role="link"
              tabIndex={0}
            >
              {/* 顶部细线:分类 + 作者 + 续写 N 徽标(同 play-card 的 card-topline 一致,
               * 手机端把「续写 N」徽标放分类/作者同行右侧) */}
              <div className="card-topline wrap-mobile align-start plaza-continuation-topline">
                <div className="inline-actions wrap-mobile align-start plaza-continuation-meta">
                  <span className="compact-meta-item">
                    ◈ {play.category?.trim() || DEFAULT_CATEGORY}
                  </span>
                  <span className="compact-meta-item">✎ {play.authorName?.trim() || '匿名'}</span>
                </div>
                <span
                  className="derived-badge continuation-badge plaza-continuation-count"
                  aria-label={`续写 ${count} 条`}
                  title={`续写 ${count} 条`}
                >
                  续写 {count}
                </span>
              </div>

              {/* 标题:占据整行,徽标已挪到顶部同行右侧,这里只留标题 */}
              <h3 className="plaza-continuation-title">{play.title}</h3>

              {/* 简介:沿用小剧场列表的 plaza-card-summary 风格 */}
              {play.summary ? <p className="summary plaza-card-summary">{play.summary}</p> : null}

              {lastCreatedAt ? (
                <span className="sub-copy plaza-continuation-date">
                  最新续写：{formatDate(lastCreatedAt)}
                </span>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="plaza-calendar-empty">
          <span className="content-meta">当前范围里还没有任何小剧场出现过续写。</span>
        </div>
      )}
    </section>
  );
}
