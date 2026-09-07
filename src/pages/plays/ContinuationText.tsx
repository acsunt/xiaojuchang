/* 续写区正文渲染:纯文本段落,完全不做 Markdown / 图片识别,
 * 直接按换行切段展示。性能优先,不需要任何解析开销。 */
import { useMemo } from 'react';

type ContinuationTextProps = {
  content: string;
};

const splitParagraphs = (content: string) =>
  content
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

export function ContinuationText({ content }: ContinuationTextProps) {
  const paragraphs = useMemo(() => splitParagraphs(content), [content]);

  if (paragraphs.length === 0) {
    return <p className="play-detail-copy continuation-content">{content}</p>;
  }

  return (
    <div className="continuation-content-text">
      {paragraphs.map((paragraph, paragraphIndex) => (
        <p
          className="play-detail-copy continuation-content"
          key={`${paragraphIndex}-${paragraph.slice(0, 12)}`}
        >
          {paragraph}
        </p>
      ))}
    </div>
  );
}
