'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme, type ThemePreference } from '@/contexts/ThemeContext';

const THEME_SEQUENCE: ThemePreference[] = ['system', 'light', 'dark'];
const THEME_LABELS: Record<ThemePreference, string> = {
  system: '端末設定',
  light: 'ライト',
  dark: 'ダーク',
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const currentIndex = THEME_SEQUENCE.indexOf(theme);
  const nextTheme = THEME_SEQUENCE[(currentIndex + 1) % THEME_SEQUENCE.length];
  const Icon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setTheme(nextTheme)}
      aria-label={`表示テーマ: ${THEME_LABELS[theme]}。クリックして${THEME_LABELS[nextTheme]}へ変更`}
      title={`表示テーマ: ${THEME_LABELS[theme]}`}
      className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-[70] h-9 -translate-x-1/2 gap-2 border-border/70 bg-background/90 px-3 text-xs font-bold shadow-lg backdrop-blur"
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{THEME_LABELS[theme]}</span>
    </Button>
  );
}
