/**
 * admin-meta 切片 —— tags / site-settings / 备份 / 通知 / 续写审计日志。
 *
 * 覆盖 8 个方法：
 *   - getAdminTags / createAdminTag / updateAdminTag / reorderAdminTags / deleteAdminTag
 *   - getAdminSiteSettings / updateAdminSiteSettings
 *   - restoreAdminBackup
 *   - getNotificationSummary
 *   - getAllContinuationAuditLogs
 */
import { describe, expect, it } from 'vitest';
import { setupPlayApiTest } from './helpers/play-api-test';

const { importApi, fetchMock } = setupPlayApiTest();

describe('playApi.adminMeta', () => {
  it('getAdminTags 用 GET /api/admin/tags', async () => {
    const playApi = await importApi();

    await playApi.getAdminTags();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/tags');
  });

  it('createAdminTag 用 POST /api/admin/tags + draft 作为 body', async () => {
    const playApi = await importApi();

    await playApi.createAdminTag({ name: 'new-tag' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/tags');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ name: 'new-tag' });
  });

  it('updateAdminTag 用 PUT /api/admin/tags/<id>', async () => {
    const playApi = await importApi();

    await playApi.updateAdminTag('t1', { name: 'renamed' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/tags/t1');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ name: 'renamed' });
  });

  it('reorderAdminTags 用 POST /api/admin/tags/reorder + orderedIds 作为 body', async () => {
    const playApi = await importApi();

    await playApi.reorderAdminTags(['t1', 't2', 't3']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/tags/reorder');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ orderedIds: ['t1', 't2', 't3'] });
  });

  it('deleteAdminTag 用 DELETE /api/admin/tags/<id>', async () => {
    const playApi = await importApi();

    await playApi.deleteAdminTag('t1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/tags/t1');
    expect(init?.method).toBe('DELETE');
  });

  it('getAdminSiteSettings 用 GET /api/admin/site-settings', async () => {
    const playApi = await importApi();

    await playApi.getAdminSiteSettings();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/site-settings');
  });

  it('updateAdminSiteSettings 用 PUT /api/admin/site-settings + settings 作为 body', async () => {
    const playApi = await importApi();

    const settings = { light: {}, dark: {} };
    await playApi.updateAdminSiteSettings(settings as never);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/site-settings');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual(settings);
  });

  it('restoreAdminBackup 用 POST /api/admin/backup + plays 作为 body', async () => {
    const playApi = await importApi();

    const plays = [{ id: 'p1', title: 't' }];
    await playApi.restoreAdminBackup(plays as never);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/backup');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ plays });
  });

  it('getNotificationSummary 走 POST /api/notification-summary + 去重后的 playIds', async () => {
    const playApi = await importApi();

    await playApi.getNotificationSummary('2026-01-01T00:00:00.000Z', 'v1', [
      ' p1 ',
      'p1',
      '',
      'p2',
    ]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/notification-summary');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      since: '2026-01-01T00:00:00.000Z',
      visitorId: 'v1',
      playIds: ['p1', 'p2'],
    });
  });

  it('getAllContinuationAuditLogs 用 GET /api/admin/review-logs/continuations', async () => {
    const playApi = await importApi();

    await playApi.getAllContinuationAuditLogs();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/review-logs/continuations');
  });
});
