import { useEffect, type RefObject } from 'react';

/**
 * 点击外部关闭弹窗的 Hook
 */
export function useClickOutside<T extends HTMLElement>(
    ref: RefObject<T>,
    callback: () => void,
    isEnabled = true
) {
    useEffect(() => {
        if (!isEnabled) return;

        const handleClickOutside = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                callback();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [ref, callback, isEnabled]);
}
