// Prices: every TLD's length tiers, and a fee calculator.
(function () {
  class PricesPage {
    constructor() {
      this.tlds = [];
      this.loading = true;
      this.error = "";
      this.loaded = false;
      this.calcName = "";
      this.calcFee = null;
      this.calcLoading = false;
      this.seq = 0;
      this.handleCalcInput = this.handleCalcInput.bind(this);
    }

    enter() {
      if (!this.loaded) this.fetchTlds();
    }

    async fetchTlds() {
      this.loading = true;
      this.error = "";
      Page.render();
      try {
        var res = await Rest.tlds();
        if (!res.ok) throw new Error("Failed to fetch TLD pricing");
        this.tlds = (res.data && res.data.tlds) || [];
        this.loaded = true;
      } catch (e) {
        this.error = (e && e.message) || "Failed to fetch pricing";
      }
      this.loading = false;
      Page.render();
    }

    handleCalcInput(e) {
      var self = this;
      this.calcName = e.target.value.toLowerCase().slice(0, 64);
      var seq = ++this.seq;
      if (!this.calcName) { this.calcFee = null; Page.render(); return; }
      this.calcLoading = true;
      Page.render();
      XidContract.read("getRegistrationFee", [this.calcName, Chain.DEFAULT_TLD]).then(function (fee) {
        if (seq !== self.seq) return;
        self.calcFee = fee;
        self.calcLoading = false;
        Page.render();
      }).catch(function () {
        if (seq !== self.seq) return;
        self.calcFee = null;
        self.calcLoading = false;
        Page.render();
      });
    }

    renderTierTable(tld) {
      var tiers = tld.price_tiers || [];
      return h("div.card-flush", { key: "tld-" + tld.tld }, [
        h("div.card-head", [
          h("h2", "." + tld.tld),
          tld.enabled ? h("span.pill.pill-ok", "Active") : h("span.pill.pill-bad", "Disabled")
        ]),
        h("table.table.table-collapse", [
          h("thead", [h("tr", [h("th", "Name Length"), h("th.num", "Registration Fee")])]),
          h("tbody", tiers.map(function (tier, i) {
            return h("tr", { key: String(tier.max_length) }, [
              h("td", { "data-label": "Name Length" }, Format.tierLabel(tier, i, tiers)),
              h("td.num", { "data-label": "Registration Fee", style: "color:var(--epix-link)" }, Format.epix(tier.price) + " EPIX")
            ]);
          }))
        ])
      ]);
    }

    renderCalculator() {
      var tld = Chain.DEFAULT_TLD;
      var name = this.calcName;
      var result = null;
      if (name) {
        if (this.calcLoading) result = h("p.dim", "Calculating...");
        else if (this.calcFee !== null && this.calcFee !== undefined) result = h("div.row-between", [
          h("div", [
            h("p", { style: "font-weight:500" }, name + "." + tld),
            h("p.mid.small", { style: "margin-top:2px" }, Text.plural(name.length, "character"))
          ]),
          h("p.mono", { style: "font-size:18px;color:var(--epix-link)" }, Number(ethers.formatEther(this.calcFee)).toLocaleString() + " EPIX")
        ]);
        else result = h("p.dim", "Enter a valid name to see the fee.");
      }
      return h("div.card", { key: "calc" }, [
        h("h2", "Fee Calculator"),
        h("p.mid", { style: "margin:4px 0 16px" }, "Enter a name to see the exact registration fee."),
        h("div.input-row", [
          h("input.input", { type: "text", value: name, placeholder: "Enter a name...", maxlength: "64", oninput: this.handleCalcInput, autocomplete: "off" }),
          h("span.suffix-chip", "." + tld)
        ]),
        result ? h("div.subcard", { style: "margin-top:16px" }, [result]) : null
      ]);
    }

    render() {
      var self = this;
      var body;
      if (this.loading) body = [h("div.card.pad", "Loading pricing...")];
      else if (this.error) body = [h("div.card.pad.text-err", this.error)];
      else body = this.tlds.map(function (t) { return self.renderTierTable(t); });
      return h("div.stack.PricesPage", { key: "prices" }, [
        h("div.page-head", [
          h("h1", "Pricing"),
          h("p", "Registration fees are based on name length. Shorter names are rarer and cost more. All fees are burned permanently.")
        ])
      ].concat(body, [this.renderCalculator()]));
    }
  }

  window.PricesPage = PricesPage;
})();
