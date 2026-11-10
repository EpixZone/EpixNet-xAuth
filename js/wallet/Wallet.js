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
    balanceRaw: null,
    balanceLoading: false,
    balanceError: null,
    revision: 0,
    balanceRequest: null,
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
      var revision = ++this.revision;
      this.clearBalance();
      this.chainOk = false;
      this.raw = result.provider;
      this.browserProvider = new ethers.BrowserProvider(this.raw, "any");
      this.address = ethers.getAddress(result.address);
      this.bech32 = Bech32.evmToBech32(this.address);
      this.walletName = result.walletName || "";
      this.walletIcon = result.walletIcon || null;
      if (this.raw && this.raw.on && !this.raw._xidHooked) {
        var hookedProvider = this.raw;
        this.raw._xidHooked = true;
        this.raw.on("accountsChanged", function (accounts) {
          if (self.raw !== hookedProvider) return;
          if (!accounts || !accounts.length) { self.disconnect(); return; }
          self.onConnected({ provider: self.raw, address: accounts[0], walletName: self.walletName, walletIcon: self.walletIcon });
        });
        this.raw.on("chainChanged", function () {
          if (self.raw !== hookedProvider) return;
          ++self.revision;
          self.clearBalance();
          self.chainOk = false;
          self.browserProvider = new ethers.BrowserProvider(self.raw, "any");
          Page.onWalletChanged();
          self.checkChain().then(function (current) {
            if (!current) return;
            self.loadBalance();
            Page.onWalletChanged();
          });
        });
      }
      Page.onWalletChanged();
      await this.checkChain();
      if (revision !== this.revision) return;
      this.loadBalance();
      Page.onWalletChanged();
      Page.render();
    },

    disconnect: function () {
      if (typeof EpixKit !== "undefined") EpixKit.disconnect();
      ++this.revision;
      this.clearBalance();
      this.address = null;
      this.bech32 = null;
      this.walletName = null;
      this.walletIcon = null;
      this.raw = null;
      this.browserProvider = null;
      this.chainOk = false;
      this.menuOpen = false;
      Page.onWalletChanged();
      Page.render();
    },

    checkChain: async function () {
      if (!this.browserProvider) return false;
      var raw = this.raw, revision = this.revision, valid = false;
      try {
        var id = await raw.request({ method: "eth_chainId" });
        valid = Number(id) === Chain.ID;
      } catch (e) {}
      if (revision !== this.revision || raw !== this.raw) return false;
      this.chainOk = valid;
      Page.render();
      return true;
    },

    switchChain: async function () {
      if (!this.raw) return;
      var raw = this.raw, address = this.address;
      try {
        await raw.request({ method: "wallet_switchEthereumChain", params: [{ chainId: Chain.HEX }] });
      } catch (err) {
        if (err && err.code === 4902) {
          await raw.request({
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
      if (raw !== this.raw || address !== this.address) throw new Error("Your wallet changed. Review the details and try again.");
      await this.checkChain();
      Page.onWalletChanged();
    },

    // The signer for a write, on the right chain.
    signer: async function () {
      if (!this.browserProvider) throw new Error("Connect your wallet first");
      var address = this.address, raw = this.raw;
      if (!this.chainOk) await this.switchChain();
      if (!this.chainOk) throw new Error("Switch your wallet to the Epix network");
      if (address !== this.address || raw !== this.raw) throw new Error("Your wallet changed. Review the details and try again.");
      var signer = await this.browserProvider.getSigner(address);
      if (address !== this.address || raw !== this.raw) throw new Error("Your wallet changed. Review the details and try again.");
      return signer;
    },

    clearBalance: function () {
      this.balance = this.balanceRaw = this.balanceError = this.balanceRequest = null;
      this.balanceLoading = false;
    },

    loadBalance: function () {
      var self = this, address = this.address, revision = this.revision;
      if (!address) return Promise.resolve(null);
      if (this.balanceRequest) return this.balanceRequest;
      this.balance = this.balanceRaw = this.balanceError = null;
      this.balanceLoading = true;
      Page.render();
      var request = Chain.withRpc(function (p) { return p.getBalance(address); }).then(function (bal) {
        if (revision !== self.revision || address !== self.address) return null;
        if (typeof bal !== "bigint" || bal < 0n) throw new Error("The balance service returned an invalid amount.");
        self.balanceRaw = bal;
        var n = Number(ethers.formatEther(bal));
        self.balance = n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(4).replace(/\.?0+$/, "");
        return bal;
      }).catch(function () {
        if (revision === self.revision && address === self.address) {
          self.balance = self.balanceRaw = null;
          self.balanceError = "Could not check your EPIX balance. Try again.";
        }
        return null;
      }).finally(function () {
        if (self.balanceRequest !== request) return;
        self.balanceLoading = false;
        self.balanceRequest = null;
        Page.render();
      });
      this.balanceRequest = request;
      return request;
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

    renderHelp: function () {
      return h("div.wallet-help.stack-sm", [
        h("h3", "Before you connect"),
        h("p.small", "Connecting requests your selected public wallet address and the Epix network. xID then reads that address's public balance and owned names. It never requests your recovery phrase or private key."),
        h("p.small", "Connecting is free and does not send a transaction. Registering a name or linking an identity asks for a separate approval in your wallet. Names, owner addresses and linked identities are public on-chain."),
        h("details", [
          h("summary", "Network and costs"),
          h("div.stack-sm", [
            h("p.small", "Use an EVM-compatible wallet. xID asks it to switch to Epix (chain ID 1916), or add Epix if it is missing. EPIX is the network's native currency; importing a token is not required. The selected account needs EPIX on Epix to pay for transactions."),
            h("p.small", "Registration costs the current name-length fee plus a network transaction fee. The name fee is burned and taken directly from your account. Linking a name you already own has a network transaction fee, with no new registration charge."),
            h("p.small", "Check the live name fee before registering and review the network fee in your wallet. Network fees vary; registration and linking are separate transactions."),
            h("a.text-link.small", { href: "?Prices", target: "_blank", rel: "noopener noreferrer" }, "Preview current registration prices")
          ])
        ])
      ]);
    },

    // The connect button / account chip. opts.compact hides the balance.
    renderButton: function (opts) {
      opts = opts || {};
      if (!this.isConnected()) {
        return h("div.wallet-wrap", { key: "wallet" }, [
          h("button.btn.btn-primary.btn-block", {
            type: "button",
            onclick: this.handleConnectClick,
            title: "Connect Wallet",
            disabled: this.connecting
          }, [Icons.wallet(), h("span.btn-label", this.connecting ? "Connecting..." : "Connect Wallet")]),
          this.connectError ? h("div.msg.msg-err.wallet-error", [this.connectError]) : null
        ]);
      }
      if (!this.chainOk) {
        return h("div.wallet-wrap", { key: "wallet" }, [
          h("button.btn.btn-warn.btn-block", { type: "button", onclick: this.handleSwitchClick, title: "Switch to Epix" }, [
            Icons.warning(), h("span.btn-label", "Switch to Epix")
          ])
        ]);
      }
      return h("div.wallet-wrap", { key: "wallet" }, [
        h("button.wallet-chip", {
          type: "button",
          onclick: this.handleMenuClick,
          title: this.address,
          "aria-expanded": this.menuOpen ? "true" : "false",
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
            h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: this.handleCopyClick }, "Copy address"),
            h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: this.handleDisconnectClick }, "Disconnect")
          ])
        ]) : null
      ]);
    }
  };
})();
