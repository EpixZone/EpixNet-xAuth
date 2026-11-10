// Registration keeps the quoted name and current input together through signing.
(function () {
  class RegisterPage {
    constructor() {
      this.input = "";
      this.name = "";
      this.owner = null;
      this.isAvailable = false;
      this.resolving = false;
      this.fee = null;
      this.error = "";
      this.validation = "";
      this.quotedName = "";
      this.registeredName = "";
      this.seq = 0;
      this.timer = null;
      this.tx = new TxState();
      this.cost = new RegistrationCost();
      this.card = new RegistrationCard(this.cost);
      this.walletAddress = Wallet.address;
      this.handleInput = this.handleInput.bind(this);
      this.handleKey = this.handleKey.bind(this);
      this.lookup = this.lookup.bind(this);
      this.handleRegister = this.handleRegister.bind(this);
      this.handleRefresh = this.handleRefresh.bind(this);
    }

    enter(name) {
      if (typeof name !== "string" || this.tx.isBusy) return;
      this.input = Text.normalizeName(name);
      this.name = this.input;
      this.tx.reset();
      this.cost.clear();
      this.registeredName = "";
      return this.lookup();
    }

    handleInput(e) {
      if (this.tx.isBusy) return;
      this.input = e.target.value;
      var parsed = Text.nameInput(this.input);
      this.name = parsed.name;
      this.validation = this.input.trim() ? parsed.error : "";
      ++this.seq;
      if (this.timer) clearTimeout(this.timer);
      this.owner = null;
      this.isAvailable = false;
      this.fee = null;
      this.quotedName = "";
      this.cost.clear();
      this.error = "";
      this.resolving = parsed.valid;
      this.registeredName = "";
      this.tx.reset();
      if (parsed.valid) this.timer = setTimeout(this.lookup, 300);
      Page.render();
    }

    handleKey(e) { if (e.key === "Enter") { e.preventDefault(); if (!this.tx.isBusy) this.lookup(); } }

    async lookup() {
      if (this.timer) clearTimeout(this.timer);
      var parsed = Text.nameInput(this.input);
      var seq = ++this.seq;
      this.name = parsed.name;
      this.validation = this.input.trim() ? parsed.error : "";
      this.owner = null;
      this.fee = null;
      this.isAvailable = false;
      this.quotedName = "";
      this.cost.clear();
      this.error = "";
      this.resolving = parsed.valid;
      Page.render();
      if (!parsed.valid) return;
      try {
        var values = await Promise.all([
          XidContract.read("resolve", [parsed.name, parsed.tld]),
          XidContract.read("getRegistrationFee", [parsed.name, parsed.tld]).then(function (fee) { return { fee: fee }; }, function () { return { error: true }; })
        ]);
        if (seq !== this.seq) return;
        this.owner = String(values[0]);
        this.isAvailable = this.owner === XidContract.ZERO;
        this.fee = values[1].fee === undefined ? null : values[1].fee;
        if (typeof this.fee !== "bigint" || this.fee < 0n) {
          this.fee = null;
          values[1].error = true;
        }
        if (this.isAvailable && values[1].error) this.error = "This name is available, but its registration fee could not be loaded. Try again before registering.";
        if (this.fee !== null) {
          this.quotedName = parsed.name;
          if (this.isAvailable) this.cost.setQuote(parsed.name, parsed.tld, this.fee);
        }
      } catch (e) {
        if (seq !== this.seq) return;
        this.error = "Could not check availability. " + TxErrors.extract(e);
      }
      this.resolving = false;
      Page.render();
    }

    canRegister() {
      var parsed = Text.nameInput(this.input);
      return parsed.valid && this.quotedName === parsed.name && this.isAvailable && this.fee !== null && !this.resolving && !this.tx.isBusy && Wallet.isConnected() && Wallet.chainOk !== false && !this.cost.loading && !this.cost.balanceLoading && !this.cost.insufficient;
    }

    onWalletChanged() {
      if (this.walletAddress !== Wallet.address) {
        this.walletAddress = Wallet.address;
        this.tx.reset();
        this.registeredName = "";
        this.card.copyStatus = "";
      }
      this.cost.onWalletChanged();
    }

    handleRefresh() {
      if (this.tx.isBusy) return;
      if (this.tx.status === "error" && !this.tx.hash) this.tx.reset();
      Wallet.loadBalance();
      return this.lookup();
    }

    handleRegister() {
      if (!this.canRegister()) return;
      var self = this;
      var parsed = Text.nameInput(this.input);
      return Promise.resolve(this.tx.run("register", [parsed.name, parsed.tld], function () {
        self.registeredName = parsed.name;
        Wallet.loadBalance();
        self.lookup();
      }, { registrationFee: this.fee })).then(function () {
        if (self.tx.error && self.tx.error.code === "REGISTRATION_FEE_CHANGED") self.lookup();
      });
    }

    renderStatus() {
      // The confirmed receipt remains useful even if the follow-up read fails.
      if (this.tx.isSuccess && this.registeredName) return h("div.msg.msg-ok.stack-sm", { key: "success" }, [
        h("h2.result-title", this.registeredName + ".epix is yours"),
        h("p", "Add your profile or link an EpixNet identity to start using it."),
        h("a.btn.btn-primary", { href: Page.nameUrl(Chain.DEFAULT_TLD, this.registeredName), onclick: Page.handleLinkClick }, "Manage your name"),
        this.tx.hash ? h("a.text-link", { href: this.tx.explorerUrl, target: "_blank", rel: "noreferrer" }, "View transaction") : null
      ]);
      if (this.validation) return h("p.text-err", { key: "validation", role: "alert" }, this.validation);
      if (this.resolving) return h("p.mid", { key: "loading", role: "status" }, "Checking " + this.name + ".epix...");
      if (this.error) return h("div.msg.msg-err.stack-sm", { key: "error", role: "alert" }, [h("p", this.error), h("button.btn.btn-secondary", { type: "button", onclick: this.lookup }, "Try again")]);
      if (this.owner === null) return null;
      if (!this.isAvailable) return h("div.lookup-result.stack-sm", { key: "taken" }, [
        h("div.row-between", [h("h2.result-title", this.name + ".epix"), h("span.pill.pill-accent", "Registered")]),
        h("p.mid", "This name already has an owner. Try another name, or view its profile."),
        h("a.btn.btn-secondary", { href: Page.nameUrl(Chain.DEFAULT_TLD, this.name), onclick: Page.handleLinkClick }, "View name details")
      ]);
      return h("div.lookup-result.stack-sm", { key: "available" }, [
        h("div.row-between", [h("h2.result-title", this.name + ".epix"), h("span.pill.pill-ok", "Available")])
      ]);
    }

    render() {
      return h("div.stack.RegisterPage", { key: "register" }, [
        h("div.page-head", [
          h("h1", "Register a .epix name"),
          h("p", "A reusable name you own. Add a profile, link your EpixNet login identities, or point it to a website.")
        ]),
        this.card.render({
          id: "register-name", input: this.input, name: this.name, tld: Chain.DEFAULT_TLD,
          onInput: this.handleInput, onKeyDown: this.handleKey, invalid: !!this.validation,
          tx: this.tx, fee: this.fee, resolving: this.resolving, available: this.isAvailable,
          status: this.renderStatus(), success: this.tx.isSuccess && !!this.registeredName,
          canRegister: this.canRegister(), onRegister: this.handleRegister, onRefresh: this.handleRefresh
        })
      ]);
    }
  }
  window.RegisterPage = RegisterPage;
})();
