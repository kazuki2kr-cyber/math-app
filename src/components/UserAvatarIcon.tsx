import Image from 'next/image';
import { isRewardIconImage } from '@/lib/rewardIcons';

export function UserAvatarIcon({
  icon,
  className = '',
  imageClassName = '',
}: {
  icon?: string | null;
  className?: string;
  imageClassName?: string;
}) {
  const safeIcon = icon || '📐';
  if (isRewardIconImage(safeIcon)) {
    return (
      <Image
        src={safeIcon}
        alt="獲得アイコン"
        width={96}
        height={96}
        unoptimized
        className={`object-contain ${className} ${imageClassName}`}
      />
    );
  }

  return <span className={className}>{safeIcon}</span>;
}
