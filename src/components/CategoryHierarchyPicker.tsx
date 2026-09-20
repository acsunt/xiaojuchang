import { useMemo } from 'react';
import type { Tag } from '../types/play';
import {
  buildTagGroupNodes,
  joinPlayCategoriesByTags,
  splitPlayCategories,
} from '../utils/categories';

type CategoryHierarchyPickerProps = {
  tags: Tag[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  chipClassName?: string;
  keyword?: string;
  emptyText?: string;
};

const toggleName = (current: string[], name: string) =>
  current.includes(name) ? current.filter((item) => item !== name) : [...current, name];

export function CategoryHierarchyPicker({
  tags,
  value,
  onChange,
  disabled = false,
  chipClassName = 'tag-chip',
  keyword = '',
  emptyText = '没有匹配的分类',
}: CategoryHierarchyPickerProps) {
  const selected = useMemo(() => splitPlayCategories(value), [value]);
  const groups = useMemo(() => {
    const nodes = buildTagGroupNodes(tags);
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return nodes;
    }

    return nodes
      .map((node) => {
        const groupMatches = node.group?.name.toLowerCase().includes(normalizedKeyword) ?? false;
        const children = groupMatches
          ? node.children
          : node.children.filter((tag) => tag.name.toLowerCase().includes(normalizedKeyword));
        return { ...node, children };
      })
      .filter((node) => {
        const groupMatches = node.group?.name.toLowerCase().includes(normalizedKeyword) ?? false;
        return groupMatches || node.children.length > 0;
      });
  }, [keyword, tags]);

  if (groups.length === 0) {
    return <div className="content-meta">{emptyText}</div>;
  }

  return (
    <div className="category-hierarchy">
      {groups.map((node) => (
        <div className="category-hierarchy-group" key={node.group?.id ?? 'ungrouped'}>
          {node.group ? (
            <div className="category-hierarchy-group-row">
              <span className="category-hierarchy-group-label">{node.group.name}</span>
            </div>
          ) : (
            <div className="category-hierarchy-group-row">
              <span className="category-hierarchy-group-label">未归入大类</span>
            </div>
          )}
          {node.children.length > 0 ? (
            <div className="category-hierarchy-children">
              {node.children.map((tag) => {
                const active = selected.includes(tag.name);
                return (
                  <button
                    className={active ? `${chipClassName} active` : chipClassName}
                    disabled={disabled}
                    key={tag.id}
                    onClick={() =>
                      onChange(joinPlayCategoriesByTags(toggleName(selected, tag.name), tags))
                    }
                    type="button"
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="content-meta">暂无小类</div>
          )}
        </div>
      ))}
    </div>
  );
}
