import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { VendorOperationalStatus } from '../../types';

export interface OperatorToast {
  id: number;
  title: string;
  description?: string;
  tone?: 'success' | 'error' | 'info' | 'warning';
}

const toneStyles: Record<NonNullable<OperatorToast['tone']>, { background: string; border: string; color: string }> = {
  success: {
    background: '#ecfdf5',
    border: '#10b981',
    color: '#065f46',
  },
  error: {
    background: '#fef2f2',
    border: '#ef4444',
    color: '#991b1b',
  },
  info: {
    background: '#eff6ff',
    border: '#3b82f6',
    color: '#1d4ed8',
  },
  warning: {
    background: '#fff7ed',
    border: '#f97316',
    color: '#9a3412',
  },
};

function getVendorStatusTone(status: VendorOperationalStatus): {
  label: string;
  background: string;
  border: string;
  text: string;
  dot: string;
  animated: boolean;
} {
  switch (status) {
    case 'SYNCING':
      return {
        label: 'Syncing',
        background: '#ecfdf5',
        border: '#10b981',
        text: '#065f46',
        dot: '#10b981',
        animated: true,
      };
    case 'SYNC_FAILED':
      return {
        label: 'Sync Failed',
        background: '#fef2f2',
        border: '#ef4444',
        text: '#991b1b',
        dot: '#ef4444',
        animated: false,
      };
    case 'DEACTIVATED':
      return {
        label: 'Deactivated',
        background: '#f3f4f6',
        border: '#9ca3af',
        text: '#4b5563',
        dot: '#9ca3af',
        animated: false,
      };
    case 'SYNCED':
    default:
      return {
        label: 'Synced',
        background: '#eff6ff',
        border: '#2563eb',
        text: '#1d4ed8',
        dot: '#16a34a',
        animated: false,
      };
  }
}

export const pageCardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '16px',
  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)',
  padding: '24px',
  fontFamily: 'Helvetica, Arial, sans-serif',
  fontSize: '11px',
};

export const sectionTitleStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  margin: 0,
};

export const fieldLabelStyle: React.CSSProperties = {
  color: '#334155',
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  marginBottom: '8px',
};

export const textInputStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #cbd5e1',
  borderRadius: '12px',
  color: '#0f172a',
  minHeight: '46px',
  padding: '10px 12px',
  width: '100%',
};

export const primaryButtonStyle: React.CSSProperties = {
  background: '#0f766e',
  border: 'none',
  borderRadius: '12px',
  color: '#ffffff',
  cursor: 'pointer',
  fontWeight: 600,
  padding: '11px 16px',
};

export const secondaryButtonStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #cbd5e1',
  borderRadius: '12px',
  color: '#0f172a',
  cursor: 'pointer',
  fontWeight: 600,
  padding: '11px 16px',
};

export function OperatorMetricCard(props: {
  label: string;
  value: string;
  description?: string;
}) {
  return (
    <div
      style={{
        ...pageCardStyle,
        padding: '20px',
      }}
    >
      <div style={{ color: '#64748b', fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
        {props.label}
      </div>
      <div style={{ color: '#0f172a', fontSize: '30px', fontWeight: 700, letterSpacing: '-0.03em' }}>
        {props.value}
      </div>
      {props.description ? (
        <div style={{ color: '#475569', fontSize: '13px', marginTop: '10px' }}>{props.description}</div>
      ) : null}
    </div>
  );
}

export function InlineNotice(props: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  title: string;
  description?: string;
}) {
  const tone = props.tone ?? 'info';
  const style = toneStyles[tone];

  return (
    <div
      style={{
        background: style.background,
        border: `1px solid ${style.border}`,
        borderRadius: '14px',
        color: style.color,
        padding: '14px 16px',
      }}
    >
      <div style={{ fontWeight: 700 }}>{props.title}</div>
      {props.description ? <div style={{ marginTop: '6px' }}>{props.description}</div> : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: VendorOperationalStatus }) {
  const tone = getVendorStatusTone(status);

  return (
    <>
      <span
        style={{
          alignItems: 'center',
          background: tone.background,
          border: `1px solid ${tone.border}`,
          borderRadius: '999px',
          color: tone.text,
          display: 'inline-flex',
          fontSize: '13px',
          fontWeight: 700,
          gap: '8px',
          padding: '7px 12px',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            background: tone.dot,
            borderRadius: '999px',
            display: 'inline-block',
            height: '10px',
            width: '10px',
            animation: tone.animated ? 'operatorPulse 1.2s ease-in-out infinite' : undefined,
          }}
        />
         <span
          style={{
            display: 'none'}}>{tone.label}</span>
      </span>
      <style jsx global>{`
        @keyframes operatorPulse {
          0% {
            opacity: 0.45;
            transform: scale(0.9);
          }

          50% {
            opacity: 1;
            transform: scale(1.15);
          }

          100% {
            opacity: 0.45;
            transform: scale(0.9);
          }
        }
      `}</style>
    </>
  );
}

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: OperatorToast[];
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    if (toasts.length === 0) {
      return undefined;
    }

    const timeouts = toasts.map(toast =>
      window.setTimeout(() => onDismiss(toast.id), 4200),
    );

    return () => {
      timeouts.forEach(timeout => window.clearTimeout(timeout));
    };
  }, [onDismiss, toasts]);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: '10px',
        position: 'fixed',
        right: '24px',
        top: '24px',
        width: '340px',
        zIndex: 1200,
      }}
    >
      {toasts.map(toast => {
        const tone = toneStyles[toast.tone ?? 'info'];
        return (
          <div
            key={toast.id}
            style={{
              background: tone.background,
              border: `1px solid ${tone.border}`,
              borderRadius: '14px',
              boxShadow: '0 18px 40px rgba(15, 23, 42, 0.16)',
              color: tone.color,
              padding: '14px 16px',
            }}
          >
            <div style={{ fontWeight: 700 }}>{toast.title}</div>
            {toast.description ? <div style={{ marginTop: '6px' }}>{toast.description}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'danger' | 'default';
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!props.open) {
    return null;
  }

  const confirmStyle =
    props.tone === 'danger'
      ? {
          ...primaryButtonStyle,
          background: '#dc2626',
        }
      : primaryButtonStyle;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        alignItems: 'center',
        background: 'rgba(15, 23, 42, 0.52)',
        display: 'flex',
        inset: 0,
        justifyContent: 'center',
        padding: '24px',
        position: 'fixed',
        zIndex: 1100,
      }}
    >
      <div
        style={{
          ...pageCardStyle,
          maxWidth: '520px',
          width: '100%',
        }}
      >
        <h3 style={{ color: '#0f172a', fontSize: '22px', margin: 0 }}>{props.title}</h3>
        <p style={{ color: '#475569', lineHeight: 1.6, marginBottom: '24px', marginTop: '12px' }}>
          {props.description}
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button type="button" style={secondaryButtonStyle} onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" style={confirmStyle} onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function RowActionMenu(props: {
  actions: Array<{
    id: string;
    label: string;
    disabled?: boolean;
    tone?: 'default' | 'danger';
    onSelect: () => void;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const visibleActions = useMemo(() => props.actions.filter(action => !action.disabled), [props.actions]);

  useEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return undefined;
    }

    const updateMenuPosition = () => {
      if (!buttonRef.current) {
        return;
      }

      const triggerRect = buttonRef.current.getBoundingClientRect();
      const menuWidth = menuRef.current?.offsetWidth ?? 180;
      const menuHeight = menuRef.current?.offsetHeight ?? visibleActions.length * 44 + 16;
      const nextLeft = Math.min(
        Math.max(8, triggerRect.right - menuWidth),
        Math.max(8, window.innerWidth - menuWidth - 8),
      );
      const preferredTop = triggerRect.bottom + 8;
      const shouldFlipAbove = preferredTop + menuHeight > window.innerHeight - 8 && triggerRect.top - menuHeight - 8 >= 8;
      const nextTop = shouldFlipAbove
        ? triggerRect.top - menuHeight - 8
        : Math.max(8, Math.min(preferredTop, window.innerHeight - menuHeight - 8));

      setMenuPosition({ left: nextLeft, top: nextTop });
    };

    updateMenuPosition();

    const animationFrameId = window.requestAnimationFrame(updateMenuPosition);
    const handleLayoutChange = () => updateMenuPosition();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('resize', handleLayoutChange);
    window.addEventListener('scroll', handleLayoutChange, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleLayoutChange);
      window.removeEventListener('scroll', handleLayoutChange, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, visibleActions.length]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedTrigger = triggerRef.current?.contains(target);
      const clickedMenu = menuRef.current?.contains(target);

      if (!clickedTrigger && !clickedMenu) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open]);

  return (
    <div ref={triggerRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Vendor row actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(current => !current)}
        style={{
          alignItems: 'center',
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: '12px',
          color: '#0f172a',
          cursor: 'pointer',
          display: 'inline-flex',
          fontSize: '16px',
          justifyContent: 'center',
          lineHeight: 1,
          minHeight: '40px',
          minWidth: '40px',
        }}
      >
        ...
      </button>
      {open && visibleActions.length > 0 && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label="Row actions"
              style={{
                background: '#ffffff',
                border: '1px solid #dbe3ef',
                borderRadius: '14px',
                boxShadow: '0 18px 40px rgba(15, 23, 42, 0.14)',
                left: menuPosition?.left ?? 8,
                minWidth: '180px',
                padding: '8px',
                position: 'fixed',
                top: menuPosition?.top ?? 8,
                visibility: menuPosition ? 'visible' : 'hidden',
                zIndex: 1200,
              }}
            >
              {visibleActions.map(action => (
                <button
                  key={action.id}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    action.onSelect();
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '10px',
                    color: action.tone === 'danger' ? '#b91c1c' : '#0f172a',
                    cursor: 'pointer',
                    display: 'block',
                    fontWeight: 600,
                    padding: '8px',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
