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

export type SubmissionType = 'original' | 'modify' | 'derived';

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
  submissionType?: SubmissionType;
  /* 「修改」投稿指向被改的原 play;详情面板用它做 diff 与合入目标。
   * 仅 submissionType='modify' 时存在,公共列表 (status='approved') 不会出现此值。 */
  parentPlayId?: string | null;
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

export type RepoAuditAction = RepoReviewAction | 'delete' | 'edit';

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

/* 续写:挂在原文小剧场下面的长文本内容,与 repos 平级但独立审核。
 *
 * - nickname 可空:未填写表示「匿名 / 原作者本人续写」,详情页不展示署名
 * - summary 必填,作为列表导语
 * - status 与 repos 一致,各自走独立审核池
 * - authorNickname 字段保留,语义与 nickname 相同,便于后续追溯 */
export type ContinuationStatus = 'pending' | 'approved' | 'rejected';
export type ContinuationReviewAction = 'approve' | 'reject';

export type Continuation = {
  id: string;
  playId: string;
  nickname: string;
  visitorId: string;
  summary: string;
  content: string;
  status: ContinuationStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewNote?: string;
  playTitle?: string;
  playAuthorName?: string;
  /* 作者最近一次编辑前已通过的版本快照。
   * 用户编辑后,状态回到 pending/rejected,详情页继续展示这一份「旧版已通过」内容,
   * 等下次重新审核通过再覆盖回主字段。 */
  lastApprovedNickname?: string;
  lastApprovedSummary?: string;
  lastApprovedContent?: string;
  lastApprovedAt?: string;
  /* 软删除标记:删除时不再真删,而是写一个时间戳。
   * 详情页仍展示 lastApproved 旧版内容(因为被删的是新版修订),
   * admin 后台可以继续看到这条记录并真实删除(目前未实现彻底硬删,
   * 默认保留以便审核追溯)。 */
  deletedAt?: string;
  /* mock-db 内部使用:详情页展示时,如果当前 status 不是 approved,
   * 会被 mock-db 重定向到 lastApproved*,同时把真实 status 写到这里,
   * 前端可以选择展示一个小标签(例如「本条后续修订暂未发布」)。 */
  _displayStatus?: ContinuationStatus;
};

export type ContinuationDraft = {
  playId: string;
  nickname: string;
  visitorId: string;
  summary: string;
  content: string;
};

export type ContinuationAuditAction = ContinuationReviewAction | 'delete' | 'edit';

export type ContinuationAuditLog = {
  id: string;
  continuationId: string;
  playId: string;
  action: ContinuationAuditAction;
  operator: string;
  note: string;
  createdAt: string;
  playTitle?: string;
  nickname?: string;
};

/* 广场「有新内容」通知的三段汇总。
 * modified 自 since 以来 review_logs 'approve' + '[修改] %' 的条目;
 * continuations 自 since 以来通过的续写条数;
 * newPlays 自 since 以来通过的原文小剧场条数。
 * 未通过(pending / rejected / offline)均不计入。 */
export type NotificationSummary = {
  modified: number;
  continuations: number;
  newPlays: number;
  since: string;
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
  submissionType?: SubmissionType;
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

export const continuationStatusLabelMap: Record<ContinuationStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
};
