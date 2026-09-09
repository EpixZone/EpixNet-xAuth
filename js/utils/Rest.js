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
      for (var n = 0; n < urls.length; n++) {
        var idx = (this.index + n) % urls.length;
        var base = urls[idx].replace(/\/+$/, "");
        try {
          var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
          var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
          var res = await fetch(base + path, controller ? { signal: controller.signal } : {});
          if (timer) clearTimeout(timer);
          if (res.status >= 500) { lastErr = new Error("HTTP " + res.status); continue; }
          this.index = idx;
          var data = null;
          try { data = await res.json(); } catch (e) { data = null; }
          return { ok: res.ok, status: res.status, data: data };
        } catch (e) {
          lastErr = e;
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
      if (opts.offset) q += "&pagination.offset=" + opts.offset;
      return this.get("/xid/v1/names/" + encodeURIComponent(b32) + q);
    },

    // One page of a wallet's names: {names, total}. Throws on a non-2xx.
    namesPage: async function (b32, page, size) {
      var res = await this.names(b32, { limit: size, offset: page * size });
      if (!res.ok) throw new Error("Failed to fetch names");
      var data = res.data || {};
      return {
        names: data.names || [],
        total: parseInt((data.pagination && data.pagination.total) || "0", 10)
      };
    },

    // {name_record: {name, tld, owner}, peer: {address, label, active, added_at, revoked_at}}
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
