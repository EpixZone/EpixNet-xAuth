// Current chain counters. These totals do not provide a historical time series.
(function () {
  function counter(value) {
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Invalid statistics response");
    if (!/^\d+$/.test(String(value))) throw new Error("Invalid statistics response");
    return BigInt(value);
  }

  function summarize(data) {
    if (!data || (data.tld_stats != null && !Array.isArray(data.tld_stats))) throw new Error("Invalid statistics response");
    var totalNames = counter(data.total_names);
    var totalBurned = counter(data.total_fees_burned);
    var tlds = (data.tld_stats || []).map(function (entry) {
      if (!entry || typeof entry.tld !== "string" || !entry.tld) throw new Error("Invalid statistics response");
      var names = counter(entry.name_count);
      // Only this bounded presentation ratio uses Number. Chain amounts stay bigint.
      var share = totalNames > 0n ? Number(names * 10000n / totalNames) / 100 : 0;
      return { tld: entry.tld, names: names, burned: counter(entry.fees_burned), enabled: entry.enabled === true, share: share };
    }).sort(function (a, b) {
      return a.names === b.names ? a.tld.localeCompare(b.tld) : a.names > b.names ? -1 : 1;
    });
    return {
      totalNames: totalNames,
      totalBurned: totalBurned,
      averageBurned: totalNames > 0n ? totalBurned / totalNames : null,
      averageApproximate: totalNames > 0n && totalBurned % totalNames !== 0n,
      activeTlds: tlds.filter(function (entry) { return entry.enabled; }).length,
      tlds: tlds
    };
  }

  class StatsPage {
    constructor() {
      this.stats = null;
      this.loading = false;
      this.error = "";
      this.refreshedAt = null;
      this.handleRefresh = this.handleRefresh.bind(this);
    }

    enter() { this.fetchStats(); }

    handleRefresh() { this.fetchStats(); return false; }

    async fetchStats() {
      if (this.loading) return;
      this.loading = true;
      this.error = "";
      Page.render();
      try {
        var res = await Rest.stats();
        if (!res.ok) throw new Error("The chain could not return statistics. Please try again.");
        var next = summarize(res.data);
        this.stats = next;
        this.refreshedAt = new Date();
      } catch (e) {
        this.error = "Could not refresh chain statistics. " + (this.stats ? "Your last successful snapshot is still shown below." : "Please check your connection and try again.");
      } finally {
        this.loading = false;
        Page.render();
      }
    }

    renderMetric(label, value, unit, note, key, title) {
      return h("div.card.stat-card", { key: key }, [
        h("p.overline", label),
        h("p.stat-value", { title: title || value }, value),
        unit ? h("p.stat-unit", unit) : null,
        h("p.stat-note", note)
      ]);
    }

    renderMetrics() {
      var s = this.stats;
      var average = "…";
      if (s) {
        average = s.averageBurned === null ? "Not yet available"
          : s.totalBurned > 0n && s.averageBurned < 100000000000000n ? "<" + Format.burned(100000000000000n)
          : Format.burned(s.averageBurned, undefined, 4);
      }
      return h("div.stats-grid", [
        this.renderMetric("Registered names", s ? Format.integer(s.totalNames) : "…", null, "Permanent names on EpixChain", "names"),
        this.renderMetric("Registration fees burned", s ? Format.burned(s.totalBurned) : "…", "EPIX", "Cumulative registration fees", "burned"),
        this.renderMetric("Average burn per name", average, "EPIX per registration", "Lifetime mean across all registrations", "average", s && s.averageBurned !== null ? (s.averageApproximate ? "≈ " : "") + Format.burned(s.averageBurned) + " EPIX per registration" : null),
        this.renderMetric("Active TLDs", s ? Format.integer(s.activeTlds) : "…", s ? "of " + Format.integer(s.tlds.length) + " configured" : null, "Accepting new registrations", "tlds")
      ]);
    }

    renderTld(entry) {
      var shareText = entry.names > 0n && entry.share < 0.1 ? "<0.1%" : entry.share.toLocaleString(undefined, { maximumFractionDigits: 1 }) + "%";
      return h("tr", { key: entry.tld }, [
        h("th", { scope: "row", "data-label": "TLD" }, "." + entry.tld),
        h("td.num", { "data-label": "Registered names" }, Format.integer(entry.names)),
        h("td", { "data-label": "Share of names" }, [
          h("div.stat-share", shareText),
          h("div.stats-bar", { "aria-hidden": "true" }, [h("span", { style: "width:" + Math.min(100, entry.share) + "%" })])
        ]),
        h("td.num", { "data-label": "Fees burned (EPIX)" }, Format.burned(entry.burned)),
        h("td", { "data-label": "Registrations" }, [h("span.pill", { classes: { "pill-ok": entry.enabled, "pill-warn": !entry.enabled } }, entry.enabled ? "Open" : "Paused")])
      ]);
    }

    renderDistribution() {
      var self = this, s = this.stats;
      return h("section.card-flush.stats-distribution", { "aria-labelledby": "stats-tld-heading" }, [
        h("div.card-head", [
          h("div", [h("h2", { id: "stats-tld-heading" }, "Names by top-level domain"), h("p.dim.small", "Share of all registered names, ordered by name count.")]),
          h("a.text-link.small", { href: "?Prices", onclick: Page.handleLinkClick }, "Current prices")
        ]),
        s.tlds.length ? h("table.table.table-collapse.stats-table", { "aria-label": "Registration counts and fees burned by top-level domain" }, [
          h("thead", [h("tr", [
            h("th", { scope: "col" }, "TLD"),
            h("th.num", { scope: "col" }, "Registered names"),
            h("th", { scope: "col" }, "Share of names"),
            h("th.num", { scope: "col" }, "Fees burned (EPIX)"),
            h("th", { scope: "col" }, "Registrations")
          ])]),
          h("tbody", s.tlds.map(function (entry) { return self.renderTld(entry); }))
        ]) : h("div.pad.stack-sm", [h("h3", "No top-level domains configured"), h("p", "Domain statistics will appear when a TLD is added to the chain.")])
      ]);
    }

    render() {
      var s = this.stats;
      var status = this.loading ? (s ? "Refreshing chain statistics…" : "Loading chain statistics…") : this.refreshedAt ? "Last successful refresh: " : "Statistics have not loaded yet.";
      return h("div.stack.StatsPage", { key: "stats", "aria-busy": this.loading ? "true" : "false" }, [
        h("div.stats-head", [
          h("div.page-head", [h("h1", "Network statistics"), h("p", "Registration activity and fees burned across xID on EpixChain.")]),
          h("button.btn", { type: "button", onclick: this.handleRefresh, disabled: this.loading }, this.loading ? "Refreshing…" : "Refresh data")
        ]),
        h("p.stats-meta", { role: "status", "aria-live": "polite", "aria-atomic": "true" }, [
          status,
          !this.loading && this.refreshedAt ? h("time", { datetime: this.refreshedAt.toISOString() }, this.refreshedAt.toLocaleString()) : null
        ]),
        this.error ? h("div.msg.msg-err.row-between", { role: "alert" }, [h("p", this.error), h("button.btn.btn-sm", { type: "button", onclick: this.handleRefresh, disabled: this.loading }, "Retry")]) : null,
        (s || this.loading) ? this.renderMetrics() : null,
        s && s.totalNames === 0n ? h("div.card.stack-sm", [
          h("h2", "No registrations yet"),
          h("p.mid", "Totals will update after the first name is registered. Refresh to check for new registrations."),
          h("a.text-link", { href: "?Prices", onclick: Page.handleLinkClick }, "Explore registration prices")
        ]) : null,
        s ? this.renderDistribution() : null,
        s ? h("p.dim.small", "Totals come from the chain's registration counters. Fees burned exclude network gas fees. The average is the lifetime total divided by registered names, rounded to four decimal places.") : null
      ]);
    }
  }

  StatsPage.summarize = summarize;
  window.StatsPage = StatsPage;
})();
