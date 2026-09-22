import { browserPermissionKeys } from './browserPanelSecurity';

export class BrowserPermissionState {
  private grants = new Map<number, Set<string>>();
  private generations = new Map<number, number>();

  has(
    guestId: number,
    origin: string,
    permission: string,
    mediaTypes?: readonly string[],
  ): boolean {
    const keys = browserPermissionKeys(origin, permission, mediaTypes);
    return keys.length > 0 && keys.every(key => this.grants.get(guestId)?.has(key));
  }

  grant(guestId: number, origin: string, permission: string, mediaTypes?: readonly string[]): void {
    const grants = this.grants.get(guestId) ?? new Set<string>();
    browserPermissionKeys(origin, permission, mediaTypes).forEach(key => grants.add(key));
    this.grants.set(guestId, grants);
  }

  capture(guestId: number): () => boolean {
    const generation = this.generations.get(guestId) ?? 0;
    this.generations.set(guestId, generation);
    return () => this.generations.get(guestId) === generation;
  }

  invalidate(guestId: number): void {
    this.grants.delete(guestId);
    this.generations.set(guestId, (this.generations.get(guestId) ?? 0) + 1);
  }

  destroy(guestId: number): void {
    this.grants.delete(guestId);
    this.generations.delete(guestId);
  }
}

type Credentials = { username: string; password: string };
type AuthCallback = (username?: string, password?: string) => void;

export class BrowserHttpAuthRequests {
  private pending = new Map<
    string,
    {
      guestId: number;
      callback: AuthCallback;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private timeoutMs: number,
    private onDismiss: (event: { id: string; guestId: number }) => void,
  ) {}

  add(id: string, guestId: number, callback: AuthCallback): void {
    this.pending.set(id, {
      guestId,
      callback,
      timeout: setTimeout(() => this.resolve(id), this.timeoutMs),
    });
  }

  belongsTo(id: string, guestId: number): boolean {
    return this.pending.get(id)?.guestId === guestId;
  }

  resolve(id: string, credentials?: Credentials): void {
    const request = this.pending.get(id);
    if (!request) return;
    this.pending.delete(id);
    clearTimeout(request.timeout);
    try {
      this.onDismiss({ id, guestId: request.guestId });
    } catch {
      // The application renderer may have been destroyed during shutdown.
    } finally {
      // Electron may already have discarded a destroyed frame's login callback.
      try {
        if (credentials) request.callback(credentials.username, credentials.password);
        else request.callback();
      } catch {
        // The request is already removed; never retain credentials or retry it.
      }
    }
  }

  cancelGuest(guestId: number): void {
    for (const [id, request] of this.pending) {
      if (request.guestId === guestId) this.resolve(id);
    }
  }

  dispose(): void {
    for (const id of this.pending.keys()) this.resolve(id);
  }
}
