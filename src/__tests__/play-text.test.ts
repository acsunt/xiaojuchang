/**
 * play-text.ts 纯函数切片 —— 文本解析 / 序列化 / 批量上传相关。
 *
 * 这些是 Node 可直接 import 跑的纯函数（没有 DOM / fetch 依赖），无需 setup。
 *
 * 覆盖：
 *   - normalizeImportedSummary（占位符 → 空串）
 *   - detectPlayTitleFromContent（引号 / HTML 包裹标题识别）
 *   - countPlayBatchItems / serializePlaysToBatchText / parsePlayBatchText（往返）
 *   - parsePlayBatchText 的错误边界（缺 ###、缺 Title、空正文、空作者）
 *
 * 跳过：downloadTextFile / downloadBlobFile 涉及 DOM，不在冒烟范围。
 */
import { describe, expect, it } from 'vitest';
import {
  countPlayBatchItems,
  detectPlayTitleFromContent,
  normalizeImportedSummary,
  parsePlayBatchText,
  serializePlaysToBatchText,
  type ParsedPlayBatchItem,
} from '../services/play-text';

describe('play-text 纯函数', () => {
  describe('normalizeImportedSummary', () => {
    it('把占位符 "导入数据" 替换为空串', () => {
      expect(normalizeImportedSummary('导入数据')).toBe('');
    });

    it('把 "无简介" 替换为空串', () => {
      expect(normalizeImportedSummary('无简介')).toBe('');
    });

    it('保留正常简介并 trim', () => {
      expect(normalizeImportedSummary('  hello world  ')).toBe('hello world');
    });

    it('占位符比较前会先 trim', () => {
      expect(normalizeImportedSummary('  导入数据  ')).toBe('');
    });
  });

  describe('detectPlayTitleFromContent', () => {
    it('识别双引号包裹的标题', () => {
      expect(detectPlayTitleFromContent('"我的小剧场"\n\n正文内容')).toBe('我的小剧场');
    });

    it('识别中文「弯引号」包裹的标题', () => {
      expect(detectPlayTitleFromContent('"另一个标题"\n\n正文')).toBe('另一个标题');
    });

    it('识别首尾 <h>...</h> 包裹的标题', () => {
      expect(detectPlayTitleFromContent('<标题名>\n正文内容\n</标题名>')).toBe('标题名');
    });

    it('首尾标签不一致时返回空串', () => {
      expect(detectPlayTitleFromContent('<a>\n正文\n</b>')).toBe('');
    });

    it('空源返回空串', () => {
      expect(detectPlayTitleFromContent('')).toBe('');
      expect(detectPlayTitleFromContent('   ')).toBe('');
    });

    it('没有标题模式时返回空串', () => {
      expect(detectPlayTitleFromContent('普通正文\n没有标题')).toBe('');
    });

    it('引号和包裹标题同时存在时优先用引号（出现在前）', () => {
      expect(detectPlayTitleFromContent('"前面引号"\n正文\n</后面标签>')).toBe('前面引号');
    });
  });

  describe('countPlayBatchItems', () => {
    it('空源返回 0', () => {
      expect(countPlayBatchItems('')).toBe(0);
    });

    it('只有空白返回 0', () => {
      expect(countPlayBatchItems('   \n\n   ')).toBe(0);
    });

    it('按 ### + 空行 切出 1 段', () => {
      const text = '### Title: T\nCategory: C\nDesc: S\ncontent';
      expect(countPlayBatchItems(text)).toBe(1);
    });

    it('多段用空行分隔', () => {
      const text = [
        '### Title: A',
        'Category: CA',
        'Desc: SA',
        'content A',
        '',
        '### Title: B',
        'Category: CB',
        'Desc: SB',
        'content B',
      ].join('\n');
      expect(countPlayBatchItems(text)).toBe(2);
    });
  });

  describe('serializePlaysToBatchText + parsePlayBatchText 往返', () => {
    it('单个 play 序列化后能完整解析回来', () => {
      const play = {
        title: '我的小剧场',
        category: '科幻',
        summary: '简介内容',
        content: '正文第一行\n正文第二行',
      };

      const text = serializePlaysToBatchText([play]);
      const parsed = parsePlayBatchText(text, 'alice');

      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({
        markerTitle: play.title,
        authorName: 'alice',
        title: play.title,
        category: play.category,
        summary: play.summary,
        content: play.content,
      } satisfies ParsedPlayBatchItem);
    });

    it('多个 play 序列化后能完整解析回来（顺序保持）', () => {
      const plays = [
        { title: 'A', category: 'a-cat', summary: 'a-sum', content: 'a-content' },
        { title: 'B', category: 'b-cat', summary: 'b-sum', content: 'b-content' },
      ];

      const text = serializePlaysToBatchText(plays);
      const parsed = parsePlayBatchText(text, 'bob');

      expect(parsed.map((p) => p.title)).toEqual(['A', 'B']);
      expect(parsed.map((p) => p.content)).toEqual(['a-content', 'b-content']);
    });

    it('category 缺省时回退到 DEFAULT_CATEGORY ("未分类")', () => {
      const text = serializePlaysToBatchText([
        { title: 'T', category: '', summary: '', content: 'c' },
      ]);

      expect(parsePlayBatchText(text, 'alice')[0]?.category).toBe('未分类');
    });

    it('summary 为占位符 "导入数据" 时序列化为空串', () => {
      const text = serializePlaysToBatchText([
        { title: 'T', category: 'C', summary: '导入数据', content: 'c' },
      ]);

      expect(text).toContain('Desc: \n');
      expect(parsePlayBatchText(text, 'alice')[0]?.summary).toBe('');
    });

    it('title 为空时序列化为 "Untitled"', () => {
      const text = serializePlaysToBatchText([
        { title: '', category: 'C', summary: 'S', content: 'c' },
      ]);

      expect(text.startsWith('### Untitled')).toBe(true);
    });
  });

  describe('parsePlayBatchText 错误边界', () => {
    const validBlock = '### Title: T\nCategory: C\nDesc: S\n正文内容';

    it('authorName 为空时抛 "批量上传前先填写署名"', () => {
      expect(() => parsePlayBatchText(validBlock, '   ')).toThrow('批量上传前先填写署名');
    });

    it('authorName 为 undefined / null 也抛同样的错', () => {
      expect(() => parsePlayBatchText(validBlock, '')).toThrow('批量上传前先填写署名');
    });

    it('缺少 ### 标题头时报错并指出段号', () => {
      const bad = 'Title: T\nCategory: C\nDesc: S\ncontent';
      expect(() => parsePlayBatchText(bad, 'alice')).toThrow('第 1 段缺少 ### 标题头');
    });

    it('缺 Title: 字段时报错并指出段号', () => {
      const bad = '### M\nCategory: C\nDesc: S\ncontent';
      expect(() => parsePlayBatchText(bad, 'alice')).toThrow('第 1 段缺少 Title:');
    });

    it('正文为空时报错', () => {
      const bad = '### M\nTitle: T\nCategory: C\nDesc: S\n';
      expect(() => parsePlayBatchText(bad, 'alice')).toThrow('第 1 段的正文不能为空');
    });

    it('第二段缺 Title: 字段时报错要指明第 2 段', () => {
      const bad = [
        '### M1',
        'Title: T1',
        'Category: C',
        'Desc: S',
        'content 1',
        '',
        '### M2', // 有 ### 头但缺 Title:
        'Category: C',
        'Desc: S',
        'content 2',
      ].join('\n');
      expect(() => parsePlayBatchText(bad, 'alice')).toThrow('第 2 段缺少 Title:');
    });

    it('空源返回空数组（不抛错）', () => {
      expect(parsePlayBatchText('', 'alice')).toEqual([]);
    });
  });
});
