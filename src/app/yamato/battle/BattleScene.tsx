import type { ReactNode } from 'react';
import styles from './battle-scene.module.css';

/** Static decoration stays outside the answer surface and never receives input. */
export function BattleScene({ variant, children }: { variant: 'lobby' | 'play' | 'result'; children: ReactNode }) {
  return <div className={`${styles.scene} ${styles[variant]}`}>{children}</div>;
}
