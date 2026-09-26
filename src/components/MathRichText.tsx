import { MathDisplay } from '@/components/MathDisplay';
import { getMathSymbolGuides, normalizeMathTextForDisplay } from '@/lib/mathText';

type MathRichTextProps = {
  children: string;
  className?: string;
  showSymbolGuide?: boolean;
};

export function MathRichText({
  children,
  className,
  showSymbolGuide = false,
}: MathRichTextProps) {
  const normalized = normalizeMathTextForDisplay(children);
  const symbolGuides = showSymbolGuide ? getMathSymbolGuides(children) : [];

  return (
    <span className="block min-w-0 max-w-full">
      <span className="block max-w-full overflow-x-auto py-0.5">
        <MathDisplay math={normalized} className={className || 'text-base'} />
      </span>
      {symbolGuides.length > 0 && (
        <span className="mt-2 block rounded-lg border border-sky-100 bg-sky-50/80 px-3 py-2 text-xs leading-5 text-sky-900">
          <span className="font-bold">記号の意味：</span>{' '}
          {symbolGuides.map((guide) => `${guide.symbol} は「${guide.label}」`).join('、')}
        </span>
      )}
    </span>
  );
}
