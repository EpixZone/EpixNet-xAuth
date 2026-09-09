// The connected wallet: EpixKit does discovery, the picker and chain
// switching; ethers wraps the provider for signing. One connect button
// component, rendered in the sidebar and under the link wizard.
(function () {
  window.Wallet = {
    address: null,
    bech32: null,
    walletName: null,
    walletIcon: null,
    raw: null,
    browserProvider: null,
    balance: null,
    chainOk: true,
    ready: false,
    menuOpen: false,
    connectError: null,
    connecting: false,

    init: function () {
      if (typeof EpixKit === "undefined") return;
      var self = this;
      EpixKit.init({
        chainId: Chain.HEX,
        chainName: Chain.NAME,
        nativeCurrency: Chain.CURRENCY,
        rpcUrls: Chain.evmUrls,
        blockExplorerUrls: [Chain.evmExplorerUrl],
        onReconnect: function (result) { self.onConnected(result); }
      });
      this.ready = true;
      this.handleConnectClick = this.handleConnectClick.bind(this);
      this.handleMenuClick = this.handleMenuClick.bind(this);
      this.handleDisconnectClick = this.handleDisconnectClick.bind(this);
      this.handleCopyClick = this.handleCopyClick.bind(this);
      this.handleSwitchClick = this.handleSwitchClick.bind(this);
      document.addEventListener("click", function (e) {
        if (self.menuOpen && !(e.target.closest && e.target.closest(".wallet-wrap"))) {
          self.menuOpen = false;
          Page.render();
        }
      });
    },

    isConnected: function () {
      return !!this.address;
    },

    connect: async function () {
      if (!this.ready || this.connecting) return;
      this.connectError = null;
      this.connecting = true;
      Page.render();
      try {
        var result = await EpixKit.connect();
        await this.onConnected(result);
      } catch (err) {
        var msg = (err && err.message) || "";
        if (msg !== "User cancelled" && msg !== "No wallet detected") {
          this.connectError = msg || "Wallet connection failed";
        }
      }
      this.connecting = false;
      Page.render();
    },

    onConnected: async function (result) {
      var self = this;
      this.raw = result.provider;
      this.browserProvider = new ethers.BrowserProvider(this.raw);
      this.address = ethers.getAddress(result.address);
      this.bech32 = Bech32.evmToBech32(this.address);
      this.walletName = result.walletName || "";
      this.walletIcon = result.walletIcon || null;
      if (this.raw && this.raw.on && !this.raw._xidHooked) {
        this.raw._xidHooked = true;
        this.raw.on("accountsChanged", function (accounts) {
          if (!accounts || !accounts.length) { self.disconnect(); return; }
          self.onConnected({ provider: self.raw, address: accounts[0], walletName: self.walletName, walletIcon: self.walletIcon });
        });
        this.raw.on("chainChanged", function () { self.checkChain(); });
      }
      await this.checkChain();
      this.loadBalance();
      Page.onWalletChanged();
      Page.render();
    },

    disconnect: function () {
      if (typeof EpixKit !== "undefined") EpixKit.disconnect();
      this.address = null;
      this.bech32 = null;
      this.walletName = null;
      this.walletIcon = null;
      this.raw = null;
      this.browserProvider = null;
      this.balance = null;
      this.menuOpen = false;
      Page.onWalletChanged();
      Page.render();
    },

    checkChain: async function () {
      if (!this.browserProvider) return;
      try {
        var net = await this.browserProvider.getNetwork();
        this.chainOk = Number(net.chainId) === Chain.ID;
      } catch (e) {
        this.chainOk = false;
      }
      Page.render();
    },

    switchChain: async function () {
      if (!this.raw) return;
      try {
        await this.raw.request({ method: "wallet_switchEthereumChain", params: [{ chainId: Chain.HEX }] });
      } catch (err) {
        if (err && err.code === 4902) {
          await this.raw.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: Chain.HEX,
              chainName: Chain.NAME,
              rpcUrls: Chain.evmUrls,
              blockExplorerUrls: [Chain.evmExplorerUrl],
              nativeCurrency: Chain.CURRENCY
            }]
          });
        } else {
          throw err;
        }
      }
      await this.checkChain();
    },

    // The signer for a write, on the right chain.
    signer: async function () {
      if (!this.browserProvider) throw new Error("Connect your wallet first");
      if (!this.chainOk) await this.switchChain();
      if (!this.chainOk) throw new Error("Switch your wallet to the Epix network");
      return this.browserProvider.getSigner(this.address);
    },

    loadBalance: function () {
      var self = this;
      if (!this.address) return;
      Chain.withRpc(function (p) { return p.getBalance(self.address); }).then(function (bal) {
        var n = Number(ethers.formatEther(bal));
        self.balance = n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(4).replace(/\.?0+$/, "");
        Page.render();
      }).catch(function () {});
    },

    handleConnectClick: function () { this.connect(); return false; },
    handleMenuClick: function () { this.menuOpen = !this.menuOpen; Page.render(); return false; },
    handleDisconnectClick: function () { this.disconnect(); return false; },
    handleSwitchClick: function () { this.switchChain().catch(function () {}); return false; },
    handleCopyClick: function () {
      if (this.address && navigator.clipboard) navigator.clipboard.writeText(this.address);
      this.menuOpen = false;
      Page.render();
      return false;
    },

    // The connect button / account chip. opts.compact hides the balance.
    renderButton: function (opts) {
      opts = opts || {};
      if (!this.isConnected()) {
        return h("div.wallet-wrap", { key: "wallet" }, [
          h("a.btn.btn-primary.btn-block", {
            href: "#Connect",
            onclick: this.handleConnectClick,
            title: "Connect Wallet",
            classes: { disabled: this.connecting }
          }, [Icons.wallet(), h("span.btn-label", this.connecting ? "Connecting..." : "Connect Wallet")]),
          this.connectError ? h("div.msg.msg-err.wallet-error", [this.connectError]) : null
        ]);
      }
      if (!this.chainOk) {
        return h("div.wallet-wrap", { key: "wallet" }, [
          h("a.btn.btn-warn.btn-block", { href: "#Switch", onclick: this.handleSwitchClick, title: "Switch to Epix" }, [
            Icons.warning(), h("span.btn-label", "Switch to Epix")
          ])
        ]);
      }
      return h("div.wallet-wrap", { key: "wallet" }, [
        h("a.wallet-chip", {
          href: "#Account",
          onclick: this.handleMenuClick,
          title: this.address,
          classes: { "is-open": this.menuOpen }
        }, [
          this.walletIcon ? h("img.wallet-icon", { src: this.walletIcon, alt: "" }) : h("span.wallet-dot"),
          h("span.wallet-meta", [
            h("span.wallet-addr.mono", Text.truncateAddress(this.address, 4)),
            !opts.compact && this.balance !== null ? h("span.wallet-balance", this.balance + " EPIX") : null
          ])
        ]),
        this.menuOpen ? h("div.wallet-menu", [
          h("div.wallet-menu-row", [h("span.overline", "EVM"), h("span.mono.small", this.address)]),
          h("div.wallet-menu-row", [h("span.overline", "Cosmos"), h("span.mono.small", this.bech32)]),
          this.walletName ? h("div.wallet-menu-row", [h("span.overline", "Wallet"), h("span.small", this.walletName)]) : null,
          h("div.wallet-menu-actions", [
            h("a.btn.btn-ghost.btn-sm", { href: "#Copy", onclick: this.handleCopyClick }, "Copy address"),
            h("a.btn.btn-ghost.btn-sm", { href: "#Disconnect", onclick: this.handleDisconnectClick }, "Disconnect")
          ])
        ]) : null
      ]);
    }
  };
})();
