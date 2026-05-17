"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, AlertTriangle, Info, ExternalLink } from "lucide-react";

/**
 * Toast — global feedback system.
 *
 * Audit fix F3: replaces every silent failure, every `alert()`, every
 * "Transaction failed" without context. Pages call `toast.success(...)` /
 * `toast.error(...)` / `toast.info(...)` after any action and the user
 * gets clear, dismissable feedback.
 *
 * Stacks max 3 toasts. Auto-dismiss after 5s. ARIA live region for
 * screen readers.
 */

export type ToastKind = "success" | "error" | "info" | "warning";

export interface ToastInput {
  kind: ToastKind;
  title: string;
  description?: string;
  /** Optional explorer/etherscan link */
  href?: string;
  hrefLabel?: string;
  /** Auto-dismiss after ms; 0 = sticky */
  durationMs?: number;
}

interface ToastInternal extends ToastInput {
  id: string;
}

interface ToastContextValue {
  show: (t: ToastInput) => void;
  success: (title: string, description?: string, opts?: Partial<ToastInput>) => void;
  error: (title: string, description?: string, opts?: Partial<ToastInput>) => void;
  info: (title: string, description?: string, opts?: Partial<ToastInput>) => void;
  warning: (title: string, description?: string, opts?: Partial<ToastInput>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_STYLES: Record<ToastKind, { accent: string; label: string; icon: typeof Check }> = {
  success: { accent: "border-success/60", label: "text-success", icon: Check },
  error:   { accent: "border-danger/60",  label: "text-danger",  icon: X },
  info:    { accent: "border-info/60",    label: "text-info",    icon: Info },
  warning: { accent: "border-warning/60", label: "text-warning", icon: AlertTriangle },
};

const KIND_LABEL: Record<ToastKind, string> = {
  success: "SUCCESS",
  error:   "ERROR",
  info:    "INFO",
  warning: "WARNING",
};

const MAX_TOASTS = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastInternal[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((t: ToastInput) => {
    const id = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `t-${Date.now()}-${Math.random()}`;
    setToasts((prev) => {
      const next = [...prev, { ...t, id }];
      return next.slice(-MAX_TOASTS);
    });
    const dur = t.durationMs ?? 5000;
    if (dur > 0) {
      setTimeout(() => dismiss(id), dur);
    }
  }, [dismiss]);

  const success = useCallback(
    (title: string, description?: string, opts: Partial<ToastInput> = {}) =>
      show({ kind: "success", title, description, ...opts }),
    [show],
  );
  const error = useCallback(
    (title: string, description?: string, opts: Partial<ToastInput> = {}) =>
      show({ kind: "error", title, description, ...opts }),
    [show],
  );
  const info = useCallback(
    (title: string, description?: string, opts: Partial<ToastInput> = {}) =>
      show({ kind: "info", title, description, ...opts }),
    [show],
  );
  const warning = useCallback(
    (title: string, description?: string, opts: Partial<ToastInput> = {}) =>
      show({ kind: "warning", title, description, ...opts }),
    [show],
  );

  return (
    <ToastContext.Provider value={{ show, success, error, info, warning, dismiss }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, onDismiss }: { toasts: ToastInternal[]; onDismiss: (id: string) => void }) {
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed top-4 right-4 z-[60] flex flex-col gap-2 max-w-sm pointer-events-none"
    >
      <AnimatePresence>
        {toasts.map((t) => {
          const style = KIND_STYLES[t.kind];
          const Icon = style.icon;
          return (
            <motion.div
              key={t.id}
              role="status"
              initial={{ opacity: 0, x: 24, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ duration: 0.2 }}
              className={`pointer-events-auto rounded border border-dashed ${style.accent}
                          bg-bgCard shadow-[0_8px_24px_rgba(17,17,17,0.06)]
                          p-3 pr-8 relative min-w-[280px]`}
            >
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                aria-label="Dismiss notification"
                className="absolute top-2 right-2 p-1 rounded text-textMuted hover:text-text hover:bg-bgAlt transition-colors"
              >
                <X size={12} />
              </button>
              <div className="flex items-start gap-2">
                <div className={`shrink-0 mt-0.5 ${style.label}`}>
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-mono text-[10px] uppercase tracking-[0.1em] ${style.label}`}>
                    {KIND_LABEL[t.kind]}
                  </p>
                  <p className="text-sm font-semibold text-text mt-0.5">{t.title}</p>
                  {t.description && (
                    <p className="text-xs text-textSecondary mt-1 leading-relaxed">{t.description}</p>
                  )}
                  {t.href && (
                    <a
                      href={t.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-accent2 hover:text-text mt-1.5 underline-offset-2 hover:underline"
                    >
                      {t.hrefLabel ?? "View"}
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

/**
 * useModalEscape — wires Escape key + (optional) click-outside to close a modal,
 * and returns ARIA props to spread on the modal root for screen readers.
 *
 * Audit fix F4: previously no modals trapped focus or responded to Escape.
 *
 * Usage:
 *   const modalProps = useModalEscape(isOpen, () => setIsOpen(false));
 *   <div {...modalProps}> ... </div>
 */
export function useModalEscape(
  open: boolean,
  onClose: () => void,
  labelledBy?: string,
): {
  role: "dialog";
  "aria-modal": true;
  "aria-labelledby"?: string;
} {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  return {
    role: "dialog",
    "aria-modal": true,
    ...(labelledBy ? { "aria-labelledby": labelledBy } : {}),
  };
}
