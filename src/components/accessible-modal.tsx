import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

/** Existing dialog content with managed focus, Escape and focus restoration. */
export function AccessibleModal({ children, onClose, labelledBy, label, className = "" }: {
  children: ReactNode;
  onClose: () => void;
  labelledBy?: string;
  label?: string;
  className?: string;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="cf-modal-overlay" />
        <Dialog.Content aria-labelledby={labelledBy} aria-describedby={undefined} aria-label={label}
          className={`cf-modal-content ${className}`}>
          <Dialog.Title className="sr-only">{label ?? "CampusFind item"}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}