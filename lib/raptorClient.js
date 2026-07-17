import { SwapError } from "./errors.js";
import { DEFAULT_RAPTOR_BASE_URL } from "./constants.js";

/**
 * @typedef {object} RaptorClientOptions
 * @property {string} [baseUrl]
 * @property {string} apiKey
 * @property {typeof fetch} [fetchImpl]
 */

export class RaptorClient {
  /**
   * @param {RaptorClientOptions} options
   */
  constructor(options) {
    if (!options?.apiKey || typeof options.apiKey !== "string" || !options.apiKey.trim()) {
      throw new SwapError("Raptor API key is required. Run `summon keychain store-api-key`.");
    }
    this.baseUrl = String(options.baseUrl || DEFAULT_RAPTOR_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey.trim();
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
  }

  /**
   * @param {string} path
   * @param {RequestInit} [init]
   */
  async request(path, init = {}) {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    const headers = {
      Accept: "application/json",
      "x-api-key": this.apiKey,
      ...(init.headers || {}),
    };
    if (init.body && !headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }

    let res;
    try {
      res = await this.fetchImpl(url, { ...init, headers });
    } catch (err) {
      throw new SwapError(`Raptor request failed: ${err?.message || err}`, { cause: err });
    }

    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text };
      }
    }

    if (!res.ok) {
      const message = body?.error || body?.message || text || `HTTP ${res.status}`;
      const code = body?.code != null ? ` (code ${body.code})` : "";
      const err = new SwapError(`Raptor error${code}: ${message}`, {
        details: { status: res.status, body },
      });
      err.status = res.status;
      throw err;
    }

    return body;
  }

  async health() {
    return this.request("/health");
  }

  /**
   * @param {Record<string, string|number|boolean|undefined|null>} query
   */
  async getQuote(query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null || value === "") continue;
      params.set(key, String(value));
    }
    return this.request(`/quote?${params.toString()}`);
  }

  /**
   * @param {object} body
   */
  async buildSwap(body) {
    return this.request("/swap", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * @param {object} body
   */
  async quoteAndSwap(body) {
    return this.request("/quote-and-swap", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * @param {string} signedTransactionBase64
   */
  async sendTransaction(signedTransactionBase64) {
    return this.request("/send-transaction", {
      method: "POST",
      body: JSON.stringify({ transaction: signedTransactionBase64 }),
    });
  }

  /**
   * @param {string} signature
   */
  async getTransactionStatus(signature) {
    return this.request(`/transaction/${encodeURIComponent(signature)}`);
  }
}
