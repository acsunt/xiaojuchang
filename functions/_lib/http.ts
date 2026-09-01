export type PlayStatus = 'pending' | 'approved' | 'rejected' | 'offline';
export type ReviewAction = 'approve' | 'reject' | 'offline';

export const validPlayStatuses: PlayStatus[] = ['pending', 'approved', 'rejected', 'offline'];
export const validReviewActions: ReviewAction[] = ['approve', 'reject', 'offline'];

export type PlayRecord = {
  id: string;
  title: string;
  authorName: string;
  category: string;
  summary: string;
  content: string;
  status: PlayStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
};

export type TagRecord = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ReviewLogRecord = {
  id: string;
  playId: string;
  action: ReviewAction;
  operator: string;
  note: string;
  createdAt: string;
  playTitle?: string;
};

export type RepoAuditAction = RepoReviewAction | 'delete' | 'edit';

export type RepoAuditLogRecord = {
  id: string;
  repoId: string;
  playId: string;
  action: RepoAuditAction;
  operator: string;
  note: string;
  createdAt: string;
  playTitle?: string;
  nickname?: string;
};

export type RepoStatus = 'pending' | 'approved' | 'rejected';
export type RepoReviewAction = 'approve' | 'reject';

export type RepoRecord = {
  id: string;
  playId: string;
  parentId?: string;
  rootId?: string;
  nickname: string;
  visitorId: string;
  content: string;
  status: RepoStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewNote?: string;
  playTitle?: string;
  playAuthorName?: string;
  replyToNickname?: string;
  replyToVisitorId?: string;
};

export type AdminSessionRecord = {
  token: string;
  username: string;
  expiresAt: string;
};

export type BackgroundCropRecord = {
  positionX: number;
  positionY: number;
  scale: number;
  backgroundOpacity: number;
  overlayOpacity: number;
};

type DeviceBackgroundRecord = {
  backgroundUrl: string;
  crop: BackgroundCropRecord;
};

type LegacyThemeBackgroundRecord = DeviceBackgroundRecord;

export type ThemeBackgroundRecord = {
  desktop: DeviceBackgroundRecord;
  mobile: DeviceBackgroundRecord;
};

export type SiteSettingsRecord = {
  light: ThemeBackgroundRecord;
  dark: ThemeBackgroundRecord;
  createdAt: string;
  updatedAt: string;
};

export const json = (data: unknown, init?: ResponseInit) =>
  Response.json(data, {
    headers: {
      'Cache-Control': 'no-store',
    },
    ...init,
  });

export const error = (message: string, status = 400) => json({ message }, { status });

export const now = () => new Date().toISOString();

export const makeId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;

export const normalizePlay = (row: Record<string, unknown>): PlayRecord => ({
  id: String(row.id),
  title: String(row.title),
  authorName: String(row.author_name),
  category: String(row.category),
  summary: String(row.summary),
  content: String(row.content),
  status: String(row.status) as PlayStatus,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
  reviewNote: row.review_note ? String(row.review_note) : null,
});

export const normalizeTag = (row: Record<string, unknown>): TagRecord => ({
  id: String(row.id),
  name: String(row.name),
  sortOrder: Number(row.sort_order ?? 0),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export const normalizeReviewLog = (row: Record<string, unknown>): ReviewLogRecord => ({
  id: String(row.id),
  playId: String(row.play_id),
  action: String(row.action) as ReviewAction,
  operator: String(row.operator),
  note: String(row.note),
  createdAt: String(row.created_at),
  playTitle: row.play_title ? String(row.play_title) : undefined,
});

export const normalizeRepoAuditLog = (row: Record<string, unknown>): RepoAuditLogRecord => ({
  id: String(row.id),
  repoId: String(row.repo_id),
  playId: String(row.play_id),
  action: String(row.action) as RepoAuditAction,
  operator: String(row.operator),
  note: String(row.note),
  createdAt: String(row.created_at),
  playTitle: row.play_title ? String(row.play_title) : undefined,
  nickname: row.nickname ? String(row.nickname) : undefined,
});

export const normalizeRepo = (row: Record<string, unknown>): RepoRecord => ({
  id: String(row.id),
  playId: String(row.play_id),
  parentId: row.parent_id ? String(row.parent_id) : undefined,
  rootId: row.root_id ? String(row.root_id) : undefined,
  nickname: String(row.nickname),
  visitorId: String(row.visitor_id),
  content: String(row.content),
  status: String(row.status) as RepoStatus,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined,
  reviewNote: row.review_note ? String(row.review_note) : undefined,
  playTitle: row.play_title ? String(row.play_title) : undefined,
  playAuthorName: row.play_author_name ? String(row.play_author_name) : undefined,
  replyToNickname: row.reply_to_nickname ? String(row.reply_to_nickname) : undefined,
  replyToVisitorId: row.reply_to_visitor_id ? String(row.reply_to_visitor_id) : undefined,
});

export const normalizeSession = (row: Record<string, unknown>): AdminSessionRecord => ({
  token: String(row.token),
  username: String(row.username),
  expiresAt: String(row.expires_at),
});

const createBackgroundRecord = (
  backgroundUrl: string,
  crop: BackgroundCropRecord,
): LegacyThemeBackgroundRecord => ({
  backgroundUrl,
  crop,
});

const parseDeviceBackgroundRecord = (
  raw: unknown,
  fallback: LegacyThemeBackgroundRecord,
): LegacyThemeBackgroundRecord => {
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }

  const value = raw as Partial<LegacyThemeBackgroundRecord>;
  const crop = value.crop ?? fallback.crop;
  return {
    backgroundUrl: String(value.backgroundUrl ?? fallback.backgroundUrl ?? ''),
    crop: {
      positionX: Number(crop.positionX ?? fallback.crop.positionX),
      positionY: Number(crop.positionY ?? fallback.crop.positionY),
      scale: Number(crop.scale ?? fallback.crop.scale),
      backgroundOpacity: Number(crop.backgroundOpacity ?? fallback.crop.backgroundOpacity ?? 1),
      overlayOpacity: Number(crop.overlayOpacity ?? fallback.crop.overlayOpacity),
    },
  };
};

const parseThemeBackgroundRecord = (
  backgroundUrl: string,
  crop: BackgroundCropRecord,
): ThemeBackgroundRecord => {
  const legacyBackground = createBackgroundRecord(backgroundUrl, crop);

  try {
    const parsed = JSON.parse(backgroundUrl) as Partial<ThemeBackgroundRecord>;
    return {
      desktop: parseDeviceBackgroundRecord(parsed.desktop, legacyBackground),
      mobile: parseDeviceBackgroundRecord(parsed.mobile, legacyBackground),
    };
  } catch {
    return {
      desktop: legacyBackground,
      mobile: legacyBackground,
    };
  }
};

export const normalizeSiteSettings = (row: Record<string, unknown>): SiteSettingsRecord => {
  const lightCrop = {
    positionX: Number(row.light_position_x ?? 50),
    positionY: Number(row.light_position_y ?? 50),
    scale: Number(row.light_scale ?? 100),
    backgroundOpacity: 1,
    overlayOpacity: Number(row.light_overlay_opacity ?? 0.2),
  };
  const darkCrop = {
    positionX: Number(row.dark_position_x ?? 50),
    positionY: Number(row.dark_position_y ?? 50),
    scale: Number(row.dark_scale ?? 100),
    backgroundOpacity: 1,
    overlayOpacity: Number(row.dark_overlay_opacity ?? 0.32),
  };

  return {
    light: parseThemeBackgroundRecord(String(row.light_background_url ?? ''), lightCrop),
    dark: parseThemeBackgroundRecord(String(row.dark_background_url ?? ''), darkCrop),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
};

export const readBearerToken = (request: Request) => {
  const authorization = request.headers.get('Authorization') ?? '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token.trim();
};
