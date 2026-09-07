/**
 * continuations 切片 —— play-api.ts 中所有以 Continuation 命名的方法。
 *
 * 覆盖的 10 个方法：
 *   - getContinuationsByPlayId / getMyContinuations / getReceivedContinuations
 *   - createContinuation / updateContinuationByAuthor
 *   - getContinuationCounts / getAdminContinuations
 *   - reviewContinuation / updateContinuationByAdmin / deleteContinuation
 *
 * 历史回归守卫：
 *   - deleteContinuation 必须是 DELETE /api/continuations/<id>，不能退回 ?id=xxx
 *   - reviewContinuation 用 POST 同路径（action/note 走 body）
 *   - updateContinuationByAuthor 用 PUT 同路径
 *   - updateContinuationByAdmin 用 PATCH 同路径
 */
import { describe, expect, it } from 'vitest';
import { setupPlayApiTest } from './helpers/play-api-test';

const { importApi, fetchMock } = setupPlayApiTest();

describe('playApi.continuations', () => {
  it('getContinuationsByPlayId 用 GET + URL 编码 + order 默认 asc', async () => {
    const playApi = await importApi();

    await playApi.getContinuationsByPlayId('play/1 & 2', 'asc');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/continuations?playId=play%2F1%20%26%202&order=asc');
    expect(init?.method).toBeUndefined(); // 默认 GET
  });

  it('getMyContinuations 在 visitorId 为空时短路不发请求', async () => {
    const playApi = await importApi();

    const result = await playApi.getMyContinuations('   ', 'desc');

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getMyContinuations 传 visitorId 时走 GET', async () => {
    const playApi = await importApi();

    await playApi.getMyContinuations('visitor-1', 'desc');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/continuations?visitorId=visitor-1&order=desc');
  });

  it('getReceivedContinuations 在 playIds 和 visitorId 都空时短路', async () => {
    const playApi = await importApi();

    const result = await playApi.getReceivedContinuations([], '', 'asc');

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getReceivedContinuations 走 POST + body 三字段', async () => {
    const playApi = await importApi();

    await playApi.getReceivedContinuations([' p1 ', 'p1', ''], ' v1 ', 'desc');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/continuations');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      mode: 'received',
      playIds: ['p1'], // dedupe + trim + 去空
      visitorId: 'v1', // trim
      order: 'desc',
    });
  });

  it('createContinuation 用 POST + 原样 draft 作为 body', async () => {
    const playApi = await importApi();

    const draft = {
      playId: 'p1',
      visitorId: 'v1',
      nickname: 'n',
      summary: 's',
      content: 'c',
    };
    await playApi.createContinuation(draft);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/continuations');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(draft);
  });

  it('updateContinuationByAuthor 用 PUT + visitorId 拼到 body 前面', async () => {
    const playApi = await importApi();

    await playApi.updateContinuationByAuthor('cont-1', 'visitor-1', {
      summary: 's',
      content: 'c',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/continuations/cont-1');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({
      visitorId: 'visitor-1',
      summary: 's',
      content: 'c',
    });
  });

  it('getContinuationCounts 在空数组时短路', async () => {
    const playApi = await importApi();

    const result = await playApi.getContinuationCounts([]);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getContinuationCounts 非空时走 POST /api/continuations/counts', async () => {
    const playApi = await importApi();

    await playApi.getContinuationCounts(['p1', 'p2']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/continuations/counts');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ playIds: ['p1', 'p2'] });
  });

  it('getAdminContinuations 不带 status 时不加 query string', async () => {
    const playApi = await importApi();

    await playApi.getAdminContinuations();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/continuations');
  });

  it('getAdminContinuations 带 status 时拼上 ?status=', async () => {
    const playApi = await importApi();

    await playApi.getAdminContinuations('pending');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/continuations?status=pending');
  });

  it('reviewContinuation 用 POST + body 传 action/note', async () => {
    const playApi = await importApi();

    await playApi.reviewContinuation('cont-1', 'approve', 'lgtm');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/continuations/cont-1');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      action: 'approve',
      note: 'lgtm',
    });
  });

  it('updateContinuationByAdmin 用 PATCH', async () => {
    const playApi = await importApi();

    await playApi.updateContinuationByAdmin('cont-1', { content: 'edited' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/continuations/cont-1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ content: 'edited' });
  });

  it('deleteContinuation 调用 DELETE /api/continuations/<id>', async () => {
    const playApi = await importApi();

    await playApi.deleteContinuation('abc 123/&?');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/continuations/abc%20123%2F%26%3F');
    expect(init?.method).toBe('DELETE');
  });

  it('deleteContinuation 在 4xx 时抛出含 message 的 Error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: '续写不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const playApi = await importApi();

    await expect(playApi.deleteContinuation('missing')).rejects.toThrow('续写不存在');
  });
});
