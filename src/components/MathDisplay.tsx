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
  const Component = block ? BlockMath : InlineMath;

  return (
    <span className={cn('math-display text-lg text-foreground', className)}>
      <Component
        math={math}
        errorColor={errorColor}
        renderError={renderError}
      />
    </span>
  );
};
