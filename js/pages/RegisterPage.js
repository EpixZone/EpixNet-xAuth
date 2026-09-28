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
      this.handleInput = this.handleInput.bind(this);
      this.handleKey = this.handleKey.bind(this);
      this.lookup = this.lookup.bind(this);
      this.handleRegister = this.handleRegister.bind(this);
    }

    enter(name) {
      if (typeof name !== "string" || this.tx.isBusy) return;
      this.input = Text.normalizeName(name);
      this.name = this.input;
      this.tx.reset();
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
      this.error = "";
      this.resolving = false;
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
        if (this.isAvailable && values[1].error) this.error = "This name is available, but its registration fee could not be loaded. Try again before registering.";
        if (this.fee !== null) this.quotedName = parsed.name;
      } catch (e) {
        if (seq !== this.seq) return;
        this.error = "Could not check availability. " + TxErrors.extract(e);
      }
      this.resolving = false;
      Page.render();
    }

    canRegister() {
      var parsed = Text.nameInput(this.input);
      return parsed.valid && this.quotedName === parsed.name && this.isAvailable && this.fee !== null && !this.resolving && !this.tx.isBusy && Wallet.isConnected() && Wallet.chainOk !== false;
    }

    handleRegister() {
      if (!this.canRegister()) return;
      var self = this;
      var parsed = Text.nameInput(this.input);
      this.tx.run("register", [parsed.name, parsed.tld], function () {
        self.registeredName = parsed.name;
        self.lookup();
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
        h("div.row-between", [h("h2.result-title", this.name + ".epix"), h("span.pill.pill-ok", "Available")]),
        h("div.kv", [h("span.k", "One-time registration fee"), h("span.v", Format.ether(this.fee) + " EPIX")]),
        h("p.small.dim", "The fee is burned on-chain. Network transaction fees also apply.")
      ]);
    }

    render() {
      var tx = this.tx;
      var label = tx.status === "simulating" ? "Checking transaction..." : tx.isPending ? "Confirm in your wallet..." : tx.isConfirming ? "Waiting for confirmation..." : "Register " + (this.name ? this.name + ".epix" : "name");
      return h("div.stack.RegisterPage", { key: "register" }, [
        h("div.page-head", [h("h1", "Register your name"), h("p", "Your .epix name. No renewals.")]),
        h("div.card.stack-sm", [
          h("label.field.field-lg", { for: "register-name" }, "Choose your name"),
          h("input.input", { id: "register-name", type: "text", value: this.input, placeholder: "yourname or yourname.epix", oninput: this.handleInput, onkeydown: this.handleKey, autocomplete: "off", spellcheck: false, disabled: tx.isBusy, "aria-describedby": "register-name-help", "aria-invalid": this.validation ? "true" : "false" }),
          h("p.lookup-hint.small.dim", { id: "register-name-help" }, "1–64 letters, numbers, or internal hyphens. Full .epix names are accepted."),
          h("div.stack-sm", { "aria-live": "polite", "aria-busy": this.resolving || tx.isBusy ? "true" : "false" }, [this.renderStatus()]),
          !Wallet.isConnected() ? h("div.stack-sm", { key: "connect" }, [
            h("p.mid", "Check a name above, then connect your wallet to register."),
            h("button.btn.btn-primary.btn-block", { type: "button", onclick: Wallet.handleConnectClick, disabled: Wallet.connecting }, Wallet.connecting ? "Connecting..." : "Connect wallet"),
            Wallet.connectError ? h("p.text-err", { role: "alert" }, Wallet.connectError) : null
          ]) : Wallet.chainOk === false ? h("button.btn.btn-primary.btn-block", { key: "switch", type: "button", onclick: Wallet.handleSwitchClick }, "Switch wallet to Epix") : !(tx.isSuccess && this.registeredName) ? h("button.btn.btn-primary.btn-block", { key: "register", type: "button", onclick: this.handleRegister, disabled: !this.canRegister() }, label) : null,
          tx.errorText ? h("div.msg.msg-err", { key: "tx-error", role: "alert" }, tx.errorText) : null,
          h("a.text-link.small", { href: "?Prices", onclick: Page.handleLinkClick }, "How registration pricing works")
        ])
      ]);
    }
  }
  window.RegisterPage = RegisterPage;
})();
