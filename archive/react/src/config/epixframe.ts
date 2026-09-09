/**
 * EpixFrame — TypeScript wrapper for the EpixNet postMessage API.
 *
 * When the xID UI runs inside an EpixNet iframe the wrapper parent provides
 * server info (theme, language) and config (chain_rpc_url) via postMessage.
 * This singleton exposes typed Promise-based helpers.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigItem {
  value: string | number | boolean | null;
  default: string | number | boolean | null;
  pending: boolean;
}

export interface ServerInfo {
  language: string;
  user_settings: Record<string, unknown>;
  version?: string;
  rev?: number;
  [key: string]: unknown;
}

export interface SiteInfo {
  auth_address: string;
  cert_user_id: string | null;
  address: string;
  address_short: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// EpixFrame class
// ---------------------------------------------------------------------------

class EpixFrame {
  private nonce: string | null;
  private nextId = 1;
  private callbacks = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

  constructor() {
    // wrapper_nonce can appear as a query param or hash param
    this.nonce =
      new URLSearchParams(window.location.search).get("wrapper_nonce") ??
      document.location.href.match(/wrapper_nonce=([A-Za-z0-9]+)/)?.[1] ??
      null;

    if (this.nonce) {
      window.addEventListener("message", this.onMessage);
      this.send({ cmd: "innerReady", params: {} });
    }
  }

  /** True when running inside an EpixNet iframe (wrapper_nonce present). */
  get isEmbedded(): boolean {
    return this.nonce !== null;
  }

  /**
   * Send a command to the EpixNet wrapper and return a promise.
   * Rejects if the response contains an `error` field (matches upstream cmdp).
   */
  cmd<T = any>(command: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.send({ cmd: command, params });
      this.callbacks.set(id, { resolve, reject });
    });
  }

  // -- convenience helpers --------------------------------------------------

  getServerInfo(): Promise<ServerInfo> {
    return this.cmd<ServerInfo>("serverInfo");
  }

  getConfigList(): Promise<Record<string, ConfigItem>> {
    return this.cmd<Record<string, ConfigItem>>("configList");
  }

  getSiteInfo(): Promise<SiteInfo> {
    return this.cmd<SiteInfo>("siteInfo");
  }

  // -- internals ------------------------------------------------------------

  private send(message: { cmd: string; params: Record<string, unknown> }): number {
    const id = this.nextId++;
    window.parent.postMessage(
      { ...message, wrapper_nonce: this.nonce, id },
      "*",
    );
    return id;
  }

  private onMessage = (e: MessageEvent) => {
    const data = e.data;
    if (!data || typeof data !== "object") return;

    if (data.cmd === "response" && typeof data.to === "number") {
      const cb = this.callbacks.get(data.to);
      if (cb) {
        this.callbacks.delete(data.to);
        if (data.result && data.result.error) {
          cb.reject(data.result.error);
        } else {
          cb.resolve(data.result);
        }
      }
    } else if (data.cmd === "ping") {
      // Respond to keep-alive pings from wrapper
      window.parent.postMessage(
        { cmd: "response", to: data.id, result: "pong", wrapper_nonce: this.nonce },
        "*",
      );
    }
  };
}

// Singleton — created once on module load.
export const epixFrame = new EpixFrame();
