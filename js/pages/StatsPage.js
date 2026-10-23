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
      this.recentXids = null;
      this.recentLoading = false;
      this.recentError = "";
      this.recentRefreshedAt = null;
      this.active = false;
      this.recentRefreshTimer = null;
      this.recentRefreshQueued = false;
      this.handleRefresh = this.handleRefresh.bind(this);
      this.fetchRecentXids = this.fetchRecentXids.bind(this);
    }

    enter() {
      this.active = true;
      this.recentRefreshQueued = this.recentLoading;
      this.handleRefresh();
    }

    leave() {
      this.active = false;
      clearTimeout(this.recentRefreshTimer);
      this.recentRefreshTimer = null;
      this.recentRefreshQueued = false;
    }

    onSiteInfo(info) {
      var event = info && info.event;
      if (!Array.isArray(event)) return;
      if (event[0] === "updated" || (event[0] === "file_done" && typeof event[1] === "string" &&
          /^data\/users\/[^/]+\/(?:content|data(?:-[0-9a-z]+)?)\.json$/.test(event[1]))) {
        this.scheduleRecentRefresh();
      }
    }

    onReconnect() { this.scheduleRecentRefresh(); }

    scheduleRecentRefresh() {
      if (!this.active || !Page.isEmbedded) return;
      // A publication arrives as several files. Coalesce that burst, and
      // retain a follow-up when new data arrives during an in-flight query.
      if (this.recentLoading) { this.recentRefreshQueued = true; return; }
      if (this.recentRefreshTimer !== null) return;
      var self = this;
      this.recentRefreshTimer = setTimeout(function () {
        self.recentRefreshTimer = null;
        self.fetchRecentXids();
      }, 250);
    }

    handleRefresh() { this.fetchStats(); this.fetchRecentXids(); return false; }

    async fetchRecentXids() {
      if (!Page.isEmbedded || this.recentLoading) return;
      clearTimeout(this.recentRefreshTimer);
      this.recentRefreshTimer = null;
      this.recentRefreshQueued = false;
      this.recentLoading = true;
      this.recentError = "";
      Page.render();
      try {
        this.recentXids = (await XidDirectory.latest(5)).slice(0, 5);
        this.recentRefreshedAt = new Date();
      } catch (e) {
        this.recentError = "Could not load recent xIDs. " + (this.recentXids ? "The last successful list is still shown below." : "Please try again.");
      } finally {
        this.recentLoading = false;
        Page.render();
        if (this.recentRefreshQueued) {
          this.recentRefreshQueued = false;
          this.scheduleRecentRefresh();
        }
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

    renderRecentXids() {
      var entries = this.recentXids;
      return h("section.card-flush.recent-xids", { "aria-labelledby": "recent-xids-heading", "aria-busy": this.recentLoading ? "true" : "false" }, [
        h("div.recent-head", [
          h("h2", { id: "recent-xids-heading" }, "Latest xIDs"),
          h("p.dim.small", "Up to five xIDs from locally available user data, ordered by its latest update. These dates reflect data changes, not chain registrations.")
        ])
      ].concat(!Page.isEmbedded ? [h("p.recent-meta", { key: "standalone" }, "Open this xite in EpixNet to see recent xIDs.")] : [
        this.recentLoading ? h("p.recent-meta", { key: "loading", role: "status" }, entries ? "Refreshing xIDs..." : "Loading xIDs...") : null,
        this.recentError ? h("div.msg.msg-err.recent-meta", { key: "error", role: "alert" }, [
          h("p", this.recentError), h("button.btn.btn-sm", { type: "button", onclick: this.fetchRecentXids, disabled: this.recentLoading }, "Retry xIDs")
        ]) : null,
        entries && entries.length ? h("table.table.table-collapse.recent-table", { "aria-label": "Latest xIDs from user data" }, [
          h("thead", [h("tr", [h("th", { scope: "col" }, "Name"), h("th", { scope: "col" }, "Last updated")])]),
          h("tbody", entries.map(function (entry) {
            var fullName = entry.name + "." + entry.tld;
            return h("tr", { key: fullName }, [
              h("th", { scope: "row", "data-label": "Name" }, [h("a.text-link", { href: Page.nameUrl(entry.tld, entry.name), onclick: Page.handleLinkClick }, fullName)]),
              h("td", { "data-label": "Last updated" }, [h("time", { datetime: entry.timestamp, title: entry.timestamp }, new Date(entry.timestamp).toLocaleString())])
            ]);
          }))
        ]) : entries && !this.recentLoading && !this.recentError ? h("p.recent-meta", { key: "empty" }, "No xIDs are available in the local user data yet.") : null,
        this.recentRefreshedAt ? h("p.recent-meta", { key: "updated" }, [
          "Last successful refresh: ", h("time", { datetime: this.recentRefreshedAt.toISOString() }, this.recentRefreshedAt.toLocaleString()), ". Dates are shown in your local time."
        ]) : null
      ]));
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
        this.renderRecentXids(),
        s ? this.renderDistribution() : null,
        s ? h("p.dim.small", "Totals come from the chain's registration counters. Fees burned exclude network gas fees. The average is the lifetime total divided by registered names, rounded to four decimal places.") : null
      ]);
    }
  }

  StatsPage.summarize = summarize;
  window.StatsPage = StatsPage;
})();
