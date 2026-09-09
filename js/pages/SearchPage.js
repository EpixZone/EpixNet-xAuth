// Search: a debounced name lookup, plus the three advanced lookups
// (forward resolve, reverse resolve by owner address, identity reverse lookup).
(function () {
  // Stable handler: maquette forbids a new function per render.
  function hideBroken(e) { e.target.style.display = "none"; }

  class NameSearch {
    constructor() {
      this.input = "";
      this.name = "";
      this.owner = null;
      this.isAvailable = false;
      this.isLoading = false;
      this.fee = null;
      this.timer = null;
      this.seq = 0;
      this.handleInput = this.handleInput.bind(this);
    }

    handleInput(e) {
      var self = this;
      this.input = e.target.value.toLowerCase().slice(0, 64);
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(function () { self.lookup(); }, 300);
      Page.render();
    }

    lookup() {
      var self = this;
      this.name = this.input;
      var seq = ++this.seq;
      if (!this.name) { this.owner = null; this.isLoading = false; Page.render(); return; }
      this.isLoading = true;
      Page.render();
      Promise.all([
        XidContract.read("resolve", [this.name, Chain.DEFAULT_TLD]),
        XidContract.read("getRegistrationFee", [this.name, Chain.DEFAULT_TLD])
      ]).then(function (results) {
        if (seq !== self.seq) return;
        self.owner = String(results[0]);
        self.isAvailable = self.owner === XidContract.ZERO;
        self.fee = results[1];
        self.isLoading = false;
        Page.render();
      }).catch(function () {
        if (seq !== self.seq) return;
        self.owner = null;
        self.isLoading = false;
        Page.render();
      });
    }

    render() {
      var tld = Chain.DEFAULT_TLD;
      var hasResult = this.name.length > 0 && !this.isLoading && this.owner !== null;
      var registered = hasResult && !this.isAvailable;
      return h("div.card", { key: "name-search" }, [
        h("label.field.field-lg", { for: "search-name" }, "Search for a name"),
        h("div.input-row", [
          h("input.input", { id: "search-name", type: "text", value: this.input, placeholder: "Search names...", maxlength: "64", oninput: this.handleInput, autocomplete: "off" }),
          h("span.suffix-chip", "." + tld)
        ]),
        h("div", { style: "min-height:24px;margin-top:12px" }, [
          this.isLoading && this.name ? h("p.dim", "Searching...") : null
        ]),
        registered ? h("div.subcard.row-between", [
          h("div", [
            h("p", { style: "font-weight:600" }, [this.name, h("span.dim", "." + tld)]),
            h("p.mid", { style: "margin-top:4px" }, ["Owner: ", h("span.mono", Text.truncateAddress(this.owner))])
          ]),
          h("a.btn.btn-primary", { href: Page.nameUrl(tld, this.name), onclick: Page.handleLinkClick }, "View Details")
        ]) : null,
        hasResult && this.isAvailable ? h("div.subcard.row-between", [
          h("p.mid", [
            h("span", { style: "font-weight:600;color:var(--epix-text)" }, this.name + "." + tld),
            " is not registered.",
            this.fee !== null ? h("span.dim", " Fee: " + Format.ether(this.fee) + " EPIX") : null
          ]),
          h("a.btn.btn-soft-ok", { href: "?", onclick: Page.handleLinkClick }, "Register It")
        ]) : null
      ]);
    }
  }

  class ForwardResolve {
    constructor() {
      this.input = "";
      this.query = "";
      this.owner = null;
      this.isAvailable = false;
      this.isLoading = false;
      this.error = null;
      this.fee = null;
      this.avatar = "";
      this.bio = "";
      this.handleInput = this.handleInput.bind(this);
      this.handleKey = this.handleKey.bind(this);
      this.handleResolve = this.handleResolve.bind(this);
    }

    handleInput(e) { this.input = e.target.value.toLowerCase(); Page.render(); }
    handleKey(e) { if (e.key === "Enter") this.handleResolve(); }

    handleResolve() {
      var self = this;
      this.query = this.input;
      this.error = null;
      if (!this.query) { Page.render(); return false; }
      this.isLoading = true;
      Page.render();
      var tld = Chain.DEFAULT_TLD;
      Promise.all([
        XidContract.read("resolve", [this.query, tld]),
        XidContract.read("getRegistrationFee", [this.query, tld]).catch(function () { return null; }),
        XidContract.read("getProfile", [this.query, tld]).catch(function () { return ["", ""]; })
      ]).then(function (results) {
        self.owner = String(results[0]);
        self.isAvailable = self.owner === XidContract.ZERO;
        self.fee = results[1];
        self.avatar = results[2] ? String(results[2][0] || "") : "";
        self.bio = results[2] ? String(results[2][1] || "") : "";
        self.isLoading = false;
        Page.render();
      }).catch(function (err) {
        self.error = err;
        self.isLoading = false;
        Page.render();
      });
      return false;
    }

    render() {
      var tld = Chain.DEFAULT_TLD;
      var hasResult = this.query.length > 0 && !this.isLoading;
      var body = null;
      if (this.isLoading && this.query) {
        body = h("p.dim", { style: "margin-top:16px" }, "Resolving...");
      } else if (hasResult && this.error) {
        body = h("p.text-err", { style: "margin-top:16px" }, TxErrors.extract(this.error));
      } else if (hasResult && !this.isAvailable && this.owner) {
        var rows = [
          h("div.kv", [h("span.k", "Name"), h("span.v", { style: "font-weight:600" }, this.query + "." + tld)]),
          h("div.kv", [h("span.k", "Owner (EVM)"), h("span.v.mono", this.owner)]),
          h("div.kv", [h("span.k", "Owner (Cosmos)"), h("span.v.mono", Bech32.evmToBech32(this.owner))])
        ];
        if (this.avatar) {
          rows.push(h("div.kv", [h("span.k", "Avatar"), h("img.avatar.avatar-sm", { src: this.avatar, alt: "avatar", referrerpolicy: "no-referrer", loading: "lazy", onerror: hideBroken })]));
        }
        if (this.bio) rows.push(h("div.kv", [h("span.k", "Bio"), h("span.v", this.bio)]));
        body = h("div.subcard", { style: "margin-top:16px" }, rows);
      } else if (hasResult && this.isAvailable) {
        body = h("div.subcard", { style: "margin-top:16px" }, [
          h("p.mid", [
            h("span", { style: "font-weight:600;color:var(--epix-text)" }, this.query + "." + tld),
            " is not registered.",
            this.fee !== null ? h("span.dim", " Registration fee: " + Format.ether(this.fee) + " EPIX") : null
          ])
        ]);
      }
      return h("div.card", { key: "forward" }, [
        h("h2", "Forward Resolve"),
        h("p.mid", { style: "margin:4px 0 16px" }, "Look up the owner of a registered name."),
        h("div.input-row.wrap-sm", [
          h("input.input", { type: "text", value: this.input, placeholder: "name", oninput: this.handleInput, onkeydown: this.handleKey, autocomplete: "off" }),
          h("span.suffix-chip", "." + tld),
          h("a.btn.btn-primary", { href: "#Resolve", onclick: this.handleResolve }, "Resolve")
        ]),
        body
      ]);
    }
  }

  class ReverseResolve {
    constructor() {
      this.input = "";
      this.displayAddr = "";
      this.primary = null;
      this.names = [];
      this.loading = false;
      this.error = "";
      this.searched = false;
      this.showAll = false;
      this.handleInput = this.handleInput.bind(this);
      this.handleKey = this.handleKey.bind(this);
      this.handleLookup = this.handleLookup.bind(this);
      this.handleToggle = this.handleToggle.bind(this);
    }

    valid(v) { return (typeof ethers !== "undefined" && ethers.isAddress(v)) || Bech32.looksLikeBech32(v); }
    handleInput(e) { this.input = e.target.value; Page.render(); }
    handleKey(e) { if (e.key === "Enter") this.handleLookup(); }
    handleToggle() { this.showAll = !this.showAll; Page.render(); return false; }

    async handleLookup() {
      var trimmed = this.input.trim();
      if (!this.valid(trimmed)) return false;
      this.displayAddr = trimmed;
      this.primary = null;
      this.names = [];
      this.error = "";
      this.searched = true;
      this.loading = true;
      this.showAll = false;
      Page.render();
      try {
        var b32 = ethers.isAddress(trimmed) ? Bech32.evmToBech32(trimmed) : trimmed;
        var results = await Promise.all([Rest.reverse(b32), Rest.names(b32, { limit: 50 })]);
        var primaryRes = results[0], namesRes = results[1];
        if (primaryRes.ok && primaryRes.data && primaryRes.data.primary_name && primaryRes.data.primary_name.name) {
          this.primary = primaryRes.data.primary_name;
        }
        if (!namesRes.ok) throw new Error("Failed to fetch names");
        this.names = (namesRes.data && namesRes.data.names) || [];
      } catch (e) {
        this.error = (e && e.message) || "Failed to fetch";
      }
      this.loading = false;
      Page.render();
      return false;
    }

    renderName(entry, primary) {
      return h("a.subcard-sm.row-between", {
        key: entry.tld + "/" + entry.name,
        href: Page.nameUrl(entry.tld, entry.name),
        onclick: Page.handleLinkClick,
        style: primary ? "display:flex;background:var(--epix-accent-soft);border:1px solid var(--epix-border);color:inherit" : "display:flex;color:inherit;margin-top:4px"
      }, [
        h("span.row-gap", [h("span", { style: "font-weight:500" }, entry.name + "." + entry.tld), primary ? h("span.pill.pill-accent", "Primary") : null]),
        h("span.mid", "View")
      ]);
    }

    render() {
      var self = this;
      var trimmed = this.input.trim();
      var others = this.primary
        ? this.names.filter(function (n) { return !(n.name === self.primary.name && n.tld === self.primary.tld); })
        : this.names;
      var body = [];
      if (trimmed && !this.valid(trimmed)) body.push(h("p.text-err.small", { style: "margin-top:8px" }, "Invalid address (enter a 0x... EVM address or epix1... bech32 address)"));
      if (this.loading) body.push(h("p.dim", { style: "margin-top:16px" }, "Resolving..."));
      if (this.error) body.push(h("p.text-err", { style: "margin-top:16px" }, this.error));
      if (this.searched && !this.loading && !this.error && this.names.length > 0) {
        body.push(h("div", { style: "margin-top:16px" }, [
          h("div.row-between.mid.small", { style: "margin-bottom:8px" }, [
            h("span", ["Address: ", h("span.mono", Text.truncateAddress(this.displayAddr))]),
            h("span", Text.plural(this.names.length, "name"))
          ]),
          this.primary ? this.renderName(this.primary, true) : null,
          others.length ? h("div", { style: "margin-top:8px" }, [
            h("button.disclosure", { onclick: this.handleToggle, classes: { "is-open": this.showAll } }, [
              h("span.disclosure-tri", "▶"), "Show all " + this.names.length + " names"
            ]),
            this.showAll ? h("div", { style: "margin-top:8px" }, others.map(function (n) { return self.renderName(n, false); })) : null
          ]) : null
        ]));
      }
      if (this.searched && !this.loading && !this.error && this.names.length === 0) {
        body.push(h("div.subcard", { style: "margin-top:16px" }, [
          h("p.mid", ["No names owned by ", h("span.mono", Text.truncateAddress(this.displayAddr)), ". If this is an EpixNet identity address, try the Identity Reverse Lookup below."])
        ]));
      }
      return h("div.card", { key: "reverse" }, [
        h("h2", "Reverse Resolve"),
        h("p.mid", { style: "margin:4px 0 16px" }, "Look up all names owned by an address (0x... or epix1...)."),
        h("div.input-row.wrap-sm", [
          h("input.input.input-mono", { type: "text", value: this.input, placeholder: "0x... or epix1...", oninput: this.handleInput, onkeydown: this.handleKey, autocomplete: "off" }),
          h("a.btn.btn-primary", { href: "#Lookup", onclick: this.handleLookup, classes: { disabled: !this.valid(trimmed) } }, "Lookup")
        ])
      ].concat(body));
    }
  }

  class IdentityReverseLookup {
    constructor() {
      this.input = "";
      this.loading = false;
      this.error = "";
      this.searched = false;
      this.result = null;
      this.handleInput = this.handleInput.bind(this);
      this.handleKey = this.handleKey.bind(this);
      this.handleLookup = this.handleLookup.bind(this);
    }

    handleInput(e) { this.input = e.target.value; Page.render(); }
    handleKey(e) { if (e.key === "Enter") this.handleLookup(); }

    async handleLookup() {
      var trimmed = this.input.trim();
      this.error = "";
      this.searched = true;
      this.loading = true;
      this.result = null;
      Page.render();
      try {
        if (!Bech32.looksLikeBech32(trimmed)) {
          this.error = "Enter a valid epix1... bech32 identity address";
        } else {
          var res = await Rest.reverseIdentity(trimmed);
          if (!res.ok) throw new Error("Failed to fetch");
          var data = res.data || {};
          if (data.name_record && data.name_record.name) {
            var peer = data.peer || {};
            this.result = {
              name: data.name_record.name,
              tld: data.name_record.tld,
              owner: data.name_record.owner,
              active: peer.active === undefined || peer.active === null ? true : !!peer.active,
              label: peer.label || "",
              addedAt: parseInt(peer.added_at || "0", 10),
              revokedAt: parseInt(peer.revoked_at || "0", 10)
            };
          }
        }
      } catch (e) {
        this.error = (e && e.message) || "Failed to fetch";
      }
      this.loading = false;
      Page.render();
      return false;
    }

    render() {
      var r = this.result;
      var body = [];
      if (this.loading) body.push(h("p.dim", { style: "margin-top:16px" }, "Resolving..."));
      if (this.error) body.push(h("p.text-err", { style: "margin-top:16px" }, this.error));
      if (this.searched && !this.loading && !this.error && r) {
        var rows = [
          h("div.kv", [h("span.k", "xID Name"), h("a.v.text-link", { href: Page.nameUrl(r.tld, r.name), onclick: Page.handleLinkClick, style: "font-weight:600" }, r.name + "." + r.tld)]),
          h("div.kv", [h("span.k", "Owner"), h("span.v.mono", Text.truncateAddress(r.owner))])
        ];
        if (r.label) rows.push(h("div.kv", [h("span.k", "Identity Label"), h("span.v", r.label)]));
        rows.push(h("div.kv", [h("span.k", "Status"), h("span.v", { classes: { "text-ok": r.active, "text-err": !r.active }, style: "font-weight:500" }, r.active ? "Active" : "Revoked (block " + r.revokedAt + ")")]));
        if (r.addedAt > 0) rows.push(h("div.kv", [h("span.k", "Added At Block"), h("span.v.mono", String(r.addedAt))]));
        body.push(h("div.subcard", { style: "margin-top:16px" }, rows));
      }
      if (this.searched && !this.loading && !this.error && !r) {
        body.push(h("div.subcard", { style: "margin-top:16px" }, [h("p.mid", "No xID name linked to this identity address.")]));
      }
      return h("div.card", { key: "identity" }, [
        h("h2", "Identity Reverse Lookup"),
        h("p.mid", { style: "margin:4px 0 16px" }, "Look up the xID name linked to an EpixNet identity address (epix1...)."),
        h("div.input-row.wrap-sm", [
          h("input.input.input-mono", { type: "text", value: this.input, placeholder: "epix1...", oninput: this.handleInput, onkeydown: this.handleKey, autocomplete: "off" }),
          h("a.btn.btn-primary", { href: "#Lookup", onclick: this.handleLookup, classes: { disabled: !Bech32.looksLikeBech32(this.input.trim()) } }, "Lookup")
        ])
      ].concat(body));
    }
  }

  class SearchPage {
    constructor() {
      this.showAdvanced = false;
      this.name_search = new NameSearch();
      this.forward = new ForwardResolve();
      this.reverse = new ReverseResolve();
      this.identity = new IdentityReverseLookup();
      this.handleToggle = this.handleToggle.bind(this);
    }

    handleToggle() { this.showAdvanced = !this.showAdvanced; Page.render(); return false; }

    render() {
      return h("div.stack.SearchPage", { key: "search" }, [
        h("div.page-head", [h("h1", "Search Names"), h("p", "Look up a name to see if it's registered.")]),
        this.name_search.render(),
        h("div", [
          h("button.disclosure", { onclick: this.handleToggle, classes: { "is-open": this.showAdvanced } }, [
            h("span.disclosure-tri", "▶"), "Advanced Lookup"
          ]),
          this.showAdvanced ? h("div.stack.disclosure-body", [
            this.forward.render(), this.reverse.render(), this.identity.render()
          ]) : null
        ])
      ]);
    }
  }

  window.SearchPage = SearchPage;
})();
