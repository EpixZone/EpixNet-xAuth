// The link wizard: connect a wallet, pick (or register) an xID, link the
// EpixNet identity address to it. The node sends users here with
// `?linkIdentity=<addr>&returnTo=/<xite>`; after the transaction the page
// polls the node until the identity resolves, then navigates back.
(function () {
  var STEPS = ["Connect Wallet", "Select xID", "Link Identity"];

  class AddPeerPage {
    constructor() {
      this.peerAddress = "";
      this.returnTo = "";
      this.selectedName = "";
      this.selectedTld = "";
      this.names = [];
      this.namesLoading = false;
      this.primaryName = "";
      this.primaryTld = "";
      this.primaryLoading = false;
      this.showRegister = false;
      this.newName = "";
      this.showTiers = false;
      this.priceTiers = [];
      this.tiersLoading = false;
      this.tiersLoaded = false;
      this.resolving = false;
      this.isAvailable = false;
      this.fee = null;
      this.feeLoading = false;
      this.seq = 0;
      this.registerTx = new TxState();
      this.linkTx = new TxState();
      this.linkStatus = "idle";
      this.pollTimer = null;
      this.timeoutTimer = null;
      this.walletAddress = null;
      this.handleRegisterToggle = this.handleRegisterToggle.bind(this);
      this.handleNewNameInput = this.handleNewNameInput.bind(this);
      this.handleTiersToggle = this.handleTiersToggle.bind(this);
      this.handleRegister = this.handleRegister.bind(this);
      this.handleLink = this.handleLink.bind(this);
      this.handleShowRegister = this.handleShowRegister.bind(this);
      this.handleSelectClick = this.handleSelectClick.bind(this);
    }

    enter(peerAddress, returnTo) {
      this.peerAddress = peerAddress || "";
      this.returnTo = returnTo || "";
      this.onWalletChanged();
    }

    leave() { this.stopTimers(); }

    onWalletChanged() {
      if (Wallet.address !== this.walletAddress) {
        this.walletAddress = Wallet.address;
        this.selectedName = "";
        this.selectedTld = "";
        this.names = [];
      }
      if (Wallet.address) {
        this.loadNames();
        this.loadPrimary();
      }
    }

    currentStep() {
      if (!Wallet.isConnected()) return 0;
      if (!this.selectedName) return 1;
      return 2;
    }

    async loadNames() {
      this.namesLoading = true;
      Page.render();
      try {
        var res = await Rest.names(Bech32.evmToBech32(Wallet.address), { limit: 100 });
        if (!res.ok) throw new Error("Failed to fetch names");
        this.names = (res.data && res.data.names) || [];
      } catch (e) {
        this.names = [];
      }
      this.namesLoading = false;
      this.autoSelect();
      Page.render();
    }

    loadPrimary() {
      var self = this;
      this.primaryLoading = true;
      XidContract.read("getPrimaryName", [Wallet.address]).then(function (r) {
        self.primaryName = String(r[0] || "");
        self.primaryTld = String(r[1] || "");
        self.primaryLoading = false;
        self.autoSelect();
        Page.render();
      }).catch(function () {
        self.primaryLoading = false;
        Page.render();
      });
    }

    // The primary name wins; else the only name the wallet owns.
    autoSelect() {
      if (this.selectedName) return;
      if (this.primaryName && this.primaryTld) {
        this.selectedName = this.primaryName;
        this.selectedTld = this.primaryTld;
      } else if (this.names.length === 1) {
        this.selectedName = this.names[0].name;
        this.selectedTld = this.names[0].tld;
      }
    }

    handleSelectClick(e) {
      var el = e.currentTarget;
      return this.select(el.getAttribute("data-name"), el.getAttribute("data-tld"));
    }

    select(name, tld) {
      this.selectedName = name;
      this.selectedTld = tld;
      Page.render();
      return false;
    }

    handleShowRegister() { this.showRegister = true; Page.render(); return false; }
    handleRegisterToggle() { this.showRegister = !this.showRegister; Page.render(); return false; }

    handleNewNameInput(e) {
      var self = this;
      this.newName = e.target.value.toLowerCase();
      var seq = ++this.seq;
      if (!this.newName) { this.resolving = false; Page.render(); return; }
      this.resolving = true;
      this.feeLoading = true;
      Page.render();
      Promise.all([
        XidContract.read("resolve", [this.newName, Chain.DEFAULT_TLD]),
        XidContract.read("getRegistrationFee", [this.newName, Chain.DEFAULT_TLD])
      ]).then(function (r) {
        if (seq !== self.seq) return;
        self.isAvailable = String(r[0]) === XidContract.ZERO;
        self.fee = r[1];
        self.resolving = false;
        self.feeLoading = false;
        Page.render();
      }).catch(function () {
        if (seq !== self.seq) return;
        self.resolving = false;
        self.feeLoading = false;
        self.isAvailable = false;
        Page.render();
      });
    }

    handleTiersToggle() {
      var self = this;
      this.showTiers = !this.showTiers;
      if (this.showTiers && !this.tiersLoaded && !this.tiersLoading) {
        this.tiersLoading = true;
        Rest.tlds().then(function (res) {
          var tlds = (res.data && res.data.tlds) || [];
          var tld = tlds.find(function (t) { return t.tld === Chain.DEFAULT_TLD; });
          self.priceTiers = tld ? (tld.price_tiers || []) : [];
          self.tiersLoaded = true;
          self.tiersLoading = false;
          Page.render();
        }).catch(function () {
          self.tiersLoading = false;
          Page.render();
        });
      }
      Page.render();
      return false;
    }

    handleRegister() {
      var self = this;
      if (!this.newName || !this.isAvailable || this.registerTx.isBusy) return false;
      var name = this.newName;
      this.registerTx.run("register", [name, Chain.DEFAULT_TLD], function () {
        self.select(name, Chain.DEFAULT_TLD);
        self.loadNames();
        self.loadPrimary();
        self.showRegister = false;
        self.newName = "";
      });
      return false;
    }

    handleLink() {
      var self = this;
      if (!this.selectedName || !this.peerAddress || this.linkTx.isBusy) return false;
      this.linkTx.run("linkIdentity", [this.selectedName, this.selectedTld, this.peerAddress, "epixnet"], function () {
        self.startPolling();
      });
      return false;
    }

    stopTimers() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
      this.pollTimer = null;
      this.timeoutTimer = null;
    }

    redirect() {
      if (!this.returnTo) return;
      try { window.top.location.href = this.returnTo; } catch (e) { window.location.href = this.returnTo; }
    }

    // Every 3 s: drop the node's cached lookup and ask again, until the
    // identity resolves to a name (the node also records the link itself on
    // that first poll), with a 60 s cap either way.
    async startPolling() {
      var self = this;
      if (!Page.isEmbedded || !this.peerAddress) {
        if (this.returnTo) setTimeout(function () { self.redirect(); }, 1500);
        return;
      }
      this.linkStatus = "polling";
      Page.render();
      try { await Page.cmd("xidInvalidateCache", { address: this.peerAddress }); } catch (e) {}
      this.pollTimer = setInterval(async function () {
        try {
          await Page.cmd("xidInvalidateCache", { address: self.peerAddress });
          var result = await Page.cmd("xidResolve", { address: self.peerAddress });
          if (result && result.name) {
            self.stopTimers();
            self.linkStatus = "confirmed";
            Page.render();
            if (self.returnTo) setTimeout(function () { self.redirect(); }, 1000);
          }
        } catch (e) {}
      }, 3000);
      this.timeoutTimer = setTimeout(function () {
        self.stopTimers();
        self.linkStatus = "confirmed";
        Page.render();
        self.redirect();
      }, 60000);
    }

    renderSteps() {
      var current = this.currentStep();
      var items = [];
      STEPS.forEach(function (label, i) {
        var done = i < current, active = i === current;
        if (i > 0) items.push(h("div.step-line", { key: "line-" + i, classes: { "is-done": done } }));
        items.push(h("div.step", { key: "step-" + i }, [
          h("div.step-dot", { classes: { "is-done": done, "is-active": active } }, [done ? Icons.check(3) : String(i + 1)]),
          h("span.step-label", { classes: { "is-on": done || active } }, label)
        ]));
      });
      return h("div.steps", items);
    }

    renderConnect() {
      return h("div.spin-col", { key: "connect", style: "padding:32px 0;gap:20px" }, [
        h("div.icon-circle", [Icons.wallet()]),
        h("div.centered", [
          h("h2", { style: "font-size:18px" }, "Connect Your Wallet"),
          h("p.mid", { style: "max-width:320px;margin-top:8px" }, "You need to connect an EpixChain wallet to register an xID and add identity addresses.")
        ]),
        h("div.wizard-wallet", [Wallet.renderButton({ compact: true })])
      ]);
    }

    renderRegisterForm() {
      var self = this;
      var tld = Chain.DEFAULT_TLD, tx = this.registerTx, name = this.newName;
      var status = null;
      if (name) {
        if (this.resolving) status = h("p.mid.small", "Checking availability...");
        else if (this.isAvailable) status = h("div.stack-sm", [
          h("div.row-gap", [h("span.pill.pill-ok", "Available"), h("span.mid.small", name + "." + tld)]),
          h("div", [
            h("button.fee-toggle", { onclick: this.handleTiersToggle, classes: { "is-open": this.showTiers } }, [
              h("span.row-gap", { style: "gap:4px" }, ["Registration Fee", Icons.chevronDown()]),
              h("span", { style: "font-weight:500;color:var(--epix-text)" }, this.feeLoading ? "..." : Format.ether(this.fee) + " EPIX")
            ]),
            this.showTiers ? h("div.tiers-box", [
              h("div.tiers-head", [h("span.overline", "All Price Tiers for ." + tld)]),
              this.tiersLoading ? h("div.pad", { style: "padding:12px" }, h("span.dim.small", "Loading tiers..."))
                : this.priceTiers.length === 0 ? h("div.pad", { style: "padding:12px" }, h("span.dim.small", "Could not load pricing"))
                : h("table.table.table-compact", [h("tbody", this.priceTiers.map(function (tier, i) {
                    var current = Format.isCurrentTier(name.length, i, self.priceTiers);
                    return h("tr", { key: String(tier.max_length), classes: { "is-current": current } }, [
                      h("td", [Format.tierLabel(tier, i, self.priceTiers), current ? h("span", { style: "margin-left:6px;color:var(--epix-link);font-weight:500" }, "←") : null]),
                      h("td.num", { style: "color:var(--epix-link)" }, Format.epix(tier.price) + " EPIX")
                    ]);
                  }))])
            ]) : null
          ])
        ]);
        else status = h("div.row-gap", [h("span.pill.pill-bad", "Taken"), h("span.mid.small", name + "." + tld + " is already registered")]);
      }
      return h("div.card.stack-sm", { key: "register-form", style: "padding:16px" }, [
        h("h3", { style: "color:var(--epix-text)" }, "Register a New xID"),
        h("div.input-row", [
          h("input.input", { type: "text", value: name, placeholder: "Enter a name", oninput: this.handleNewNameInput, autocomplete: "off" }),
          h("span.suffix-chip", "." + tld)
        ]),
        status,
        h("a.btn.btn-primary.btn-block", { href: "#RegisterNew", onclick: this.handleRegister, classes: { disabled: !name || !this.isAvailable || tx.isBusy } },
          tx.isPending ? "Confirm in wallet..." : tx.isConfirming ? "Waiting for tx..." : "Register " + (name || "...") + "." + tld),
        tx.isSuccess ? h("div.msg.msg-ok.small", "Name registered successfully!") : null,
        tx.errorText ? h("div.msg.msg-err.small", tx.errorText) : null
      ]);
    }

    renderSelect() {
      var self = this;
      if (this.namesLoading || this.primaryLoading) {
        return h("div.spin-col", { key: "loading" }, [h("div.spinner"), h("p.mid", "Looking up your xID names...")]);
      }
      if (this.names.length === 0 && !this.showRegister) {
        return h("div.spin-col", { key: "none", style: "padding:24px 0;gap:16px" }, [
          h("div.icon-circle.warn", [Icons.warning()]),
          h("div.centered", [
            h("h2", { style: "font-size:18px" }, "No xID Found"),
            h("p.mid", { style: "max-width:320px;margin-top:4px" }, "You need to register an xID name before you can add an EpixNet identity address.")
          ]),
          h("a.btn.btn-primary", { href: "#RegisterNew", onclick: this.handleShowRegister }, "Register a New xID")
        ]);
      }
      return h("div.stack-sm", { key: "select", style: "gap:20px" }, [
        this.names.length ? h("div.stack-sm", [
          h("div.row-between", [
            h("h3", this.names.length === 1 ? "Your xID" : "Select an xID to use"),
            h("a.btn.btn-ghost.btn-sm", { href: "#RegisterNew", onclick: this.handleRegisterToggle }, this.showRegister ? "Cancel" : "+ Register New")
          ]),
          h("div.select-list", this.names.map(function (entry) {
            var selected = entry.name === self.selectedName && entry.tld === self.selectedTld;
            return h("button.select-row", { key: entry.tld + "/" + entry.name, classes: { "is-selected": selected }, onclick: self.handleSelectClick, "data-name": entry.name, "data-tld": entry.tld }, [
              h("span", entry.name + "." + entry.tld),
              selected ? h("span.check-dot", [Icons.check(3)]) : null
            ]);
          }))
        ]) : null,
        this.showRegister ? this.renderRegisterForm() : null
      ]);
    }

    renderLink() {
      var tx = this.linkTx;
      if (tx.isSuccess) {
        return h("div.spin-col", { key: "linked", style: "padding:32px 0;gap:16px" }, [
          h("div.icon-circle.ok", [Icons.check(2)]),
          h("div.centered", [
            h("h2.text-ok", { style: "font-size:18px" }, "Identity Linked!"),
            h("p.mid", { style: "margin-top:4px" }, [h("span.mono.small", this.peerAddress), " has been added to ", h("strong", this.selectedName + "." + this.selectedTld), "."])
          ]),
          this.returnTo && this.linkStatus === "polling" ? h("div.spin-row", [h("div.spinner.spinner-sm"), h("span", "Waiting for identity confirmation...")]) : null,
          this.returnTo && this.linkStatus === "confirmed" ? h("p.mid", "Redirecting back...") : null
        ]);
      }
      return h("div.stack-sm", { key: "link", style: "gap:16px" }, [
        h("div.card.stack-sm", { style: "padding:16px" }, [
          h("div.row-between", [h("span.mid", "Your xID"), h("span", { style: "font-weight:600" }, this.selectedName + "." + this.selectedTld)]),
          h("div", { style: "height:1px;background:var(--epix-border)" }),
          h("div", [
            h("span.mid", "EpixNet Identity"),
            h("p.mono.small.break", { style: "margin-top:4px" }, this.peerAddress ? this.peerAddress : h("span.dim", { style: "font-style:italic" }, "No identity address provided"))
          ])
        ]),
        tx.errorText ? h("div.msg.msg-err", tx.errorText) : null,
        h("a.btn.btn-primary.btn-block", { href: "#Link", onclick: this.handleLink, classes: { disabled: tx.isBusy || !this.peerAddress }, style: "height:44px;font-weight:600" },
          tx.isPending ? "Confirm in wallet..." : tx.isConfirming ? "Confirming..." : "Link Identity")
      ]);
    }

    render() {
      var step = this.currentStep();
      var body = step === 0 ? this.renderConnect() : step === 1 ? this.renderSelect() : this.renderLink();
      return h("div.AddPeerPage", { key: "add-peer" }, [
        h("h1.wizard-title", "Link EpixNet Identity"),
        h("p.wizard-intro", "Link your EpixNet identity to your xID name."),
        this.renderSteps(),
        h("div.card", { style: "border-radius:var(--epix-radius-lg)" }, [body]),
        Wallet.isConnected() && step > 0 ? h("div.wizard-wallet", [Wallet.renderButton({ compact: true })]) : null
      ]);
    }
  }

  window.AddPeerPage = AddPeerPage;
})();
