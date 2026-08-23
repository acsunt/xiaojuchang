import type { Play, PlayDraft } from '../types/play';
import { DEFAULT_CATEGORY } from '../types/play';

const BLOCK_SPLITTER = /\r?\n\s*\r?\n(?=###\s+)/g;
const LINE_BREAK = /\r?\n/;
const MARKER_PREFIX = '### ';
const TITLE_PREFIX = 'Title:';
const CATEGORY_PREFIX = 'Category:';
const SUMMARY_PREFIX = 'Desc:';
const IMPORTED_SUMMARY_PLACEHOLDER = '导入数据';
const BATCH_FALLBACK_CATEGORY = '无分类';
const BATCH_FALLBACK_SUMMARY = '';

export type ParsedPlayBatchItem = PlayDraft & {
  markerTitle: string;
};

const normalizeLine = (value: string) => value.trim();

const splitBatchBlocks = (source: string) =>
  source
    .trim()
    .split(BLOCK_SPLITTER)
    .map((item) => item.trim())
    .filter(Boolean);

export const normalizeImportedSummary = (value: string) => {
  const normalized = value.trim();
  return normalized === IMPORTED_SUMMARY_PLACEHOLDER || normalized === '无简介' ? '' : normalized;
};

const detectQuotedTitle = (source: string) => {
  const candidates = [source.match(/"([^"\r\n]+)"/), source.match(/“([^”\r\n]+)”/)];
  const earliest = candidates
    .filter((match): match is RegExpMatchArray => Boolean(match?.[1]))
    .sort((left, right) => (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER))[0];

  return earliest?.[1]?.trim() ?? '';
};

const detectWrappedTitle = (source: string) => {
  const nonEmptyLines = source
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .filter(Boolean);

  if (nonEmptyLines.length < 2) {
    return '';
  }

  const firstLineMatch = nonEmptyLines[0]?.match(/^<([^<>/]+)>$/);
  const lastLineMatch = nonEmptyLines[nonEmptyLines.length - 1]?.match(/^<\/([^<>]+)>$/);
  const openTitle = firstLineMatch?.[1]?.trim() ?? '';
  const closeTitle = lastLineMatch?.[1]?.trim() ?? '';

  return openTitle && closeTitle && openTitle === closeTitle ? openTitle : '';
};

export const detectPlayTitleFromContent = (source: string) => {
  const normalized = source.trim();
  if (!normalized) {
    return '';
  }

  return detectQuotedTitle(normalized) || detectWrappedTitle(normalized);
};

export const countPlayBatchItems = (source: string) => splitBatchBlocks(source).length;

export const serializePlayToBatchBlock = (play: Pick<Play, 'title' | 'category' | 'summary' | 'content'>) => {
  const category = play.category?.trim() || DEFAULT_CATEGORY;

  return [
    `### ${play.title.trim() || 'Untitled'}`,
    `${TITLE_PREFIX} ${play.title.trim()}`,
    `${CATEGORY_PREFIX} ${category}`,
    `${SUMMARY_PREFIX} ${normalizeImportedSummary(play.summary)}`,
    play.content.trim(),
  ].join('\n');
};

export const serializePlaysToBatchText = (plays: Array<Pick<Play, 'title' | 'category' | 'summary' | 'content'>>) =>
  plays.map(serializePlayToBatchBlock).join('\n\n');

export const parsePlayBatchText = (source: string, authorName: string) => {
  const normalizedAuthor = authorName.trim();
  if (!normalizedAuthor) {
    throw new Error('批量上传前先填写署名');
  }

  const blocks = splitBatchBlocks(source);
  if (blocks.length === 0) {
    return [] as ParsedPlayBatchItem[];
  }

  return blocks.map((block, index) => {
    const lines = block.split(LINE_BREAK);
    const markerTitle = normalizeLine(lines[0] ?? '');

    if (!markerTitle.startsWith(MARKER_PREFIX)) {
      throw new Error(`第 ${index + 1} 段缺少 ### 标题头`);
    }

    let title = '';
    let category = BATCH_FALLBACK_CATEGORY;
    let summary = BATCH_FALLBACK_SUMMARY;
    let contentStartIndex = 1;

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
      const line = normalizeLine(lines[lineIndex] ?? '');

      if (line.startsWith(TITLE_PREFIX)) {
        title = line.slice(TITLE_PREFIX.length).trim();
        contentStartIndex = lineIndex + 1;
        continue;
      }

      if (line.startsWith(CATEGORY_PREFIX)) {
        category = line.slice(CATEGORY_PREFIX.length).trim() || BATCH_FALLBACK_CATEGORY;
        contentStartIndex = lineIndex + 1;
        continue;
      }

      if (line.startsWith(SUMMARY_PREFIX)) {
        summary = normalizeImportedSummary(line.slice(SUMMARY_PREFIX.length)) || BATCH_FALLBACK_SUMMARY;
        contentStartIndex = lineIndex + 1;
        continue;
      }

      contentStartIndex = lineIndex;
      break;
    }

    const content = lines.slice(contentStartIndex).join('\n').trim();

    if (!title) {
      throw new Error(`第 ${index + 1} 段缺少 Title:`);
    }

    if (!content) {
      throw new Error(`第 ${index + 1} 段的正文不能为空`);
    }

    return {
      markerTitle: markerTitle.slice(MARKER_PREFIX.length).trim(),
      authorName: normalizedAuthor,
      title,
      category,
      summary,
      content,
    } satisfies ParsedPlayBatchItem;
  });
};

export const downloadTextFile = (filename: string, contents: string) => {
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
  downloadBlobFile(filename, blob);
};

export const downloadBlobFile = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};
