import { useState } from 'react';
import featureGuideMarkdown from '../../README.md?raw';
import { getChangelogCategories, visitorChangelog } from '../data/visitor-changelog';
import { SimpleMarkdown } from './SimpleMarkdown';

type ChangelogModalProps = {
  onClose: () => void;
};

type ChangelogTab = 'updates' | 'guide';

const getVisitorFeatureGuide = (markdown: string) => {
  const visitorOnly = markdown.split(/\n## 管理员侧/)[0] ?? markdown;

  return visitorOnly
    .replace(/^## 游客侧\s*/m, '')
    .replace(/\n---\s*$/m, '')
    .trim();
};

export function ChangelogModal({ onClose }: ChangelogModalProps) {
  const [activeTab, setActiveTab] = useState<ChangelogTab>('updates');

  return (
    <div className="modal-overlay changelog-modal-overlay" onClick={onClose} role="presentation">
      <div
        aria-labelledby="changelog-title"
        aria-modal="true"
        className="modal-panel stack-gap-md changelog-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button aria-label="关闭" className="changelog-modal-close" onClick={onClose} type="button">
          ×
        </button>
        <div className="content-head">
          <h3 id="changelog-title" className="modal-title">
            {activeTab === 'updates' ? '更新' : '功能介绍'}
          </h3>
        </div>

        <div
          className="inline-actions wrap-mobile changelog-tab-row"
          role="tablist"
          aria-label="说明分类"
        >
          <button
            aria-selected={activeTab === 'updates'}
            className={activeTab === 'updates' ? 'tab-chip active' : 'tab-chip'}
            onClick={() => setActiveTab('updates')}
            role="tab"
            type="button"
          >
            更新
          </button>
          <button
            aria-selected={activeTab === 'guide'}
            className={activeTab === 'guide' ? 'tab-chip active' : 'tab-chip'}
            onClick={() => setActiveTab('guide')}
            role="tab"
            type="button"
          >
            功能介绍
          </button>
        </div>

        <div className="changelog-modal-body stack-gap-md">
          {activeTab === 'updates' ? (
            visitorChangelog.map((entry) => {
              const categories = getChangelogCategories(entry);

              return (
                <section className="changelog-version" key={entry.version}>
                  <h4 className="changelog-version-title">{entry.version}</h4>
                  {categories.map((category) => (
                    <div className="changelog-category" key={`${entry.version}-${category.label}`}>
                      <p className="changelog-category-label">{category.label}</p>
                      <ul className="changelog-list">
                        {category.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              );
            })
          ) : (
            <SimpleMarkdown content={getVisitorFeatureGuide(featureGuideMarkdown)} />
          )}
        </div>
      </div>
    </div>
  );
}
