import React from 'react';
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { normalizeMathTextForDisplay, splitMathText } from '@/lib/mathText';

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

  const displayMath = normalizeMathTextForDisplay(math);

  const parts = splitMathText(displayMath);

  // Backup for pure math without delimiters (previous behavior)
  if (parts.length === 1 && parts[0].type === 'text') {
    if (block) {
      return (
        <span className={cn('math-display text-lg text-foreground', className)}>
           <BlockMath math={displayMath} errorColor={errorColor} renderError={renderError}/>
        </span>
      );
    } else {
      // Fallback for inline pure math (often used in multiple-choice options)
      // If it contains backslash but no Japanese text, it's highly likely pure math string
      const hasJapanese = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(displayMath);
      const isLikelyMath = !hasJapanese && (displayMath.includes('\\') || displayMath.match(/^[0-9a-zA-Z\s\+\-\*\/\=\(\)\.\,\:\^\_]+$/));
      
      if (isLikelyMath) {
        return (
          <span className={cn('math-display text-lg text-foreground', className)}>
             <InlineMath math={displayMath} errorColor={errorColor} renderError={renderError}/>
          </span>
        );
      }
    }
  }

  return (
    <span className={cn('math-display text-lg text-foreground leading-relaxed', className)}>
      {parts.length === 0 ? (
        <span>{displayMath}</span>
      ) : (
        parts.map((part, index) => {
          if (part.type === 'block') {
            return <span key={index} className="my-2 block max-w-full overflow-x-auto py-1 text-center"><BlockMath math={part.content} errorColor={errorColor} renderError={renderError} /></span>;
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
