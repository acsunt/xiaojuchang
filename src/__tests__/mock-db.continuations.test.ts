/**
 * mock-db.ts 业务规则切片 —— localStorage 伪数据库的"非序列化样板"部分。
 *
 * 只测业务规则(过滤 / 排序 / 状态流转 / 软删除 / visitorId 校验),
 * 不测 localStorage 持久化本身（那部分靠 readStore/writeStore 是无脑 JSON）。
 *
 * 覆盖 mockDb.continuations 的方法：
 *   - getContinuationsByPlayId / getMyContinuations / getReceivedContinuations
 *   - getContinuationCounts / getAdminContinuations
 *   - createContinuation / updateContinuationByAuthor
 *   - reviewContinuation / updateContinuationByAdmin / deleteContinuation
 *
 * 跳过（不在冒烟范围）：
 *   - mockDb.plays / mockDb.repos / mockDb.tags / mockDb.siteSettings
 *     等其他面（它们逻辑薄、规则简单，加进来收益低）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// mock-db.ts 直接读写 localStorage / sessionStorage，node 环境没这俩全局。
// 给它们补一个最小 stub（和 helper 里的 storageStub 同款）。
const storageStub = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
})();

beforeEach(() => {
  vi.stubGlobal('localStorage', storageStub);
  vi.stubGlobal('sessionStorage', storageStub);
  // mock-db 内部 emit* 函数会调 window.dispatchEvent（仅在有 window 时）。
  // node 没 window，stub 一个最小实现避免 ReferenceError。
  vi.stubGlobal('window', { dispatchEvent: () => undefined });
  storageStub.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import { mockDb } from '../data/mock-db';
import type { Continuation, ContinuationDraft } from '../types/play';

const CONTINUATION_KEY = 'mini-theater.continuations';
const REVIEW_LOG_KEY = 'mini-theater.continuation-review-logs';
const PLAY_KEY = 'mini-theater.plays';

const seedContinuation = (overrides: Partial<Continuation> = {}): Continuation => ({
  id: 'cont_x',
  playId: 'p1',
  nickname: 'alice',
  visitorId: 'v1',
  summary: 'sum',
  content: 'content',
  status: 'approved',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...overrides,
});

const seedPlay = (id: string, status: 'approved' | 'pending' | 'rejected' = 'approved') => ({
  id,
  title: `title-${id}`,
  authorName: 'bob',
  category: 'cat',
  summary: 'sum',
  content: 'content',
  status,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  reviewedAt: status === 'approved' ? '2026-01-01T00:00:00.000Z' : null,
  reviewNote: null,
  submissionType: 'original' as const,
  parentPlayId: null,
});

const setStored = <T>(key: string, value: T) => localStorage.setItem(key, JSON.stringify(value));

describe('mockDb.continuations 业务规则', () => {
  describe('getContinuationsByPlayId', () => {
    it('按 playId 过滤 + 排除 deletedAt', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [
        seedContinuation({ id: 'a', playId: 'p1' }),
        seedContinuation({ id: 'b', playId: 'p2' }),
        seedContinuation({ id: 'c', playId: 'p1', deletedAt: '2026-02-01T00:00:00.000Z' }),
      ]);

      const result = mockDb.getContinuationsByPlayId('p1', 'asc');

      expect(result.map((c) => c.id)).toEqual(['a']);
    });

    it('order=desc 按 createdAt 倒序', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [
        seedContinuation({ id: 'old', playId: 'p1', createdAt: '2026-01-01T00:00:00.000Z' }),
        seedContinuation({ id: 'new', playId: 'p1', createdAt: '2026-02-01T00:00:00.000Z' }),
      ]);

      const result = mockDb.getContinuationsByPlayId('p1', 'desc');

      expect(result.map((c) => c.id)).toEqual(['new', 'old']);
    });
  });

  describe('getMyContinuations', () => {
    it('只返回当前 visitor 的续写（含各种状态）', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [
        seedContinuation({ id: 'a', visitorId: 'v1' }),
        seedContinuation({ id: 'b', visitorId: 'v2' }),
        seedContinuation({ id: 'c', visitorId: 'v1', status: 'rejected' }),
      ]);

      const result = mockDb.getMyContinuations('v1', 'asc');

      expect(result.map((c) => c.id).sort()).toEqual(['a', 'c']);
    });
  });

  describe('getReceivedContinuations', () => {
    it('approved/rejected + 非自己写 + playId 命中 才算"收到"', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [
        // 命中：approved、别人写、p1 命中
        seedContinuation({ id: 'a', playId: 'p1', visitorId: 'someone-else', status: 'approved' }),
        // 不算：pending（未审）
        seedContinuation({ id: 'b', playId: 'p1', visitorId: 'someone-else', status: 'pending' }),
        // 不算：自己写的
        seedContinuation({ id: 'c', playId: 'p1', visitorId: 'v1', status: 'approved' }),
        // 不算：playId 不在入参里
        seedContinuation({ id: 'd', playId: 'p2', visitorId: 'someone-else', status: 'approved' }),
      ]);

      const result = mockDb.getReceivedContinuations(['p1'], 'v1', 'asc');

      expect(result.map((c) => c.id)).toEqual(['a']);
    });

    it('没有 playIds 时返回空（即使 visitorId 也不为空）', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [seedContinuation({ id: 'a' })]);

      const result = mockDb.getReceivedContinuations([], 'v1', 'asc');

      expect(result).toEqual([]);
    });
  });

  describe('createContinuation', () => {
    it('play 不存在时抛 "小剧场不存在"', () => {
      localStorage.clear();
      expect(() =>
        mockDb.createContinuation({
          playId: 'missing',
          visitorId: 'v1',
          nickname: '',
          summary: 's',
          content: 'c',
        } as ContinuationDraft),
      ).toThrow('小剧场不存在');
    });

    it('play 存在时写入新续写，status 默认 pending', () => {
      setStored(PLAY_KEY, [seedPlay('p1')]);

      const created = mockDb.createContinuation({
        playId: 'p1',
        visitorId: 'v1',
        nickname: 'alice',
        summary: 'sum',
        content: 'content',
      });

      expect(created.status).toBe('pending');
      expect(created.playId).toBe('p1');
      expect(created.id).toMatch(/^cont_/);

      const stored = JSON.parse(localStorage.getItem(CONTINUATION_KEY) ?? '[]');
      expect(stored).toHaveLength(1);
    });
  });

  describe('updateContinuationByAuthor', () => {
    it('visitorId 不匹配时抛 "只有原作者才能修改这条续写"', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [seedContinuation({ id: 'a', visitorId: 'v1' })]);

      expect(() => mockDb.updateContinuationByAuthor('a', 'v2', { summary: 'new' })).toThrow(
        '只有原作者才能修改这条续写',
      );
    });

    it('visitorId 匹配时把改动写到 pendingDraft* 字段，主字段不变', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [
        seedContinuation({ id: 'a', visitorId: 'v1', content: 'old', status: 'approved' }),
      ]);

      const updated = mockDb.updateContinuationByAuthor('a', 'v1', {
        summary: 'new-sum',
        content: 'new-content',
      });

      // 主字段保持原状，pendingDraft 收到新值
      expect(updated.content).toBe('old');
      expect(updated.summary).toBe('sum');
      expect(updated.pendingDraftContent).toBe('new-content');
      expect(updated.pendingDraftSummary).toBe('new-sum');
    });
  });

  describe('reviewContinuation', () => {
    it('id 不存在返回 null', () => {
      expect(mockDb.reviewContinuation('missing', 'approve', '')).toBeNull();
    });

    it('approve 把 status 设为 approved 并写 lastApproved*', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [
        seedContinuation({ id: 'a', status: 'pending', content: 'new' }),
      ]);

      const reviewed = mockDb.reviewContinuation('a', 'approve', 'lgtm');

      expect(reviewed?.status).toBe('approved');
      expect(reviewed?.lastApprovedContent).toBe('new');
      expect(reviewed?.reviewNote).toBe('lgtm');
    });

    it('approve 时把 pendingDraft* 升级为主字段并清空 pendingDraft*', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [
        seedContinuation({
          id: 'a',
          status: 'approved',
          content: 'old',
          summary: 'old-sum',
          pendingDraftContent: 'drafted',
          pendingDraftSummary: 'drafted-sum',
        }),
      ]);

      const reviewed = mockDb.reviewContinuation('a', 'approve', '');

      expect(reviewed?.content).toBe('drafted');
      expect(reviewed?.summary).toBe('drafted-sum');
      expect(reviewed?.pendingDraftContent).toBeUndefined();
    });

    it('reject 把 status 设为 rejected，同时清空 pendingDraft*', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [
        seedContinuation({
          id: 'a',
          status: 'pending',
          pendingDraftContent: 'drafted',
        }),
      ]);

      const reviewed = mockDb.reviewContinuation('a', 'reject', 'no');

      expect(reviewed?.status).toBe('rejected');
      expect(reviewed?.pendingDraftContent).toBeUndefined(); // 不留痕迹
    });

    it('审核动作追加到 audit log', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [seedContinuation({ id: 'a' })]);

      mockDb.reviewContinuation('a', 'approve', 'note');

      const logs = JSON.parse(localStorage.getItem(REVIEW_LOG_KEY) ?? '[]');
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        continuationId: 'a',
        action: 'approve',
        note: 'note',
      });
    });
  });

  describe('updateContinuationByAdmin', () => {
    it('id 不存在返回 null', () => {
      expect(mockDb.updateContinuationByAdmin('missing', { content: 'x' })).toBeNull();
    });

    it('content 字段会被 trim', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [seedContinuation({ id: 'a' })]);

      const updated = mockDb.updateContinuationByAdmin('a', { content: '  trimmed  ' });

      expect(updated?.content).toBe('trimmed');
    });

    it('编辑动作追加到 audit log（action=edit）', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [seedContinuation({ id: 'a' })]);

      mockDb.updateContinuationByAdmin('a', { content: 'edited' });

      const logs = JSON.parse(localStorage.getItem(REVIEW_LOG_KEY) ?? '[]');
      expect(logs[0]).toMatchObject({ continuationId: 'a', action: 'edit' });
    });
  });

  describe('deleteContinuation', () => {
    it('id 不存在返回 false', () => {
      expect(mockDb.deleteContinuation('missing')).toBe(false);
    });

    it('软删除：写 deletedAt + 追加 audit log', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [seedContinuation({ id: 'a' })]);

      const ok = mockDb.deleteContinuation('a');

      expect(ok).toBe(true);
      const stored = JSON.parse(localStorage.getItem(CONTINUATION_KEY) ?? '[]');
      expect(stored[0].deletedAt).toBeTruthy();
      const logs = JSON.parse(localStorage.getItem(REVIEW_LOG_KEY) ?? '[]');
      expect(logs[0]).toMatchObject({ continuationId: 'a', action: 'delete' });
    });
  });

  describe('getAdminContinuations', () => {
    it('按 updatedAt 倒序', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [
        seedContinuation({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }),
        seedContinuation({ id: 'new', updatedAt: '2026-02-01T00:00:00.000Z' }),
      ]);

      const result = mockDb.getAdminContinuations();

      expect(result.map((c) => c.id)).toEqual(['new', 'old']);
    });

    it("status='pending' 包含真正 pending + 有 pendingDraft 的 approved", () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [
        seedContinuation({ id: 'pure-pending', status: 'pending' }),
        seedContinuation({
          id: 'approved-with-draft',
          status: 'approved',
          pendingDraftContent: 'drafted',
        }),
        seedContinuation({ id: 'pure-approved', status: 'approved' }),
      ]);

      const result = mockDb.getAdminContinuations('pending');

      expect(result.map((c) => c.id).sort()).toEqual(['approved-with-draft', 'pure-pending']);
    });
  });

  describe('getContinuationCounts', () => {
    it('只统计 status=approved 且 playId 在入参集合内的', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [
        seedContinuation({ id: 'a', playId: 'p1', status: 'approved' }),
        seedContinuation({ id: 'b', playId: 'p1', status: 'pending' }),
        seedContinuation({ id: 'c', playId: 'p2', status: 'approved' }),
      ]);

      const result = mockDb.getContinuationCounts(['p1']);

      expect(result[0]?.playId).toBe('p1');
      expect(result[0]?.count).toBe(1);
    });

    it('返回 firstCreatedAt / lastCreatedAt 区间', () => {
      setStored<Continuation[]>(CONTINUATION_KEY, [
        seedContinuation({ id: 'old', playId: 'p1', createdAt: '2026-01-01T00:00:00.000Z' }),
        seedContinuation({ id: 'new', playId: 'p1', createdAt: '2026-02-01T00:00:00.000Z' }),
      ]);

      const result = mockDb.getContinuationCounts(['p1']);

      expect(result[0]).toMatchObject({
        playId: 'p1',
        count: 2,
        firstCreatedAt: '2026-01-01T00:00:00.000Z',
        lastCreatedAt: '2026-02-01T00:00:00.000Z',
      });
    });
  });
});
