/**
 * admin-plays 切片 —— 管理员对 play 的所有操作。
 *
 * 覆盖 6 个方法：
 *   - getAdminPlays / getAdminPlayById
 *   - reviewPlay / updateAdminPlay / bulkReviewPlays
 *   - deleteAdminPlay / clearReviewLogs
 *   - getReviewLogs / getAllPlayReviewLogs
 */
import { describe, expect, it } from 'vitest';
import { setupPlayApiTest } from './helpers/play-api-test';

const { importApi, fetchMock } = setupPlayApiTest();

describe('playApi.adminPlays', () => {
  it('getAdminPlays 不带 status 时不加 query string', async () => {
    const playApi = await importApi();

    await playApi.getAdminPlays();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/plays');
  });

  it('getAdminPlays 带 status 时拼上 ?status=', async () => {
    const playApi = await importApi();

    await playApi.getAdminPlays('pending');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/plays?status=pending');
  });

  it('getAdminPlayById 用 GET /api/admin/plays/<id>', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'p1', summary: 's' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const playApi = await importApi();

    await playApi.getAdminPlayById('p1');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/plays/p1');
  });

  it('reviewPlay 用 POST /api/admin/plays/<id>/review + action/note/edit 拼成 body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'p1', summary: 's' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const playApi = await importApi();

    await playApi.reviewPlay('p1', 'approve', 'lgtm', {
      title: 't',
      authorName: 'a',
      category: 'c',
      summary: 's',
      content: 'c',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/plays/p1/review');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      action: 'approve',
      note: 'lgtm',
      title: 't',
      authorName: 'a',
      category: 'c',
      summary: 's',
      content: 'c',
    });
  });

  it('reviewPlay 不传 edit 时 edit 字段都是 undefined（key 仍存在）', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'p1', summary: 's' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const playApi = await importApi();

    await playApi.reviewPlay('p1', 'reject', 'no');

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      action: 'reject',
      note: 'no',
      title: undefined,
      authorName: undefined,
      category: undefined,
      summary: undefined,
      content: undefined,
    });
  });

  it('updateAdminPlay 用 PUT /api/admin/plays/<id>', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'p1', summary: 's' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const playApi = await importApi();

    await playApi.updateAdminPlay('p1', { title: 'new' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/plays/p1');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ title: 'new' });
  });

  it('bulkReviewPlays 在 ids 全空时短路不发请求', async () => {
    const playApi = await importApi();

    const result = await playApi.bulkReviewPlays(['', '  '], 'approve', 'note');

    expect(result).toEqual({
      action: 'approve',
      updatedIds: [],
      skippedIds: [],
      updatedCount: 0,
      skippedCount: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bulkReviewPlays 走 POST /api/admin/bulk-review + ids 经过去重去空', async () => {
    const playApi = await importApi();

    await playApi.bulkReviewPlays([' p1 ', 'p1', '', 'p2'], 'reject', 'spam');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/bulk-review');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      ids: ['p1', 'p2'],
      action: 'reject',
      note: 'spam',
    });
  });

  it('deleteAdminPlay 用 DELETE /api/admin/plays/<id>', async () => {
    const playApi = await importApi();

    await playApi.deleteAdminPlay('p1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/plays/p1');
    expect(init?.method).toBe('DELETE');
  });

  it('clearReviewLogs 用 DELETE /api/admin/plays/<id>/logs', async () => {
    const playApi = await importApi();

    await playApi.clearReviewLogs('p1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/plays/p1/logs');
    expect(init?.method).toBe('DELETE');
  });

  it('getReviewLogs 用 GET /api/admin/plays/<id>/logs', async () => {
    const playApi = await importApi();

    await playApi.getReviewLogs('p1');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/plays/p1/logs');
  });

  it('getAllPlayReviewLogs 用 GET /api/admin/review-logs/plays', async () => {
    const playApi = await importApi();

    await playApi.getAllPlayReviewLogs();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/review-logs/plays');
  });
});
