// Epix chain facts and the read-only RPC layer. RPC URLs come from the node's
// serverInfo (`chain_evm_rpc_urls`, `chain_rpc_urls`) with failover across the
// list; the built-in defaults serve a page opened outside the wrapper.
//
// Two explorers: the Epix Explorer xite (in-network; Cosmos transaction hashes
// and bech32 accounts) and the EVM explorer at `chain_block_explorer_url`
// (Blockscout at scan.epix.zone by default; `0x` transaction hashes, and the
// only form a wallet accepts as chain metadata). A write returns an EVM hash;
// `Rest.cosmosTxHash` maps it to the wrapping Cosmos transaction so the link
// can stay in-network.
(function () {
  window.Chain = {
    ID: 1916,
    HEX: "0x77C",
    NAME: "Epix",
    CURRENCY: { name: "EPIX", symbol: "EPIX", decimals: 18 },
    DEFAULT_TLD: "epix",
    DEFAULT_EVM: "https://evmrpc.epix.zone",
    DEFAULT_REST: "https://api.epix.zone",
    DEFAULT_EXPLORER: "https://scan.epix.zone",
    // The Epix Explorer xite: transactions and accounts are shown there.
    EXPLORER_XITE: "epix1epxrwflutk4j2saxuy84wvv52tdepuep8yqcqk",

    evmUrls: [],
    restUrls: [],
    explorerUrl: "",
    evmExplorerUrl: "",
    evmIndex: 0,
    providers: {},

    init: function (serverInfo) {
      var info = serverInfo || {};
      this.evmUrls = this.list(info.chain_evm_rpc_urls, info.chain_evm_rpc_url, this.DEFAULT_EVM);
      this.restUrls = this.list(info.chain_rpc_urls, info.chain_rpc_url, this.DEFAULT_REST);
      this.explorerUrl = "/" + this.EXPLORER_XITE;
      this.evmExplorerUrl = String(info.chain_block_explorer_url || this.DEFAULT_EXPLORER).replace(/\/+$/, "");
      this.providers = {};
      this.evmIndex = 0;
    },

    initDefaults: function () {
      this.init({});
    },

    list: function (many, one, fallback) {
      var out = [];
      var push = function (v) {
        if (typeof v !== "string") return;
        v.split(/[\n,]/).forEach(function (s) {
          s = s.trim();
          if (s && out.indexOf(s) === -1) out.push(s);
        });
      };
      if (Array.isArray(many)) many.forEach(push);
      else push(many);
      push(one);
      if (!out.length) out.push(fallback);
      return out;
    },

    // A provider bound to the configured network: no eth_chainId round trip
    // on first use, so a dead first URL cannot stall the page before failover.
    provider: function (i) {
      if (!this.providers[i]) {
        var url = this.evmUrls[i] || this.DEFAULT_EVM;
        this.providers[i] = new ethers.JsonRpcProvider(
          url,
          { chainId: this.ID, name: "epix" },
          { staticNetwork: true }
        );
      }
      return this.providers[i];
    },

    readProvider: function () {
      return this.provider(this.evmIndex);
    },

    isNetworkError: function (e) {
      var code = e && e.code;
      return code === "NETWORK_ERROR" || code === "TIMEOUT" || code === "SERVER_ERROR" || (e instanceof TypeError);
    },

    // Run `fn(provider)` against the endpoints in turn. Only network-class
    // failures move to the next URL; a revert (CALL_EXCEPTION) is an answer
    // and is thrown as is.
    withRpc: async function (fn) {
      var urls = this.evmUrls.length ? this.evmUrls : [this.DEFAULT_EVM];
      var lastErr = null;
      for (var n = 0; n < urls.length; n++) {
        var idx = (this.evmIndex + n) % urls.length;
        try {
          var res = await fn(this.provider(idx));
          this.evmIndex = idx;
          return res;
        } catch (e) {
          if (!this.isNetworkError(e)) throw e;
          lastErr = e;
        }
      }
      throw lastErr || new Error("No RPC endpoint reachable");
    },

    // In-network explorer links into the Epix Explorer xite (`?tx=` takes the
    // COSMOS hash, `?account=` a bech32 address); with `<base target="_top">`
    // they leave the wrapper frame.
    explorerTxUrl: function (cosmosHash) {
      return this.explorerUrl + "/?tx=" + cosmosHash;
    },

    // The EVM explorer's page for a `0x` transaction hash (Blockscout layout).
    evmTxUrl: function (hash) {
      return this.evmExplorerUrl + "/tx/" + hash;
    },

    explorerAccountUrl: function (addr) {
      return this.explorerUrl + "/?account=" + addr;
    }
  };
})();
