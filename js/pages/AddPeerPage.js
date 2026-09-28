// Connect a wallet, choose a name, link the node's identity, then return to
// the originating xite after the chain and the node both recognize it.
(function () {
  var STEPS = ["Connect wallet", "Choose name", "Link and return"];
  var COMMAND_TIMEOUT = 8000;
  var CONFIRM_TIMEOUT = 60000;
  var ORIGINS = {
    epix1talk58lw26c0cyrtuu8axptne2p6zf33s7xxwu: "EpixTalk",
    epix1p0stmcza0xjkvv0vnjlk0ypr7xsunt4lxkhgcm: "EpixPost",
    Config: "Settings"
  };

  class AddPeerPage {
    constructor() {
      this.peerAddress = "";
      this.returnTo = "";
      this.active = false;
      this.generation = 0;
      this.walletAddress = null;
      this.selectedName = "";
      this.selectedTld = "";
      this.selectionConfirmed = false;
      this.names = [];
      this.receiptNames = [];
      this.namesLoading = false;
      this.namesError = "";
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
      this.lookupName = "";
      this.lookupError = "";
      this.fee = null;
      this.seq = 0;
      this.registerTx = new TxState();
      this.linkTx = new TxState();
      this.linkChecking = false;
      this.chainLinked = false;
      this.nodeRecorded = false;
      this.baselineRecorded = null;
      this.linkStatus = "idle";
      this.linkError = "";
      this.pollSeq = 0;
      this.pollTimer = null;
      this.timeoutTimer = null;
      this.redirectTimer = null;
      this.pendingCalls = new Map();
      ["handleRegisterToggle", "handleNewNameInput", "handleTiersToggle", "handleRegister",
        "handleLink", "handleShowRegister", "handleSelectClick", "handleContinue", "handleChange",
        "handleRetryNames", "handleRetryLookup", "handleRetryConfirmation", "handleReturn"].forEach(function (key) {
        this[key] = this[key].bind(this);
      }, this);
    }

    enter(peerAddress, returnTo) {
      var changed = this.peerAddress !== (peerAddress || "") || this.returnTo !== (returnTo || "");
      this.active = true;
      this.peerAddress = String(peerAddress || "").trim();
      this.returnTo = Text.safeReturnTo(returnTo || "");
      if (changed) this.walletAddress = null;
      this.onWalletChanged();
    }

    leave() {
      this.active = false;
      this.generation += 1;
      this.seq += 1;
      this.stopTimers();
      // Re-entering refreshes account data and resumes via the existing-link check.
      this.receiptNames = [];
      this.walletAddress = null;
    }

    isCurrent(generation, address) {
      return this.active && generation === this.generation && address === Wallet.address;
    }

    onWalletChanged() {
      if (!this.active) return;
      if (Wallet.address === this.walletAddress) return;
      this.generation += 1;
      this.seq += 1;
      this.stopTimers();
      this.walletAddress = Wallet.address;
      this.selectedName = this.selectedTld = this.primaryName = this.primaryTld = "";
      this.selectionConfirmed = false;
      this.names = [];
      this.receiptNames = [];
      this.namesError = "";
      this.namesLoading = this.primaryLoading = false;
      this.newName = this.lookupName = this.lookupError = "";
      this.isAvailable = this.resolving = this.showRegister = false;
      this.fee = null;
      this.registerTx = new TxState();
      this.linkTx = new TxState();
      this.linkChecking = this.chainLinked = this.nodeRecorded = false;
      this.baselineRecorded = null;
      this.linkStatus = "idle";
      this.linkError = "";
      if (Wallet.address) {
        this.loadNames();
        this.loadPrimary();
      }
      Page.render();
    }

    originLabel() {
      var path = this.returnTo.split(/[?#]/)[0];
      var origin = path.split("/")[1];
      return ORIGINS[origin] || "your xite";
    }

    currentStep() {
      if (!Wallet.isConnected()) return 0;
      return this.selectionConfirmed ? 2 : 1;
    }

    async loadNames() {
      if (!Wallet.address) return;
      var generation = this.generation, address = Wallet.address;
      this.namesLoading = true;
      this.namesError = "";
      Page.render();
      try {
        var res = await Rest.namesAll(Bech32.evmToBech32(address));
        if (!this.isCurrent(generation, address)) return;
        var names = res.names.slice(), pending = [], self = this;
        for (var entry of this.receiptNames) {
          if (names.some(function (name) { return name.name === entry.name && name.tld === entry.tld; })) continue;
          var owner = String(await XidContract.read("resolve", [entry.name, entry.tld])).toLowerCase();
          if (!this.isCurrent(generation, address)) return;
          // REST indexing can lag a mined registration. Retain its receipt
          // while the name is absent, but never override a different owner.
          if (owner === address.toLowerCase() || owner === XidContract.ZERO) {
            names.push(entry);
            pending.push(entry);
          }
        }
        if (!this.isCurrent(generation, address)) return;
        this.receiptNames = pending;
        this.names = names;
        if (!this.selectionConfirmed && !names.some(function (entry) { return entry.name === self.selectedName && entry.tld === self.selectedTld; })) {
          this.selectedName = this.selectedTld = "";
        }
      } catch (e) {
        if (!this.isCurrent(generation, address)) return;
        this.namesError = "We could not load your names. Retry before choosing a name.";
      }
      this.namesLoading = false;
      this.autoSelect();
      Page.render();
    }

    async loadPrimary() {
      var generation = this.generation, address = Wallet.address;
      this.primaryLoading = true;
      try {
        var r = await XidContract.read("getPrimaryName", [address]);
        if (!this.isCurrent(generation, address)) return;
        this.primaryName = String(r[0] || "");
        this.primaryTld = String(r[1] || "");
      } catch (e) {
        if (!this.isCurrent(generation, address)) return;
        // Names remain selectable if the optional primary-name lookup fails.
      }
      this.primaryLoading = false;
      this.autoSelect();
      Page.render();
    }

    autoSelect() {
      if (this.selectedName || this.namesLoading || this.primaryLoading) return;
      var self = this;
      var primary = this.names.find(function (entry) { return entry.name === self.primaryName && entry.tld === self.primaryTld; });
      var selected = primary || (this.names.length === 1 ? this.names[0] : null);
      if (selected) { this.selectedName = selected.name; this.selectedTld = selected.tld; }
      // A default highlights a choice; Continue advances the wizard.
    }

    handleSelectClick(e) {
      if (this.registerTx.isBusy) return false;
      this.selectedName = e.currentTarget.getAttribute("data-name");
      this.selectedTld = e.currentTarget.getAttribute("data-tld");
      Page.render();
      return false;
    }

    handleContinue() {
      var self = this;
      if (this.namesLoading || this.namesError || this.registerTx.isBusy || !this.names.some(function (entry) {
        return entry.name === self.selectedName && entry.tld === self.selectedTld;
      })) return false;
      this.selectionConfirmed = true;
      this.showRegister = false;
      Page.render();
      return false;
    }

    handleChange() {
      if (this.linkTx.isBusy || this.linkChecking || this.chainLinked) return false;
      this.selectionConfirmed = false;
      this.linkTx = new TxState();
      this.linkError = "";
      Page.render();
      return false;
    }

    handleRetryNames() { this.loadNames(); this.loadPrimary(); return false; }
    handleShowRegister() { this.showRegister = true; Page.render(); return false; }
    handleRegisterToggle() { if (!this.registerTx.isBusy) this.showRegister = !this.showRegister; Page.render(); return false; }
    handleNewNameInput(e) { this.newName = e.target.value; this.lookup(); }
    handleRetryLookup() { this.lookup(); return false; }

    lookup() {
      var self = this, input = Text.nameInput(this.newName), seq = ++this.seq;
      this.isAvailable = false;
      this.lookupName = "";
      this.lookupError = "";
      this.fee = null;
      this.resolving = input.valid;
      if (!input.valid) { Page.render(); return; }
      Page.render();
      Promise.all([
        XidContract.read("resolve", [input.name, input.tld]),
        XidContract.read("getRegistrationFee", [input.name, input.tld])
      ]).then(function (r) {
        if (!self.active || seq !== self.seq) return;
        self.lookupName = input.name;
        self.isAvailable = String(r[0]) === XidContract.ZERO;
        self.fee = r[1];
        self.resolving = false;
        Page.render();
      }).catch(function () {
        if (!self.active || seq !== self.seq) return;
        self.resolving = false;
        self.lookupError = "We could not check availability or pricing. Please retry.";
        Page.render();
      });
    }

    handleTiersToggle() {
      var self = this;
      this.showTiers = !this.showTiers;
      if (this.showTiers && !this.tiersLoaded && !this.tiersLoading) {
        this.tiersLoading = true;
        Rest.tlds().then(function (res) {
          if (!res.ok) throw new Error("Pricing unavailable");
          var tld = ((res.data && res.data.tlds) || []).find(function (t) { return t.tld === Chain.DEFAULT_TLD; });
          self.priceTiers = tld ? (tld.price_tiers || []) : [];
          self.tiersLoaded = true;
        }).catch(function () {}).finally(function () { self.tiersLoading = false; Page.render(); });
      }
      Page.render();
      return false;
    }

    canRegister() {
      var input = Text.nameInput(this.newName);
      return input.valid && input.name === this.lookupName && this.isAvailable && !this.resolving && !this.lookupError && this.fee !== null && !this.registerTx.isBusy;
    }

    handleRegister() {
      if (!this.canRegister()) return false;
      var self = this, input = Text.nameInput(this.newName), generation = this.generation, address = Wallet.address;
      this.registerTx.run("register", [input.name, input.tld], function () {
        if (!self.isCurrent(generation, address)) return;
        self.selectedName = input.name;
        self.selectedTld = input.tld;
        var entry = { name: input.name, tld: input.tld, owner: address };
        self.receiptNames.push(entry);
        if (!self.names.some(function (name) { return name.name === entry.name && name.tld === entry.tld; })) self.names.push(entry);
        self.selectionConfirmed = true;
        self.showRegister = false;
        self.newName = "";
        self.lookupName = "";
        self.isAvailable = false;
        self.loadNames();
        self.loadPrimary();
      });
      return false;
    }

    validPeer() { return Bech32.isBech32Address(this.peerAddress); }

    async handleLink() {
      if (!this.selectionConfirmed || !this.selectedName || !this.validPeer() || this.linkTx.isBusy || this.linkChecking) return false;
      if (this.chainLinked) { this.startPolling(); return false; }
      var self = this, generation = this.generation, address = Wallet.address;
      var name = this.selectedName, tld = this.selectedTld, peer = this.peerAddress;
      this.linkChecking = true;
      this.linkError = "";
      Page.render();
      try {
        // A refreshed or retried wizard can continue an already-mined link
        // without asking the wallet to send a duplicate transaction.
        var linked = await this.bounded(function () { return XidContract.read("getLinkedIdentities", [name, tld]); });
        if (!this.isCurrent(generation, address)) return false;
        if (XidContract.peersFrom(linked).some(function (entry) { return entry.address === peer && entry.active === true; })) {
          this.chainLinked = true;
          this.startPolling();
        } else {
          this.linkTx.run("linkIdentity", [name, tld, peer, "epixnet"], function () {
            if (!self.isCurrent(generation, address)) return;
            self.chainLinked = true;
            self.startPolling();
          });
        }
      } catch (e) {
        if (this.isCurrent(generation, address)) this.linkError = "We could not check this identity. Retry when the chain is reachable.";
      } finally {
        if (this.isCurrent(generation, address)) { this.linkChecking = false; Page.render(); }
      }
      return false;
    }

    bounded(operation) {
      var self = this;
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          self.pendingCalls.delete(timer);
          reject(new Error("The node did not respond in time."));
        }, COMMAND_TIMEOUT);
        self.pendingCalls.set(timer, reject);
        Promise.resolve().then(operation).then(function (result) {
          clearTimeout(timer); self.pendingCalls.delete(timer); resolve(result);
        }, function (error) {
          clearTimeout(timer); self.pendingCalls.delete(timer); reject(error);
        });
      });
    }

    command(method, params) {
      return this.bounded(function () { return Page.cmd(method, params || {}); });
    }

    stopTimers() {
      this.pollSeq += 1;
      clearTimeout(this.pollTimer);
      clearTimeout(this.timeoutTimer);
      clearTimeout(this.redirectTimer);
      this.pollTimer = this.timeoutTimer = this.redirectTimer = null;
      this.pendingCalls.forEach(function (reject, timer) { clearTimeout(timer); reject(new Error("Check cancelled")); });
      this.pendingCalls.clear();
    }

    nodeHasIdentity(result) {
      var self = this;
      return !!result && Array.isArray(result.identities) && result.identities.some(function (entry) {
        return entry.auth_address === self.peerAddress && entry.xid === self.selectedName + "." + self.selectedTld && !!entry.cert_user_id;
      });
    }

    startPolling() {
      var self = this;
      this.stopTimers();
      this.nodeRecorded = false;
      this.linkError = "";
      if (!Page.isEmbedded) {
        this.linkStatus = "error";
        this.linkError = "Your identity is linked on-chain. Open this page in EpixNet to finish connecting it to your xite.";
        Page.render();
        return;
      }
      var seq = this.pollSeq;
      this.linkStatus = "polling";
      // Install the deadline before the first bridge command, which may never reply.
      this.timeoutTimer = setTimeout(function () {
        if (seq !== self.pollSeq || !self.active) return;
        self.stopTimers();
        self.linkStatus = "error";
        self.linkError = "Your on-chain link is saved, but the node has not confirmed this identity yet. Retry confirmation, or return and select your xID there.";
        Page.render();
      }, CONFIRM_TIMEOUT);
      Page.render();
      this.pollOnce(seq);
    }

    async pollOnce(seq) {
      var self = this;
      var current = function () { return self.active && seq === self.pollSeq; };
      try {
        // Record the baseline before invalidation can trigger node completion.
        // A pre-existing cert does not prove that this origin was selected.
        if (this.baselineRecorded === null) {
          var baseline = await this.command("identityList");
          if (!current()) return;
          if (!baseline || !Array.isArray(baseline.identities)) throw new Error("Identity list unavailable");
          this.baselineRecorded = this.nodeHasIdentity(baseline);
        }
        await this.command("xidInvalidateCache", { address: this.peerAddress });
        if (!current()) return;
        var result = await this.command("xidResolve", { address: this.peerAddress });
        if (!current()) return;
        if (!result || result.name !== this.selectedName || result.tld !== this.selectedTld || result.active !== true) throw new Error("Identity not resolved yet");
        // xidResolve may fall back to another held address and omits the peer
        // address. Check the exact active address on the selected name too.
        var identities = await this.bounded(function () { return XidContract.read("getLinkedIdentities", [self.selectedName, self.selectedTld]); });
        if (!current()) return;
        if (!XidContract.peersFrom(identities).some(function (entry) { return entry.address === self.peerAddress && entry.active === true; })) throw new Error("Identity not linked yet");
        var local = await this.command("identityList");
        if (!current()) return;
        if (!this.nodeHasIdentity(local)) throw new Error("Identity not recorded yet");
        this.nodeRecorded = true;
        this.stopTimers();
        this.linkStatus = "ready";
        // New local certs appear only after the node's atomic record/select
        // operation. Existing certs retain an explicit return action.
        if (this.returnTo && this.baselineRecorded === false) {
          var returnSeq = this.pollSeq;
          this.redirectTimer = setTimeout(function () {
            if (self.active && returnSeq === self.pollSeq) self.handleReturn();
          }, 1500);
        }
        Page.render();
        return;
      } catch (e) {
        if (!current()) return;
      }
      this.pollTimer = setTimeout(function () { if (current()) self.pollOnce(seq); }, 3000);
    }

    handleRetryConfirmation() { if (this.chainLinked) this.startPolling(); return false; }
    handleReturn() {
      var destination = Text.safeReturnTo(this.returnTo);
      if (!destination) return false;
      this.stopTimers();
      try { window.top.location.href = destination; } catch (e) { window.location.href = destination; }
      return false;
    }

    renderSteps() {
      var current = this.currentStep(), ready = this.linkStatus === "ready";
      var items = [];
      STEPS.forEach(function (label, i) {
        var done = i < current || ready, active = i === current && !ready;
        if (i > 0) items.push(h("div.step-line", { key: "line-" + i, classes: { "is-done": done } }));
        items.push(h("div.step", { key: "step-" + i, "aria-current": active ? "step" : undefined }, [
          h("div.step-dot", { classes: { "is-done": done, "is-active": active } }, [done ? Icons.check(3) : String(i + 1)]),
          h("span.step-label", { classes: { "is-on": done || active } }, label)
        ]));
      });
      return h("div.steps", { "aria-label": "Connection progress" }, items);
    }

    renderConnect() {
      return h("div.spin-col", { key: "connect" }, [
        h("div.icon-circle", [Icons.wallet()]),
        h("h2", "Connect your wallet"),
        h("p.mid.centered", "Choose an existing name or register a new one. Your wallet approves the on-chain transactions."),
        h("div.wizard-wallet", [Wallet.renderButton({ compact: true })])
      ]);
    }

    renderRegisterForm() {
      var self = this, input = Text.nameInput(this.newName), tx = this.registerTx;
      var status = null;
      if (this.newName) {
        if (!input.valid) status = h("p.text-err.small", input.error);
        else if (this.resolving) status = h("p.mid.small", "Checking availability and price...");
        else if (this.lookupError) status = h("div.msg.msg-err", [this.lookupError, h("button.btn.btn-sm", { type: "button", onclick: this.handleRetryLookup }, "Retry check")]);
        else if (this.lookupName && this.isAvailable) status = h("div.stack-sm", [
          h("div.row-gap", [h("span.pill.pill-ok", "Available"), h("span", input.name + "." + input.tld)]),
          h("button.fee-toggle", { type: "button", onclick: this.handleTiersToggle, "aria-expanded": this.showTiers ? "true" : "false", classes: { "is-open": this.showTiers } }, [
            h("span.row-gap", ["Registration fee", Icons.chevronDown()]), h("strong", Format.ether(this.fee) + " EPIX")
          ]),
          h("p.dim.small", "One-time registration fee. Network transaction fees also apply."),
          this.showTiers ? h("div.tiers-box", [
            this.tiersLoading ? h("p.pad-sm", "Loading prices...") : this.priceTiers.length ? h("table.table.table-compact", [h("tbody", this.priceTiers.map(function (tier, i) {
              return h("tr", { key: String(tier.max_length), classes: { "is-current": Format.isCurrentTier(input.name.length, i, self.priceTiers) } }, [
                h("td", Format.tierLabel(tier, i, self.priceTiers)), h("td.num", Format.epix(tier.price) + " EPIX")
              ]);
            }))]) : h("p.pad-sm", "Pricing is unavailable. Close and reopen to retry.")
          ]) : null
        ]);
        else if (this.lookupName) status = h("p.text-warn", input.name + "." + input.tld + " is already registered.");
      }
      return h("div.subcard.stack-sm", { key: "register-form" }, [
        h("h3", "Register a new name"),
        h("label.field", { for: "wizard-name" }, "Name"),
        h("div.input-row", [
          h("input.input", { id: "wizard-name", type: "text", value: this.newName, placeholder: "Your name or name.epix", oninput: this.handleNewNameInput, autocomplete: "off", disabled: tx.isBusy, "aria-describedby": "wizard-name-help" }),
          h("span.suffix-chip", "." + Chain.DEFAULT_TLD)
        ]),
        h("p.dim.small", { id: "wizard-name-help" }, "Letters, numbers and hyphens. Your name does not expire."),
        h("div", { "aria-live": "polite" }, [status]),
        h("button.btn.btn-primary.btn-block", { type: "button", onclick: this.handleRegister, disabled: !this.canRegister() }, tx.isPending ? "Confirm registration in wallet..." : tx.isConfirming ? "Registering name..." : "Register name"),
        tx.errorText ? h("div.msg.msg-err", { role: "alert" }, tx.errorText) : null
      ]);
    }

    renderSelect() {
      var self = this;
      return h("div.stack", { key: "select" }, [
        h("div", [h("h2", "Choose your name"), h("p.mid", "Select the identity you want to use" + (this.returnTo ? " on " + this.originLabel() : "") + ".")]),
        this.namesLoading ? h("p.mid", { role: "status" }, "Loading your names...") : null,
        this.namesError ? h("div.msg.msg-err", { role: "alert" }, [h("p", this.namesError), h("button.btn.btn-sm", { type: "button", onclick: this.handleRetryNames }, "Retry names")]) : null,
        !this.namesLoading && !this.namesError && !this.names.length ? h("p.mid", "This wallet does not own any names yet. Register one below to continue.") : null,
        this.names.length ? h("div.select-list", { "aria-label": "Your names" }, this.names.map(function (entry) {
          var selected = entry.name === self.selectedName && entry.tld === self.selectedTld;
          var primary = entry.name === self.primaryName && entry.tld === self.primaryTld;
          return h("button.select-row", { type: "button", key: entry.tld + "/" + entry.name, classes: { "is-selected": selected }, "aria-pressed": selected ? "true" : "false", disabled: self.registerTx.isBusy || self.namesLoading, onclick: self.handleSelectClick, "data-name": entry.name, "data-tld": entry.tld }, [
            h("span.row-gap", [entry.name + "." + entry.tld, primary ? h("span.pill.pill-accent", "Primary") : null]),
            selected ? h("span.check-dot", [Icons.check(3)]) : null
          ]);
        })) : null,
        this.names.length ? h("button.btn.btn-primary.btn-block", { type: "button", onclick: this.handleContinue, disabled: !this.selectedName || this.namesLoading || !!this.namesError || this.registerTx.isBusy }, "Continue with " + (this.selectedName ? this.selectedName + "." + this.selectedTld : "selected name")) : null,
        this.names.length || this.namesError ? h("button.btn.btn-ghost", { type: "button", onclick: this.handleRegisterToggle, disabled: this.registerTx.isBusy, "aria-expanded": this.showRegister ? "true" : "false" }, this.showRegister ? "Close registration" : "Register a new name") : null,
        this.showRegister || (!this.namesLoading && !this.namesError && !this.names.length) ? this.renderRegisterForm() : null
      ]);
    }

    renderLink() {
      var tx = this.linkTx, ready = this.linkStatus === "ready", polling = this.linkStatus === "polling";
      return h("div.stack", { key: "link" }, [
        h("div", [h("h2", ready ? "Identity ready" : this.chainLinked ? "Finish connecting" : "Link your identity"), h("p.mid", this.chainLinked ? "Your name is linked on-chain." : "Approve one transaction to connect this EpixNet identity to your name.")]),
        h("div.subcard.stack-sm", [
          h("div.row-between", [h("span.mid", "Your xID"), h("strong", this.selectedName + "." + this.selectedTld)]),
          !this.chainLinked ? h("button.btn-link", { type: "button", onclick: this.handleChange, disabled: tx.isBusy || this.linkChecking }, "Change name or register another") : null,
          h("p.overline", "EpixNet identity"),
          h("p.mono.small.break", this.peerAddress || "No identity address was provided.")
        ]),
        this.registerTx.isSuccess && !this.chainLinked ? h("p.text-ok", "Name registered. Complete the link to use it on your xite.") : null,
        !this.validPeer() ? h("div.msg.msg-err", { role: "alert" }, "This link has no valid EpixNet identity address. Return to your xite and start Connect xID again.") : null,
        ready ? h("div.msg.msg-ok", { role: "status" }, this.redirectTimer ? "Your identity is saved on this node. Returning to " + this.originLabel() + "..." : "Your identity is saved on this node. You can return and select it on your xite.") : null,
        polling ? h("div.spin-row", { role: "status" }, [h("div.spinner.spinner-sm"), h("span", "Confirming your identity with the node...")]) : null,
        this.linkError ? h("div.msg.msg-err", { role: "alert" }, this.linkError) : null,
        tx.errorText ? h("div.msg.msg-err", { role: "alert" }, tx.errorText) : null,
        !this.chainLinked ? h("button.btn.btn-primary.btn-block", { type: "button", onclick: this.handleLink, disabled: tx.isBusy || this.linkChecking || !this.validPeer() }, this.linkChecking ? "Checking existing link..." : tx.isPending ? "Confirm link in wallet..." : tx.isConfirming ? "Linking identity..." : "Link identity") : null,
        this.chainLinked && !polling && !ready ? h("button.btn.btn-primary.btn-block", { type: "button", onclick: this.handleRetryConfirmation }, "Retry confirmation") : null,
        this.chainLinked && this.returnTo ? h("button.btn.btn-block", { type: "button", onclick: this.handleReturn }, "Return to " + this.originLabel()) : null,
        this.linkStatus === "error" && this.returnTo ? h("p.dim.small", "If you return now, choose " + this.selectedName + "." + this.selectedTld + " in the xite's identity picker. You do not need to register again.") : null
      ]);
    }

    render() {
      var step = this.currentStep();
      return h("div.AddPeerPage.stack", { key: "add-peer" }, [
        h("div.centered", [h("h1.wizard-title", this.returnTo ? "Connect to " + this.originLabel() : "Connect your xID"), h("p.wizard-intro", "One name for your EpixNet identity.")]),
        this.returnTo ? h("p.mid.centered.wizard-context", "After registration and linking, we will return you to " + this.originLabel() + ".") : null,
        this.renderSteps(),
        h("div.card", [step === 0 ? this.renderConnect() : step === 1 ? this.renderSelect() : this.renderLink()]),
        Wallet.isConnected() ? h("div.wizard-wallet", [Wallet.renderButton({ compact: true })]) : null,
        this.returnTo && !this.chainLinked ? h("button.btn-link", { type: "button", onclick: this.handleReturn, disabled: this.registerTx.isBusy || this.linkTx.isBusy }, "Cancel and return to " + this.originLabel()) : null
      ]);
    }
  }

  window.AddPeerPage = AddPeerPage;
})();
