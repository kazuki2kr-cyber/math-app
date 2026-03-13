import React from 'react';
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// utility function typically from lib/utils.ts, but injected here or using existing
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface MathDisplayProps {
  math: string;
  block?: boolean;
  className?: string;
  errorColor?: string;
  renderError?: (error: Error | TypeError) => React.ReactNode;
}

export const MathDisplay: React.FC<MathDisplayProps> = ({
  math,
  block = false,
  className,
  errorColor = '#cc0000',
  renderError,
}) => {
  if (!math) return null;

  const parts: { type: 'text' | 'inline' | 'block'; content: string }[] = [];
  let lastIndex = 0;
  // match $$ ... $$ first, then $ ... $
  const regex = /\$\$(.*?)\$\$|\$(.*?)\$/g;
  let match;

  while ((match = regex.exec(math)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: math.substring(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      parts.push({ type: 'block', content: match[1] });
    } else if (match[2] !== undefined) {
      parts.push({ type: 'inline', content: match[2] });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < math.length) {
    parts.push({ type: 'text', content: math.substring(lastIndex) });
  }

  // Backup for pure math without delimiters (previous behavior)
  if (parts.length === 0 && block) {
       return (
         <span className={cn('math-display text-lg text-foreground', className)}>
            <BlockMath math={math} errorColor={errorColor} renderError={renderError}/>
         </span>
       )
  }

  return (
    <span className={cn('math-display text-lg text-foreground leading-relaxed', className)}>
      {parts.length === 0 ? (
        <span>{math}</span>
      ) : (
        parts.map((part, index) => {
          if (part.type === 'block') {
            return <span key={index} className="block my-2 text-center"><BlockMath math={part.content} errorColor={errorColor} renderError={renderError} /></span>;
          } else if (part.type === 'inline') {
            return <InlineMath key={index} math={part.content} errorColor={errorColor} renderError={renderError} />;
          } else {
            return (
              <React.Fragment key={index}>
                {part.content.split('\n').map((line, i, arr) => (
                  <React.Fragment key={i}>
                    {line}
                    {i < arr.length - 1 && <br />}
                  </React.Fragment>
                ))}
              </React.Fragment>
            );
          }
        })
      )}
    </span>
  );
};
