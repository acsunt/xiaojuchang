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
            <article className="plaza-derived-group" key={play.id}>
              <button
                className="plaza-calendar-play-item"
                onClick={() => onOpenPlay(play)}
                type="button"
              >
                <div className="card-topline wrap-mobile">
                  <span>{play.category?.trim() || DEFAULT_CATEGORY}</span>
                  <span>续写 {count} 条</span>
                </div>
                <strong>{play.title}</strong>
                {/* 分类 / 作者 / 简介 沿用小剧场列表 compact-meta-row 的图标:
                 *  - 分类:◈
                 *  - 作者:✎
                 *  - 简介:✦(走 .plaza-card-summary 的 ::before) */}
                <div className="compact-meta-row compact-meta-row-small plaza-derived-version-meta">
                  <span className="compact-meta-item">
                    ◈ {play.category?.trim() || DEFAULT_CATEGORY}
                  </span>
                  <span className="compact-meta-item">✎ {play.authorName?.trim() || '匿名'}</span>
                </div>
                {play.summary ? <p className="summary plaza-card-summary">{play.summary}</p> : null}
                {lastCreatedAt ? (
                  <span className="sub-copy">最新续写：{formatDate(lastCreatedAt)}</span>
                ) : null}
              </button>
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
