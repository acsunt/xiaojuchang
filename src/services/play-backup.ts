import {
  DEFAULT_CATEGORY,
  type Play,
  type PlayStatus,
  type Repo,
  type RepoStatus,
  type Tag,
} from '../types/play';
import { normalizeImportedSummary } from './play-text';
import { createZipFromTextFiles, readZipTextFiles, type ZipTextFile } from './simple-zip';

const LINE_BREAK = /\r?\n/;
const BLOCK_SPLITTER = /\r?\n\s*\r?\n(?=###\s+)/g;
const MARKER_PREFIX = '### ';
const ID_PREFIX = 'Id:';
const TITLE_PREFIX = 'Title:';
const AUTHOR_PREFIX = 'Author:';
const CATEGORY_PREFIX = 'Category:';
const SUMMARY_PREFIX = 'Desc:';
const STATUS_PREFIX = 'Status:';
const CREATED_AT_PREFIX = 'CreatedAt:';
const UPDATED_AT_PREFIX = 'UpdatedAt:';
const REVIEWED_AT_PREFIX = 'ReviewedAt:';
const REVIEW_NOTE_PREFIX = 'ReviewNote:';
const CONTENT_PREFIX = 'Content:';
const TAGS_FILE_NAME = 'tags.txt';
const TAG_NAME_PREFIX = 'Name:';
const TAG_SORT_ORDER_PREFIX = 'SortOrder:';

const backupStatusOrder: PlayStatus[] = ['pending', 'approved', 'rejected', 'offline'];

const backupFileNameMap: Record<PlayStatus, string> = {
  pending: 'pending.txt',
  approved: 'approved.txt',
  rejected: 'rejected.txt',
  offline: 'offline.txt',
};

/* repo 备份文件:挂在压缩包根目录,与 4 个 play 状态文件平级。
 * repo 自身只有 pending/approved/rejected 三种状态,
 * 不存在 offline,这里沿用 plays 的 backupStatusOrder 做排序锚点。 */
const REPO_FILE_PREFIX = 'repo-';
const repoFileNameMap: Record<RepoStatus, string> = {
  pending: `${REPO_FILE_PREFIX}pending.txt`,
  approved: `${REPO_FILE_PREFIX}approved.txt`,
  rejected: `${REPO_FILE_PREFIX}rejected.txt`,
};
const repoStatusOrder: RepoStatus[] = ['pending', 'approved', 'rejected'];

const DEFAULT_BACKUP_ARCHIVE_NAME = '小剧场备份.zip';
const DEFAULT_MERGED_BACKUP_ARCHIVE_NAME = '导出作者和分类.zip';

const safeBackupPathSegment = (value: string, fallback: string) => {
  const normalized = value.trim() || fallback;
  return (
    normalized
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .slice(0, 80) || fallback
  );
};

const splitBlocks = (source: string) =>
  source
    .trim()
    .split(BLOCK_SPLITTER)
    .map((item) => item.trim())
    .filter(Boolean);

const escapeInlineValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n');

const unescapeInlineValue = (value: string) => {
  let result = '';

  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    const next = value[index + 1];

    if (current === '\\' && next === 'n') {
      result += '\n';
      index += 1;
      continue;
    }

    if (current === '\\' && next === '\\') {
      result += '\\';
      index += 1;
      continue;
    }

    result += current;
  }

  return result;
};

const normalizeTimestamp = (value: string, fallback: string) => {
  const normalized = value.trim();
  return normalized && !Number.isNaN(Date.parse(normalized)) ? normalized : fallback;
};

const makeFallbackId = () => `backup_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;

type BackupRecordTextOptions = {
  includeAttachedMeta?: boolean;
};

const makeBackupRecordText = (play: Play, options: BackupRecordTextOptions = {}) => {
  const { includeAttachedMeta = true } = options;
  const reviewedAt = play.reviewedAt?.trim() ?? '';
  const reviewNote = play.reviewNote?.trim() ?? '';
  const status = play.status;

  return [
    `${MARKER_PREFIX}${play.title.trim() || 'Untitled'}`,
    ...(includeAttachedMeta
      ? [
          `${ID_PREFIX} ${escapeInlineValue(play.id)}`,
          `${STATUS_PREFIX} ${status}`,
          `${CREATED_AT_PREFIX} ${escapeInlineValue(play.createdAt)}`,
          `${UPDATED_AT_PREFIX} ${escapeInlineValue(play.updatedAt)}`,
          `${REVIEWED_AT_PREFIX} ${escapeInlineValue(reviewedAt)}`,
          `${REVIEW_NOTE_PREFIX} ${escapeInlineValue(reviewNote)}`,
        ]
      : []),
    `${TITLE_PREFIX} ${escapeInlineValue(play.title)}`,
    `${AUTHOR_PREFIX} ${escapeInlineValue(play.authorName)}`,
    `${CATEGORY_PREFIX} ${escapeInlineValue(play.category || DEFAULT_CATEGORY)}`,
    `${SUMMARY_PREFIX} ${escapeInlineValue(normalizeImportedSummary(play.summary))}`,
    CONTENT_PREFIX,
    play.content,
  ].join('\n');
};

/* repo 的标记头:与 plays 共享 ###,首行写「昵称 · 所属 playId」。
 * 内容块跟 plays 完全一致的格式,以便后续若做导入也能复用 parseBackupText 流程。
 * (注意:目前不做 repo 的导入解析,只负责导出。) */
type RepoBackupRecordTextOptions = {
  includeAttachedMeta?: boolean;
};

const makeRepoRecordText = (repo: Repo, options: RepoBackupRecordTextOptions = {}) => {
  const { includeAttachedMeta = true } = options;
  const reviewedAt = repo.reviewedAt?.trim() ?? '';
  const reviewNote = repo.reviewNote?.trim() ?? '';
  const status = repo.status;
  const headerNickname = repo.nickname?.trim() || '匿名';

  return [
    `${MARKER_PREFIX}${headerNickname} · ${repo.playId}`,
    ...(includeAttachedMeta
      ? [
          `${ID_PREFIX} ${escapeInlineValue(repo.id)}`,
          `${STATUS_PREFIX} ${status}`,
          `${CREATED_AT_PREFIX} ${escapeInlineValue(repo.createdAt)}`,
          `${UPDATED_AT_PREFIX} ${escapeInlineValue(repo.updatedAt)}`,
          `${REVIEWED_AT_PREFIX} ${escapeInlineValue(reviewedAt)}`,
          `${REVIEW_NOTE_PREFIX} ${escapeInlineValue(reviewNote)}`,
        ]
      : []),
    `${TITLE_PREFIX} ${escapeInlineValue(repo.playTitle ?? '')}`,
    `${AUTHOR_PREFIX} ${escapeInlineValue(repo.playAuthorName ?? '')}`,
    `${CATEGORY_PREFIX} ${escapeInlineValue(repo.playId)}`,
    `${SUMMARY_PREFIX} ${escapeInlineValue(repo.replyToNickname ?? '')}`,
    CONTENT_PREFIX,
    repo.content,
  ].join('\n');
};

const makeRepoFileText = (
  status: RepoStatus,
  repos: Repo[],
  options: RepoBackupRecordTextOptions = {},
) =>
  repos
    .filter((repo) => repo.status === status)
    .map((repo) => makeRepoRecordText(repo, options))
    .join('\n\n');

const makeBackupFileText = (status: PlayStatus, plays: Play[]) =>
  plays
    .filter((play) => play.status === status)
    .map((play) => makeBackupRecordText(play))
    .join('\n\n');

const makeTagsFileText = (tags: Tag[]) =>
  [...tags]
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'zh-CN'),
    )
    .map((tag) =>
      [
        `${MARKER_PREFIX}${tag.name}`,
        `${TAG_NAME_PREFIX} ${escapeInlineValue(tag.name)}`,
        `${TAG_SORT_ORDER_PREFIX} ${tag.sortOrder}`,
      ].join('\n'),
    )
    .join('\n\n');

export const createBackupArchive = (
  plays: Play[],
  tags: Tag[] = [],
  options: { repos?: Repo[]; includeAttachedMeta?: boolean } = {},
) => {
  const { repos = [], includeAttachedMeta = true } = options;
  const files: ZipTextFile[] = [
    ...backupStatusOrder.map((status) => ({
      name: backupFileNameMap[status],
      text: makeBackupFileText(status, plays),
    })),
    {
      name: TAGS_FILE_NAME,
      text: makeTagsFileText(tags),
    },
    ...(repos.length > 0
      ? repoStatusOrder.map((status) => ({
          name: repoFileNameMap[status],
          text: makeRepoFileText(status, repos, { includeAttachedMeta }),
        }))
      : []),
  ];

  return createZipFromTextFiles(files);
};

const groupPlaysBy = (plays: Play[], getKey: (play: Play) => string) => {
  const groups = new Map<string, Play[]>();

  plays.forEach((play) => {
    const key = getKey(play);
    groups.set(key, [...(groups.get(key) ?? []), play]);
  });

  return [...groups.entries()].sort(([leftName], [rightName]) =>
    leftName.localeCompare(rightName, 'zh-CN'),
  );
};

const makeGroupedTextFiles = (
  folderName: string,
  groups: Array<[string, Play[]]>,
  fallbackName: string,
  options: BackupRecordTextOptions = {},
) =>
  groups.map(([name, items]) => ({
    name: `${folderName}/${safeBackupPathSegment(name, fallbackName)}.txt`,
    text: [...items]
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((play) => makeBackupRecordText(play, options))
      .join('\n\n'),
  }));

const makeGroupedRepoTextFiles = (
  folderName: string,
  groups: Array<[string, Repo[]]>,
  fallbackName: string,
  options: RepoBackupRecordTextOptions = {},
) =>
  groups.map(([name, items]) => ({
    name: `${folderName}/${safeBackupPathSegment(name, fallbackName)}.txt`,
    text: [...items]
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((repo) => makeRepoRecordText(repo, options))
      .join('\n\n'),
  }));

const groupReposBy = (repos: Repo[], getKey: (repo: Repo) => string) => {
  const groups = new Map<string, Repo[]>();

  repos.forEach((repo) => {
    const key = getKey(repo);
    groups.set(key, [...(groups.get(key) ?? []), repo]);
  });

  return [...groups.entries()].sort(([leftName], [rightName]) =>
    leftName.localeCompare(rightName, 'zh-CN'),
  );
};

export const createMergedBackupArchive = (
  plays: Play[],
  options: BackupRecordTextOptions & { repos?: Repo[] } = {},
) => {
  const { repos = [], includeAttachedMeta = true } = options;
  const authorGroups = groupPlaysBy(plays, (play) => play.authorName.trim() || '匿名');
  const categoryGroups = groupPlaysBy(plays, (play) => play.category?.trim() || DEFAULT_CATEGORY);

  /* 「附带 repo」开启时,合并导出额外生成 authors/ + categories/ 两个 repo 文件夹。
   * - authors/:按作者名分组(取所属 play 的作者),便于按人整理对应小剧场的所有回复;
   * - categories/:按所属 play 的分类分组,便于按主题查看所有相关讨论。
   * 注意:repo 的 authors/ 与 plays 的 authors/ 命名重叠,但内容是两份不同的 TXT,
   * 所以把 repo 文件夹改名为 authors-repo/ 和 categories-repo/ 避免解压时互相覆盖。 */
  const repoAuthorGroups = groupReposBy(repos, (repo) => repo.playAuthorName?.trim() || '匿名');
  const repoCategoryGroups = groupReposBy(repos, (repo) => repo.playId || '未关联');

  return createZipFromTextFiles([
    ...makeGroupedTextFiles('authors', authorGroups, '匿名', options),
    ...makeGroupedTextFiles('categories', categoryGroups, DEFAULT_CATEGORY, options),
    ...(repos.length > 0
      ? [
          ...makeGroupedRepoTextFiles('authors-repo', repoAuthorGroups, '匿名', {
            includeAttachedMeta,
          }),
          ...makeGroupedRepoTextFiles('categories-repo', repoCategoryGroups, '未关联', {
            includeAttachedMeta,
          }),
        ]
      : []),
  ]);
};

const parseBackupText = (source: string, expectedStatus: PlayStatus) => {
  const blocks = splitBlocks(source);
  if (blocks.length === 0) {
    return [] as Play[];
  }

  return blocks.map((block, index) => {
    const lines = block.split(LINE_BREAK);
    const markerTitle = (lines[0] ?? '').trim();

    if (!markerTitle.startsWith(MARKER_PREFIX)) {
      throw new Error(`${backupFileNameMap[expectedStatus]} 第 ${index + 1} 段缺少 ### 标题头`);
    }

    let id = '';
    let title = '';
    let authorName = '';
    let category = DEFAULT_CATEGORY;
    let summary = '';
    let status = expectedStatus;
    let createdAt = '';
    let updatedAt = '';
    let reviewedAt = '';
    let reviewNote = '';
    let contentStartIndex = -1;

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
      const rawLine = lines[lineIndex] ?? '';
      const line = rawLine.trim();

      if (line === CONTENT_PREFIX) {
        contentStartIndex = lineIndex + 1;
        break;
      }

      if (line.startsWith(ID_PREFIX)) {
        id = unescapeInlineValue(line.slice(ID_PREFIX.length).trim());
        continue;
      }

      if (line.startsWith(TITLE_PREFIX)) {
        title = unescapeInlineValue(line.slice(TITLE_PREFIX.length).trim());
        continue;
      }

      if (line.startsWith(AUTHOR_PREFIX)) {
        authorName = unescapeInlineValue(line.slice(AUTHOR_PREFIX.length).trim());
        continue;
      }

      if (line.startsWith(CATEGORY_PREFIX)) {
        category =
          unescapeInlineValue(line.slice(CATEGORY_PREFIX.length).trim()) || DEFAULT_CATEGORY;
        continue;
      }

      if (line.startsWith(SUMMARY_PREFIX)) {
        summary = normalizeImportedSummary(
          unescapeInlineValue(line.slice(SUMMARY_PREFIX.length).trim()),
        );
        continue;
      }

      if (line.startsWith(STATUS_PREFIX)) {
        const parsedStatus = line.slice(STATUS_PREFIX.length).trim() as PlayStatus;
        status = backupStatusOrder.includes(parsedStatus) ? parsedStatus : expectedStatus;
        continue;
      }

      if (line.startsWith(CREATED_AT_PREFIX)) {
        createdAt = unescapeInlineValue(line.slice(CREATED_AT_PREFIX.length).trim());
        continue;
      }

      if (line.startsWith(UPDATED_AT_PREFIX)) {
        updatedAt = unescapeInlineValue(line.slice(UPDATED_AT_PREFIX.length).trim());
        continue;
      }

      if (line.startsWith(REVIEWED_AT_PREFIX)) {
        reviewedAt = unescapeInlineValue(line.slice(REVIEWED_AT_PREFIX.length).trim());
        continue;
      }

      if (line.startsWith(REVIEW_NOTE_PREFIX)) {
        reviewNote = unescapeInlineValue(line.slice(REVIEW_NOTE_PREFIX.length).trim());
      }
    }

    if (contentStartIndex < 0) {
      throw new Error(`${backupFileNameMap[expectedStatus]} 第 ${index + 1} 段缺少 Content:`);
    }

    const content = lines.slice(contentStartIndex).join('\n');
    const timestampFallback = new Date().toISOString();

    if (!title.trim()) {
      throw new Error(`${backupFileNameMap[expectedStatus]} 第 ${index + 1} 段缺少 Title:`);
    }

    if (!authorName.trim()) {
      throw new Error(`${backupFileNameMap[expectedStatus]} 第 ${index + 1} 段缺少 Author:`);
    }

    if (!content.trim()) {
      throw new Error(`${backupFileNameMap[expectedStatus]} 第 ${index + 1} 段正文不能为空`);
    }

    return {
      id: id.trim() || makeFallbackId(),
      title: title.trim(),
      authorName: authorName.trim(),
      category: category.trim() || DEFAULT_CATEGORY,
      summary,
      content,
      status,
      createdAt: normalizeTimestamp(createdAt, timestampFallback),
      updatedAt: normalizeTimestamp(updatedAt, normalizeTimestamp(createdAt, timestampFallback)),
      reviewedAt: reviewedAt.trim()
        ? normalizeTimestamp(reviewedAt, normalizeTimestamp(updatedAt, timestampFallback))
        : undefined,
      reviewNote: reviewNote.trim() || undefined,
    } satisfies Play;
  });
};

export const parseBackupArchive = async (file: Blob) => {
  const files = await readZipTextFiles(file);
  const fileMap = new Map(files.map((item) => [item.name, item.text]));

  return backupStatusOrder.reduce(
    (result, status) => ({
      ...result,
      [status]: parseBackupText(fileMap.get(backupFileNameMap[status]) ?? '', status),
    }),
    {
      pending: [] as Play[],
      approved: [] as Play[],
      rejected: [] as Play[],
      offline: [] as Play[],
    },
  );
};

export const flattenBackupArchive = (archive: Record<PlayStatus, Play[]>) =>
  backupStatusOrder.flatMap((status) => archive[status]);

export const downloadBackupArchive = (
  plays: Play[],
  tags: Tag[] = [],
  options: { repos?: Repo[]; includeAttachedMeta?: boolean } = {},
) => {
  const archive = createBackupArchive(plays, tags, options);
  const url = URL.createObjectURL(archive);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = DEFAULT_BACKUP_ARCHIVE_NAME;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const downloadMergedBackupArchive = (
  plays: Play[],
  options: BackupRecordTextOptions & { repos?: Repo[] } = {},
) => {
  const archive = createMergedBackupArchive(plays, options);
  const url = URL.createObjectURL(archive);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = DEFAULT_MERGED_BACKUP_ARCHIVE_NAME;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const getBackupStatusCounts = (plays: Play[]) =>
  backupStatusOrder.reduce(
    (result, status) => ({
      ...result,
      [status]: plays.filter((play) => play.status === status).length,
    }),
    {
      pending: 0,
      approved: 0,
      rejected: 0,
      offline: 0,
    },
  );

export const backupStatusLabelMap: Record<PlayStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  offline: '已下线',
};
