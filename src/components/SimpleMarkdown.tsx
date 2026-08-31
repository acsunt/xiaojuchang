import type { ReactNode } from 'react';

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'rule' }
  | { type: 'list'; items: Array<{ indent: number; text: string }> };

const renderInline = (text: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={`b-${key}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={`c-${key}`}>{token.slice(1, -1)}</code>);
    }

    key += 1;
    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
};

const parseMarkdown = (content: string): MarkdownBlock[] => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let listItems: Array<{ indent: number; text: string }> | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems || listItems.length === 0) {
      listItems = null;
      return;
    }

    blocks.push({ type: 'list', items: listItems });
    listItems = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, '');
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const list = line.match(/^(\s*)-\s+(.+)$/);

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.trim() === '---') {
      flushParagraph();
      flushList();
      blocks.push({ type: 'rule' });
      continue;
    }

    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
      });
      continue;
    }

    if (line.startsWith('> ')) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'quote', text: line.slice(2) });
      continue;
    }

    if (list) {
      flushParagraph();
      if (!listItems) {
        listItems = [];
      }
      listItems.push({
        indent: Math.min(1, Math.floor(list[1].length / 2)),
        text: list[2],
      });
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
};

type SimpleMarkdownProps = {
  content: string;
};

export function SimpleMarkdown({ content }: SimpleMarkdownProps) {
  const blocks = parseMarkdown(content);

  return (
    <div className="simple-markdown">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3';
          return (
            <Tag className={`simple-markdown-h${block.level}`} key={`${block.type}-${index}`}>
              {renderInline(block.text)}
            </Tag>
          );
        }

        if (block.type === 'quote') {
          return (
            <blockquote className="simple-markdown-quote" key={`${block.type}-${index}`}>
              {renderInline(block.text)}
            </blockquote>
          );
        }

        if (block.type === 'rule') {
          return <hr className="simple-markdown-rule" key={`${block.type}-${index}`} />;
        }

        if (block.type === 'list') {
          return (
            <ul className="simple-markdown-list" key={`${block.type}-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li
                  className={item.indent > 0 ? 'is-nested' : undefined}
                  key={`${index}-${itemIndex}`}
                >
                  {renderInline(item.text)}
                </li>
              ))}
            </ul>
          );
        }

        return <p key={`${block.type}-${index}`}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}
