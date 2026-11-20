import React from 'react';

interface KanjiQuestionTextProps {
  text?: string | null;
  highlightKanji?: boolean;
  className?: string;
}

function renderSegment(segment: string, highlightKanji: boolean, keyPrefix: string): React.ReactNode {
  if (!highlightKanji) return segment;
  const parts = segment.split(/([一-龠]+)/g);
  return parts.map((part, index) => {
    if (!part) return null;
    if (/^[一-龠]+$/.test(part)) {
      return (
        <span key={`${keyPrefix}-k-${index}`} className="text-orange-900 border-b-2 border-orange-400">
          {part}
        </span>
      );
    }
    return <React.Fragment key={`${keyPrefix}-t-${index}`}>{part}</React.Fragment>;
  });
}

/**
 * Safely renders kanji question text supporting only `<u>...</u>` emphasis tags
 * and optional kanji character highlighting without `dangerouslySetInnerHTML`.
 */
export function KanjiQuestionText({
  text,
  highlightKanji = false,
  className,
}: KanjiQuestionTextProps) {
  const safeText = String(text || '');
  const tokens = safeText.split(/(<u>[\s\S]*?<\/u>)/gi);

  return (
    <span className={className}>
      {tokens.map((token, index) => {
        if (!token) return null;
        const underlineMatch = /^<u>([\s\S]*?)<\/u>$/i.exec(token);
        if (underlineMatch) {
          return (
            <u key={`u-${index}`}>
              {renderSegment(underlineMatch[1], highlightKanji, `u-${index}`)}
            </u>
          );
        }
        return (
          <React.Fragment key={`seg-${index}`}>
            {renderSegment(token, highlightKanji, `seg-${index}`)}
          </React.Fragment>
        );
      })}
    </span>
  );
}
