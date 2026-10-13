'use client';

import { useEffect, useRef, type ReactNode } from 'react';

// Native dialog provides focus containment, an inert background and focus return.
export function Modal({ children, onClose, labelledBy }: {
  children: ReactNode;
  onClose: () => void;
  labelledBy: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog ref={dialog} aria-labelledby={labelledBy}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-transparent p-0 text-inherit backdrop:bg-transparent"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      {children}
    </dialog>
  );
}
