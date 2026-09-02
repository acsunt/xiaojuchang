import { mockDb } from '../data/mock-db';
import { normalizeImportedSummary } from './play-text';
import { DEFAULT_CATEGORY, PLAYS_UPDATED_EVENT } from '../types/play';
import type {
  AdminSession,
  BulkReviewResult,
  Play,
  PlayDraft,
  PlayStatus,
  Repo,
  RepoAuditLog,
  RepoDraft,
  RepoNoticeSummary,
  RepoOrder,
  RepoReviewAction,
  RepoStatus,
  RepoSummary,
  ReviewAction,
  ReviewLog,
  SiteSettings,
  SubmissionFeedback,
  Tag,
  TagDraft,
} from '../types/play';

const apiMode = import.meta.env.VITE_API_MODE ?? (import.meta.env.DEV ? 'local' : 'remote');
const ADMIN_SESSION_STORAGE_KEY = 'mini-theater.remote-admin-session';
const PUBLIC_PLAYS_CACHE_KEY = 'mini-theater.public-plays-cache';
let publicPlaysCache: Play[] | null = null;
let publicPlaysRequest: Promise<Play[]> | null = null;
const publicPlayByIdRequests = new Map<string, Promise<Play | null>>();

const getStoredRemoteSession = (): AdminSession | null => {
  const raw = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AdminSession;
  } catch {
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    return null;
  }
};

const getPublicPlayCacheStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage;
};

const readStoredPublicPlays = (): Play[] => {
  const storage = getPublicPlayCacheStorage();
  if (!storage) {
    return [];
  }

  const raw = storage.getItem(PUBLIC_PLAYS_CACHE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Play[];
    return Array.isArray(parsed) ? parsed.map((play) => normalizePlaySummary(play)) : [];
  } catch {
    storage.removeItem(PUBLIC_PLAYS_CACHE_KEY);
    return [];
  }
};

const normalizeErrorMessage = (rawText: string, fallback = '请求失败') => {
  const text = rawText.trim();
  if (!text) {
    return fallback;
  }

  const lowered = text.toLowerCase();
  const looksLikeHtml =
    lowered.startsWith('<!doctype') || lowered.startsWith('<html') || lowered.includes('<body');
  if (looksLikeHtml) {
    return '接口返回了异常页面，请刷新后重试';
  }

  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length > 120) {
    return fallback;
  }

  return singleLine;
};

const setStoredRemoteSession = (session: AdminSession | null) => {
  if (!session) {
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    return;
  }

  localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(session));
};

type SiteSettingsThemeInput =
  | SiteSettings['light']
  | {
      backgroundUrl?: string;
      crop?: SiteSettings['light']['desktop']['crop'];
      desktop?: SiteSettings['light']['desktop'];
      mobile?: SiteSettings['light']['mobile'];
    };

const createDefaultBackground = (overlayOpacity: number) => ({
  backgroundUrl: '',
  crop: {
    positionX: 50,
    positionY: 50,
    scale: 100,
    backgroundOpacity: 1,
    overlayOpacity,
  },
});

const normalizeSiteBackground = (
  input: SiteSettingsThemeInput | undefined,
  overlayOpacity: number,
): SiteSettings['light']['desktop'] => {
  const fallback = createDefaultBackground(overlayOpacity);
  const source = input && 'backgroundUrl' in input ? input : fallback;
  const crop = source.crop ?? fallback.crop;

  return {
    backgroundUrl: String(source.backgroundUrl ?? ''),
    crop: {
      positionX: Number(crop.positionX ?? fallback.crop.positionX),
      positionY: Number(crop.positionY ?? fallback.crop.positionY),
      scale: Number(crop.scale ?? fallback.crop.scale),
      backgroundOpacity: Number(crop.backgroundOpacity ?? fallback.crop.backgroundOpacity),
      overlayOpacity: Number(crop.overlayOpacity ?? fallback.crop.overlayOpacity),
    },
  };
};

const normalizeSiteThemeSettings = (
  input: SiteSettingsThemeInput | undefined,
  overlayOpacity: number,
): SiteSettings['light'] => {
  if (input && 'desktop' in input && 'mobile' in input) {
    return {
      desktop: normalizeSiteBackground(input.desktop, overlayOpacity),
      mobile: normalizeSiteBackground(input.mobile, overlayOpacity),
    };
  }

  const legacyBackground = normalizeSiteBackground(input, overlayOpacity);
  return {
    desktop: legacyBackground,
    mobile: legacyBackground,
  };
};

const normalizeSiteSettings = (settings: SiteSettings): SiteSettings => ({
  light: normalizeSiteThemeSettings(settings.light as SiteSettingsThemeInput, 0.2),
  dark: normalizeSiteThemeSettings(settings.dark as SiteSettingsThemeInput, 0.32),
  createdAt: settings.createdAt ?? '',
  updatedAt: settings.updatedAt ?? '',
});

const normalizePlayDraft = (draft: PlayDraft): PlayDraft => ({
  ...draft,
  category: draft.category?.trim() || DEFAULT_CATEGORY,
  summary: normalizeImportedSummary(draft.summary),
  submissionType: draft.submissionType ?? 'original',
});

const normalizePlaySummary = (play: Play): Play => ({
  ...play,
  summary: normalizeImportedSummary(play.summary),
  submissionType: play.submissionType ?? 'original',
});

const emitPublicPlaysUpdated = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PLAYS_UPDATED_EVENT));
  }
};

const cachePublicPlays = (plays: Play[]) => {
  const normalized = plays.map(normalizePlaySummary);
  publicPlaysCache = normalized;

  const storage = getPublicPlayCacheStorage();
  if (storage) {
    storage.setItem(PUBLIC_PLAYS_CACHE_KEY, JSON.stringify(normalized));
  }

  return normalized;
};

const upsertCachedPublicPlay = (play: Play) => {
  const normalizedPlay = normalizePlaySummary(play);
  const currentPlays = getCachedPublicPlays();
  const nextPlays = currentPlays.some((item) => item.id === normalizedPlay.id)
    ? currentPlays.map((item) => (item.id === normalizedPlay.id ? normalizedPlay : item))
    : [normalizedPlay, ...currentPlays];

  return cachePublicPlays(nextPlays);
};

export const getCachedPublicPlays = (): Play[] => {
  if (publicPlaysCache) {
    return publicPlaysCache;
  }

  publicPlaysCache = readStoredPublicPlays();
  return publicPlaysCache;
};

export const getCachedPublicPlayById = (id: string) =>
  getCachedPublicPlays().find((play) => play.id === id) ?? null;

const normalizeSubmissionFeedbackSummary = (feedback: SubmissionFeedback): SubmissionFeedback => ({
  ...feedback,
  latestSummary:
    typeof feedback.latestSummary === 'string'
      ? normalizeImportedSummary(feedback.latestSummary)
      : feedback.latestSummary,
});

const jsonRequest = async <T>(input: RequestInfo | URL, init?: RequestInit) => {
  const remoteSession = getStoredRemoteSession();
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
      ...(remoteSession?.token
        ? {
            Authorization: `Bearer ${remoteSession.token}`,
          }
        : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message = normalizeErrorMessage(errorText);

    try {
      const parsed = JSON.parse(errorText) as { message?: string };
      message = normalizeErrorMessage(parsed.message ?? errorText);
    } catch {
      // ignore invalid json body
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
};

export const playApi = {
  async getPublicPlays(): Promise<Play[]> {
    if (apiMode === 'remote') {
      if (!publicPlaysRequest) {
        publicPlaysRequest = jsonRequest<Play[]>('/api/plays')
          .then((plays) => cachePublicPlays(plays))
          .finally(() => {
            publicPlaysRequest = null;
          });
      }

      return publicPlaysRequest;
    }

    return Promise.resolve(cachePublicPlays(mockDb.getPublicPlays()));
  },

  async getPublicPlayById(id: string): Promise<Play | null> {
    if (apiMode === 'remote') {
      const existingRequest = publicPlayByIdRequests.get(id);
      if (existingRequest) {
        return existingRequest;
      }

      const request = jsonRequest<Play | null>(`/api/plays/${id}`)
        .then((play) => {
          if (!play) {
            return null;
          }

          upsertCachedPublicPlay(play);
          return normalizePlaySummary(play);
        })
        .finally(() => {
          publicPlayByIdRequests.delete(id);
        });

      publicPlayByIdRequests.set(id, request);
      return request;
    }

    const play = mockDb.getPublicPlayById(id);
    if (play) {
      upsertCachedPublicPlay(play);
    }

    return Promise.resolve(play ? normalizePlaySummary(play) : null);
  },

  async getTags(): Promise<Tag[]> {
    if (apiMode === 'remote') {
      return jsonRequest<Tag[]>('/api/tags');
    }

    return Promise.resolve(mockDb.getTags());
  },

  async getSiteSettings(): Promise<SiteSettings> {
    if (apiMode === 'remote') {
      const settings = await jsonRequest<SiteSettings>('/api/site-settings');
      return normalizeSiteSettings(settings);
    }

    return Promise.resolve(normalizeSiteSettings(mockDb.getSiteSettings()));
  },

  async getSubmissionFeedback(ids: string[]): Promise<SubmissionFeedback[]> {
    const normalizedIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    if (normalizedIds.length === 0) {
      return Promise.resolve([]);
    }

    if (apiMode === 'remote') {
      const feedback = await jsonRequest<SubmissionFeedback[]>('/api/plays/feedback', {
        method: 'POST',
        body: JSON.stringify({ ids: normalizedIds }),
      });
      return feedback.map(normalizeSubmissionFeedbackSummary);
    }

    return Promise.resolve(
      mockDb.getSubmissionFeedback(normalizedIds).map(normalizeSubmissionFeedbackSummary),
    );
  },

  async uploadPlay(draft: PlayDraft): Promise<Play> {
    const normalizedDraft = normalizePlayDraft(draft);

    if (apiMode === 'remote') {
      const play = await jsonRequest<Play>('/api/plays', {
        method: 'POST',
        body: JSON.stringify(normalizedDraft),
      });
      return normalizePlaySummary(play);
    }

    return Promise.resolve(normalizePlaySummary(mockDb.createPlay(normalizedDraft)));
  },

  async getReposByPlayId(playId: string, order: RepoOrder): Promise<Repo[]> {
    if (apiMode === 'remote') {
      return jsonRequest<Repo[]>(`/api/repos?playId=${encodeURIComponent(playId)}&order=${order}`);
    }

    return Promise.resolve(mockDb.getReposByPlayId(playId, order));
  },

  async getMyRepos(visitorId: string, order: RepoOrder): Promise<Repo[]> {
    if (!visitorId.trim()) {
      return [];
    }

    if (apiMode === 'remote') {
      return jsonRequest<Repo[]>(
        `/api/repos?visitorId=${encodeURIComponent(visitorId)}&order=${order}`,
      );
    }

    return Promise.resolve(mockDb.getMyRepos(visitorId, order));
  },

  async getReceivedRepos(playIds: string[], visitorId: string, order: RepoOrder): Promise<Repo[]> {
    const normalizedPlayIds = Array.from(
      new Set(playIds.map((playId) => playId.trim()).filter(Boolean)),
    );
    const normalizedVisitorId = visitorId.trim();
    if (normalizedPlayIds.length === 0 && !normalizedVisitorId) {
      return [];
    }

    if (apiMode === 'remote') {
      return jsonRequest<Repo[]>('/api/repos', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'received',
          playIds: normalizedPlayIds,
          visitorId: normalizedVisitorId,
          order,
        }),
      });
    }

    return Promise.resolve(mockDb.getReceivedRepos(normalizedPlayIds, normalizedVisitorId, order));
  },

  async createRepo(draft: RepoDraft): Promise<Repo> {
    if (apiMode === 'remote') {
      return jsonRequest<Repo>('/api/repos', {
        method: 'POST',
        body: JSON.stringify(draft),
      });
    }

    return Promise.resolve(mockDb.createRepo(draft));
  },

  async getRepoCounts(playIds: string[]): Promise<RepoSummary[]> {
    if (playIds.length === 0) {
      return [];
    }

    if (apiMode === 'remote') {
      return jsonRequest<RepoSummary[]>('/api/repos/counts', {
        method: 'POST',
        body: JSON.stringify({ playIds }),
      });
    }

    return Promise.resolve(mockDb.getRepoCounts(playIds));
  },

  async getRepoNoticeSummary(
    playIds: string[],
    visitorId: string,
    readAt: string,
  ): Promise<RepoNoticeSummary> {
    const normalizedPlayIds = Array.from(
      new Set(playIds.map((playId) => playId.trim()).filter(Boolean)),
    );
    const normalizedVisitorId = visitorId.trim();
    if (normalizedPlayIds.length === 0 && !normalizedVisitorId) {
      return { receivedCount: 0, unreadCount: 0 };
    }

    if (apiMode === 'remote') {
      return jsonRequest<RepoNoticeSummary>('/api/repos/counts', {
        method: 'POST',
        body: JSON.stringify({
          playIds: normalizedPlayIds,
          visitorId: normalizedVisitorId,
          readAt,
        }),
      });
    }

    return Promise.resolve(
      mockDb.getRepoNoticeSummary(normalizedPlayIds, normalizedVisitorId, readAt),
    );
  },

  async adminLogin(username: string, password: string): Promise<AdminSession> {
    if (apiMode === 'remote') {
      const session = await jsonRequest<AdminSession>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setStoredRemoteSession(session);
      return session;
    }

    return Promise.resolve(mockDb.login(username, password));
  },

  async getAdminSession(): Promise<AdminSession | null> {
    if (apiMode === 'remote') {
      const session = getStoredRemoteSession();
      if (!session) {
        return null;
      }

      try {
        const refreshed = await jsonRequest<AdminSession>('/api/admin/login', {
          method: 'GET',
        });
        setStoredRemoteSession(refreshed);
        return refreshed;
      } catch {
        setStoredRemoteSession(null);
        return null;
      }
    }

    return Promise.resolve(mockDb.getSession());
  },

  async logoutAdmin(): Promise<void> {
    if (apiMode === 'remote') {
      try {
        await jsonRequest<{ ok: boolean }>('/api/admin/logout', {
          method: 'POST',
        });
      } finally {
        setStoredRemoteSession(null);
      }
      return Promise.resolve();
    }

    mockDb.logout();
    return Promise.resolve();
  },

  async getAdminPlays(status?: PlayStatus): Promise<Play[]> {
    if (apiMode === 'remote') {
      const query = status ? `?status=${status}` : '';
      const plays = await jsonRequest<Play[]>(`/api/admin/plays${query}`);
      return plays.map(normalizePlaySummary);
    }

    return Promise.resolve(mockDb.getAdminPlays(status).map(normalizePlaySummary));
  },

  async getAdminRepos(status?: RepoStatus): Promise<Repo[]> {
    if (apiMode === 'remote') {
      const query = status ? `?status=${status}` : '';
      return jsonRequest<Repo[]>(`/api/admin/repos${query}`);
    }

    return Promise.resolve(mockDb.getAdminRepos(status));
  },

  async reviewRepo(repoId: string, action: RepoReviewAction, note: string): Promise<Repo | null> {
    if (apiMode === 'remote') {
      const repo = await jsonRequest<Repo | null>(`/api/admin/repos/${repoId}`, {
        method: 'POST',
        body: JSON.stringify({ action, note }),
      });
      emitPublicPlaysUpdated();
      return repo;
    }

    const repo = mockDb.reviewRepo(repoId, action, note);
    emitPublicPlaysUpdated();
    return Promise.resolve(repo);
  },

  async deleteRepo(repoId: string): Promise<void> {
    if (apiMode === 'remote') {
      await jsonRequest<{ ok: boolean }>(`/api/admin/repos/${repoId}`, {
        method: 'DELETE',
      });
      emitPublicPlaysUpdated();
      return Promise.resolve();
    }

    mockDb.deleteRepo(repoId);
    emitPublicPlaysUpdated();
    return Promise.resolve();
  },

  /* 任务 5：管理员更新 repo 的正文 / 审核备注。后端 PATCH /api/admin/repos/:id。 */
  async updateRepo(
    repoId: string,
    patch: { content?: string; note?: string },
  ): Promise<Repo | null> {
    if (apiMode === 'remote') {
      const repo = await jsonRequest<Repo | null>(`/api/admin/repos/${repoId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      emitPublicPlaysUpdated();
      return repo;
    }

    const repo = mockDb.updateRepo(repoId, patch);
    emitPublicPlaysUpdated();
    return Promise.resolve(repo);
  },

  async deleteRejectedReposByVisitor(visitorId: string): Promise<number> {
    if (apiMode === 'remote') {
      const result = await jsonRequest<{ deletedCount: number }>(
        `/api/repos/mine/rejected?visitorId=${encodeURIComponent(visitorId)}`,
        { method: 'DELETE' },
      );
      emitPublicPlaysUpdated();
      return Promise.resolve(result.deletedCount ?? 0);
    }

    const deletedCount = mockDb.deleteRejectedReposByVisitor(visitorId);
    emitPublicPlaysUpdated();
    return Promise.resolve(deletedCount);
  },

  async getAdminPlayById(id: string): Promise<Play | null> {
    if (apiMode === 'remote') {
      const play = await jsonRequest<Play | null>(`/api/admin/plays/${id}`);
      return play ? normalizePlaySummary(play) : null;
    }

    const play = mockDb.getAdminPlayById(id);
    return Promise.resolve(play ? normalizePlaySummary(play) : null);
  },

  async getAdminTags(): Promise<Tag[]> {
    if (apiMode === 'remote') {
      return jsonRequest<Tag[]>('/api/admin/tags');
    }

    return Promise.resolve(mockDb.getTags());
  },

  async restoreAdminBackup(plays: Play[]): Promise<{ restoredCount: number }> {
    if (apiMode === 'remote') {
      return jsonRequest<{ restoredCount: number }>('/api/admin/backup', {
        method: 'POST',
        body: JSON.stringify({ plays }),
      });
    }

    return Promise.resolve(mockDb.restoreAdminBackup(plays));
  },

  async getAdminSiteSettings(): Promise<SiteSettings> {
    if (apiMode === 'remote') {
      const settings = await jsonRequest<SiteSettings>('/api/admin/site-settings');
      return normalizeSiteSettings(settings);
    }

    return Promise.resolve(normalizeSiteSettings(mockDb.getSiteSettings()));
  },

  async updateAdminSiteSettings(settings: SiteSettings): Promise<SiteSettings> {
    if (apiMode === 'remote') {
      const saved = await jsonRequest<SiteSettings>('/api/admin/site-settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      return normalizeSiteSettings(saved);
    }

    return Promise.resolve(normalizeSiteSettings(mockDb.updateSiteSettings(settings)));
  },

  async createAdminTag(draft: TagDraft): Promise<Tag> {
    if (apiMode === 'remote') {
      return jsonRequest<Tag>('/api/admin/tags', {
        method: 'POST',
        body: JSON.stringify(draft),
      });
    }

    return Promise.resolve(mockDb.createTag(draft));
  },

  async updateAdminTag(tagId: string, draft: TagDraft): Promise<Tag> {
    if (apiMode === 'remote') {
      return jsonRequest<Tag>(`/api/admin/tags/${tagId}`, {
        method: 'PUT',
        body: JSON.stringify(draft),
      });
    }

    return Promise.resolve(mockDb.updateTag(tagId, draft));
  },

  async reorderAdminTags(orderedIds: string[]): Promise<Tag[]> {
    if (apiMode === 'remote') {
      return jsonRequest<Tag[]>('/api/admin/tags/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedIds }),
      });
    }

    return Promise.resolve(mockDb.reorderTags(orderedIds));
  },

  async deleteAdminTag(tagId: string): Promise<void> {
    if (apiMode === 'remote') {
      await jsonRequest<{ ok: boolean }>(`/api/admin/tags/${tagId}`, {
        method: 'DELETE',
      });
      return Promise.resolve();
    }

    mockDb.deleteTag(tagId);
    return Promise.resolve();
  },

  async deleteAdminPlay(playId: string): Promise<void> {
    if (apiMode === 'remote') {
      await jsonRequest<{ ok: boolean }>(`/api/admin/plays/${playId}`, {
        method: 'DELETE',
      });
      return Promise.resolve();
    }

    mockDb.deleteAdminPlay(playId);
    return Promise.resolve();
  },

  async clearReviewLogs(playId: string): Promise<void> {
    if (apiMode === 'remote') {
      await jsonRequest<{ ok: boolean }>(`/api/admin/plays/${playId}/logs`, {
        method: 'DELETE',
      });
      return Promise.resolve();
    }

    mockDb.clearReviewLogs(playId);
    return Promise.resolve();
  },

  async reviewPlay(
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
  ): Promise<Play | null> {
    if (apiMode === 'remote') {
      const play = await jsonRequest<Play | null>(`/api/admin/plays/${playId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          note,
          title: edit?.title,
          authorName: edit?.authorName,
          category: edit?.category,
          summary: edit?.summary,
          content: edit?.content,
        }),
      });
      return play ? normalizePlaySummary(play) : null;
    }

    const play = mockDb.reviewPlay(playId, action, note, edit);
    return Promise.resolve(play ? normalizePlaySummary(play) : null);
  },

  async updateAdminPlay(
    playId: string,
    edit: {
      title?: string;
      authorName?: string;
      category?: string;
      summary?: string;
      content?: string;
    },
  ): Promise<Play | null> {
    if (apiMode === 'remote') {
      const play = await jsonRequest<Play | null>(`/api/admin/plays/${playId}`, {
        method: 'PUT',
        body: JSON.stringify(edit),
      });
      return play ? normalizePlaySummary(play) : null;
    }

    const play = mockDb.updateAdminPlay(playId, edit);
    return Promise.resolve(play ? normalizePlaySummary(play) : null);
  },

  async bulkReviewPlays(
    playIds: string[],
    action: ReviewAction,
    note: string,
  ): Promise<BulkReviewResult> {
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

    if (apiMode === 'remote') {
      return jsonRequest<BulkReviewResult>('/api/admin/bulk-review', {
        method: 'POST',
        body: JSON.stringify({ ids: normalizedIds, action, note }),
      });
    }

    return Promise.resolve(mockDb.bulkReviewPlays(normalizedIds, action, note));
  },

  async getReviewLogs(playId: string): Promise<ReviewLog[]> {
    if (apiMode === 'remote') {
      return jsonRequest<ReviewLog[]>(`/api/admin/plays/${playId}/logs`);
    }

    return Promise.resolve(mockDb.getReviewLogs(playId));
  },

  async getAllPlayReviewLogs(): Promise<ReviewLog[]> {
    if (apiMode === 'remote') {
      return jsonRequest<ReviewLog[]>('/api/admin/review-logs/plays');
    }

    return Promise.resolve(mockDb.getAllPlayReviewLogs());
  },

  async getAllRepoAuditLogs(): Promise<RepoAuditLog[]> {
    if (apiMode === 'remote') {
      return jsonRequest<RepoAuditLog[]>('/api/admin/review-logs/repos');
    }

    return Promise.resolve(mockDb.getAllRepoAuditLogs());
  },
};
