import type { RepoNoticeSettings } from '../types/play';
import { getSubmissionHistory } from './browser-upload-history';

const VISITOR_ID_KEY = 'mini-theater:visitor-id';
const REPO_NICKNAME_HISTORY_KEY = 'mini-theater:repo-nickname-history';
const REPO_NOTICE_SETTINGS_KEY = 'mini-theater:repo-notice-settings';
const REPO_READ_AT_KEY = 'mini-theater:repo-read-at';
const OWNED_PLAY_IDS_KEY = 'mini-theater:owned-play-ids';
export const REPO_NOTICE_UPDATED_EVENT = 'mini-theater:repo-notice-updated';
const MAX_REPO_NICKNAME_HISTORY = 12;

const makeVisitorId = () => `visitor_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

const readJsonStore = <T,>(key: string, fallback: T): T => {
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

const writeJsonStore = <T,>(key: string, value: T) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
};

const emitRepoNoticeUpdated = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(REPO_NOTICE_UPDATED_EVENT));
  }
};

export const getVisitorId = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  const existing = window.localStorage.getItem(VISITOR_ID_KEY)?.trim();
  if (existing) {
    return existing;
  }

  const nextVisitorId = makeVisitorId();
  window.localStorage.setItem(VISITOR_ID_KEY, nextVisitorId);
  return nextVisitorId;
};

export const getRepoNicknameHistory = () => readJsonStore<string[]>(REPO_NICKNAME_HISTORY_KEY, []);

export const clearRepoNicknameHistory = () => {
  writeJsonStore(REPO_NICKNAME_HISTORY_KEY, []);
  return [] as string[];
};

export const rememberRepoNickname = (nickname: string) => {
  const normalized = nickname.trim();
  if (!normalized) {
    return getRepoNicknameHistory();
  }

  const nextHistory = [normalized, ...getRepoNicknameHistory().filter((item) => item !== normalized)].slice(
    0,
    MAX_REPO_NICKNAME_HISTORY,
  );
  writeJsonStore(REPO_NICKNAME_HISTORY_KEY, nextHistory);
  return nextHistory;
};

export const getRepoNoticeSettings = (): RepoNoticeSettings => {
  const value = readJsonStore<RepoNoticeSettings>(REPO_NOTICE_SETTINGS_KEY, 'count');
  return value === 'dot' || value === 'off' ? value : 'count';
};

export const setRepoNoticeSettings = (settings: RepoNoticeSettings) => {
  writeJsonStore(REPO_NOTICE_SETTINGS_KEY, settings);
  emitRepoNoticeUpdated();
  return settings;
};

export const getRepoReadAt = () => readJsonStore<string>(REPO_READ_AT_KEY, '');

export const markRepoReadNow = () => {
  const timestamp = new Date().toISOString();
  writeJsonStore(REPO_READ_AT_KEY, timestamp);
  emitRepoNoticeUpdated();
  return timestamp;
};

export const getOwnedPlayIdsFromSubmissionHistory = () =>
  Array.from(
    new Set(
      getSubmissionHistory()
        .map((record) => record.latestPlayId?.trim() ?? '')
        .filter(Boolean),
    ),
  );

// ----- 独立的"我的作品"playId 存储 -----
// 与投稿记录不同：清空投稿记录不会清空此存储，
// 保证用户清空投稿记录后仍能收到这些作品的 repo 提醒。

const readOwnedPlayIdsStore = (): string[] =>
  readJsonStore<string[]>(OWNED_PLAY_IDS_KEY, []);

const writeOwnedPlayIdsStore = (ids: string[]) => {
  writeJsonStore(OWNED_PLAY_IDS_KEY, ids);
};

export const rememberOwnedPlayId = (playId: string) => {
  const normalized = playId.trim();
  if (!normalized) {
    return readOwnedPlayIdsStore();
  }

  const current = readOwnedPlayIdsStore();
  if (current.includes(normalized)) {
    return current;
  }

  const next = [...current, normalized];
  writeOwnedPlayIdsStore(next);
  return next;
};

export const getOwnedPlayIds = () =>
  Array.from(
    new Set([...getOwnedPlayIdsFromSubmissionHistory(), ...readOwnedPlayIdsStore()]),
  );