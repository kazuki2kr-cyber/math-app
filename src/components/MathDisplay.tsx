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
  // match $$ ... $$, \[ ... \], $ ... $, \( ... \)
  const regex = /\$\$(.*?)\$\$|\\\[([\s\S]*?)\\\]|\$(.*?)\$|\\\(([\s\S]*?)\\\)/g;
  let match;

  while ((match = regex.exec(math)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: math.substring(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      parts.push({ type: 'block', content: match[1] });
    } else if (match[2] !== undefined) {
      parts.push({ type: 'block', content: match[2] });
    } else if (match[3] !== undefined) {
      parts.push({ type: 'inline', content: match[3] });
    } else if (match[4] !== undefined) {
      parts.push({ type: 'inline', content: match[4] });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < math.length) {
    parts.push({ type: 'text', content: math.substring(lastIndex) });
  }

  // Backup for pure math without delimiters (previous behavior)
  if (parts.length === 1 && parts[0].type === 'text') {
    if (block) {
      return (
        <span className={cn('math-display text-lg text-foreground', className)}>
           <BlockMath math={math} errorColor={errorColor} renderError={renderError}/>
        </span>
      );
    } else {
      // Fallback for inline pure math (often used in multiple-choice options)
      // If it contains backslash but no Japanese text, it's highly likely pure math string
      const hasJapanese = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(math);
      const isLikelyMath = !hasJapanese && (math.includes('\\') || math.match(/^[0-9a-zA-Z\s\+\-\*\/\=\(\)\.\,\:\^\_]+$/));
      
      if (isLikelyMath) {
        return (
          <span className={cn('math-display text-lg text-foreground', className)}>
             <InlineMath math={math} errorColor={errorColor} renderError={renderError}/>
          </span>
        );
      }
    }
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
