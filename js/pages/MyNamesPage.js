// My Names: the connected wallet's names, ten per page, with the primary
// marked and "Set Primary" on every other row.
(function () {
  var PAGE_SIZE = 10;

  class MyNamesPage {
    constructor() {
      this.names = [];
      this.total = 0;
      this.page = 0;
      this.loading = false;
      this.error = "";
      this.primaryName = "";
      this.primaryTld = "";
      this.tx = new TxState();
      this.address = null;
      this.handlePrev = this.handlePrev.bind(this);
      this.handleNext = this.handleNext.bind(this);
      this.handleSetPrimaryClick = this.handleSetPrimaryClick.bind(this);
    }

    enter() {
      if (Wallet.address !== this.address) { this.address = Wallet.address; this.page = 0; }
      this.fetchNames();
      this.fetchPrimary();
    }

    onWalletChanged() {
      this.address = Wallet.address;
      this.page = 0;
      this.names = [];
      this.total = 0;
      if (Page.content === this) this.enter();
    }

    async fetchNames() {
      if (!Wallet.address) return;
      this.loading = true;
      this.error = "";
      Page.render();
      try {
        var res = await Rest.namesPage(Bech32.evmToBech32(Wallet.address), this.page, PAGE_SIZE);
        this.names = res.names;
        this.total = res.total;
      } catch (e) {
        this.error = (e && e.message) || "Failed to fetch names";
      }
      this.loading = false;
      Page.render();
    }

    fetchPrimary() {
      var self = this;
      if (!Wallet.address) return;
      XidContract.read("getPrimaryName", [Wallet.address]).then(function (r) {
        self.primaryName = String(r[0] || "");
        self.primaryTld = String(r[1] || "");
        Page.render();
      }).catch(function () {});
    }

    handleSetPrimaryClick(e) {
      var el = e.currentTarget;
      return this.setPrimary({ name: el.getAttribute("data-name"), tld: el.getAttribute("data-tld") });
    }

    setPrimary(entry) {
      var self = this;
      if (this.tx.isBusy) return false;
      this.tx.run("setPrimaryName", [entry.name, entry.tld], function () { self.fetchPrimary(); });
      return false;
    }

    handlePrev() { if (this.page > 0) { this.page -= 1; this.fetchNames(); } return false; }
    handleNext() { if ((this.page + 1) * PAGE_SIZE < this.total) { this.page += 1; this.fetchNames(); } return false; }

    renderRow(entry) {
      var self = this;
      var isPrimary = entry.name === this.primaryName && entry.tld === this.primaryTld;
      var url = Page.nameUrl(entry.tld, entry.name);
      return h("div.list-row", { key: entry.tld + "/" + entry.name }, [
        h("a.name-link", { href: url, onclick: Page.handleLinkClick }, [
          h("span", entry.name + "." + entry.tld),
          isPrimary ? h("span.pill.pill-accent", "Primary") : null
        ]),
        h("div.actions", [
          !isPrimary ? h("a.btn.btn-sm.btn-soft-accent", {
            href: "#SetPrimary",
            onclick: this.handleSetPrimaryClick,
            "data-name": entry.name,
            "data-tld": entry.tld,
            classes: { disabled: self.tx.isBusy }
          }, "Set Primary") : null,
          h("a.text-link.mid", { href: url, onclick: Page.handleLinkClick }, "View")
        ])
      ]);
    }

    render() {
      var self = this;
      if (!Wallet.isConnected()) {
        return h("div.stack.MyNamesPage", { key: "my-names" }, [
          h("h1", "My Names"),
          h("div.card.pad", "Connect your wallet to view your names.")
        ]);
      }
      var body;
      if (this.loading) body = h("div.pad", "Loading...");
      else if (this.error) body = h("div.pad.text-err", this.error);
      else if (this.names.length === 0) body = h("div.pad.stack-sm", [
        h("p.mid", "You don't own any names yet."),
        h("a.btn.btn-primary", { href: "?", onclick: Page.handleLinkClick }, "Register Your First Name")
      ]);
      else body = h("div", [
        h("div", this.names.map(function (e) { return self.renderRow(e); })),
        this.tx.hash ? h("div.pad-sm.tx-line", [
          "Set Primary tx: ",
          h("a.text-link", { href: this.tx.explorerUrl, target: "_blank", rel: "noreferrer" }, this.tx.hash.slice(0, 16) + "..."),
          this.tx.isSuccess ? h("span.text-ok", { style: "margin-left:8px" }, "Confirmed!") : null,
          this.tx.errorText ? h("span.text-err", { style: "margin-left:8px" }, this.tx.errorText) : null
        ]) : null
      ]);
      var pages = Math.ceil(this.total / PAGE_SIZE);
      return h("div.stack.MyNamesPage", { key: "my-names" }, [
        h("div.row-between", [
          h("h1", ["My Names", this.total > 0 ? h("span.dim", { style: "font-weight:400;font-size:16px;margin-left:8px" }, "(" + this.total + ")") : null]),
          h("a.btn.btn-primary", { href: "?", onclick: Page.handleLinkClick }, "Register New")
        ]),
        h("div.card-flush", [
          body,
          this.total > PAGE_SIZE ? h("div.row-between.pad-sm", [
            h("button.btn-link", { onclick: this.handlePrev, disabled: this.page === 0 }, "Previous"),
            h("span.mid", "Page " + (this.page + 1) + " of " + pages),
            h("button.btn-link", { onclick: this.handleNext, disabled: (this.page + 1) * PAGE_SIZE >= this.total }, "Next")
          ]) : null
        ])
      ]);
    }
  }

  window.MyNamesPage = MyNamesPage;
})();
