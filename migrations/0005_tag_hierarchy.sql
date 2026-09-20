/* 标签词表升级为大类 / 小类:
 * - kind=group 表示大类,parent_id 为空
 * - kind=tag 表示小类,可挂到大类下
 * 旧标签全部视为小类,可后续用「汇流入海」归入大类。 */
ALTER TABLE tags ADD COLUMN kind TEXT NOT NULL DEFAULT 'tag';
ALTER TABLE tags ADD COLUMN parent_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tags_parent_id ON tags(parent_id);

INSERT OR IGNORE INTO tags (id, name, kind, parent_id, sort_order, created_at, updated_at) VALUES
  ('tag_group_world', '世界观', 'group', NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tag_group_emotion', '感情向', 'group', NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tag_group_ending', '结局', 'group', NULL, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tag_group_scale', '尺度', 'group', NULL, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tag_group_mood', '氛围', 'group', NULL, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tag_group_special', '特殊', 'group', NULL, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
