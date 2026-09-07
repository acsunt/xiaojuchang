/**
 * repos 切片 —— 公开面向游客的 repo 评论接口。
 *
 * 覆盖 5 个方法：
 *   - getReposByPlayId / getMyRepos / getReceivedRepos / createRepo
 *   - getRepoCounts / getRepoNoticeSummary
 */
import { describe, expect, it } from 'vitest';
import { setupPlayApiTest } from './helpers/play-api-test';

const { importApi, fetchMock } = setupPlayApiTest();

describe('playApi.repos', () => {
  it('getReposByPlayId 用 GET + URL 编码', async () => {
    const playApi = await importApi();

    await playApi.getReposByPlayId('p/1', 'desc');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/repos?playId=p%2F1&order=desc');
  });

  it('getMyRepos 在 visitorId 空字符串时短路', async () => {
    const playApi = await importApi();

    const result = await playApi.getMyRepos('', 'asc');

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getMyRepos 传 visitorId 时走 GET', async () => {
    const playApi = await importApi();

    await playApi.getMyRepos('v1', 'asc');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/repos?visitorId=v1&order=asc');
  });

  it('getReceivedRepos 在 playIds 和 visitorId 都空时短路', async () => {
    const playApi = await importApi();

    const result = await playApi.getReceivedRepos([], '  ', 'asc');

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getReceivedRepos 走 POST + body 三字段', async () => {
    const playApi = await importApi();

    await playApi.getReceivedRepos([' p1 ', 'p1'], ' v1 ', 'desc');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/repos');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      mode: 'received',
      playIds: ['p1'],
      visitorId: 'v1',
      order: 'desc',
    });
  });

  it('createRepo 用 POST /api/repos + draft 原样作为 body', async () => {
    const playApi = await importApi();

    const draft = {
      playId: 'p1',
      nickname: 'n',
      visitorId: 'v1',
      content: 'c',
    };
    await playApi.createRepo(draft);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/repos');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(draft);
  });

  it('getRepoCounts 在空数组时短路', async () => {
    const playApi = await importApi();

    const result = await playApi.getRepoCounts([]);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getRepoCounts 非空时走 POST /api/repos/counts', async () => {
    const playApi = await importApi();

    await playApi.getRepoCounts(['p1', 'p2']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/repos/counts');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ playIds: ['p1', 'p2'] });
  });

  it('getRepoNoticeSummary 在 playIds 和 visitorId 都空时返回零计数', async () => {
    const playApi = await importApi();

    const result = await playApi.getRepoNoticeSummary([], '', '2026-01-01T00:00:00.000Z');

    expect(result).toEqual({ receivedCount: 0, unreadCount: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getRepoNoticeSummary 走 POST /api/repos/counts + body 四字段', async () => {
    const playApi = await importApi();

    await playApi.getRepoNoticeSummary([' p1 ', 'p1'], ' v1 ', '2026-01-01T00:00:00.000Z');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/repos/counts');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      playIds: ['p1'],
      visitorId: 'v1',
      readAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
