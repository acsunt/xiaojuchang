/**
 * mock-db.plays 业务规则切片。
 *
 * 覆盖 mockDb 中 play 相关的核心方法（按面切，聚焦业务规则不重复）：
 *   - getPublicPlays / getAdminPlays / getAdminPlayById
 *   - deleteAdminPlay / clearReviewLogs
 *   - updateAdminPlay（trim / 非空校验 / 系列重命名）
 *   - reviewPlay（普通 inline edit + modify 合入 + 状态流转 + 审计日志）
 *   - bulkReviewPlays（按 ids 分类 + 跳过不存在）
 *   - getPendingModifyPlays（submissionType=modify + status=pending）
 *
 * 跳过：
 *   - getPublicPlayById（逻辑薄：find + 状态过滤）
 *   - createPlay / submitPlayEdit（被 continuations 的 createContinuation 同款覆盖思路）
 *   - restoreAdminBackup（关联备份导出，纯格式化样板多）
 *   - getSubmissionFeedback（多个字段拼装，规则薄）
 */
import { describe, expect, it } from 'vitest';
import { mockDb } from '../data/mock-db';
import type { Play, PlayDraft, ReviewLog } from '../types/play';
import { setupMockStorageTest } from './helpers/mock-storage-test';

setupMockStorageTest();

const PLAY_KEY = 'mini-theater.plays';
const REVIEW_LOG_KEY = 'mini-theater.review-logs';
const SESSION_KEY = 'mini-theater.admin-session';
const TAG_KEY = 'mini-theater.tags';

const seedPlay = (overrides: Partial<Play> = {}): Play => ({
  id: 'p1',
  title: 'Title',
  authorName: 'alice',
  category: 'cat',
  summary: 'sum',
  content: 'content',
  status: 'pending',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  reviewedAt: null,
  reviewNote: null,
  submissionType: 'original',
  parentPlayId: null,
  ...overrides,
});

const seedAdminSession = () => {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      token: 'tok',
      username: 'admin',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
  );
};

const setStored = <T>(key: string, value: T) => localStorage.setItem(key, JSON.stringify(value));

const seedDraft = (overrides: Partial<PlayDraft> = {}): PlayDraft => ({
  title: 'New',
  authorName: 'alice',
  category: 'cat',
  summary: 'sum',
  content: 'content',
  submissionType: 'original',
  ...overrides,
});

describe('mockDb.plays 业务规则', () => {
  describe('getPublicPlays', () => {
    it('只返回 approved + 按 updatedAt 倒序', () => {
      setStored<Play[]>(PLAY_KEY, [
        seedPlay({ id: 'approved-old', status: 'approved', updatedAt: '2026-01-01T00:00:00.000Z' }),
        seedPlay({ id: 'pending', status: 'pending', updatedAt: '2026-02-01T00:00:00.000Z' }),
        seedPlay({ id: 'approved-new', status: 'approved', updatedAt: '2026-02-01T00:00:00.000Z' }),
      ]);

      const result = mockDb.getPublicPlays();

      expect(result.map((p) => p.id)).toEqual(['approved-new', 'approved-old']);
    });
  });

  describe('getAdminPlays', () => {
    it('不传 status 返回所有（按 updatedAt 倒序）', () => {
      setStored<Play[]>(PLAY_KEY, [
        seedPlay({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }),
        seedPlay({ id: 'b', updatedAt: '2026-02-01T00:00:00.000Z' }),
      ]);

      const result = mockDb.getAdminPlays();

      expect(result.map((p) => p.id)).toEqual(['b', 'a']);
    });

    it('传 status 时只返回该状态', () => {
      setStored<Play[]>(PLAY_KEY, [
        seedPlay({ id: 'pending', status: 'pending' }),
        seedPlay({ id: 'approved', status: 'approved' }),
      ]);

      const result = mockDb.getAdminPlays('pending');

      expect(result.map((p) => p.id)).toEqual(['pending']);
    });
  });

  describe('deleteAdminPlay', () => {
    it('id 不存在抛 "内容不存在"', () => {
      expect(() => mockDb.deleteAdminPlay('missing')).toThrow('内容不存在');
    });

    it('存在时删除 + 同步清掉它的审核日志', () => {
      setStored<Play[]>(PLAY_KEY, [seedPlay({ id: 'p1' })]);
      setStored<ReviewLog[]>(REVIEW_LOG_KEY, [
        {
          id: 'l1',
          playId: 'p1',
          action: 'approve',
          operator: 'admin',
          note: '',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'l2',
          playId: 'p2',
          action: 'approve',
          operator: 'admin',
          note: '',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      mockDb.deleteAdminPlay('p1');

      expect(JSON.parse(localStorage.getItem(PLAY_KEY) ?? '[]')).toHaveLength(0);
      expect(JSON.parse(localStorage.getItem(REVIEW_LOG_KEY) ?? '[]')).toHaveLength(1);
    });
  });

  describe('clearReviewLogs', () => {
    it('id 不存在抛 "内容不存在"', () => {
      expect(() => mockDb.clearReviewLogs('missing')).toThrow('内容不存在');
    });

    it('只清该 play 的日志，不动 play 本身', () => {
      setStored<Play[]>(PLAY_KEY, [seedPlay({ id: 'p1' })]);
      setStored<ReviewLog[]>(REVIEW_LOG_KEY, [
        {
          id: 'l1',
          playId: 'p1',
          action: 'approve',
          operator: 'admin',
          note: '',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      mockDb.clearReviewLogs('p1');

      expect(JSON.parse(localStorage.getItem(PLAY_KEY) ?? '[]')).toHaveLength(1);
      expect(JSON.parse(localStorage.getItem(REVIEW_LOG_KEY) ?? '[]')).toHaveLength(0);
    });
  });

  describe('updateAdminPlay', () => {
    it('id 不存在抛 "内容不存在"', () => {
      expect(() => mockDb.updateAdminPlay('missing', { title: 't' })).toThrow('内容不存在');
    });

    it('title 为空抛 "标题不能为空"', () => {
      setStored<Play[]>(PLAY_KEY, [seedPlay({ id: 'p1' })]);

      expect(() => mockDb.updateAdminPlay('p1', { title: '   ' })).toThrow('标题不能为空');
    });

    it('authorName 为空抛 "署名不能为空"', () => {
      setStored<Play[]>(PLAY_KEY, [seedPlay({ id: 'p1' })]);

      expect(() => mockDb.updateAdminPlay('p1', { authorName: '' })).toThrow('署名不能为空');
    });

    it('content 为空抛 "正文不能为空"', () => {
      setStored<Play[]>(PLAY_KEY, [seedPlay({ id: 'p1' })]);

      expect(() => mockDb.updateAdminPlay('p1', { content: '   ' })).toThrow('正文不能为空');
    });

    it('字段会 trim', () => {
      setStored<Play[]>(PLAY_KEY, [seedPlay({ id: 'p1' })]);

      const updated = mockDb.updateAdminPlay('p1', {
        title: '  New Title  ',
        authorName: '  bob  ',
        content: '  content  ',
      });

      expect(updated?.title).toBe('New Title');
      expect(updated?.authorName).toBe('bob');
      expect(updated?.content).toBe('content');
    });

    it('category 改了之后自动 ensureTagName（加入 tags 词表）', () => {
      setStored<Play[]>(PLAY_KEY, [seedPlay({ id: 'p1', category: 'old' })]);

      mockDb.updateAdminPlay('p1', { category: 'new-cat' });

      const tags = JSON.parse(localStorage.getItem(TAG_KEY) ?? '[]') as Array<{ name: string }>;
      expect(tags.some((t) => t.name === 'new-cat')).toBe(true);
    });
  });

  describe('reviewPlay - 普通投稿 inline edit', () => {
    it('未登录抛 "管理员未登录"', () => {
      setStored<Play[]>(PLAY_KEY, [seedPlay({ id: 'p1' })]);

      expect(() => mockDb.reviewPlay('p1', 'approve', '')).toThrow('管理员未登录');
    });

    it('approve 把 status 改为 approved + 写审核日志', () => {
      seedAdminSession();
      setStored<Play[]>(PLAY_KEY, [seedPlay({ id: 'p1' })]);

      const reviewed = mockDb.reviewPlay('p1', 'approve', 'lgtm');

      expect(reviewed?.status).toBe('approved');
      expect(reviewed?.reviewNote).toBe('lgtm');
      const logs = JSON.parse(localStorage.getItem(REVIEW_LOG_KEY) ?? '[]');
      expect(logs[0]).toMatchObject({ playId: 'p1', action: 'approve', operator: 'admin' });
    });

    it('inline edit 覆盖到 play 字段', () => {
      seedAdminSession();
      setStored<Play[]>(PLAY_KEY, [seedPlay({ id: 'p1', content: 'old' })]);

      const reviewed = mockDb.reviewPlay('p1', 'approve', '', { content: 'edited' });

      expect(reviewed?.content).toBe('edited');
    });

    it('reject 不改 content 但改 status + note', () => {
      seedAdminSession();
      setStored<Play[]>(PLAY_KEY, [seedPlay({ id: 'p1', content: 'unchanged' })]);

      const reviewed = mockDb.reviewPlay('p1', 'reject', 'no');

      expect(reviewed?.status).toBe('rejected');
      expect(reviewed?.reviewNote).toBe('no');
      expect(reviewed?.content).toBe('unchanged');
    });

    it('offline 把 status 改为 offline', () => {
      seedAdminSession();
      setStored<Play[]>(PLAY_KEY, [seedPlay({ id: 'p1', status: 'approved' })]);

      const reviewed = mockDb.reviewPlay('p1', 'offline', '下架');

      expect(reviewed?.status).toBe('offline');
    });
  });

  describe('reviewPlay - modify 投稿合入', () => {
    it('modify + approve：把内容合入 parent 并删除自己', () => {
      seedAdminSession();
      setStored<Play[]>(PLAY_KEY, [
        seedPlay({ id: 'parent', status: 'approved', content: 'old' }),
        seedPlay({
          id: 'modify-1',
          status: 'pending',
          submissionType: 'modify',
          parentPlayId: 'parent',
          content: 'edited content',
        }),
      ]);

      const result = mockDb.reviewPlay('modify-1', 'approve', 'apply');

      // 合入：parent 内容更新
      expect(result?.id).toBe('parent');
      expect(result?.content).toBe('edited content');
      // 自己被删
      const stored = JSON.parse(localStorage.getItem(PLAY_KEY) ?? '[]') as Play[];
      expect(stored.find((p) => p.id === 'modify-1')).toBeUndefined();
      // 审计日志里 playId 是 parent，前缀 [修改]
      const logs = JSON.parse(localStorage.getItem(REVIEW_LOG_KEY) ?? '[]') as ReviewLog[];
      expect(logs[0]).toMatchObject({
        playId: 'parent',
        action: 'approve',
        note: '[修改] apply',
      });
    });

    it('modify + reject：只改自己的 status', () => {
      seedAdminSession();
      setStored<Play[]>(PLAY_KEY, [
        seedPlay({ id: 'parent', status: 'approved' }),
        seedPlay({
          id: 'modify-1',
          status: 'pending',
          submissionType: 'modify',
          parentPlayId: 'parent',
        }),
      ]);

      const reviewed = mockDb.reviewPlay('modify-1', 'reject', 'no');

      expect(reviewed?.id).toBe('modify-1');
      expect(reviewed?.status).toBe('rejected');
      // parent 没动
      const stored = JSON.parse(localStorage.getItem(PLAY_KEY) ?? '[]') as Play[];
      expect(stored.find((p) => p.id === 'parent')?.status).toBe('approved');
    });

    it('modify 缺少 parentPlayId 抛 "修改草稿缺少 parent_play_id"', () => {
      seedAdminSession();
      setStored<Play[]>(PLAY_KEY, [
        seedPlay({
          id: 'modify-1',
          status: 'pending',
          submissionType: 'modify',
          parentPlayId: null,
        }),
      ]);

      expect(() => mockDb.reviewPlay('modify-1', 'approve', '')).toThrow(
        '修改草稿缺少 parent_play_id',
      );
    });
  });

  describe('bulkReviewPlays', () => {
    it('未登录抛 "管理员未登录"', () => {
      expect(() => mockDb.bulkReviewPlays(['p1'], 'approve', '')).toThrow('管理员未登录');
    });

    it('存在的 id 进 updatedIds，不存在的进 skippedIds（与目标状态无关）', () => {
      seedAdminSession();
      setStored<Play[]>(PLAY_KEY, [
        seedPlay({ id: 'p1', status: 'pending' }),
        seedPlay({ id: 'p2', status: 'approved' }),
      ]);

      const result = mockDb.bulkReviewPlays(['p1', 'p2', 'missing'], 'reject', 'batch');

      expect(result.updatedIds.sort()).toEqual(['p1', 'p2']); // 存在即 updated
      expect(result.skippedIds).toEqual(['missing']);
      expect(result.action).toBe('reject');
      // p2 (approved) 被 reject 后状态变为 rejected
      const stored = JSON.parse(localStorage.getItem(PLAY_KEY) ?? '[]') as Play[];
      expect(stored.find((p) => p.id === 'p2')?.status).toBe('rejected');
    });
  });

  describe('getPendingModifyPlays', () => {
    it('只返回 submissionType=modify + status=pending', () => {
      setStored<Play[]>(PLAY_KEY, [
        seedPlay({ id: 'mod-pending', submissionType: 'modify', status: 'pending' }),
        seedPlay({ id: 'mod-approved', submissionType: 'modify', status: 'approved' }),
        seedPlay({ id: 'orig-pending', submissionType: 'original', status: 'pending' }),
      ]);

      const result = mockDb.getPendingModifyPlays();

      expect(result.map((p) => p.id)).toEqual(['mod-pending']);
    });
  });

  // 顺带：createPlay 只需要覆盖"新建一条 pending"这一关键行为，给后两个面的测试兜底
  describe('createPlay', () => {
    it('新建一条 status=pending 的 play + 追加到表头', () => {
      const created = mockDb.createPlay(seedDraft());

      expect(created.status).toBe('pending');
      expect(created.id).toMatch(/^play_/);

      const stored = JSON.parse(localStorage.getItem(PLAY_KEY) ?? '[]') as Play[];
      expect(stored.find((p) => p.id === created.id)).toBeDefined();
      // 新加的在最前面
      expect(stored[0]?.id).toBe(created.id);
    });

    it('category 缺省时回退到 DEFAULT_CATEGORY ("未分类")', () => {
      const created = mockDb.createPlay(seedDraft({ category: '' }));

      expect(created.category).toBe('未分类');
    });
  });
});
