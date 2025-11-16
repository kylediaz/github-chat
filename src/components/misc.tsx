import styles from './misc.module.css';
import { cn } from '@/lib/utils';

export function AnimatedEllipsis({ className }: { className?: string }) {
    return <span className={cn(styles['animated-ellipsis'], className)}></span>
}