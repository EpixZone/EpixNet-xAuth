// Register: type a name, see availability and fee live, register it.
(function () {
  class RegisterPage {
    constructor() {
      this.name = "";
      this.owner = null;
      this.isAvailable = false;
      this.resolving = false;
      this.fee = null;
      this.feeLoading = false;
      this.seq = 0;
      this.tx = new TxState();
      this.handleInput = this.handleInput.bind(this);
      this.handleRegister = this.handleRegister.bind(this);
    }

    handleInput(e) {
      this.name = e.target.value.toLowerCase();
      this.lookup();
    }

    lookup() {
      var self = this;
      var name = this.name;
      var seq = ++this.seq;
      if (!name) { this.owner = null; this.fee = null; this.resolving = false; Page.render(); return; }
      this.resolving = true;
      this.feeLoading = true;
      Page.render();
      Promise.all([
        XidContract.read("resolve", [name, Chain.DEFAULT_TLD]),
        XidContract.read("getRegistrationFee", [name, Chain.DEFAULT_TLD])
      ]).then(function (results) {
        if (seq !== self.seq) return;
        self.owner = String(results[0]);
        self.isAvailable = self.owner === XidContract.ZERO;
        self.fee = results[1];
        self.resolving = false;
        self.feeLoading = false;
        Page.render();
      }).catch(function () {
        if (seq !== self.seq) return;
        self.resolving = false;
        self.feeLoading = false;
        self.owner = null;
        self.isAvailable = false;
        Page.render();
      });
    }

    handleRegister() {
      var self = this;
      if (!this.name || !this.isAvailable || this.tx.isBusy) return false;
      this.tx.run("register", [this.name, Chain.DEFAULT_TLD], function () { self.lookup(); });
      return false;
    }

    renderStatus() {
      var tld = Chain.DEFAULT_TLD;
      if (!this.name) return null;
      var rows = [];
      if (this.resolving) {
        rows.push(h("p.mid", "Checking availability..."));
      } else if (this.owner === null) {
        rows.push(h("p.mid", "Could not reach the chain."));
      } else if (this.isAvailable) {
        rows.push(h("div.row-gap", [h("span.pill.pill-ok", "Available"), h("span.mid", this.name + "." + tld)]));
        rows.push(h("div.row-between.subcard-sm", [
          h("span.mid", "Registration Fee"),
          h("span", { style: "font-weight:500" }, this.feeLoading ? "..." : Format.ether(this.fee) + " EPIX")
        ]));
      } else {
        rows.push(h("div.row-gap", [
          h("span.pill.pill-bad", "Taken"),
          h("span.mid", [this.name + "." + tld + " is owned by ", h("span.mono.small", this.owner)])
        ]));
      }
      return h("div.stack-sm", rows);
    }

    render() {
      var tld = Chain.DEFAULT_TLD;
      var tx = this.tx;
      var label = tx.isPending ? "Confirming..." : tx.isConfirming ? "Waiting for tx..." : "Register " + (this.name || "...") + "." + tld;
      return h("div.stack.RegisterPage", { key: "register" }, [
        h("div.centered", [
          h("img.logo-hero", { src: "img/xID.png", alt: "xID" }),
          h("p.mid", "Claim your identity on EpixChain. Names are permanent and transferable.")
        ]),
        h("div.card.stack-sm", [
          h("div", [
            h("label.field.field-lg", { for: "register-name" }, "Name"),
            h("div.input-row", [
              h("input.input", { id: "register-name", type: "text", value: this.name, placeholder: "Enter a name", oninput: this.handleInput, autocomplete: "off" }),
              h("span.suffix-chip", "." + tld)
            ])
          ]),
          this.renderStatus(),
          !Wallet.isConnected()
            ? h("p.text-warn", "Connect your wallet to register a name.")
            : h("a.btn.btn-primary.btn-block", {
                href: "#Register",
                onclick: this.handleRegister,
                classes: { disabled: !this.name || !this.isAvailable || tx.isBusy }
              }, label),
          tx.isSuccess && tx.hash ? h("div.msg.msg-ok", [
            "Name registered successfully! ",
            h("a.text-link", { href: tx.explorerUrl, target: "_blank", rel: "noreferrer" }, "View transaction")
          ]) : null,
          tx.errorText ? h("div.msg.msg-err", "Error: " + tx.errorText) : null
        ])
      ]);
    }
  }

  window.RegisterPage = RegisterPage;
})();
