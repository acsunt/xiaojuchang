/**
 * plays-public 切片 —— 公开面向游客的 play / tag / site-settings 接口。
 *
 * 覆盖 7 个方法：
 *   - getPublicPlays / getPublicPlayById
 *   - getTags / getSiteSettings
 *   - getSubmissionFeedback
 */
import { describe, expect, it } from 'vitest';
import { setupPlayApiTest } from './helpers/play-api-test';

const { importApi, fetchMock } = setupPlayApiTest();

describe('playApi.playsPublic', () => {
  it('getPublicPlays 用 GET /api/plays', async () => {
    const playApi = await importApi();

    await playApi.getPublicPlays();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/plays');
    expect(init?.method).toBeUndefined(); // 默认 GET
  });

  it('getPublicPlayById 用 GET /api/plays/<id>', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'p1', summary: 's' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const playApi = await importApi();

    await playApi.getPublicPlayById('p1');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/plays/p1');
  });

  it('getPublicPlayById 在 id 包含特殊字符时不做编码（约定 id 不含 / ? &）', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'abc-123', summary: 's' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const playApi = await importApi();

    await playApi.getPublicPlayById('abc-123');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/plays/abc-123');
  });

  it('getTags 用 GET /api/tags', async () => {
    const playApi = await importApi();

    await playApi.getTags();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tags');
  });

  it('getSiteSettings 用 GET /api/site-settings', async () => {
    const playApi = await importApi();

    await playApi.getSiteSettings();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/site-settings');
  });

  it('getSubmissionFeedback 在 ids 全空时短路不发请求', async () => {
    const playApi = await importApi();

    const result = await playApi.getSubmissionFeedback(['', '   ']);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getSubmissionFeedback 去重 + trim 后走 POST', async () => {
    const playApi = await importApi();

    await playApi.getSubmissionFeedback([' p1 ', 'p1', '', 'p2']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/plays/feedback');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      ids: ['p1', 'p2'], // 去重 + 去空
    });
  });
});
