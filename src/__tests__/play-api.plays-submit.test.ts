/**
 * plays-submit 切片 —— 游客侧 play 投稿 / 修改 / 待审修改列表。
 *
 * 覆盖 3 个方法：
 *   - uploadPlay / submitPlayEdit / getPendingModifyPlays
 */
import { describe, expect, it } from 'vitest';
import { setupPlayApiTest } from './helpers/play-api-test';

const { importApi, fetchMock } = setupPlayApiTest();

describe('playApi.playsSubmit', () => {
  it('uploadPlay 用 POST /api/plays + draft 作为 body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'p1', summary: 's' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const playApi = await importApi();

    const draft = {
      title: 't',
      authorName: 'a',
      category: 'c',
      summary: 's',
      content: 'c',
      submissionType: 'original' as const,
    };
    await playApi.uploadPlay(draft);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/plays');
    expect(init?.method).toBe('POST');
    // normalizePlayDraft 会补上 submissionType 和 trim 后的 category。
    expect(JSON.parse(init?.body as string)).toEqual({
      ...draft,
      category: 'c',
      submissionType: 'original',
    });
  });

  it('submitPlayEdit 用 PUT /api/plays/<parentPlayId>', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'p1', summary: 's' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const playApi = await importApi();

    await playApi.submitPlayEdit('parent/1', {
      title: 't',
      category: 'c',
      summary: 's',
      content: 'c',
      authorName: 'a',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/plays/parent%2F1');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({
      title: 't',
      category: 'c',
      summary: 's',
      content: 'c',
      authorName: 'a',
    });
  });

  it('getPendingModifyPlays 用 GET /api/admin/plays/pending-edits', async () => {
    const playApi = await importApi();

    await playApi.getPendingModifyPlays();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/plays/pending-edits');
  });
});
