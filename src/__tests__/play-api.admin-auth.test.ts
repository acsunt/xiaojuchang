/**
 * admin-auth 切片 —— 管理员登录 / 会话 / 登出。
 *
 * 覆盖 3 个方法：
 *   - adminLogin / getAdminSession / logoutAdmin
 *
 * 注意点：
 *   - adminLogin 会把 session 写进 localStorage
 *   - getAdminSession 没有 session 时不发请求、直接返回 null
 *   - logoutAdmin 即使服务端失败也会清 localStorage
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPlayApiTest } from './helpers/play-api-test';

const { importApi, fetchMock } = setupPlayApiTest();

describe('playApi.adminAuth', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('adminLogin 用 POST /api/admin/login + body', async () => {
    const playApi = await importApi();

    await playApi.adminLogin('alice', 'secret');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/login');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      username: 'alice',
      password: 'secret',
    });
  });

  it('adminLogin 把返回的 session 写进 localStorage', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          token: 'tok-123',
          username: 'alice',
          expiresAt: '2026-12-31T00:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const playApi = await importApi();

    const session = await playApi.adminLogin('alice', 'secret');

    expect(session.token).toBe('tok-123');
    expect(localStorage.getItem('mini-theater.remote-admin-session')).not.toBeNull();
  });

  it('getAdminSession 在没有本地 session 时直接返回 null，不发请求', async () => {
    const playApi = await importApi();

    const session = await playApi.getAdminSession();

    expect(session).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getAdminSession 有本地 session 时 GET /api/admin/login 刷新', async () => {
    localStorage.setItem(
      'mini-theater.remote-admin-session',
      JSON.stringify({ token: 'old', username: 'alice', expiresAt: '2099-01-01T00:00:00.000Z' }),
    );

    const playApi = await importApi();
    await playApi.getAdminSession();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/login');
    expect(init?.method).toBe('GET');
  });

  it('logoutAdmin 总是清掉 localStorage（即使 fetch 抛错）', async () => {
    localStorage.setItem(
      'mini-theater.remote-admin-session',
      JSON.stringify({ token: 'tok', username: 'alice', expiresAt: '2099-01-01T00:00:00.000Z' }),
    );
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const playApi = await importApi();
    await expect(playApi.logoutAdmin()).rejects.toThrow('network down');

    expect(localStorage.getItem('mini-theater.remote-admin-session')).toBeNull();
  });

  it('logoutAdmin 正常路径走 POST /api/admin/logout', async () => {
    const playApi = await importApi();

    await playApi.logoutAdmin();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/logout');
    expect(init?.method).toBe('POST');
  });
});
