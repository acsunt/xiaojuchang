import { normalizeImportedSummary } from './play-text';
import type { PlayDraft, SubmissionEditedField, SubmissionFeedback } from '../types/play';

const AUTHOR_HISTORY_KEY = 'mini-theater.author-history';
const SUBMISSION_HISTORY_KEY = 'mini-theater.submission-history';
const MAX_AUTHOR_HISTORY = 12;
const MAX_SUBMISSION_HISTORY = 60;
/* 已被后台删除的小剧场，本地仍保留基础信息 7 天，过期自动清掉 */
const MISSING_RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type BrowserSubmissionRecord = PlayDraft & {
  id: string;
  latestPlayId?: string;
  latestFeedback?: SubmissionFeedback;
  lastSubmittedAt: string;
  submissionCount: number;
  /* 后端检测到 play 已被删除的时间（ISO）。7 天后该投稿记录自动从本地移除。 */
  missingDetectedAt?: string;
};

const now = () => new Date().toISOString();
const makeId = () => `local_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

const readStore = <T>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeStore = <T>(key: string, value: T) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
};

const normalizeSubmissionFeedbackSummary = (feedback?: SubmissionFeedback) => {
  if (!feedback) {
    return feedback;
  }

  return {
    ...feedback,
    latestSummary:
      typeof feedback.latestSummary === 'string'
        ? normalizeImportedSummary(feedback.latestSummary)
        : feedback.latestSummary,
  } satisfies SubmissionFeedback;
};

const normalizeSubmissionDraftFields = <
  T extends { summary: string; latestFeedback?: SubmissionFeedback },
>(
  record: T,
): T => ({
  ...record,
  summary: normalizeImportedSummary(record.summary),
  latestFeedback: normalizeSubmissionFeedbackSummary(record.latestFeedback),
});

const normalizeSubmissionRecord = (record: BrowserSubmissionRecord): BrowserSubmissionRecord =>
  normalizeSubmissionDraftFields(record);

export const getAuthorHistory = () => readStore<string[]>(AUTHOR_HISTORY_KEY, []);

export const rememberAuthorName = (authorName: string) => {
  const normalized = authorName.trim();
  if (!normalized) {
    return getAuthorHistory();
  }

  const nextHistory = [
    normalized,
    ...getAuthorHistory().filter((item) => item !== normalized),
  ].slice(0, MAX_AUTHOR_HISTORY);
  writeStore(AUTHOR_HISTORY_KEY, nextHistory);
  return nextHistory;
};

export const clearAuthorHistory = () => {
  writeStore(AUTHOR_HISTORY_KEY, []);
  return [] as string[];
};

export const getSubmissionHistory = () =>
  readStore<BrowserSubmissionRecord[]>(SUBMISSION_HISTORY_KEY, [])
    .map(normalizeSubmissionRecord)
    .sort((a, b) => b.lastSubmittedAt.localeCompare(a.lastSubmittedAt));

export const clearSubmissionHistory = () => {
  writeStore(SUBMISSION_HISTORY_KEY, []);
  return [] as BrowserSubmissionRecord[];
};

export const removeSubmissionRecord = (historyId: string) => {
  const nextHistory = getSubmissionHistory().filter((item) => item.id !== historyId);
  writeStore(SUBMISSION_HISTORY_KEY, nextHistory);
  return nextHistory;
};

export const mergeSubmissionFeedback = (feedbackItems: SubmissionFeedback[]) => {
  const feedbackMap = new Map(feedbackItems.map((item) => [item.playId, item]));
  const timestamp = now();
  const ttlCutoff = Date.now() - MISSING_RECORD_TTL_MS;

  const nextHistory: BrowserSubmissionRecord[] = getSubmissionHistory()
    .map((item) => {
      if (!item.latestPlayId) {
        return item;
      }

      const incoming = feedbackMap.get(item.latestPlayId);
      const previousFeedback = item.latestFeedback;

      // 后端确认已被删除：保留本地基础信息，标记 missingDetectedAt
      if (incoming?.status === 'missing') {
        const latestFeedback: SubmissionFeedback = {
          ...incoming,
          reviewNote: incoming.reviewNote || '该投稿已被删除',
        };
        return normalizeSubmissionRecord({
          ...item,
          latestFeedback,
          missingDetectedAt: item.missingDetectedAt ?? timestamp,
        });
      }

      // 之前已知被删除，现在又出现（恢复/重新上传）：清掉 missing 标记
      const missingDetectedAt =
        previousFeedback?.status === 'missing' ? undefined : item.missingDetectedAt;
      const fallbackFeedback: SubmissionFeedback = previousFeedback ?? {
        playId: item.latestPlayId,
        status: 'pending',
        reviewNote: '',
        reviewedAt: '',
        updatedAt: item.lastSubmittedAt,
      };

      const rawFeedback = normalizeSubmissionFeedbackSummary(incoming ?? fallbackFeedback)!;
      const editedFields: SubmissionEditedField[] = [];

      if (rawFeedback.latestTitle && rawFeedback.latestTitle !== item.title) {
        editedFields.push('title');
      }
      if (rawFeedback.latestAuthorName && rawFeedback.latestAuthorName !== item.authorName) {
        editedFields.push('authorName');
      }
      if (rawFeedback.latestCategory && rawFeedback.latestCategory !== item.category) {
        editedFields.push('category');
      }
      if (rawFeedback.latestSummary && rawFeedback.latestSummary !== item.summary) {
        editedFields.push('summary');
      }
      if (rawFeedback.latestContent && rawFeedback.latestContent !== item.content) {
        editedFields.push('content');
      }

      const latestFeedback: SubmissionFeedback = {
        ...rawFeedback,
        editedFields,
      };

      return normalizeSubmissionRecord({
        ...item,
        title: rawFeedback.latestTitle ?? item.title,
        authorName: rawFeedback.latestAuthorName ?? item.authorName,
        category: rawFeedback.latestCategory ?? item.category,
        summary: rawFeedback.latestSummary ?? item.summary,
        content: rawFeedback.latestContent ?? item.content,
        latestFeedback,
        missingDetectedAt,
      });
    })
    // 过期：被删除超过 7 天的投稿记录，从本地清掉
    .filter((item) => {
      if (!item.missingDetectedAt) {
        return true;
      }
      const detected = Date.parse(item.missingDetectedAt);
      return Number.isFinite(detected) ? detected > ttlCutoff : true;
    });

  writeStore(SUBMISSION_HISTORY_KEY, nextHistory);
  return nextHistory;
};

export const saveSubmissionRecord = (
  draft: PlayDraft,
  options?: {
    historyId?: string;
    latestPlayId?: string;
  },
) => {
  const currentHistory = getSubmissionHistory();
  const timestamp = now();

  if (options?.historyId) {
    const nextHistory = currentHistory.map((item) =>
      item.id === options.historyId
        ? normalizeSubmissionRecord({
            ...item,
            ...draft,
            latestPlayId: options.latestPlayId,
            latestFeedback: options.latestPlayId
              ? {
                  playId: options.latestPlayId,
                  status: 'pending',
                  reviewNote: '',
                  reviewedAt: '',
                  updatedAt: timestamp,
                }
              : item.latestFeedback,
            lastSubmittedAt: timestamp,
            submissionCount: item.submissionCount + 1,
            /* 重新投稿后清掉此前记录的删除标记 */
            missingDetectedAt: undefined,
          })
        : normalizeSubmissionRecord(item),
    );

    writeStore(SUBMISSION_HISTORY_KEY, nextHistory.slice(0, MAX_SUBMISSION_HISTORY));
    return nextHistory.find((item) => item.id === options.historyId) ?? null;
  }

  const nextRecord: BrowserSubmissionRecord = {
    id: makeId(),
    ...normalizeSubmissionDraftFields({
      ...draft,
      latestPlayId: options?.latestPlayId,
      latestFeedback: options?.latestPlayId
        ? {
            playId: options.latestPlayId,
            status: 'pending',
            reviewNote: '',
            reviewedAt: '',
            updatedAt: timestamp,
          }
        : undefined,
      lastSubmittedAt: timestamp,
      submissionCount: 1,
    }),
  };

  const nextHistory = [nextRecord, ...currentHistory].slice(0, MAX_SUBMISSION_HISTORY);
  writeStore(SUBMISSION_HISTORY_KEY, nextHistory);
  return nextRecord;
};
