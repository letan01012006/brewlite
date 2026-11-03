'use client';

import { useEffect, useRef, type ReactNode } from 'react';

// Native dialog provides focus containment, an inert background and focus return.
export function Modal({ children, onClose, labelledBy }: {
  children: ReactNode;
  onClose: () => void;
  labelledBy: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pointerStartedOutside = useRef(false);
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
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-transparent p-4 text-inherit open:flex open:items-center open:justify-center backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      onPointerDown={(event) => {
        pointerStartedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pointerStartedOutside.current && event.target === event.currentTarget) onClose();
        pointerStartedOutside.current = false;
      }}
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      {children}
    </dialog>
  );
}
