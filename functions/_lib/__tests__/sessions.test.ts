// covers sessions.ts：createAdminSession / getAdminSessionFromRequest / deleteAdminSession。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdminSession, deleteAdminSession, getAdminSessionFromRequest } from '../db';
import { ADMIN_SESSIONS_SCHEMA_SQL, createTestD1 } from './test-d1';

const makeRequest = (token?: string) =>
  new Request('https://example.com/api/admin/x', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

describe('sessions 读写函数', () => {
  let db: ReturnType<typeof createTestD1>;

  beforeEach(() => {
    db = createTestD1();
    db.sqlite.exec(ADMIN_SESSIONS_SCHEMA_SQL);
  });

  it('createAdminSession 生成 token 并写入 7 天后过期的会话', async () => {
    const session = await createAdminSession(db, 'admin');

    expect(session.username).toBe('admin');
    expect(session.token).toBeTruthy();

    const row = db.sqlite
      .prepare('SELECT * FROM admin_sessions WHERE token = ?')
      .get(session.token) as any;
    expect(row).toBeTruthy();
    expect(row.username).toBe('admin');
  });

  it('getAdminSessionFromRequest 对没有 Authorization 头的请求返回 null', async () => {
    expect(await getAdminSessionFromRequest(db, makeRequest())).toBeNull();
  });

  it('getAdminSessionFromRequest 对不存在的 token 返回 null', async () => {
    expect(await getAdminSessionFromRequest(db, makeRequest('not-a-real-token'))).toBeNull();
  });

  it('getAdminSessionFromRequest 对有效 token 返回会话信息', async () => {
    const session = await createAdminSession(db, 'admin');
    const found = await getAdminSessionFromRequest(db, makeRequest(session.token));

    expect(found?.username).toBe('admin');
    expect(found?.token).toBe(session.token);
  });

  it('getAdminSessionFromRequest 对已过期的 token 返回 null，并顺带清理这条记录', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const session = await createAdminSession(db, 'admin');

    vi.setSystemTime(new Date('2026-01-09T00:00:00.000Z')); // 超过 7 天有效期
    const found = await getAdminSessionFromRequest(db, makeRequest(session.token));
    expect(found).toBeNull();

    const row = db.sqlite
      .prepare('SELECT * FROM admin_sessions WHERE token = ?')
      .get(session.token);
    expect(row).toBeFalsy();
    vi.useRealTimers();
  });

  it('deleteAdminSession 删除对应 token 的会话，重复删除不报错', async () => {
    const session = await createAdminSession(db, 'admin');

    await deleteAdminSession(db, makeRequest(session.token));
    expect(await getAdminSessionFromRequest(db, makeRequest(session.token))).toBeNull();

    // 再次删除同一个已不存在的 token，不应抛错
    await expect(deleteAdminSession(db, makeRequest(session.token))).resolves.toBeUndefined();
  });

  it('deleteAdminSession 对没有 Authorization 头的请求直接忽略', async () => {
    await expect(deleteAdminSession(db, makeRequest())).resolves.toBeUndefined();
  });
});
