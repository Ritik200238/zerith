"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "outline";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
}

/**
 * Zerith editorial button.
 *
 *  primary  — dark on light (text bg / bg color text)
 *  outline  — transparent w/ dashed border
 *  ghost    — text-only, muted → text on hover
 *
 * All variants share 8px gap, 12×24 padding, 8px radius from the
 * `.btn` utility class in globals.css.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    leftIcon,
    rightIcon,
    loading,
    disabled,
    className = "",
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  const variantClass =
    variant === "primary"
      ? "btn-primary"
      : variant === "outline"
        ? "btn-outline"
        : "btn-ghost";
  const sizeClass = size === "sm" ? "btn-sm" : "";

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={`btn ${variantClass} ${sizeClass} ${className}`.trim()}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin"
        />
      ) : (
        leftIcon
      )}
      <span>{children}</span>
      {!loading && rightIcon}
    </button>
  );
});
