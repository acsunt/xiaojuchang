/**
 * admin-repos 切片 —— 管理员对 repo 的所有操作。
 *
 * 覆盖 4 个方法：
 *   - getAdminRepos / reviewRepo / updateRepo / deleteRepo
 *   - deleteRejectedReposByVisitor / getAllRepoAuditLogs
 */
import { describe, expect, it } from 'vitest';
import { setupPlayApiTest } from './helpers/play-api-test';

const { importApi, fetchMock } = setupPlayApiTest();

describe('playApi.adminRepos', () => {
  it('getAdminRepos 不带 status 时不加 query string', async () => {
    const playApi = await importApi();

    await playApi.getAdminRepos();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/repos');
  });

  it('getAdminRepos 带 status 时拼上 ?status=', async () => {
    const playApi = await importApi();

    await playApi.getAdminRepos('rejected');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/repos?status=rejected');
  });

  it('reviewRepo 用 POST /api/admin/repos/<id> + body', async () => {
    const playApi = await importApi();

    await playApi.reviewRepo('r1', 'approve', 'lgtm');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/repos/r1');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      action: 'approve',
      note: 'lgtm',
    });
  });

  it('updateRepo 用 PATCH /api/admin/repos/<id>', async () => {
    const playApi = await importApi();

    await playApi.updateRepo('r1', { content: 'edited', note: 'admin note' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/repos/r1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({
      content: 'edited',
      note: 'admin note',
    });
  });

  it('deleteRepo 用 DELETE /api/admin/repos/<id>', async () => {
    const playApi = await importApi();

    await playApi.deleteRepo('r1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/repos/r1');
    expect(init?.method).toBe('DELETE');
  });

  it('deleteRejectedReposByVisitor 用 DELETE + visitorId 作为 query string', async () => {
    const playApi = await importApi();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ deletedCount: 3 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const count = await playApi.deleteRejectedReposByVisitor('v/1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/repos/mine/rejected?visitorId=v%2F1');
    expect(init?.method).toBe('DELETE');
    expect(count).toBe(3);
  });

  it('getAllRepoAuditLogs 用 GET /api/admin/review-logs/repos', async () => {
    const playApi = await importApi();

    await playApi.getAllRepoAuditLogs();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/review-logs/repos');
  });
});
