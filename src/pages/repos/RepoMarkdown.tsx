import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const imagePattern = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;
const markdownImagePattern = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const bareUrlPattern = /(https?:\/\/[^\s<>()]+)/g;

type MarkdownTextToken = { type: 'text'; value: string };
type MarkdownLinkToken = { type: 'link'; label: string; url: string };
type MarkdownImageToken = { type: 'image'; alt: string; url: string; imageIndex: number };
type MarkdownToken = MarkdownTextToken | MarkdownLinkToken | MarkdownImageToken;

type ParsedRepoMarkdown = {
  images: Array<{ alt: string; url: string }>;
  paragraphs: Array<{ id: string; tokens: MarkdownToken[] }>;
};

const isImageUrl = (url: string) => imagePattern.test(url.split('#')[0] ?? '');

const pushTextWithLinks = (
  tokens: MarkdownToken[],
  images: ParsedRepoMarkdown['images'],
  value: string,
) => {
  let cursor = 0;
  const matches = Array.from(value.matchAll(markdownLinkPattern));

  for (const match of matches) {
    const index = match.index ?? 0;
    if (index > cursor) {
      pushBareUrls(tokens, images, value.slice(cursor, index));
    }

    const label = match[1] ?? '';
    const url = match[2] ?? '';
    if (isImageUrl(url)) {
      const imageIndex = images.push({ alt: label || '图床图片', url }) - 1;
      tokens.push({ type: 'image', alt: label, url, imageIndex });
    } else {
      tokens.push({ type: 'link', label, url });
    }
    cursor = index + match[0].length;
  }

  if (cursor < value.length) {
    pushBareUrls(tokens, images, value.slice(cursor));
  }
};

const pushBareUrls = (
  tokens: MarkdownToken[],
  images: ParsedRepoMarkdown['images'],
  value: string,
) => {
  let cursor = 0;
  const matches = Array.from(value.matchAll(bareUrlPattern));

  for (const match of matches) {
    const index = match.index ?? 0;
    const url = match[1] ?? '';
    if (index > cursor) {
      tokens.push({ type: 'text', value: value.slice(cursor, index) });
    }

    if (isImageUrl(url)) {
      const imageIndex = images.push({ alt: '图床图片', url }) - 1;
      tokens.push({ type: 'image', alt: '图床图片', url, imageIndex });
    } else {
      tokens.push({ type: 'link', label: url, url });
    }
    cursor = index + match[0].length;
  }

  if (cursor < value.length) {
    tokens.push({ type: 'text', value: value.slice(cursor) });
  }
};

const parseInlineMarkdown = (
  images: ParsedRepoMarkdown['images'],
  value: string,
): MarkdownToken[] => {
  const tokens: MarkdownToken[] = [];
  let cursor = 0;
  const matches = Array.from(value.matchAll(markdownImagePattern));

  for (const match of matches) {
    const index = match.index ?? 0;
    if (index > cursor) {
      pushTextWithLinks(tokens, images, value.slice(cursor, index));
    }

    const imageIndex = images.push({ alt: match[1] ?? '图床图片', url: match[2] ?? '' }) - 1;
    tokens.push({ type: 'image', alt: match[1] ?? '图床图片', url: match[2] ?? '', imageIndex });
    cursor = index + match[0].length;
  }

  if (cursor < value.length) {
    pushTextWithLinks(tokens, images, value.slice(cursor));
  }

  return tokens;
};

const splitParagraphs = (content: string) =>
  content
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

const parseRepoMarkdown = (content: string): ParsedRepoMarkdown => {
  const images: ParsedRepoMarkdown['images'] = [];
  const paragraphs = splitParagraphs(content).map((paragraph, paragraphIndex) => ({
    id: `${paragraphIndex}-${paragraph.slice(0, 12)}`,
    tokens: parseInlineMarkdown(images, paragraph),
  }));

  return {
    images,
    paragraphs,
  };
};

type RepoMarkdownProps = {
  content: string;
};

export function RepoMarkdown({ content }: RepoMarkdownProps) {
  const touchStartXRef = useRef<number | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const parsedContent = useMemo(() => parseRepoMarkdown(content), [content]);
  const previewImage = previewIndex === null ? null : (parsedContent.images[previewIndex] ?? null);
  const hasMultipleImages = parsedContent.images.length > 1;

  const closePreview = () => setPreviewIndex(null);
  const openPreview = (imageIndex: number) => setPreviewIndex(imageIndex);
  const showPrevious = useCallback(() => {
    if (!hasMultipleImages) {
      return;
    }

    setPreviewIndex((currentIndex) =>
      currentIndex === null
        ? currentIndex
        : (currentIndex - 1 + parsedContent.images.length) % parsedContent.images.length,
    );
  }, [hasMultipleImages, parsedContent.images.length]);
  const showNext = useCallback(() => {
    if (!hasMultipleImages) {
      return;
    }

    setPreviewIndex((currentIndex) =>
      currentIndex === null ? currentIndex : (currentIndex + 1) % parsedContent.images.length,
    );
  }, [hasMultipleImages, parsedContent.images.length]);

  useEffect(() => {
    if (previewIndex === null) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePreview();
        return;
      }

      if (!hasMultipleImages) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        showPrevious();
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        showNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasMultipleImages, previewIndex, showNext, showPrevious]);

  return (
    <div className="repo-markdown stack-gap-sm">
      {parsedContent.paragraphs.map((paragraph) => (
        <p key={paragraph.id}>
          {paragraph.tokens.map((token, tokenIndex) => {
            if (token.type === 'text') {
              return <span key={tokenIndex}>{token.value}</span>;
            }

            if (token.type === 'link') {
              return (
                <a href={token.url} key={tokenIndex} rel="noreferrer" target="_blank">
                  {token.label}
                </a>
              );
            }

            return (
              <button
                className="repo-image-thumb"
                key={tokenIndex}
                onClick={() => openPreview(token.imageIndex)}
                type="button"
              >
                <img alt={token.alt || '图床图片'} src={token.url} loading="lazy" />
              </button>
            );
          })}
        </p>
      ))}

      {previewImage ? (
        <div className="repo-image-modal" role="presentation" onClick={closePreview}>
          <div className="repo-image-stage" onClick={closePreview}>
            <button
              aria-label="关闭图片预览"
              className="repo-image-modal-close"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                closePreview();
              }}
            >
              ×
            </button>
            {hasMultipleImages && previewIndex !== null ? (
              <div
                className="repo-image-modal-counter"
                onClick={(event) => event.stopPropagation()}
              >
                {previewIndex + 1} / {parsedContent.images.length}
              </div>
            ) : null}
            {hasMultipleImages ? (
              <button
                aria-label="上一张图片"
                className="repo-image-nav repo-image-nav-prev"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  showPrevious();
                }}
              >
                ‹
              </button>
            ) : null}
            {hasMultipleImages ? (
              <button
                aria-label="下一张图片"
                className="repo-image-nav repo-image-nav-next"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  showNext();
                }}
              >
                ›
              </button>
            ) : null}
            <div
              className="repo-image-viewport"
              onClick={(event) => event.stopPropagation()}
              onTouchEnd={(event) => {
                const touchStartX = touchStartXRef.current;
                const touchEndX = event.changedTouches[0]?.clientX ?? null;
                touchStartXRef.current = null;
                if (!hasMultipleImages || touchStartX === null || touchEndX === null) {
                  return;
                }

                const deltaX = touchEndX - touchStartX;
                if (Math.abs(deltaX) < 48) {
                  return;
                }

                if (deltaX < 0) {
                  showNext();
                } else {
                  showPrevious();
                }
              }}
              onTouchStart={(event) => {
                touchStartXRef.current = event.touches[0]?.clientX ?? null;
              }}
            >
              <img
                alt={previewImage.alt || 'repo 原图'}
                className="repo-image-full"
                src={previewImage.url}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
