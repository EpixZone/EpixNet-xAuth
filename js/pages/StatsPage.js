// Current chain counters. These totals do not provide a historical time series.
(function () {
  var XID_MODULE_BECH32 = "epix1gs90m79353yufdyqrl93yklqgcg0s6cfdcjv7h";

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
      this.recentRegistrations = null;
      this.recentLoading = false;
      this.recentError = "";
      this.recentRefreshedAt = null;
      this.handleRefresh = this.handleRefresh.bind(this);
      this.fetchRecentRegistrations = this.fetchRecentRegistrations.bind(this);
    }

    enter() { this.handleRefresh(); }

    handleRefresh() { this.fetchStats(); this.fetchRecentRegistrations(); return false; }

    async fetchRecentRegistrations() {
      if (this.recentLoading) return;
      this.recentLoading = true;
      this.recentError = "";
      Page.render();
      try {
        this.recentRegistrations = (await Rest.latestRegistrations(5)).slice(0, 5);
        this.recentRefreshedAt = new Date();
      } catch (e) {
        this.recentError = "Could not load recent registrations. " + (this.recentRegistrations ? "The last successful list is still shown below." : "Please try again.");
      } finally {
        this.recentLoading = false;
        Page.render();
      }
    }

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

    renderMetric(label, value, unit, note, key, title, link) {
      var properties = { key: key };
      if (link) {
        properties.href = link.href;
        properties.target = "_blank";
        properties.rel = "noopener noreferrer";
      }
      return h(link ? "a.card.stat-card.card-link" : "div.card.stat-card", properties, [
        h("p.overline", label),
        h("p.stat-value", { title: title || value }, value),
        unit ? h("p.stat-unit", unit) : null,
        h("p.stat-note", note),
        link ? h("p.stat-action", [link.label, h("span.sr-only", " (opens in a new tab)")]) : null
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
        this.renderMetric("Registration fees burned", s ? Format.burned(s.totalBurned) : "…", "EPIX", "Cumulative registration fees", "burned", null, {
          href: Chain.explorerAccountUrl(XID_MODULE_BECH32), label: "View burn transactions ↗"
        }),
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

    renderRecentRegistrations() {
      var entries = this.recentRegistrations;
      return h("section.card-flush.recent-registrations", { "aria-labelledby": "recent-registrations-heading", "aria-busy": this.recentLoading ? "true" : "false" }, [
        h("div.recent-head", [
          h("h2", { id: "recent-registrations-heading" }, "Latest registrations"),
          h("p.dim.small", "Up to five recent registrations from the chain's transaction index.")
        ]),
        this.recentLoading ? h("p.recent-meta", { key: "loading", role: "status" }, entries ? "Refreshing registrations..." : "Loading registrations...") : null,
        this.recentError ? h("div.msg.msg-err.recent-meta", { key: "error", role: "alert" }, [
          h("p", this.recentError), h("button.btn.btn-sm", { type: "button", onclick: this.fetchRecentRegistrations, disabled: this.recentLoading }, "Retry registrations")
        ]) : null,
        entries && entries.length ? h("table.table.table-collapse.recent-table", { "aria-label": "Latest indexed xID registrations" }, [
          h("thead", [h("tr", [h("th", { scope: "col" }, "Name"), h("th", { scope: "col" }, "Registered"), h("th", { scope: "col" }, "Transaction")])]),
          h("tbody", entries.map(function (entry) {
            var fullName = entry.name + "." + entry.tld;
            return h("tr", { key: entry.txHash + "/" + fullName }, [
              h("th", { scope: "row", "data-label": "Name" }, [h("a.text-link", { href: Page.nameUrl(entry.tld, entry.name), onclick: Page.handleLinkClick }, fullName)]),
              h("td", { "data-label": "Registered" }, [h("time", { datetime: entry.timestamp, title: entry.timestamp }, new Date(entry.timestamp).toLocaleString())]),
              h("td", { "data-label": "Transaction" }, [h("a.text-link.mono", {
                href: Chain.explorerTxUrl(entry.txHash), target: "_blank", rel: "noopener noreferrer", title: entry.txHash,
                "aria-label": "View registration transaction for " + fullName + " (opens in a new tab)"
              }, entry.txHash.slice(0, 8) + "…" + entry.txHash.slice(-6) + " ↗")])
            ]);
          }))
        ]) : entries && !this.recentLoading && !this.recentError ? h("p.recent-meta", { key: "empty" }, "No indexed registrations are available from this node yet.") : null,
        entries && entries.length > 0 && entries.length < 5 ? h("p.recent-meta", { key: "limited" }, "Showing " + entries.length + " registration" + (entries.length === 1 ? "" : "s") + " available in this node's transaction index.") : null,
        this.recentRefreshedAt ? h("p.recent-meta", { key: "updated" }, [
          "Last successful refresh: ", h("time", { datetime: this.recentRefreshedAt.toISOString() }, this.recentRefreshedAt.toLocaleString()), ". Dates are shown in your local time."
        ]) : null
      ]);
    }

    render() {
      var s = this.stats;
      var refreshing = this.loading || this.recentLoading;
      var status = this.loading ? (s ? "Refreshing chain statistics…" : "Loading chain statistics…") : this.refreshedAt ? "Last successful refresh: " : "Statistics have not loaded yet.";
      return h("div.stack.StatsPage", { key: "stats", "aria-busy": refreshing ? "true" : "false" }, [
        h("div.stats-head", [
          h("div.page-head", [h("h1", "Network statistics"), h("p", "Registration activity and fees burned across xID on EpixChain.")]),
          h("button.btn", { type: "button", onclick: this.handleRefresh, disabled: refreshing }, refreshing ? "Refreshing…" : "Refresh data")
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
        this.renderRecentRegistrations(),
        s ? this.renderDistribution() : null,
        s ? h("p.dim.small", "Totals come from the chain's registration counters. Fees burned exclude network gas fees. The average is the lifetime total divided by registered names, rounded to four decimal places.") : null
      ]);
    }
  }

  StatsPage.summarize = summarize;
  window.StatsPage = StatsPage;
})();
