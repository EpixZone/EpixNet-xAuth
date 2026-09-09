// Stats: totals and the per-TLD breakdown from the chain's REST API.
(function () {
  var XID_MODULE_BECH32 = "epix1gs90m79353yufdyqrl93yklqgcg0s6cfdcjv7h";

  class StatsPage {
    constructor() {
      this.stats = null;
      this.loading = true;
      this.error = "";
    }

    enter() {
      this.fetchStats();
    }

    async fetchStats() {
      this.loading = true;
      this.error = "";
      Page.render();
      try {
        var res = await Rest.stats();
        if (!res.ok) throw new Error("Failed to fetch stats");
        this.stats = res.data;
      } catch (e) {
        this.error = (e && e.message) || "Failed to fetch stats";
      }
      this.loading = false;
      Page.render();
    }

    render() {
      var s = this.stats;
      var body = [];
      if (this.loading) body.push(h("div.pad", "Loading..."));
      else if (this.error) body.push(h("div.msg.msg-err", this.error));
      else if (s) {
        body.push(h("div.grid-2", [
          h("div.card", [
            h("p.overline", { style: "margin-bottom:8px" }, "Total Names Registered"),
            h("p", { style: "font-size:24px;font-weight:600;color:var(--epix-link)" }, s.total_names || "0")
          ]),
          h("a.card.card-link", { href: Chain.explorerAccountUrl(XID_MODULE_BECH32), target: "_blank", rel: "noreferrer" }, [
            h("p.overline", { style: "margin-bottom:8px" }, "Total Fees Burned 🔥"),
            h("p.text-warn", { style: "font-size:24px;font-weight:600" }, Format.burned(s.total_fees_burned)),
            h("p.dim.small", { style: "margin-top:4px" }, ["EPIX — ", h("span", { style: "color:var(--epix-link)" }, "View burn transactions ↗")])
          ])
        ]));
        if (s.tld_stats && s.tld_stats.length) {
          body.push(h("div.card-flush", [
            h("div.card-head", [h("h2", "TLD Breakdown")]),
            h("table.table.table-collapse", [
              h("thead", [h("tr", [h("th", "TLD"), h("th", "Names"), h("th", "Fees Burned (EPIX) 🔥"), h("th", "Status")])]),
              h("tbody", s.tld_stats.map(function (t) {
                return h("tr", { key: t.tld }, [
                  h("td", { "data-label": "TLD", style: "font-weight:500" }, "." + t.tld),
                  h("td.mid", { "data-label": "Names" }, String(t.name_count)),
                  h("td.mid", { "data-label": "Fees Burned (EPIX)" }, Format.burned(t.fees_burned)),
                  h("td", { "data-label": "Status" }, [t.enabled ? h("span.pill.pill-ok", "Active") : h("span.pill.pill-bad", "Disabled")])
                ]);
              }))
            ])
          ]));
        }
      }
      return h("div.stack.StatsPage", { key: "stats" }, [h("h1", "Stats")].concat(body));
    }
  }

  window.StatsPage = StatsPage;
})();
