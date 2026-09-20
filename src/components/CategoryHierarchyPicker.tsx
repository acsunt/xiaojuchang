import { useMemo } from 'react';
import type { Tag } from '../types/play';
import { buildTagGroupNodes, joinPlayCategories, splitPlayCategories } from '../utils/categories';

type CategoryHierarchyPickerProps = {
  tags: Tag[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  chipClassName?: string;
};

const toggleName = (current: string[], name: string) =>
  current.includes(name) ? current.filter((item) => item !== name) : [...current, name];

export function CategoryHierarchyPicker({
  tags,
  value,
  onChange,
  disabled = false,
  chipClassName = 'tag-chip',
}: CategoryHierarchyPickerProps) {
  const selected = useMemo(() => splitPlayCategories(value), [value]);
  const groups = useMemo(() => buildTagGroupNodes(tags), [tags]);

  if (groups.length === 0) {
    return null;
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
                    onClick={() => onChange(joinPlayCategories(toggleName(selected, tag.name)))}
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
