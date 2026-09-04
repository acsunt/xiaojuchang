CREATE TABLE IF NOT EXISTS plays (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author_name TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'offline')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  review_note TEXT,
  submission_type TEXT NOT NULL DEFAULT 'original' CHECK (submission_type IN ('original', 'modify', 'derived')),
  parent_play_id TEXT REFERENCES plays(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plays_status_updated_at ON plays(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_plays_parent_play_id ON plays(parent_play_id);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

CREATE TABLE IF NOT EXISTS site_settings (
  id TEXT PRIMARY KEY,
  light_background_url TEXT NOT NULL DEFAULT '',
  light_position_x REAL NOT NULL DEFAULT 50,
  light_position_y REAL NOT NULL DEFAULT 50,
  light_scale REAL NOT NULL DEFAULT 100,
  light_overlay_opacity REAL NOT NULL DEFAULT 0.2,
  dark_background_url TEXT NOT NULL DEFAULT '',
  dark_position_x REAL NOT NULL DEFAULT 50,
  dark_position_y REAL NOT NULL DEFAULT 50,
  dark_scale REAL NOT NULL DEFAULT 100,
  dark_overlay_opacity REAL NOT NULL DEFAULT 0.32,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO site_settings (
  id,
  light_background_url,
  light_position_x,
  light_position_y,
  light_scale,
  light_overlay_opacity,
  dark_background_url,
  dark_position_x,
  dark_position_y,
  dark_scale,
  dark_overlay_opacity,
  created_at,
  updated_at
) VALUES (
  'default',
  '',
  50,
  50,
  100,
  0.2,
  '',
  50,
  50,
  100,
  0.32,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS review_logs (
  id TEXT PRIMARY KEY,
  play_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'offline')),
  operator TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (play_id) REFERENCES plays(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  play_id TEXT NOT NULL,
  parent_id TEXT,
  root_id TEXT,
  nickname TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  review_note TEXT,
  FOREIGN KEY (play_id) REFERENCES plays(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_repos_play_status_created_at ON repos(play_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repos_visitor_created_at ON repos(visitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repos_parent_id ON repos(parent_id);

CREATE INDEX IF NOT EXISTS idx_review_logs_play_created_at ON review_logs(play_id, created_at DESC);

/* 续写:挂在原文小剧场下面的长文本内容,与 repo 评论平级但独立审核。
 *
 * 与 repos 的差异:
 * - 必填 summary:用于续写列表里展示「这条续写写什么」(简介/导语)
 * - nickname 可空:未填写表示「匿名」或「原作者匿名续写」,详情页不展示署名
 *   (不填大概率是原作者自己续写,没必要在原文下面显示作者名)
 * - status 与 repos 一致,审核员独立看待
 * - author_name:虽然 nickname 可空,仍保留作者字段供后续追溯;
 *   复用 repo 的 nickname 列,语义与续写表单的「作者」一致
 *
 * 为什么分表:续写是长文、有简介、走自己的审核池;repos 是轻量评论,
 * 不应该被续写的长内容污染评论列表/统计。 */
CREATE TABLE IF NOT EXISTS continuations (
  id TEXT PRIMARY KEY,
  play_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  review_note TEXT,
  FOREIGN KEY (play_id) REFERENCES plays(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_continuations_play_status_created_at
  ON continuations(play_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_continuations_visitor_created_at
  ON continuations(visitor_id, created_at DESC);

INSERT OR IGNORE INTO tags (id, name, sort_order, created_at, updated_at) VALUES
  ('tag_modern', '现代/日常', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tag_emotion', '情感/恋爱', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tag_campus', '校园/成长', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);