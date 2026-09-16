import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';

import { i18nService } from '@/services/i18n';

interface TerminalPanelProps {
  cwd: string;
  isObscured: boolean;
  terminalId: string;
}

// Windows Terminal's Campbell palette keeps PowerShell output familiar while
// still exposing the full ANSI bright-color range used by modern CLI tools.
const TERMINAL_THEME = {
  background: '#0c0c0c',
  foreground: '#cccccc',
  cursor: '#ffffff',
  cursorAccent: '#0c0c0c',
  selectionBackground: '#264f78',
  black: '#0c0c0c',
  red: '#c50f1f',
  green: '#13a10e',
  yellow: '#c19c00',
  blue: '#0037da',
  magenta: '#881798',
  cyan: '#3a96dd',
  white: '#cccccc',
  brightBlack: '#767676',
  brightRed: '#e74856',
  brightGreen: '#16c60c',
  brightYellow: '#f9f1a5',
  brightBlue: '#3b78ff',
  brightMagenta: '#b4009e',
  brightCyan: '#61d6d6',
  brightWhite: '#f2f2f2',
};

// Prompt customizers such as Oh My Posh use Nerd Font private-use glyphs for
// Git/status icons. Prefer the common family names used by terminal profiles,
// then their Mono variants, standard monospace fonts, and CJK fallbacks.
const TERMINAL_FONT_FAMILY =
  "'MesloLGM Nerd Font', 'MesloLGL Nerd Font', " +
  "'CaskaydiaCove Nerd Font', 'CaskaydiaMono Nerd Font', " +
  "'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', " +
  "'MesloLGM Nerd Font Mono', 'MesloLGL Nerd Font Mono', " +
  "'CaskaydiaCove Nerd Font Mono', 'JetBrainsMono Nerd Font Mono', " +
  "'Cascadia Mono', Consolas, 'Microsoft YaHei UI', 'Microsoft YaHei', " +
  "'PingFang SC', 'Noto Sans Mono CJK SC', monospace";

const ignoreTerminalActionFailure = (operation: Promise<unknown>): void => {
  void operation.catch(() => undefined);
};

const TerminalPanel = ({ cwd, isObscured, terminalId }: TerminalPanelProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const backendTerminalIdRef = useRef<string | null>(null);
  const createPromiseRef = useRef<ReturnType<typeof window.electron.terminal.create> | null>(null);
  const backendReadyRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const backendTerminalId =
      backendTerminalIdRef.current ?? `${terminalId}:${crypto.randomUUID()}`;
    backendTerminalIdRef.current = backendTerminalId;
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    const terminal = new Terminal({
      allowTransparency: false,
      convertEol: true,
      cursorBlink: true,
      drawBoldTextInBrightColors: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      fontWeightBold: 600,
      scrollback: 10_000,
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;
    let disposed = false;

    const fitAndResize = () => {
      if (disposed || host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        // A hidden panel can report transient zero dimensions while tabs switch.
      }
    };

    const unsubscribeData = window.electron.terminal.onData(event => {
      if (event.id === backendTerminalId) terminal.write(event.data);
    });
    const unsubscribeExit = window.electron.terminal.onExit(event => {
      if (event.id !== backendTerminalId) return;
      backendReadyRef.current = false;
      terminal.write(
        `\r\n${i18nService.t('coworkTerminalExited').replace('{code}', String(event.exitCode))}\r\n`,
      );
    });
    const inputSubscription = terminal.onData(data => {
      if (backendReadyRef.current) {
        ignoreTerminalActionFailure(
          window.electron.terminal.write({ id: backendTerminalId, data }),
        );
      }
    });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      if (backendReadyRef.current) {
        ignoreTerminalActionFailure(
          window.electron.terminal.resize({ id: backendTerminalId, cols, rows }),
        );
      }
    });
    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(host);
    fitAndResize();

    const createPromise =
      createPromiseRef.current ??
      window.electron.terminal
        .create({
          id: backendTerminalId,
          cwd,
          cols: terminal.cols,
          rows: terminal.rows,
        })
        .catch(() => ({ success: false }) as const);
    createPromiseRef.current = createPromise;
    void createPromise.then(result => {
      if (disposed) return;
      if (!result.success) {
        terminal.write(`\r\n${i18nService.t('coworkTerminalCreateFailed')}\r\n`);
        return;
      }
      backendReadyRef.current = true;
      fitAndResize();
      terminal.focus();
    });

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      inputSubscription.dispose();
      resizeSubscription.dispose();
      unsubscribeData();
      unsubscribeExit();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      // Delay backend teardown by one task. React StrictMode immediately reruns
      // this effect in development, where the new run cancels this pending close
      // and reuses the same PTY instead of killing the just-created shell.
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        void createPromise.then(result => {
          if (result.success) {
            ignoreTerminalActionFailure(window.electron.terminal.close(backendTerminalId));
          }
          backendReadyRef.current = false;
          createPromiseRef.current = null;
        });
      }, 0);
    };
  }, [cwd, terminalId]);

  useEffect(() => {
    if (isObscured) return;
    const frame = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        terminalRef.current?.focus();
      } catch {
        // The shared display panel may still be measuring after becoming visible.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [isObscured]);

  return (
    <section
      className={`${isObscured ? 'hidden' : 'flex'} absolute inset-0 min-h-0 flex-col bg-[#0c0c0c] p-2`}
      aria-label={i18nService.t('coworkTerminal')}
      aria-hidden={isObscured}
    >
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
    </section>
  );
};

export default TerminalPanel;
