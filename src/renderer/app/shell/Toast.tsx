import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from '@heroicons/react/20/solid';
import { XMarkIcon } from '@heroicons/react/24/outline';
import React from 'react';

import { i18nService } from '@/services/i18n';

export type ToastTone = 'error' | 'info' | 'success' | 'warning';

export interface ToastContent {
  message: string;
  title?: string;
  tone?: ToastTone;
  duration?: number;
}

interface ToastProps extends ToastContent {
  onClose?: () => void;
}

const TONE_STYLES: Record<ToastTone, { icon: string; iconSurface: string }> = {
  error: {
    icon: 'text-red-600 dark:text-red-300',
    iconSurface: 'bg-red-50 dark:bg-red-950/70',
  },
  info: {
    icon: 'text-primary',
    iconSurface: 'bg-primary-muted',
  },
  success: {
    icon: 'text-emerald-600 dark:text-emerald-300',
    iconSurface: 'bg-emerald-50 dark:bg-emerald-950/70',
  },
  warning: {
    icon: 'text-amber-600 dark:text-amber-300',
    iconSurface: 'bg-amber-50 dark:bg-amber-950/70',
  },
};

const Toast: React.FC<ToastProps> = ({ message, onClose, title, tone = 'info' }) => {
  const styles = TONE_STYLES[tone];
  const hasTitle = Boolean(title);
  const Icon =
    tone === 'warning'
      ? ExclamationTriangleIcon
      : tone === 'error'
        ? ExclamationCircleIcon
        : tone === 'success'
          ? CheckCircleIcon
          : InformationCircleIcon;

  return (
    <div className="pointer-events-none fixed left-4 right-4 top-14 z-[10000] flex justify-center sm:left-auto sm:right-5 sm:justify-end">
      <div
        className="pointer-events-auto w-full max-w-[380px] overflow-hidden rounded-[14px] border border-border/60 bg-surface/95 text-foreground shadow-popover backdrop-blur-xl animate-scale-in"
        role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
        aria-live={tone === 'error' || tone === 'warning' ? 'assertive' : 'polite'}
      >
        <div className={`flex gap-3 px-3 py-2.5 ${hasTitle ? 'items-start' : 'items-center'}`}>
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ${hasTitle ? 'mt-0.5' : ''} ${styles.iconSurface}`}
          >
            <Icon className={`h-[18px] w-[18px] ${styles.icon}`} aria-hidden="true" />
          </div>
          <div
            className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${hasTitle ? '' : 'self-center'}`}
          >
            {title && <div className="text-sm font-semibold leading-5">{title}</div>}
            <div
              className={`${title ? 'mt-0.5 text-secondary' : 'text-foreground'} text-sm leading-5`}
            >
              {message}
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-tertiary transition-colors hover:bg-surface-raised hover:text-foreground ${hasTitle ? '-mr-0.5 -mt-0.5' : '-mr-0.5'}`}
              aria-label={i18nService.t('dismiss')}
            >
              <XMarkIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Toast;
