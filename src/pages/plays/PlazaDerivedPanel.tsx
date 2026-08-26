import { DEFAULT_CATEGORY, type Play } from '../../types/play';
import { buildPlayVersionGroups, getPlayVersionLabel } from './play-versions';

type PlazaDerivedPanelProps = {
  plays: Play[];
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

export function PlazaDerivedPanel({ plays, onOpenPlay }: PlazaDerivedPanelProps) {
  const versionGroups = buildPlayVersionGroups(plays);

  return (
    <section className="form-panel plaza-derived-panel">
      <div className="sidebar-head plaza-derived-head">
        <div className="stack-gap-sm">
          <h3>衍生版本</h3>
          <p className="sub-copy">
            按当前筛选范围汇总同标题、同分类的小剧场。最早发布的是原文，后续为衍生版本。
          </p>
        </div>
      </div>

      {versionGroups.length ? (
        <div className="plaza-derived-group-list">
          {versionGroups.map((group) => (
            <article className="plaza-derived-group" key={group.id}>
              <div className="stack-gap-sm">
                <div className="card-topline wrap-mobile">
                  <span>{group.category || DEFAULT_CATEGORY}</span>
                  <span>{group.plays.length} 个版本</span>
                </div>
                <strong>{group.title}</strong>
              </div>

              <div className="plaza-derived-version-list">
                {group.plays.map((play, index) => (
                  <button
                    className="plaza-calendar-play-item"
                    key={play.id}
                    onClick={() => onOpenPlay(play)}
                    type="button"
                  >
                    <div className="card-topline wrap-mobile">
                      <strong>{getPlayVersionLabel(index)}</strong>
                      <span>{formatDate(play.createdAt)}</span>
                    </div>
                    <div className="compact-meta-row compact-meta-row-small">
                      <span>{play.authorName || '匿名'}</span>
                      <span>{play.category?.trim() || DEFAULT_CATEGORY}</span>
                    </div>
                    {play.summary ? (
                      <span className="sub-copy plaza-calendar-play-summary">{play.summary}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="plaza-calendar-empty">
          <span className="content-meta">当前范围里还没有同标题、同分类的多版本小剧场。</span>
        </div>
      )}
    </section>
  );
}
