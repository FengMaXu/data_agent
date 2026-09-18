import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'area[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'iframe',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Keeps keyboard focus inside an open dialog and returns it to the trigger.
 * The optional scope is the overlay element; its siblings are made inert while
 * the dialog is open so pointer and assistive-technology users have the same
 * modal boundary.
 */
export function useFocusTrap(
    enabled: boolean,
    containerRef: RefObject<HTMLElement | null>,
    scopeRef?: RefObject<HTMLElement | null>,
) {
    useEffect(() => {
        if (!enabled || !containerRef.current) return undefined;

        const container = containerRef.current;
        const scope = scopeRef?.current ?? container.parentElement;
        const previousActiveElement = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const inertSiblings: HTMLElement[] = [];
        let current: HTMLElement | null = scope;
        while (current?.parentElement && current.parentElement !== document.body) {
            const parent = current.parentElement;
            Array.from(parent.children).forEach((element) => {
                if (element !== current && element instanceof HTMLElement && !inertSiblings.includes(element)) {
                    inertSiblings.push(element);
                }
            });
            current = parent;
        }
        const previousInert = inertSiblings.map((element) => element.inert);

        inertSiblings.forEach((element) => {
            element.inert = true;
        });

        const focusFirstElement = () => {
            const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
            (firstFocusable ?? container).focus();
        };
        const animationFrame = window.requestAnimationFrame(focusFirstElement);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;

            const focusableElements = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
            if (focusableElements.length === 0) {
                event.preventDefault();
                container.focus();
                return;
            }

            const first = focusableElements[0];
            const last = focusableElements[focusableElements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            window.cancelAnimationFrame(animationFrame);
            document.removeEventListener('keydown', handleKeyDown);
            inertSiblings.forEach((element, index) => {
                element.inert = previousInert[index];
            });
            if (previousActiveElement?.isConnected) {
                previousActiveElement.focus();
            }
        };
    }, [containerRef, enabled, scopeRef]);
}
