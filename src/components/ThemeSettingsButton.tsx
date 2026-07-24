'use client';

import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Monitor, Moon, Settings, Sun, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme, type ThemePreference } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  {
    value: 'light',
    label: 'ライト',
    description: '従来の明るいデザインです（既定）',
    icon: Sun,
  },
  {
    value: 'dark',
    label: 'ダーク',
    description: '画面全体を暗い配色で表示します',
    icon: Moon,
  },
  {
    value: 'system',
    label: '端末設定に合わせる',
    description: 'スマートフォンやPCの設定に連動します',
    icon: Monitor,
  },
];

interface ThemeSettingsButtonProps {
  className?: string;
  labelClassName?: string;
}

export function ThemeSettingsButton({
  className,
  labelClassName = 'hidden md:inline',
}: ThemeSettingsButtonProps) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="表示設定を開く"
        title="表示設定"
        className={cn('text-muted-foreground hover:text-foreground', className)}
      >
        <Settings className="h-4 w-4" />
        <span className={labelClassName}>表示設定</span>
      </Button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl sm:p-6"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="text-lg font-black">表示設定</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  お好みの画面テーマを選んでください。
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="表示設定を閉じる"
                className="shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2">
              {THEME_OPTIONS.map((option) => {
                const OptionIcon = option.icon;
                const selected = theme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setTheme(option.value);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                      selected
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-background hover:bg-muted',
                    )}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                      <OptionIcon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                    {selected && <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
