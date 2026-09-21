"use client";

import type { ReactNode } from "react";

interface ToggleProps {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

/**
 * iOS-style switch. Same boolean contract as a checkbox, look only:
 * a native button already activates on Enter/Space, so onClick alone
 * covers mouse, touch, and keyboard, with ARIA state for readers.
 */
export default function Toggle({ checked, label, onChange }: ToggleProps): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={checked ? "switch on" : "switch"}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
    </button>
  );
}
