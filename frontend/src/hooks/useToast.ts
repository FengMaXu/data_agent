import { useState, useEffect } from 'react';

export type ToastType = 'success' | 'error';

export interface ToastMessage {
    text: string;
    type: ToastType;
}

export function useToast() {
    const [toast, setToast] = useState<ToastMessage | null>(null);

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    const showToast = (text: string, type: ToastType = 'success') => {
        setToast({ text, type });
    };

    return { toast, showToast };
}
