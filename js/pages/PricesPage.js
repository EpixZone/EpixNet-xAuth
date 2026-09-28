// Live length tiers and a validated registration fee preview.
(function () {
  class PricesPage {
    constructor() {
      this.tlds = [];
      this.loading = true;
      this.error = "";
      this.loaded = false;
      this.calcInput = "";
      this.calcName = "";
      this.calcFee = null;
      this.calcLoading = false;
      this.calcError = "";
      this.validation = "";
      this.seq = 0;
      this.timer = null;
      this.fetchSeq = 0;
      this.handleCalcInput = this.handleCalcInput.bind(this);
      this.handleCalcKey = this.handleCalcKey.bind(this);
      this.calculate = this.calculate.bind(this);
      this.fetchTlds = this.fetchTlds.bind(this);
    }

    enter() { if (!this.loaded) this.fetchTlds(); }

    async fetchTlds() {
      var seq = ++this.fetchSeq;
      this.loading = true;
      this.error = "";
      Page.render();
      try {
        var res = await Rest.tlds();
        if (seq !== this.fetchSeq) return;
        if (!res.ok) throw new Error("The pricing service did not respond successfully.");
        this.tlds = (res.data && res.data.tlds) || [];
        this.loaded = true;
      } catch (e) {
        if (seq !== this.fetchSeq) return;
        this.error = "Could not load pricing. " + ((e && e.message) || "Please try again.");
      }
      this.loading = false;
      Page.render();
    }

    handleCalcInput(e) {
      this.calcInput = e.target.value;
      var parsed = Text.nameInput(this.calcInput);
      this.calcName = parsed.name;
      ++this.seq;
      if (this.timer) clearTimeout(this.timer);
      this.calcFee = null;
      this.calcLoading = false;
      this.calcError = "";
      this.validation = this.calcInput.trim() ? parsed.error : "";
      if (parsed.valid) this.timer = setTimeout(this.calculate, 300);
      Page.render();
    }

    handleCalcKey(e) { if (e.key === "Enter") { e.preventDefault(); this.calculate(); } }

    async calculate() {
      if (this.timer) clearTimeout(this.timer);
      var parsed = Text.nameInput(this.calcInput);
      var seq = ++this.seq;
      this.calcName = parsed.name;
      this.validation = this.calcInput.trim() ? parsed.error : "";
      this.calcFee = null;
      this.calcError = "";
      this.calcLoading = parsed.valid;
      Page.render();
      if (!parsed.valid) return;
      try {
        var fee = await XidContract.read("getRegistrationFee", [parsed.name, parsed.tld]);
        if (seq !== this.seq) return;
        this.calcFee = fee;
      } catch (e) {
        if (seq !== this.seq) return;
        this.calcError = "Could not load the fee. " + TxErrors.extract(e);
      }
      this.calcLoading = false;
      Page.render();
    }

    renderTierTable(tld) {
      var tiers = tld.price_tiers || [];
      return h("div.card-flush", { key: "tld-" + tld.tld }, [
        h("div.card-head", [h("h2", "." + tld.tld + " names"), tld.enabled ? h("span.pill.pill-ok", "Open for registration") : h("span.pill.pill-bad", "Registration paused")]),
        h("table.table.table-collapse", [
          h("caption.sr-only", "Registration fee by name length for ." + tld.tld),
          h("thead", [h("tr", [h("th", { scope: "col" }, "Name length"), h("th.num", { scope: "col" }, "One-time fee")])]),
          h("tbody", tiers.map(function (tier, i) {
            return h("tr", { key: String(tier.max_length) }, [
              h("td", { "data-label": "Name length" }, Format.tierLabel(tier, i, tiers)),
              h("td.num", { "data-label": "One-time fee", style: "color:var(--epix-link)" }, Format.epix(tier.price) + " EPIX")
            ]);
          }))
        ])
      ]);
    }

    renderCalculator() {
      return h("div.card.stack-sm", { key: "calculator" }, [
        h("div", [h("h2", "What will your name cost?"), h("p.mid", "Preview the on-chain fee before checking availability.")]),
        h("label.field", { for: "fee-name" }, "Name"),
        h("div.input-row.wrap-sm", [
          h("input.input", { id: "fee-name", value: this.calcInput, placeholder: "yourname or yourname.epix", oninput: this.handleCalcInput, onkeydown: this.handleCalcKey, autocomplete: "off", spellcheck: false, "aria-describedby": "fee-name-help", "aria-invalid": this.validation ? "true" : "false" }),
          h("button.btn.btn-primary", { type: "button", onclick: this.calculate, disabled: !this.calcInput.trim() || this.calcLoading }, "Calculate fee")
        ]),
        h("p.small.lookup-hint.dim", { id: "fee-name-help" }, this.validation || "1–64 letters, numbers, or internal hyphens."),
        h("div.stack-sm", { "aria-live": "polite", "aria-busy": this.calcLoading ? "true" : "false" }, [
          this.calcLoading ? h("p.mid", { key: "loading", role: "status" }, "Loading fee...") : null,
          this.calcError ? h("div.msg.msg-err.stack-sm", { key: "error", role: "alert" }, [h("p", this.calcError), h("button.btn.btn-secondary", { type: "button", onclick: this.calculate }, "Try again")]) : null,
          this.calcFee !== null ? h("div.lookup-result.stack-sm", { key: "fee" }, [
            h("div.row-between", [h("div", [h("h2.result-title", this.calcName + ".epix"), h("p.mid.small", Text.plural(this.calcName.length, "character"))]), h("p.result-title", Format.ether(this.calcFee) + " EPIX")]),
            h("p.small.dim", "This is a price estimate from the chain, not an availability check. Network fees are additional."),
            h("a.btn.btn-secondary", { href: "?Register&name=" + encodeURIComponent(this.calcName), onclick: Page.handleLinkClick }, "Check availability")
          ]) : null
        ])
      ]);
    }

    render() {
      var self = this;
      var body;
      if (this.loading) body = [h("div.card", { key: "loading", role: "status" }, "Loading current pricing...")];
      else if (this.error) body = [h("div.card.stack-sm", { key: "error", role: "alert" }, [h("p.text-err", this.error), h("button.btn.btn-secondary", { type: "button", onclick: this.fetchTlds }, "Try again")])];
      else if (!this.tlds.length) body = [h("div.card", { key: "empty" }, "No registration pricing is available yet.")];
      else body = this.tlds.map(function (tld) { return self.renderTierTable(tld); });
      return h("div.stack.PricesPage", { key: "prices" }, [
        h("div.page-head", [h("h1", "Registration pricing"), h("p", "Pay once, with no renewal fees. Shorter names cost more, and every registration fee is burned on-chain.")]),
        this.renderCalculator(),
        h("div.stack", { "aria-live": "polite", "aria-busy": this.loading ? "true" : "false" }, body)
      ]);
    }
  }
  window.PricesPage = PricesPage;
})();
