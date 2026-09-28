// The Cosmos REST API of the chain (xid module), with failover across the
// node's configured endpoint list. Only network errors and 5xx fail over: a
// 404 is a real answer (an address with no primary name).
(function () {
  window.Rest = {
    index: 0,

    urls: function () {
      var list = window.Chain && Chain.restUrls && Chain.restUrls.length ? Chain.restUrls : [Chain.DEFAULT_REST];
      return list;
    },

    // -> {ok, status, data}
    get: async function (path) {
      var urls = this.urls();
      var lastErr = null;
      // Keep this request's retry order stable across concurrent completions.
      var startIndex = this.index;
      for (var n = 0; n < urls.length; n++) {
        var idx = (startIndex + n) % urls.length;
        var base = urls[idx].replace(/\/+$/, "");
        var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
        try {
          var res = await fetch(base + path, controller ? { signal: controller.signal } : {});
          if (res.status >= 500) { lastErr = new Error("HTTP " + res.status); continue; }
          var data = null;
          try { data = await res.json(); } catch (e) { data = null; }
          if (res.ok && (!data || typeof data !== "object")) throw new Error("The chain returned an unreadable response. Try again.");
          this.index = idx;
          return { ok: res.ok, status: res.status, data: data,
            height: res.headers ? res.headers.get("x-cosmos-block-height") : null };
        } catch (e) {
          lastErr = e;
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      throw lastErr || new Error("Failed to fetch");
    },

    // {primary_name: {name, tld, owner}}; 404 when the address has none.
    reverse: function (b32) {
      return this.get("/xid/v1/reverse/" + encodeURIComponent(b32));
    },

    // {names: [{name, tld, owner}], pagination: {total}}
    names: function (b32, opts) {
      opts = opts || {};
      var q = "?pagination.limit=" + (opts.limit || 100) + "&pagination.count_total=true";
      if (opts.key) q += "&pagination.key=" + encodeURIComponent(opts.key);
      else if (opts.offset) q += "&pagination.offset=" + opts.offset;
      return this.get("/xid/v1/names/" + encodeURIComponent(b32) + q);
    },

    // One page of a wallet's names: {names, total}. Throws on a non-2xx.
    namesPage: async function (b32, page, size) {
      var res = await this.names(b32, { limit: size, offset: page * size });
      if (!res.ok) throw new Error("Failed to fetch names");
      var data = res.data || {};
      if (!Array.isArray(data.names)) throw new Error("The chain returned an invalid names response.");
      return {
        names: data.names || [],
        total: parseInt((data.pagination && data.pagination.total) || data.names.length, 10),
        nextKey: (data.pagination && data.pagination.next_key) || ""
      };
    },

    // The chain caps a page at its configured maximum, regardless of the
    // requested limit. Follow its cursor rather than treating one page as all.
    namesAll: async function (b32) {
      var names = [], seen = new Set(), cursors = new Set(), key = "", total = 0;
      for (var page = 0; page < 1000; page++) {
        var res = await this.names(b32, { limit: 100, key: key });
        if (!res.ok || !res.data || !Array.isArray(res.data.names)) throw new Error("Could not load your names. Try again.");
        var data = res.data;
        data.names.forEach(function (entry) {
          var id = entry.tld + "/" + entry.name;
          if (!seen.has(id)) { seen.add(id); names.push(entry); }
        });
        total = Math.max(total, Number((data.pagination || {}).total) || 0);
        key = (data.pagination || {}).next_key || "";
        if (!key) return { names: names, total: Math.max(total, names.length) };
        if (cursors.has(key)) throw new Error("The names list changed while loading. Please try again.");
        cursors.add(key);
      }
      throw new Error("This wallet has too many names to load at once. Use My Names to browse them.");
    },

    // {name_record: {name, tld, owner}, identity: {address, label, active, added_at, revoked_at}}
    reverseIdentity: function (b32) {
      return this.get("/xid/v1/reverse_identity/" + encodeURIComponent(b32));
    },

    // {records: [{record_type, value, ttl}]}
    dns: function (tld, name) {
      return this.get("/xid/v1/dns/" + encodeURIComponent(tld) + "/" + encodeURIComponent(name));
    },

    // {tlds: [{tld, enabled, price_tiers: [{max_length, price}]}]}
    tlds: function () {
      return this.get("/xid/v1/tlds");
    },

    // {total_names, total_fees_burned, tld_stats: [{tld, name_count, fees_burned, enabled}]}
    stats: function () {
      return this.get("/xid/v1/stats");
    },

    // The Cosmos transaction wrapping an EVM transaction, by its `0x` hash, or
    // null when the chain has not indexed it (yet). The EVM module emits the
    // `ethereum_tx.ethereumTxHash` event; the tx service searches it.
    cosmosTxHash: async function (evmHash) {
      var q = encodeURIComponent("ethereum_tx.ethereumTxHash='" + evmHash + "'");
      var res = await this.get("/cosmos/tx/v1beta1/txs?query=" + q + "&pagination.limit=1");
      var rows = (res.ok && res.data && res.data.tx_responses) || [];
      return rows.length && rows[0].txhash ? String(rows[0].txhash) : null;
    }
  };
})();
