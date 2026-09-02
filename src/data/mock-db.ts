import type {
  AdminSession,
  BulkReviewResult,
  Play,
  PlayDraft,
  PlayStatus,
  Repo,
  RepoAuditLog,
  RepoDraft,
  RepoReviewAction,
  RepoStatus,
  ReviewAction,
  ReviewLog,
  SiteSettings,
  SubmissionFeedback,
  Tag,
  TagDraft,
} from '../types/play';
import { DEFAULT_CATEGORY, PLAYS_UPDATED_EVENT, TAGS_UPDATED_EVENT } from '../types/play';

const PLAY_STORE_KEY = 'mini-theater.plays';
const REVIEW_LOG_STORE_KEY = 'mini-theater.review-logs';
const REPO_REVIEW_LOG_STORE_KEY = 'mini-theater.repo-review-logs';
const REPO_STORE_KEY = 'mini-theater.repos';
const ADMIN_SESSION_KEY = 'mini-theater.admin-session';
const TAG_STORE_KEY = 'mini-theater.tags';
const SITE_SETTINGS_STORE_KEY = 'mini-theater.site-settings';

const now = () => new Date().toISOString();

const makeId = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

const emitPlaysUpdated = () => {
  window.dispatchEvent(new Event(PLAYS_UPDATED_EVENT));
};

const emitTagsUpdated = () => {
  window.dispatchEvent(new Event(TAGS_UPDATED_EVENT));
};

const seedTags: Tag[] = [
  { id: 'tag_modern', name: '现代/日常', sortOrder: 0, createdAt: now(), updatedAt: now() },
  { id: 'tag_emotion', name: '情感/恋爱', sortOrder: 1, createdAt: now(), updatedAt: now() },
  { id: 'tag_campus', name: '校园/成长', sortOrder: 2, createdAt: now(), updatedAt: now() },
];

const seedPlays: Play[] = [
  {
    id: 'play_seed_approved_1',
    title: '深夜便利店的最后一单',
    authorName: '雾片',
    category: '现代/日常',
    summary: '两个陌生人在便利店关门前，互相接住了彼此的一点崩溃。',
    content:
      '凌晨一点，便利店只剩冷白灯和收银台的滴答声。她抱着一箱泡面站在门口，像是想进来，又像是只想找个地方站一会儿。你说，买一送一，今天最后一单。她笑了一下，说那就给生活也来一份赠品吧。',
    status: 'approved',
    createdAt: now(),
    updatedAt: now(),
    reviewedAt: now(),
    reviewNote: '首批展示内容',
  },
  {
    id: 'play_seed_pending_1',
    title: '雨天广播站',
    authorName: '青桥',
    category: '校园/成长',
    summary: '一段没有说出口的告白，被留在校广播站最后一次值班里。',
    content:
      '毕业前最后一次值班，广播站外一直在下雨。你把稿子一页页读完，却把真正想说的话压在最下面。直到片尾音乐响起，话筒红灯熄灭，你才知道，有些台词只会留给自己。',
    status: 'pending',
    createdAt: now(),
    updatedAt: now(),
  },
];

const seedReviewLogs: ReviewLog[] = [
  {
    id: 'review_seed_1',
    playId: 'play_seed_approved_1',
    action: 'approve',
    operator: 'system-seed',
    note: '首批展示内容',
    createdAt: now(),
    playTitle: '深夜便利店的最后一单',
  },
];

const seedRepoReviewLogs: RepoAuditLog[] = [];

const createSeedBackground = (overlayOpacity: number) => ({
  backgroundUrl: '',
  crop: {
    positionX: 50,
    positionY: 50,
    scale: 100,
    backgroundOpacity: 1,
    overlayOpacity,
  },
});

const seedSiteSettings: SiteSettings = {
  light: {
    desktop: createSeedBackground(0.2),
    mobile: createSeedBackground(0.2),
  },
  dark: {
    desktop: createSeedBackground(0.32),
    mobile: createSeedBackground(0.32),
  },
  createdAt: now(),
  updatedAt: now(),
};

const readStore = <T>(key: string, fallback: T): T => {
  const raw = localStorage.getItem(key);
  if (!raw) {
    localStorage.setItem(key, JSON.stringify(fallback));
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    localStorage.setItem(key, JSON.stringify(fallback));
    return fallback;
  }
};

const writeStore = <T>(key: string, value: T) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const getTags = () => readStore<Tag[]>(TAG_STORE_KEY, seedTags);
const setTags = (tags: Tag[]) => {
  writeStore(TAG_STORE_KEY, tags);
  emitTagsUpdated();
};
const getPlays = () => readStore<Play[]>(PLAY_STORE_KEY, seedPlays);
const setPlays = (plays: Play[]) => {
  writeStore(PLAY_STORE_KEY, plays);
  emitPlaysUpdated();
};
/* 「修改」标题 / 分类时,按 (authorName + title + category) 旧键把同系列下所有作品
 * (不同状态) 一起重写到新键,使 buildPlayVersionGroups / 列表 / 详情同步跟随。
 * 返回变更后的全表。 */
const applySeriesRename = (
  plays: Play[],
  oldKey: { authorName: string; title: string; category: string },
  next: { title: string; category: string },
  timestamp: string,
): Play[] => {
  const titleChanged = oldKey.title !== next.title;
  const categoryChanged = oldKey.category !== next.category;
  if (!titleChanged && !categoryChanged) {
    return plays;
  }
  return plays.map((play) => {
    if (
      play.authorName === oldKey.authorName &&
      play.title === oldKey.title &&
      play.category === oldKey.category
    ) {
      return {
        ...play,
        title: next.title,
        category: next.category,
        updatedAt: timestamp,
      };
    }
    return play;
  });
};
const getReviewLogs = () => readStore<ReviewLog[]>(REVIEW_LOG_STORE_KEY, seedReviewLogs);
const setReviewLogs = (logs: ReviewLog[]) => writeStore(REVIEW_LOG_STORE_KEY, logs);
const getRepoReviewLogs = () =>
  readStore<RepoAuditLog[]>(REPO_REVIEW_LOG_STORE_KEY, seedRepoReviewLogs);
const setRepoReviewLogs = (logs: RepoAuditLog[]) => writeStore(REPO_REVIEW_LOG_STORE_KEY, logs);
const getRepos = () => readStore<Repo[]>(REPO_STORE_KEY, []);
const setRepos = (repos: Repo[]) => writeStore(REPO_STORE_KEY, repos);
const getSiteSettings = () => readStore<SiteSettings>(SITE_SETTINGS_STORE_KEY, seedSiteSettings);
const setSiteSettings = (settings: SiteSettings) => writeStore(SITE_SETTINGS_STORE_KEY, settings);

const createDevSession = (username: string) => {
  const session: AdminSession = {
    token: makeId('session'),
    username,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 8).toISOString(),
  };

  writeStore(ADMIN_SESSION_KEY, session);
  return session;
};

const normalizeTagName = (value: string) => value.trim();
const ensureTagName = (value: string) => {
  const name = normalizeTagName(value);
  if (!name || name === DEFAULT_CATEGORY) {
    return;
  }

  const currentTags = getTags();
  if (currentTags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
    return;
  }

  const timestamp = now();
  setTags([
    ...currentTags,
    {
      id: makeId('tag'),
      name,
      sortOrder: currentTags.length,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
};
const normalizeImportedSummary = (value: string) => {
  const normalized = value.trim();
  return normalized === '导入数据' || normalized === '无简介' ? '' : normalized;
};
const normalizeBackupTimestamp = (value: string, fallback: string) => {
  const normalized = value.trim();
  return normalized && !Number.isNaN(Date.parse(normalized)) ? normalized : fallback;
};
const normalizeBackupPlay = (play: Play): Play => {
  const timestampFallback = now();
  const createdAt = normalizeBackupTimestamp(play.createdAt, timestampFallback);
  const updatedAt = normalizeBackupTimestamp(play.updatedAt, createdAt);
  const reviewedAt = play.reviewedAt?.trim()
    ? normalizeBackupTimestamp(play.reviewedAt, updatedAt)
    : undefined;

  return {
    id: play.id.trim() || makeId('play'),
    title: play.title.trim(),
    authorName: play.authorName.trim(),
    category: play.category.trim() || DEFAULT_CATEGORY,
    summary: normalizeImportedSummary(play.summary),
    content: play.content,
    status: play.status,
    createdAt,
    updatedAt,
    reviewedAt,
    reviewNote: play.reviewNote?.trim() || undefined,
  };
};

export const mockDb = {
  getPublicPlays() {
    return getPlays()
      .filter((play) => play.status === 'approved')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  getPublicPlayById(id: string) {
    return getPlays().find((play) => play.id === id && play.status === 'approved') ?? null;
  },

  getTags() {
    return getTags().sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'),
    );
  },

  getSiteSettings() {
    return getSiteSettings();
  },

  updateSiteSettings(settings: SiteSettings) {
    const current = getSiteSettings();
    const nextSettings: SiteSettings = {
      ...settings,
      createdAt: current.createdAt,
      updatedAt: now(),
    };

    setSiteSettings(nextSettings);
    return nextSettings;
  },

  getSubmissionFeedback(ids: string[]): SubmissionFeedback[] {
    const idSet = new Set(ids);
    return getPlays()
      .filter((play) => idSet.has(play.id))
      .map((play) => ({
        playId: play.id,
        status: play.status,
        reviewNote: play.reviewNote ?? '',
        reviewedAt: play.reviewedAt,
        updatedAt: play.updatedAt,
        latestTitle: play.title,
        latestAuthorName: play.authorName,
        latestCategory: play.category,
        latestSummary: play.summary,
        latestContent: play.content,
      }));
  },

  createPlay(draft: PlayDraft) {
    const createdAt = now();
    const play: Play = {
      id: makeId('play'),
      ...draft,
      category: draft.category?.trim() || DEFAULT_CATEGORY,
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    };

    setPlays([play, ...getPlays()]);
    return play;
  },

  getReposByPlayId(playId: string, order: 'asc' | 'desc') {
    return getRepos()
      .filter((repo) => repo.playId === playId && repo.status === 'approved')
      .sort((left, right) =>
        order === 'desc'
          ? right.createdAt.localeCompare(left.createdAt)
          : left.createdAt.localeCompare(right.createdAt),
      );
  },

  getMyRepos(visitorId: string, order: 'asc' | 'desc') {
    return getRepos()
      .filter((repo) => repo.visitorId === visitorId)
      .sort((left, right) =>
        order === 'desc'
          ? right.createdAt.localeCompare(left.createdAt)
          : left.createdAt.localeCompare(right.createdAt),
      );
  },

  getReceivedRepos(playIds: string[], visitorId: string, order: 'asc' | 'desc') {
    const playIdSet = new Set(playIds);
    return getRepos()
      .filter(
        (repo) =>
          (repo.status === 'approved' || repo.status === 'rejected') &&
          repo.visitorId !== visitorId &&
          (playIdSet.has(repo.playId) || repo.replyToVisitorId === visitorId),
      )
      .sort((left, right) =>
        order === 'desc'
          ? right.createdAt.localeCompare(left.createdAt)
          : left.createdAt.localeCompare(right.createdAt),
      );
  },

  createRepo(draft: RepoDraft) {
    const play = this.getPublicPlayById(draft.playId);
    if (!play) {
      throw new Error('小剧场不存在，或尚未通过审核');
    }

    const parent = draft.parentId
      ? getRepos().find((repo) => repo.id === draft.parentId && repo.playId === draft.playId)
      : null;
    const createdAt = now();
    const repo: Repo = {
      id: makeId('repo'),
      playId: draft.playId,
      parentId: draft.parentId,
      rootId: parent?.rootId ?? parent?.id,
      nickname: draft.nickname.trim(),
      visitorId: draft.visitorId.trim(),
      content: draft.content.trim(),
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
      playTitle: play.title,
      playAuthorName: play.authorName,
      replyToNickname: parent?.nickname,
      replyToVisitorId: parent?.visitorId,
    };

    setRepos([repo, ...getRepos()]);
    return repo;
  },

  getRepoCounts(playIds: string[]) {
    const playIdSet = new Set(playIds);
    const summaryMap = new Map<
      string,
      { count: number; firstCreatedAt?: string; lastCreatedAt?: string }
    >();
    getRepos()
      .filter((repo) => repo.status === 'approved' && playIdSet.has(repo.playId))
      .forEach((repo) => {
        const current = summaryMap.get(repo.playId) ?? {
          count: 0,
          firstCreatedAt: undefined,
          lastCreatedAt: undefined,
        };
        summaryMap.set(repo.playId, {
          count: current.count + 1,
          firstCreatedAt:
            !current.firstCreatedAt || repo.createdAt.localeCompare(current.firstCreatedAt) < 0
              ? repo.createdAt
              : current.firstCreatedAt,
          lastCreatedAt:
            !current.lastCreatedAt || repo.createdAt.localeCompare(current.lastCreatedAt) > 0
              ? repo.createdAt
              : current.lastCreatedAt,
        });
      });

    return playIds.map((playId) => ({
      playId,
      count: summaryMap.get(playId)?.count ?? 0,
      firstCreatedAt: summaryMap.get(playId)?.firstCreatedAt,
      lastCreatedAt: summaryMap.get(playId)?.lastCreatedAt,
    }));
  },

  getRepoNoticeSummary(playIds: string[], visitorId: string, readAt: string) {
    const receivedRepos = this.getReceivedRepos(playIds, visitorId, 'desc');
    const readTime = readAt ? new Date(readAt).getTime() : 0;
    return {
      receivedCount: receivedRepos.length,
      unreadCount: receivedRepos.filter((repo) => new Date(repo.createdAt).getTime() > readTime)
        .length,
    };
  },

  login(username: string, password: string) {
    if (!import.meta.env.DEV) {
      throw new Error('当前构建未启用前端本地管理员登录，请部署后端并配置管理员环境变量。');
    }

    if (!username.trim() || !password.trim()) {
      throw new Error('开发演示模式下也需要填写账号和密码。');
    }

    return createDevSession(username.trim());
  },

  getSession() {
    const session = readStore<AdminSession | null>(ADMIN_SESSION_KEY, null);
    if (!session) {
      return null;
    }

    if (new Date(session.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(ADMIN_SESSION_KEY);
      return null;
    }

    return session;
  },

  logout() {
    localStorage.removeItem(ADMIN_SESSION_KEY);
  },

  getAdminPlays(status?: PlayStatus) {
    const plays = getPlays().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return status ? plays.filter((play) => play.status === status) : plays;
  },

  getAdminPlayById(id: string) {
    return getPlays().find((play) => play.id === id) ?? null;
  },

  restoreAdminBackup(plays: Play[]) {
    const normalizedPlays = plays.map(normalizeBackupPlay);
    const seenIds = new Set<string>();

    for (const play of normalizedPlays) {
      if (!play.id) {
        throw new Error('备份里存在缺少 id 的内容');
      }

      if (seenIds.has(play.id)) {
        throw new Error('备份里存在重复 id，请检查压缩包内容');
      }

      if (!play.title || !play.authorName || !play.content) {
        throw new Error('备份里存在标题、署名或正文为空的内容');
      }

      seenIds.add(play.id);
    }

    setReviewLogs([]);
    setPlays(normalizedPlays.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    return { restoredCount: normalizedPlays.length };
  },

  createTag(draft: TagDraft) {
    const name = normalizeTagName(draft.name);
    if (!name) {
      throw new Error('标签名不能为空');
    }

    const existing = getTags().find((tag) => tag.name === name);
    if (existing) {
      throw new Error('标签已存在');
    }

    const timestamp = now();
    const nextTag: Tag = {
      id: makeId('tag'),
      name,
      sortOrder: getTags().length,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    setTags([...getTags(), nextTag]);
    return nextTag;
  },

  updateTag(tagId: string, draft: TagDraft) {
    const name = normalizeTagName(draft.name);
    if (!name) {
      throw new Error('标签名不能为空');
    }

    const currentTags = getTags();
    const existing = currentTags.find((tag) => tag.id !== tagId && tag.name === name);
    if (existing) {
      throw new Error('标签已存在');
    }

    const timestamp = now();
    let target: Tag | null = null;
    const nextTags = currentTags.map((tag) => {
      if (tag.id !== tagId) {
        return tag;
      }

      target = { ...tag, name, updatedAt: timestamp };
      return target;
    });

    if (!target) {
      throw new Error('标签不存在');
    }

    const nextPlays = getPlays().map((play) =>
      play.category === currentTags.find((tag) => tag.id === tagId)?.name
        ? { ...play, category: name, updatedAt: timestamp }
        : play,
    );

    setTags(nextTags);
    setPlays(nextPlays);
    return target;
  },

  deleteTag(tagId: string) {
    const currentTags = getTags();
    const target = currentTags.find((tag) => tag.id === tagId);
    if (!target) {
      throw new Error('标签不存在');
    }

    const nextTags = currentTags
      .filter((tag) => tag.id !== tagId)
      .map((tag, index) => ({ ...tag, sortOrder: index }));
    const timestamp = now();
    const nextPlays = getPlays().map((play) =>
      play.category === target.name
        ? { ...play, category: DEFAULT_CATEGORY, updatedAt: timestamp }
        : play,
    );

    setTags(nextTags);
    setPlays(nextPlays);
  },

  reorderTags(orderedIds: string[]) {
    const currentTags = this.getTags();
    if (currentTags.length !== orderedIds.length) {
      throw new Error('标签重排数量不匹配');
    }

    const tagMap = new Map(currentTags.map((tag) => [tag.id, tag]));
    const nextTags = orderedIds.map((tagId, index) => {
      const tag = tagMap.get(tagId);
      if (!tag) {
        throw new Error('标签重排数据无效');
      }

      return {
        ...tag,
        sortOrder: index,
      };
    });

    setTags(nextTags);
    return nextTags;
  },

  deleteAdminPlay(playId: string) {
    const target = this.getAdminPlayById(playId);
    if (!target) {
      throw new Error('内容不存在');
    }

    setPlays(getPlays().filter((play) => play.id !== playId));
    setReviewLogs(getReviewLogs().filter((log) => log.playId !== playId));
  },

  clearReviewLogs(playId: string) {
    const target = this.getAdminPlayById(playId);
    if (!target) {
      throw new Error('内容不存在');
    }

    setReviewLogs(getReviewLogs().filter((log) => log.playId !== playId));
  },

  updateAdminPlay(
    playId: string,
    edit: {
      title?: string;
      authorName?: string;
      category?: string;
      summary?: string;
      content?: string;
    },
  ): Play | null {
    const currentPlay = this.getAdminPlayById(playId);
    if (!currentPlay) {
      throw new Error('内容不存在');
    }

    const nextTitle = String(edit.title ?? currentPlay.title).trim();
    const nextAuthorName = String(edit.authorName ?? currentPlay.authorName).trim();
    const nextCategory =
      String(edit.category ?? currentPlay.category).trim() || currentPlay.category;
    const nextSummary = normalizeImportedSummary(String(edit.summary ?? currentPlay.summary));
    const nextContent = String(edit.content ?? currentPlay.content).trim();

    if (!nextTitle) {
      throw new Error('标题不能为空');
    }

    if (!nextAuthorName) {
      throw new Error('署名不能为空');
    }

    if (!nextContent) {
      throw new Error('正文不能为空');
    }

    ensureTagName(nextCategory);

    const timestamp = now();
    const updatedRow: Play = {
      ...currentPlay,
      title: nextTitle,
      authorName: nextAuthorName,
      category: nextCategory,
      summary: nextSummary,
      content: nextContent,
      updatedAt: timestamp,
    };
    let nextPlays: Play[] = getPlays().map((play) => (play.id === playId ? updatedRow : play));
    nextPlays = applySeriesRename(
      nextPlays,
      {
        authorName: currentPlay.authorName,
        title: currentPlay.title,
        category: currentPlay.category,
      },
      { title: nextTitle, category: nextCategory },
      timestamp,
    );

    setPlays(nextPlays);
    return nextPlays.find((play) => play.id === playId) ?? null;
  },

  reviewPlay(
    playId: string,
    action: ReviewAction,
    note: string,
    edit?: {
      title?: string;
      authorName?: string;
      category?: string;
      summary?: string;
      content?: string;
    },
  ): Play | null {
    const session = this.getSession();
    if (!session) {
      throw new Error('管理员未登录');
    }

    const currentPlay = this.getAdminPlayById(playId);
    if (!currentPlay) {
      throw new Error('内容不存在');
    }

    const mappedStatus: PlayStatus =
      action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'offline';
    const timestamp = now();

    /* 「修改」语义:原 play 已通过 pendingEdit 携带作者改动,任意审核动作都需清空。
     * approve:把 pendingEdit 字段合入主字段 + 同系列 title/category 跟随。
     * reject / offline:仅清空 pendingEdit,主字段保持不变。
     * inline edit 不允许走 modify 路径。 */
    if (currentPlay.pendingEdit) {
      if (action === 'approve') {
        const nextTitle = currentPlay.pendingEdit.title.trim();
        const nextAuthorName = currentPlay.pendingEdit.authorName.trim();
        const nextCategory = currentPlay.pendingEdit.category.trim() || currentPlay.category;
        const nextSummary = normalizeImportedSummary(currentPlay.pendingEdit.summary);
        const nextContent = currentPlay.pendingEdit.content.trim();
        if (!nextTitle) throw new Error('标题不能为空');
        if (!nextAuthorName) throw new Error('署名不能为空');
        if (!nextContent) throw new Error('正文不能为空');
        ensureTagName(nextCategory);
        let nextPlays: Play[] = getPlays().map((play) =>
          play.id === playId
            ? {
                ...play,
                title: nextTitle,
                authorName: nextAuthorName,
                category: nextCategory,
                summary: nextSummary,
                content: nextContent,
                status: mappedStatus,
                reviewNote: note || '无备注',
                reviewedAt: timestamp,
                updatedAt: timestamp,
                pendingEdit: undefined,
              }
            : play,
        );
        if (currentPlay.title !== nextTitle || currentPlay.category !== nextCategory) {
          nextPlays = applySeriesRename(
            nextPlays,
            {
              authorName: currentPlay.authorName,
              title: currentPlay.title,
              category: currentPlay.category,
            },
            { title: nextTitle, category: nextCategory },
            timestamp,
          );
        }
        setPlays(nextPlays);
        const reviewLog: ReviewLog = {
          id: makeId('review'),
          playId,
          action: 'approve',
          operator: session.username,
          note: note || '无备注',
          createdAt: timestamp,
          playTitle: nextTitle,
        };
        setReviewLogs([reviewLog, ...getReviewLogs()]);
        return nextPlays.find((play) => play.id === playId) ?? null;
      }
      /* reject / offline:清空 pendingEdit,把状态写入主字段。 */
      const updatedRow: Play = {
        ...currentPlay,
        status: mappedStatus,
        reviewNote: note || '无备注',
        reviewedAt: timestamp,
        updatedAt: timestamp,
        pendingEdit: undefined,
      };
      const nextPlays: Play[] = getPlays().map((play) => (play.id === playId ? updatedRow : play));
      setPlays(nextPlays);
      const reviewLog: ReviewLog = {
        id: makeId('review'),
        playId,
        action,
        operator: session.username,
        note: note || '无备注',
        createdAt: timestamp,
        playTitle: updatedRow.title,
      };
      setReviewLogs([reviewLog, ...getReviewLogs()]);
      return nextPlays.find((play) => play.id === playId) ?? null;
    }

    /* 普通投稿 / 衍生:inline edit 覆盖,否则保持原字段。 */
    const inlineEdit = edit;
    const nextTitle = String(inlineEdit?.title ?? currentPlay.title).trim();
    const nextAuthorName = String(inlineEdit?.authorName ?? currentPlay.authorName).trim();
    const nextCategory =
      String(inlineEdit?.category ?? currentPlay.category).trim() || currentPlay.category;
    const nextSummary = normalizeImportedSummary(
      String(inlineEdit?.summary ?? currentPlay.summary),
    );
    const nextContent = String(inlineEdit?.content ?? currentPlay.content).trim();

    if (!nextTitle) {
      throw new Error('标题不能为空');
    }

    if (!nextAuthorName) {
      throw new Error('署名不能为空');
    }

    if (!nextContent) {
      throw new Error('正文不能为空');
    }

    ensureTagName(nextCategory);

    const updatedRow: Play = {
      ...currentPlay,
      title: nextTitle,
      authorName: nextAuthorName,
      category: nextCategory,
      summary: nextSummary,
      content: nextContent,
      status: mappedStatus,
      reviewNote: note || '无备注',
      reviewedAt: timestamp,
      updatedAt: timestamp,
    };
    let nextPlays: Play[] = getPlays().map((play) => (play.id === playId ? updatedRow : play));
    nextPlays = applySeriesRename(
      nextPlays,
      {
        authorName: currentPlay.authorName,
        title: currentPlay.title,
        category: currentPlay.category,
      },
      { title: nextTitle, category: nextCategory },
      timestamp,
    );

    setPlays(nextPlays);
    const reviewLog: ReviewLog = {
      id: makeId('review'),
      playId,
      action,
      operator: session.username,
      note: note || '无备注',
      createdAt: timestamp,
      playTitle: nextTitle,
    };
    setReviewLogs([reviewLog, ...getReviewLogs()]);
    return nextPlays.find((play) => play.id === playId) ?? null;
  },

  /* 作者「修改」投稿:创建一条独立的 pending 待审核 play,
   * submissionType='modify', parentPlayId 指向被改的原 play。 */
  /* 作者「修改」投稿:把改动就地写入原 play 的 pendingEdit 字段,
   * 不创建新 play。审核通过时由 reviewPlay 合入字段并清空 pendingEdit,
   * 拒绝 / 下线时仅清空 pendingEdit,原 play 字段保持不变。 */
  submitPlayEdit(
    playId: string,
    draft: {
      title: string;
      category: string;
      summary: string;
      content: string;
      authorName: string;
    },
  ): Play {
    const currentPlay = this.getAdminPlayById(playId);
    if (!currentPlay) {
      throw new Error('内容不存在');
    }
    const nextTitle = draft.title.trim();
    const nextAuthorName = draft.authorName.trim();
    const nextCategory = draft.category.trim() || currentPlay.category;
    const nextSummary = normalizeImportedSummary(draft.summary);
    const nextContent = draft.content.trim();
    if (!nextTitle) throw new Error('标题不能为空');
    if (!nextAuthorName) throw new Error('署名不能为空');
    if (!nextContent) throw new Error('正文不能为空');
    ensureTagName(nextCategory);
    const timestamp = now();
    const pendingEdit = {
      title: nextTitle,
      authorName: nextAuthorName,
      category: nextCategory,
      summary: nextSummary,
      content: nextContent,
      submittedAt: timestamp,
    };
    const nextPlays: Play[] = getPlays().map((play) =>
      play.id === playId
        ? {
            ...play,
            pendingEdit,
            updatedAt: timestamp,
          }
        : play,
    );
    setPlays(nextPlays);
    return nextPlays.find((play) => play.id === playId)!;
  },

  clearPendingEdit(playId: string): Play | null {
    const currentPlay = this.getAdminPlayById(playId);
    if (!currentPlay) {
      return null;
    }
    if (!currentPlay.pendingEdit) {
      return currentPlay;
    }
    const timestamp = now();
    const nextPlays: Play[] = getPlays().map((play) =>
      play.id === playId ? { ...play, pendingEdit: undefined, updatedAt: timestamp } : play,
    );
    setPlays(nextPlays);
    return nextPlays.find((play) => play.id === playId) ?? null;
  },

  getPendingEditPlays(): Play[] {
    return getPlays()
      .filter((play) => Boolean(play.pendingEdit))
      .sort((left, right) => {
        const leftAt = left.pendingEdit?.submittedAt ?? left.updatedAt;
        const rightAt = right.pendingEdit?.submittedAt ?? right.updatedAt;
        return rightAt.localeCompare(leftAt);
      });
  },

  getAdminRepos(status?: RepoStatus) {
    const repos = getRepos().sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return status ? repos.filter((repo) => repo.status === status) : repos;
  },

  reviewRepo(repoId: string, action: RepoReviewAction, note: string) {
    const session = this.getSession();
    if (!session) {
      throw new Error('管理员未登录');
    }

    const target = getRepos().find((repo) => repo.id === repoId);
    if (!target) {
      throw new Error('repo 不存在');
    }

    const timestamp = now();
    const normalizedNote = note || '无备注';
    const nextStatus: RepoStatus = action === 'approve' ? 'approved' : 'rejected';
    const nextRepos = getRepos().map((repo) =>
      repo.id === repoId
        ? {
            ...repo,
            status: nextStatus,
            reviewNote: normalizedNote,
            reviewedAt: timestamp,
            updatedAt: timestamp,
          }
        : repo,
    );
    setRepos(nextRepos);
    setRepoReviewLogs([
      {
        id: makeId('repo_review'),
        repoId: target.id,
        playId: target.playId,
        action,
        operator: session.username,
        note: normalizedNote,
        createdAt: timestamp,
        playTitle: target.playTitle,
        nickname: target.nickname,
      },
      ...getRepoReviewLogs(),
    ]);
    return nextRepos.find((repo) => repo.id === repoId) ?? null;
  },

  /* 任务 5：管理员编辑 repo 正文 / 审核备注。 */
  updateRepo(repoId: string, patch: { content?: string; note?: string }) {
    const session = this.getSession();
    if (!session) {
      throw new Error('管理员未登录');
    }
    const target = getRepos().find((repo) => repo.id === repoId);
    if (!target) {
      throw new Error('repo 不存在');
    }
    const timestamp = now();
    const newContent = patch.content !== undefined ? patch.content.trim() : undefined;
    const newNote = patch.note !== undefined ? patch.note.trim() : undefined;
    if (newContent !== undefined && newContent.length === 0) {
      throw new Error('repo 正文不能为空');
    }
    const nextRepos = getRepos().map((repo) =>
      repo.id === repoId
        ? {
            ...repo,
            content: newContent ?? repo.content,
            reviewNote: newNote ?? repo.reviewNote ?? '',
            updatedAt: timestamp,
          }
        : repo,
    );
    setRepos(nextRepos);
    setRepoReviewLogs([
      {
        id: makeId('repo_review'),
        repoId: target.id,
        playId: target.playId,
        action: 'edit',
        operator: session.username,
        note: newNote ?? target.reviewNote ?? '',
        createdAt: timestamp,
        playTitle: target.playTitle,
        nickname: target.nickname,
      },
      ...getRepoReviewLogs(),
    ]);
    return nextRepos.find((repo) => repo.id === repoId) ?? null;
  },

  deleteRepo(repoId: string) {
    const session = this.getSession();
    if (!session) {
      throw new Error('管理员未登录');
    }

    const target = getRepos().find((repo) => repo.id === repoId);
    if (!target) {
      throw new Error('repo 不存在');
    }

    setRepoReviewLogs([
      {
        id: makeId('repo_review'),
        repoId: target.id,
        playId: target.playId,
        action: 'delete',
        operator: session.username,
        note: '后台删除 repo',
        createdAt: now(),
        playTitle: target.playTitle,
        nickname: target.nickname,
      },
      ...getRepoReviewLogs(),
    ]);
    setRepos(
      getRepos().filter(
        (repo) => repo.id !== repoId && repo.parentId !== repoId && repo.rootId !== repoId,
      ),
    );
  },

  deleteRejectedReposByVisitor(visitorId: string): number {
    const normalizedVisitorId = visitorId.trim();
    if (!normalizedVisitorId) {
      return 0;
    }
    const before = getRepos().length;
    setRepos(
      getRepos().filter(
        (repo) => !(repo.visitorId === normalizedVisitorId && repo.status === 'rejected'),
      ),
    );
    return before - getRepos().length;
  },

  bulkReviewPlays(playIds: string[], action: ReviewAction, note: string): BulkReviewResult {
    const session = this.getSession();
    if (!session) {
      throw new Error('管理员未登录');
    }

    const normalizedIds = Array.from(new Set(playIds.map((id) => id.trim()).filter(Boolean)));
    if (normalizedIds.length === 0) {
      return {
        action,
        updatedIds: [],
        skippedIds: [],
        updatedCount: 0,
        skippedCount: 0,
      };
    }

    const timestamp = now();
    const reviewNote = note || '无备注';
    const idSet = new Set(normalizedIds);
    const currentPlays = getPlays();
    const updatedIds = currentPlays.filter((play) => idSet.has(play.id)).map((play) => play.id);
    const skippedIds = normalizedIds.filter((id) => !updatedIds.includes(id));
    const mappedStatus: PlayStatus =
      action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'offline';

    if (mappedStatus === 'approved') {
      currentPlays
        .filter((play) => idSet.has(play.id))
        .forEach((play) => ensureTagName(play.category));
    }

    if (updatedIds.length > 0) {
      const updatedIdSet = new Set(updatedIds);
      const nextPlays = currentPlays.map((play) =>
        updatedIdSet.has(play.id)
          ? {
              ...play,
              status: mappedStatus,
              reviewNote,
              reviewedAt: timestamp,
              updatedAt: timestamp,
            }
          : play,
      );
      const nextLogs = [
        ...updatedIds.map((playId): ReviewLog => ({
          id: makeId('review'),
          playId,
          action,
          operator: session.username,
          note: reviewNote,
          createdAt: timestamp,
          playTitle: currentPlays.find((play) => play.id === playId)?.title,
        })),
        ...getReviewLogs(),
      ];

      setPlays(nextPlays);
      setReviewLogs(nextLogs);
    }

    return {
      action,
      updatedIds,
      skippedIds,
      updatedCount: updatedIds.length,
      skippedCount: skippedIds.length,
    };
  },

  getReviewLogs(playId: string) {
    const playTitleMap = new Map(getPlays().map((play) => [play.id, play.title]));
    return getReviewLogs()
      .filter((log) => log.playId === playId)
      .map((log) => ({
        ...log,
        playTitle: log.playTitle ?? playTitleMap.get(log.playId),
      }));
  },

  getAllPlayReviewLogs() {
    const playTitleMap = new Map(getPlays().map((play) => [play.id, play.title]));
    return getReviewLogs().map((log) => ({
      ...log,
      playTitle: log.playTitle ?? playTitleMap.get(log.playId),
    }));
  },

  getAllRepoAuditLogs() {
    const playTitleMap = new Map(getPlays().map((play) => [play.id, play.title]));
    return getRepoReviewLogs().map((log) => ({
      ...log,
      playTitle: log.playTitle ?? playTitleMap.get(log.playId),
    }));
  },
};
