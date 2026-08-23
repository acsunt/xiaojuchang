export type PlayStatus = 'pending' | 'approved' | 'rejected' | 'offline';
export type RepoStatus = 'pending' | 'approved' | 'rejected';
export type ReviewAction = 'approve' | 'reject' | 'offline';
export type RepoReviewAction = 'approve' | 'reject';
export type Category = string;
export type PlayTimeField = 'createdAt' | 'updatedAt';

export type Tag = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Play = {
  id: string;
  title: string;
  authorName: string;
  category: Category;
  summary: string;
  content: string;
  status: PlayStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewNote?: string;
};

export type ReviewLog = {
  id: string;
  playId: string;
  action: ReviewAction;
  operator: string;
  note: string;
  createdAt: string;
  playTitle?: string;
};

export type RepoAuditAction = RepoReviewAction | 'delete';

export type RepoAuditLog = {
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

export type Repo = {
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

export type RepoDraft = {
  playId: string;
  parentId?: string;
  nickname: string;
  visitorId: string;
  content: string;
};

export type RepoOrder = 'asc' | 'desc';

export type RepoSummary = {
  playId: string;
  count: number;
  firstCreatedAt?: string;
  lastCreatedAt?: string;
};

export type RepoNoticeSummary = {
  receivedCount: number;
  unreadCount: number;
};

export type RepoNoticeSettings = 'count' | 'dot' | 'off';

export type RepoReviewResult = {
  action: RepoReviewAction | 'delete';
  updatedIds: string[];
  skippedIds: string[];
  updatedCount: number;
  skippedCount: number;
};

export type BulkReviewResult = {
  action: ReviewAction;
  updatedIds: string[];
  skippedIds: string[];
  updatedCount: number;
  skippedCount: number;
};

export type AdminSession = {
  token: string;
  username: string;
  expiresAt: string;
};

export type PlayDraft = {
  title: string;
  authorName: string;
  category?: Category;
  summary: string;
  content: string;
};

export type TagDraft = {
  name: string;
};

export type BackgroundCrop = {
  positionX: number;
  positionY: number;
  scale: number;
  backgroundOpacity: number;
  overlayOpacity: number;
};

export type BackgroundDevice = 'desktop' | 'mobile';

export type DeviceBackground = {
  backgroundUrl: string;
  crop: BackgroundCrop;
};

export type ThemeModeBackground = {
  desktop: DeviceBackground;
  mobile: DeviceBackground;
};

export type SiteSettings = {
  light: ThemeModeBackground;
  dark: ThemeModeBackground;
  createdAt: string;
  updatedAt: string;
};

export type SubmissionFeedbackStatus = PlayStatus | 'missing';
export type SubmissionEditedField = 'title' | 'authorName' | 'category' | 'summary' | 'content';

export type SubmissionFeedback = {
  playId: string;
  status: SubmissionFeedbackStatus;
  reviewNote: string;
  reviewedAt?: string;
  updatedAt: string;
  latestTitle?: string;
  latestAuthorName?: string;
  latestCategory?: string;
  latestSummary?: string;
  latestContent?: string;
  editedFields?: SubmissionEditedField[];
};
export type UploadMode = 'single' | 'batch';

export const DEFAULT_CATEGORY = '未分类';
export const PLAYS_UPDATED_EVENT = 'mini-theater:plays-updated';
export const TAGS_UPDATED_EVENT = 'mini-theater:tags-updated';

export const statusLabelMap: Record<PlayStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  offline: '已下线',
};

export const repoStatusLabelMap: Record<RepoStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
};