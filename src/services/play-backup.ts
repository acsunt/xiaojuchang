/* 备份恢复 / 导出工具集
 *
 * 三种 zip 产物:
 * - 主备份:小剧场备份-{date}-{N}篇.zip
 *   ├── 已通过.txt
 *   ├── 标签.txt
 *   └── (附带 repo 时) repo-已审核.txt
 * - 合并导出:导出作者和分类-{date}.zip
 *   ├── 已通过.txt / 标签.txt
 *   ├── 作者/<作者>.txt / 分类/<分类>.txt
 *   └── (附带 repo 时) 作者-repo/... / 分类-repo/...
 * - 续写导出:小剧场续写-{date}-{N}条.zip / 续写-{date}-{N}条.zip
 *   └── 续写-已审核.txt
 *
 * 每条记录的块格式统一为:
 *   ### <type>:<id> · <展示文案>
 *   Type: play | repo | continuation | tag
 *   ...
 *   Content: (play / repo / continuation)
 *   <多行正文>
 *   (tag 没有 Content 字段,以 SortOrder 结尾)
 *
 * 解析器只认新版格式。旧版 4 文件 / 英文文件名 zip 一律报错。
 */

import { DEFAULT_CATEGORY, type Continuation, type Play, type Repo, type Tag } from '../types/play';
import { normalizeImportedSummary } from './play-text';
import { createZipFromTextFiles, readZipTextFiles, type ZipTextFile } from './simple-zip';

const LINE_BREAK = /\r?\n/;
const BLOCK_SPLITTER = /\r?\n\s*\r?\n(?=###\s+)/g;
const MARKER_PREFIX = '### ';

/* 通用字段前缀 */
const TYPE_PREFIX = 'Type:';
const ID_PREFIX = 'Id:';

/* play 字段 */
const TITLE_PREFIX = 'Title:';
const AUTHOR_PREFIX = 'Author:';
const CATEGORY_PREFIX = 'Category:';
const SUMMARY_PREFIX = 'Summary:';
const STATUS_PREFIX = 'Status:';
const CREATED_AT_PREFIX = 'CreatedAt:';
const UPDATED_AT_PREFIX = 'UpdatedAt:';
const REVIEWED_AT_PREFIX = 'ReviewedAt:';
const REVIEW_NOTE_PREFIX = 'ReviewNote:';
const CONTENT_PREFIX = 'Content:';

/* repo / continuation 公共字段 */
const PLAY_ID_PREFIX = 'PlayId:';
const NICKNAME_PREFIX = 'Nickname:';
const PLAY_TITLE_PREFIX = 'PlayTitle:';
const PLAY_AUTHOR_PREFIX = 'PlayAuthor:';
const REPLY_TO_NICKNAME_PREFIX = 'ReplyToNickname:';

/* tag 字段 */
const TAG_NAME_PREFIX = 'Name:';
const TAG_SORT_ORDER_PREFIX = 'SortOrder:';

/* 文件名(全中文) */
const PLAY_APPROVED_FILE = '已通过.txt';
const TAGS_FILE = '标签.txt';
const REPO_APPROVED_FILE = 'repo-已审核.txt';
const CONTINUATION_APPROVED_FILE = '续写-已审核.txt';

const MERGED_AUTHOR_DIR = '作者';
const MERGED_CATEGORY_DIR = '分类';
const MERGED_AUTHOR_REPO_DIR = '作者-repo';
const MERGED_CATEGORY_REPO_DIR = '分类-repo';

const APPROVED_STATUS = 'approved';
const PLAY_TYPE = 'play';
const REPO_TYPE = 'repo';
const CONTINUATION_TYPE = 'continuation';
const TAG_TYPE = 'tag';

type RecordType = typeof PLAY_TYPE | typeof REPO_TYPE | typeof CONTINUATION_TYPE | typeof TAG_TYPE;

/* ---------- 下载工具 ---------- */ const safeBackupPathSegment = (
  value: string,
  fallback: string,
) => {
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

const makeFallbackId = (prefix: string) =>
  `backup_${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;

const formatDateTag = (now: Date = new Date()) => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/* ---------- 通用行解析 ---------- */

type LineReader = {
  /* 按前缀匹配一行;命中返回去掉前缀 + unescape 后的值,未命中返回 null。 */
  readByPrefix(prefix: string): string | null;
};

const createLineReader = (lines: string[], startIndex: number) => {
  let cursor = startIndex;
  const reader: LineReader = {
    readByPrefix(prefix) {
      while (cursor < lines.length) {
        const rawLine = lines[cursor] ?? '';
        const line = rawLine.trim();
        cursor += 1;

        if (line === CONTENT_PREFIX) {
          /* Content: 是个特殊标记,碰到就把 cursor 退回一行让外层识别;
           * 同时返回 null 表示「这一行不是字段行」 */
          cursor -= 1;
          return null;
        }

        if (line.startsWith(prefix)) {
          return unescapeInlineValue(line.slice(prefix.length).trim());
        }
      }
      return null;
    },
  };
  return reader;
};

const readFirstMarkerTitle = (lines: string[]) => {
  const first = (lines[0] ?? '').trim();
  if (!first.startsWith(MARKER_PREFIX)) {
    return '';
  }
  return first.slice(MARKER_PREFIX.length).trim();
};

/* ---------- Play 序列化 ---------- */

const makePlayMarkerTitle = (play: Play) =>
  `${PLAY_TYPE}:${play.id} · ${play.title.trim() || 'Untitled'}`;

const makePlayRecordText = (play: Play) => {
  const reviewedAt = play.reviewedAt?.trim() ?? '';
  const reviewNote = play.reviewNote?.trim() ?? '';

  return [
    `${MARKER_PREFIX}${makePlayMarkerTitle(play)}`,
    `${TYPE_PREFIX} ${PLAY_TYPE}`,
    `${ID_PREFIX} ${escapeInlineValue(play.id)}`,
    `${STATUS_PREFIX} ${play.status || APPROVED_STATUS}`,
    `${TITLE_PREFIX} ${escapeInlineValue(play.title)}`,
    `${AUTHOR_PREFIX} ${escapeInlineValue(play.authorName)}`,
    `${CATEGORY_PREFIX} ${escapeInlineValue(play.category || DEFAULT_CATEGORY)}`,
    `${SUMMARY_PREFIX} ${escapeInlineValue(normalizeImportedSummary(play.summary))}`,
    `${CREATED_AT_PREFIX} ${escapeInlineValue(play.createdAt)}`,
    `${UPDATED_AT_PREFIX} ${escapeInlineValue(play.updatedAt)}`,
    `${REVIEWED_AT_PREFIX} ${escapeInlineValue(reviewedAt)}`,
    `${REVIEW_NOTE_PREFIX} ${escapeInlineValue(reviewNote)}`,
    CONTENT_PREFIX,
    play.content,
  ].join('\n');
};

const parsePlayRecord = (block: string): Play => {
  const lines = block.split(LINE_BREAK);
  const markerTitle = readFirstMarkerTitle(lines);
  const reader = createLineReader(lines, 1);

  const id = reader.readByPrefix(ID_PREFIX);
  const status = (reader.readByPrefix(STATUS_PREFIX) ?? APPROVED_STATUS) as Play['status'];
  const title = reader.readByPrefix(TITLE_PREFIX);
  const authorName = reader.readByPrefix(AUTHOR_PREFIX);
  const category = reader.readByPrefix(CATEGORY_PREFIX);
  const summaryRaw = reader.readByPrefix(SUMMARY_PREFIX);
  const createdAt = reader.readByPrefix(CREATED_AT_PREFIX) ?? '';
  const updatedAt = reader.readByPrefix(UPDATED_AT_PREFIX) ?? '';
  const reviewedAt = reader.readByPrefix(REVIEWED_AT_PREFIX) ?? '';
  const reviewNote = reader.readByPrefix(REVIEW_NOTE_PREFIX) ?? '';

  /* Content: 行之后的所有行作为正文 */
  let contentStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() === CONTENT_PREFIX) {
      contentStart = i + 1;
      break;
    }
  }

  if (contentStart < 0) {
    throw new Error(`缺少 Content:(${markerTitle || '未命名 play'})`);
  }
  if (!title) {
    throw new Error(`缺少 Title:(${markerTitle || '未命名 play'})`);
  }
  if (!authorName) {
    throw new Error(`缺少 Author:(${markerTitle || '未命名 play'})`);
  }

  const content = lines.slice(contentStart).join('\n');
  const timestampFallback = new Date().toISOString();

  if (!content.trim()) {
    throw new Error(`正文不能为空(${markerTitle || '未命名 play'})`);
  }

  return {
    id: id?.trim() || makeFallbackId('play'),
    title: title.trim(),
    authorName: authorName.trim(),
    category: category?.trim() || DEFAULT_CATEGORY,
    summary: normalizeImportedSummary(summaryRaw ?? ''),
    content,
    status,
    createdAt: normalizeTimestamp(createdAt, timestampFallback),
    updatedAt: normalizeTimestamp(updatedAt, normalizeTimestamp(createdAt, timestampFallback)),
    reviewedAt: reviewedAt.trim()
      ? normalizeTimestamp(reviewedAt, normalizeTimestamp(updatedAt, timestampFallback))
      : undefined,
    reviewNote: reviewNote.trim() || undefined,
  };
};

/* ---------- Repo 序列化 ---------- */

const makeRepoMarkerTitle = (repo: Repo) => {
  const nickname = repo.nickname?.trim() || '匿名';
  return `${REPO_TYPE}:${repo.id} · ${nickname}`;
};

const makeRepoRecordText = (repo: Repo) => {
  const reviewedAt = repo.reviewedAt?.trim() ?? '';
  const reviewNote = repo.reviewNote?.trim() ?? '';

  return [
    `${MARKER_PREFIX}${makeRepoMarkerTitle(repo)}`,
    `${TYPE_PREFIX} ${REPO_TYPE}`,
    `${ID_PREFIX} ${escapeInlineValue(repo.id)}`,
    `${PLAY_ID_PREFIX} ${escapeInlineValue(repo.playId)}`,
    `${STATUS_PREFIX} ${repo.status || APPROVED_STATUS}`,
    `${NICKNAME_PREFIX} ${escapeInlineValue(repo.nickname || '')}`,
    `${PLAY_TITLE_PREFIX} ${escapeInlineValue(repo.playTitle ?? '')}`,
    `${PLAY_AUTHOR_PREFIX} ${escapeInlineValue(repo.playAuthorName ?? '')}`,
    `${REPLY_TO_NICKNAME_PREFIX} ${escapeInlineValue(repo.replyToNickname ?? '')}`,
    `${CREATED_AT_PREFIX} ${escapeInlineValue(repo.createdAt)}`,
    `${UPDATED_AT_PREFIX} ${escapeInlineValue(repo.updatedAt)}`,
    `${REVIEWED_AT_PREFIX} ${escapeInlineValue(reviewedAt)}`,
    `${REVIEW_NOTE_PREFIX} ${escapeInlineValue(reviewNote)}`,
    CONTENT_PREFIX,
    repo.content,
  ].join('\n');
};

const parseRepoRecord = (block: string): Repo => {
  const lines = block.split(LINE_BREAK);
  const markerTitle = readFirstMarkerTitle(lines);
  const reader = createLineReader(lines, 1);

  const id = reader.readByPrefix(ID_PREFIX);
  const playId = reader.readByPrefix(PLAY_ID_PREFIX);
  const status = (reader.readByPrefix(STATUS_PREFIX) ?? APPROVED_STATUS) as Repo['status'];
  const nickname = reader.readByPrefix(NICKNAME_PREFIX) ?? '';
  const playTitle = reader.readByPrefix(PLAY_TITLE_PREFIX) ?? '';
  const playAuthorName = reader.readByPrefix(PLAY_AUTHOR_PREFIX) ?? '';
  const replyToNickname = reader.readByPrefix(REPLY_TO_NICKNAME_PREFIX) ?? '';
  const createdAt = reader.readByPrefix(CREATED_AT_PREFIX) ?? '';
  const updatedAt = reader.readByPrefix(UPDATED_AT_PREFIX) ?? '';
  const reviewedAt = reader.readByPrefix(REVIEWED_AT_PREFIX) ?? '';
  const reviewNote = reader.readByPrefix(REVIEW_NOTE_PREFIX) ?? '';

  let contentStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() === CONTENT_PREFIX) {
      contentStart = i + 1;
      break;
    }
  }

  if (contentStart < 0) {
    throw new Error(`缺少 Content:(${markerTitle || '未命名 repo'})`);
  }
  if (!playId) {
    throw new Error(`缺少 PlayId:(${markerTitle || '未命名 repo'})`);
  }

  const content = lines.slice(contentStart).join('\n');
  const timestampFallback = new Date().toISOString();

  if (!content.trim()) {
    throw new Error(`正文不能为空(${markerTitle || '未命名 repo'})`);
  }

  return {
    id: id?.trim() || makeFallbackId('repo'),
    playId: playId.trim(),
    parentId: undefined,
    rootId: undefined,
    nickname: nickname.trim(),
    visitorId: '',
    content,
    status,
    createdAt: normalizeTimestamp(createdAt, timestampFallback),
    updatedAt: normalizeTimestamp(updatedAt, normalizeTimestamp(createdAt, timestampFallback)),
    reviewedAt: reviewedAt.trim()
      ? normalizeTimestamp(reviewedAt, normalizeTimestamp(updatedAt, timestampFallback))
      : undefined,
    reviewNote: reviewNote.trim() || undefined,
    playTitle: playTitle.trim() || undefined,
    playAuthorName: playAuthorName.trim() || undefined,
    replyToNickname: replyToNickname.trim() || undefined,
  };
};

/* ---------- Continuation 序列化 ----------
 *
 * 只导出读者看得到的主字段:
 * 不含 pendingDraft* / lastApproved* / deletedAt / _displayStatus / visitorId
 * (导入后状态机起点清零,作者再编辑会重新走 pendingDraft 流程)
 */

const makeContinuationMarkerTitle = (item: Continuation) => {
  const summary = item.summary?.trim() || '续写';
  const preview = summary.slice(0, 16);
  return `${CONTINUATION_TYPE}:${item.id} · ${preview}`;
};

const makeContinuationRecordText = (item: Continuation) => {
  const reviewedAt = item.reviewedAt?.trim() ?? '';
  const reviewNote = item.reviewNote?.trim() ?? '';

  return [
    `${MARKER_PREFIX}${makeContinuationMarkerTitle(item)}`,
    `${TYPE_PREFIX} ${CONTINUATION_TYPE}`,
    `${ID_PREFIX} ${escapeInlineValue(item.id)}`,
    `${PLAY_ID_PREFIX} ${escapeInlineValue(item.playId)}`,
    `${STATUS_PREFIX} ${item.status || APPROVED_STATUS}`,
    `${NICKNAME_PREFIX} ${escapeInlineValue(item.nickname || '')}`,
    `${PLAY_TITLE_PREFIX} ${escapeInlineValue(item.playTitle ?? '')}`,
    `${PLAY_AUTHOR_PREFIX} ${escapeInlineValue(item.playAuthorName ?? '')}`,
    `${SUMMARY_PREFIX} ${escapeInlineValue(item.summary)}`,
    `${CREATED_AT_PREFIX} ${escapeInlineValue(item.createdAt)}`,
    `${UPDATED_AT_PREFIX} ${escapeInlineValue(item.updatedAt)}`,
    `${REVIEWED_AT_PREFIX} ${escapeInlineValue(reviewedAt)}`,
    `${REVIEW_NOTE_PREFIX} ${escapeInlineValue(reviewNote)}`,
    CONTENT_PREFIX,
    item.content,
  ].join('\n');
};

const parseContinuationRecord = (block: string): Continuation => {
  const lines = block.split(LINE_BREAK);
  const markerTitle = readFirstMarkerTitle(lines);
  const reader = createLineReader(lines, 1);

  const id = reader.readByPrefix(ID_PREFIX);
  const playId = reader.readByPrefix(PLAY_ID_PREFIX);
  const status = (reader.readByPrefix(STATUS_PREFIX) ?? APPROVED_STATUS) as Continuation['status'];
  const nickname = reader.readByPrefix(NICKNAME_PREFIX) ?? '';
  const playTitle = reader.readByPrefix(PLAY_TITLE_PREFIX) ?? '';
  const playAuthorName = reader.readByPrefix(PLAY_AUTHOR_PREFIX) ?? '';
  const summary = reader.readByPrefix(SUMMARY_PREFIX) ?? '';
  const createdAt = reader.readByPrefix(CREATED_AT_PREFIX) ?? '';
  const updatedAt = reader.readByPrefix(UPDATED_AT_PREFIX) ?? '';
  const reviewedAt = reader.readByPrefix(REVIEWED_AT_PREFIX) ?? '';
  const reviewNote = reader.readByPrefix(REVIEW_NOTE_PREFIX) ?? '';

  let contentStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() === CONTENT_PREFIX) {
      contentStart = i + 1;
      break;
    }
  }

  if (contentStart < 0) {
    throw new Error(`缺少 Content:(${markerTitle || '未命名续写'})`);
  }
  if (!playId) {
    throw new Error(`缺少 PlayId:(${markerTitle || '未命名续写'})`);
  }

  const content = lines.slice(contentStart).join('\n');
  const timestampFallback = new Date().toISOString();

  return {
    id: id?.trim() || makeFallbackId('cont'),
    playId: playId.trim(),
    nickname: nickname.trim(),
    /* visitorId 不导出,导入后留空 — 续写不再归属任何具体作者
     * (避免恢复后旧 visitorId 跟新作者串号) */
    visitorId: '',
    summary: summary.trim(),
    content,
    status,
    createdAt: normalizeTimestamp(createdAt, timestampFallback),
    updatedAt: normalizeTimestamp(updatedAt, normalizeTimestamp(createdAt, timestampFallback)),
    reviewedAt: reviewedAt.trim()
      ? normalizeTimestamp(reviewedAt, normalizeTimestamp(updatedAt, timestampFallback))
      : undefined,
    reviewNote: reviewNote.trim() || undefined,
    playTitle: playTitle.trim() || undefined,
    playAuthorName: playAuthorName.trim() || undefined,
  };
};

/* ---------- Tag 序列化 ---------- */

const makeTagMarkerTitle = (tag: Tag) => `${TAG_TYPE}:${tag.id} · ${tag.name}`;

const makeTagRecordText = (tag: Tag) =>
  [
    `${MARKER_PREFIX}${makeTagMarkerTitle(tag)}`,
    `${TYPE_PREFIX} ${TAG_TYPE}`,
    `${ID_PREFIX} ${escapeInlineValue(tag.id)}`,
    `${TAG_NAME_PREFIX} ${escapeInlineValue(tag.name)}`,
    `${TAG_SORT_ORDER_PREFIX} ${tag.sortOrder}`,
    `${CREATED_AT_PREFIX} ${escapeInlineValue(tag.createdAt)}`,
    `${UPDATED_AT_PREFIX} ${escapeInlineValue(tag.updatedAt)}`,
  ].join('\n');

const parseTagRecord = (block: string): Tag => {
  const lines = block.split(LINE_BREAK);
  const markerTitle = readFirstMarkerTitle(lines);
  const reader = createLineReader(lines, 1);

  const id = reader.readByPrefix(ID_PREFIX);
  const name = reader.readByPrefix(TAG_NAME_PREFIX);
  const sortOrderRaw = reader.readByPrefix(TAG_SORT_ORDER_PREFIX);
  const createdAt = reader.readByPrefix(CREATED_AT_PREFIX) ?? '';
  const updatedAt = reader.readByPrefix(UPDATED_AT_PREFIX) ?? '';

  if (!name) {
    throw new Error(`缺少 Name:(${markerTitle || '未命名 tag'})`);
  }

  const timestampFallback = new Date().toISOString();
  const sortOrder = Number.parseInt(sortOrderRaw ?? '', 10);
  const finalSortOrder = Number.isFinite(sortOrder) ? sortOrder : 0;

  return {
    id: id?.trim() || makeFallbackId('tag'),
    name: name.trim(),
    sortOrder: finalSortOrder,
    createdAt: normalizeTimestamp(createdAt, timestampFallback),
    updatedAt: normalizeTimestamp(updatedAt, timestampFallback),
  };
};

/* ---------- 按 Type 字段统一分发 ---------- */

const parseBlockByType = (block: string) => {
  const lines = block.split(LINE_BREAK);
  const typeLine = (lines[1] ?? '').trim();
  if (!typeLine.startsWith(TYPE_PREFIX)) {
    const markerTitle = readFirstMarkerTitle(lines) || '未命名记录';
    throw new Error(`缺少 Type:字段(${markerTitle})`);
  }

  const type = typeLine.slice(TYPE_PREFIX.length).trim();
  switch (type) {
    case PLAY_TYPE:
      return { type, value: parsePlayRecord(block) };
    case REPO_TYPE:
      return { type, value: parseRepoRecord(block) };
    case CONTINUATION_TYPE:
      return { type, value: parseContinuationRecord(block) };
    case TAG_TYPE:
      return { type, value: parseTagRecord(block) };
    default: {
      const markerTitle = readFirstMarkerTitle(lines) || '未命名记录';
      throw new Error(`不支持的记录类型 ${type}(${markerTitle})`);
    }
  }
};

/* ---------- 工具:把 plays 切成「已通过」 ---------- */

const filterApproved = <T extends { status: string }>(items: T[]): T[] =>
  items.filter((item) => item.status === APPROVED_STATUS);

/* ---------- 主备份 zip ---------- */

export const createBackupArchive = (
  plays: Play[],
  tags: Tag[] = [],
  options: { repos?: Repo[] } = {},
) => {
  const { repos = [] } = options;
  const approvedPlays = filterApproved(plays);
  const approvedRepos = filterApproved(repos);

  const files: ZipTextFile[] = [
    {
      name: PLAY_APPROVED_FILE,
      text: approvedPlays.map(makePlayRecordText).join('\n\n'),
    },
    {
      name: TAGS_FILE,
      text: [...tags]
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'zh-CN'),
        )
        .map(makeTagRecordText)
        .join('\n\n'),
    },
    ...(approvedRepos.length > 0
      ? [
          {
            name: REPO_APPROVED_FILE,
            text: approvedRepos.map(makeRepoRecordText).join('\n\n'),
          },
        ]
      : []),
  ];

  return createZipFromTextFiles(files);
};

/* ---------- 合并导出 zip ---------- */

const groupBy = <T>(items: T[], getKey: (item: T) => string) => {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const key = getKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  return [...groups.entries()].sort(([leftName], [rightName]) =>
    leftName.localeCompare(rightName, 'zh-CN'),
  );
};

const makeGroupedPlayFiles = (
  folderName: string,
  groups: Array<[string, Play[]]>,
  fallbackName: string,
) =>
  groups.map(([name, items]) => ({
    name: `${folderName}/${safeBackupPathSegment(name, fallbackName)}.txt`,
    text: [...items]
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map(makePlayRecordText)
      .join('\n\n'),
  }));

const makeGroupedRepoFiles = (
  folderName: string,
  groups: Array<[string, Repo[]]>,
  fallbackName: string,
) =>
  groups.map(([name, items]) => ({
    name: `${folderName}/${safeBackupPathSegment(name, fallbackName)}.txt`,
    text: [...items]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(makeRepoRecordText)
      .join('\n\n'),
  }));

export const createMergedBackupArchive = (
  plays: Play[],
  tags: Tag[] = [],
  options: { repos?: Repo[] } = {},
) => {
  const { repos = [] } = options;
  const approvedPlays = filterApproved(plays);
  const approvedRepos = filterApproved(repos);

  const authorGroups = groupBy(approvedPlays, (play) => play.authorName.trim() || '匿名');
  const categoryGroups = groupBy(
    approvedPlays,
    (play) => play.category?.trim() || DEFAULT_CATEGORY,
  );
  const repoAuthorGroups = groupBy(approvedRepos, (repo) => repo.playAuthorName?.trim() || '匿名');
  const repoCategoryGroups = groupBy(approvedRepos, (repo) => repo.playId || '未关联');

  const files: ZipTextFile[] = [
    {
      name: PLAY_APPROVED_FILE,
      text: approvedPlays.map(makePlayRecordText).join('\n\n'),
    },
    {
      name: TAGS_FILE,
      text: [...tags]
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'zh-CN'),
        )
        .map(makeTagRecordText)
        .join('\n\n'),
    },
    ...makeGroupedPlayFiles(MERGED_AUTHOR_DIR, authorGroups, '匿名'),
    ...makeGroupedPlayFiles(MERGED_CATEGORY_DIR, categoryGroups, DEFAULT_CATEGORY),
    ...(approvedRepos.length > 0
      ? [
          ...makeGroupedRepoFiles(MERGED_AUTHOR_REPO_DIR, repoAuthorGroups, '匿名'),
          ...makeGroupedRepoFiles(MERGED_CATEGORY_REPO_DIR, repoCategoryGroups, '未关联'),
        ]
      : []),
  ];

  return createZipFromTextFiles(files);
};

/* ---------- 续写 zip ---------- */

export const createContinuationsArchive = (items: Continuation[]) => {
  const approved = filterApproved(items);
  return createZipFromTextFiles([
    {
      name: CONTINUATION_APPROVED_FILE,
      text: [...approved]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(makeContinuationRecordText)
        .join('\n\n'),
    },
  ]);
};

/* ---------- 解析器 ---------- */

export type ParsedBackup = {
  plays: Play[];
  repos: Repo[];
  continuations: Continuation[];
  tags: Tag[];
};

const parseBlocksByFile = (source: string) => {
  const blocks = splitBlocks(source);
  if (blocks.length === 0) {
    return [];
  }
  return blocks.map((block) => parseBlockByType(block));
};

/* 主备份 zip 解析:忽略 续写-已审核.txt(那个走独立解析路径) */
export const parseBackupArchive = async (file: Blob): Promise<ParsedBackup> => {
  const files = await readZipTextFiles(file);
  const result: ParsedBackup = { plays: [], repos: [], continuations: [], tags: [] };

  for (const file of files) {
    if (file.name === CONTINUATION_APPROVED_FILE) {
      continue;
    }

    const records = parseBlocksByFile(file.text);
    for (const record of records) {
      switch (record.type) {
        case PLAY_TYPE:
          result.plays.push(record.value as Play);
          break;
        case REPO_TYPE:
          result.repos.push(record.value as Repo);
          break;
        case CONTINUATION_TYPE:
          result.continuations.push(record.value as Continuation);
          break;
        case TAG_TYPE:
          result.tags.push(record.value as Tag);
          break;
      }
    }
  }

  return result;
};

/* 续写 zip 独立解析 */
export const parseContinuationsArchive = async (file: Blob): Promise<Continuation[]> => {
  const files = await readZipTextFiles(file);
  const continuations: Continuation[] = [];

  for (const entry of files) {
    if (entry.name !== CONTINUATION_APPROVED_FILE) {
      continue;
    }
    const records = parseBlocksByFile(entry.text);
    for (const record of records) {
      if (record.type === CONTINUATION_TYPE) {
        continuations.push(record.value as Continuation);
      } else {
        throw new Error(`续写 zip 里的 ${entry.name} 包含非续写记录(Type: ${record.type})`);
      }
    }
  }

  return continuations;
};

/* 兼容垫片:旧代码会 flatten 出所有状态 plays 用来计数;
 * 现在只有 approved 一种状态,直接返回 plays 字段即可。 */
export const flattenBackupArchive = (archive: ParsedBackup): Play[] => archive.plays;

/* ---------- 下载工具 ---------- */

const triggerDownload = (archive: Blob, fileName: string) => {
  const url = URL.createObjectURL(archive);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const downloadBackupArchive = (
  plays: Play[],
  tags: Tag[] = [],
  options: { repos?: Repo[] } = {},
) => {
  const approvedCount = filterApproved(plays).length;
  const dateTag = formatDateTag();
  triggerDownload(
    createBackupArchive(plays, tags, options),
    `小剧场备份-${dateTag}-${approvedCount}篇.zip`,
  );
};

export const downloadMergedBackupArchive = (
  plays: Play[],
  tags: Tag[] = [],
  options: { repos?: Repo[] } = {},
) => {
  const dateTag = formatDateTag();
  triggerDownload(createMergedBackupArchive(plays, tags, options), `导出作者和分类-${dateTag}.zip`);
};

export const downloadContinuationsArchive = (
  items: Continuation[],
  prefix: string = '小剧场续写',
) => {
  const approvedCount = filterApproved(items).length;
  const dateTag = formatDateTag();
  triggerDownload(createContinuationsArchive(items), `${prefix}-${dateTag}-${approvedCount}条.zip`);
};

/* ---------- 计数 / 状态映射 ---------- */

export const getBackupStatusCounts = (plays: Play[]) => ({
  pending: plays.filter((play) => play.status === 'pending').length,
  approved: plays.filter((play) => play.status === 'approved').length,
  rejected: plays.filter((play) => play.status === 'rejected').length,
  offline: plays.filter((play) => play.status === 'offline').length,
});

export const backupStatusLabelMap = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  offline: '已下线',
} as const;

export type _RecordType = RecordType;
