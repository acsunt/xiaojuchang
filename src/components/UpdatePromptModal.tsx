import {
  currentChangelogVersion,
  getChangelogCategories,
  openVisitorChangelog,
} from '../data/visitor-changelog';

type UpdatePromptModalProps = {
  onCancel: () => void;
  onRefresh: () => void;
};

export function UpdatePromptModal({ onCancel, onRefresh }: UpdatePromptModalProps) {
  const currentCategories = getChangelogCategories(currentChangelogVersion);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="update-prompt-title">
      <div className="modal-panel stack-gap-md update-prompt-modal">
        <h3 id="update-prompt-title" className="modal-title">发现新功能更新</h3>

        <div className="stack-gap-sm">
          <p className="sub-copy">
            检测到网页有新版本，是否立即刷新以加载最新功能？
          </p>
          <div className="update-prompt-warning">
            <strong>⚠ 刷新提示：</strong>
            刷新后当前页面未上传的编辑内容可能会消失。如果不便现在刷新，可以取消，稍后手动刷新。
          </div>
        </div>

        <section className="update-prompt-changelog stack-gap-sm">
          <h4 className="changelog-version-title">当前版本 {currentChangelogVersion.version}</h4>
          {currentCategories.map((category) => (
            <div className="changelog-category" key={category.label}>
              <p className="changelog-category-label">{category.label}</p>
              <ul className="changelog-list">
                {category.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
          <button
            className="update-changelog-link"
            onClick={openVisitorChangelog}
            type="button"
          >
            更新日志
          </button>
        </section>

        <div className="inline-actions modal-action-row">
          <button className="button secondary" onClick={onCancel} type="button">
            稍后手动刷新
          </button>
          <button className="button primary" onClick={onRefresh} type="button">
            立即刷新
          </button>
        </div>
      </div>
    </div>
  );
}