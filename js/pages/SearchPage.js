// Search by name, wallet owner, or linked EpixNet identity.
(function () {
  function hideBroken(e) { e.target.style.display = "none"; }
  function errorMessage(error, fallback) {
    return (window.TxErrors && TxErrors.extract(error)) || fallback;
  }
  function retry(error, handler) {
    return h("div.msg.msg-err.stack-sm", { key: "error", role: "alert" }, [
      h("p", error), h("button.btn.btn-secondary", { type: "button", onclick: handler }, "Try again")
    ]);
  }

  class NameLookup {
    constructor() {
      this.input = "";
      this.loading = false;
      this.error = "";
      this.validation = "";
      this.result = null;
      this.seq = 0;
      this.timer = null;
      this.handleInput = this.handleInput.bind(this);
      this.handleKey = this.handleKey.bind(this);
      this.lookup = this.lookup.bind(this);
    }

    handleInput(e) {
      this.input = e.target.value;
      ++this.seq;
      if (this.timer) clearTimeout(this.timer);
      this.result = null;
      this.error = "";
      this.loading = false;
      var parsed = Text.nameInput(this.input);
      this.validation = this.input.trim() ? parsed.error : "";
      if (parsed.valid) this.timer = setTimeout(this.lookup, 300);
      Page.render();
    }

    handleKey(e) {
      if (e.key === "Enter") { e.preventDefault(); this.lookup(); }
    }

    async lookup() {
      if (this.timer) clearTimeout(this.timer);
      var parsed = Text.nameInput(this.input);
      var seq = ++this.seq;
      this.validation = parsed.error;
      this.error = "";
      this.result = null;
      this.loading = parsed.valid;
      Page.render();
      if (!parsed.valid) return;
      try {
        var values = await Promise.all([
          XidContract.read("resolve", [parsed.name, parsed.tld]),
          XidContract.read("getRegistrationFee", [parsed.name, parsed.tld]).then(function (fee) { return { fee: fee }; }, function () { return { error: true }; }),
          XidContract.read("getProfile", [parsed.name, parsed.tld]).then(function (profile) { return { profile: profile }; }, function () { return { error: true }; })
        ]);
        if (seq !== this.seq) return;
        var profile = values[2].profile || [];
        this.result = {
          name: parsed.name, tld: parsed.tld, owner: String(values[0]),
          fee: values[1].fee, feeError: !!values[1].error,
          avatar: String(profile[0] || ""), bio: String(profile[1] || ""), profileError: !!values[2].error
        };
      } catch (e) {
        if (seq !== this.seq) return;
        this.error = "Could not look up this name. " + errorMessage(e, "Check your connection and try again.");
      }
      this.loading = false;
      Page.render();
    }

    renderResult() {
      var r = this.result;
      if (!r) return null;
      var fullName = r.name + "." + r.tld;
      if (r.owner === XidContract.ZERO) {
        return h("div.lookup-result.stack-sm", { key: "available" }, [
          h("div.row-between", [h("h2.result-title", fullName), h("span.pill.pill-ok", "Available")]),
          h("p.mid", "This name is ready to register. It is yours permanently, with no renewal fees."),
          r.fee !== undefined ? h("div.kv", [h("span.k", "One-time fee"), h("span.v", Format.ether(r.fee) + " EPIX")]) : h("p.text-warn", "The fee could not be loaded. It will be checked again before registration."),
          h("a.btn.btn-primary", { href: "?Register&name=" + encodeURIComponent(r.name), onclick: Page.handleLinkClick }, "Register " + fullName)
        ]);
      }
      return h("div.lookup-result.stack-sm", { key: "registered" }, [
        h("div.row-between", [h("h2.result-title", fullName), h("span.pill.pill-accent", "Registered")]),
        r.avatar ? h("img.avatar", { src: r.avatar, alt: fullName + " profile", referrerpolicy: "no-referrer", loading: "lazy", onerror: hideBroken }) : null,
        r.bio ? ProfileMarkdown.render(r.bio, "search-bio") : null,
        h("div.kv", [h("span.k", "Wallet (EVM)"), h("span.v.mono", r.owner)]),
        h("div.kv", [h("span.k", "Wallet (Epix)"), h("span.v.mono", Bech32.evmToBech32(r.owner))]),
        r.profileError ? h("div.msg.msg-warn", ["Owner found, but the profile could not be loaded. ", h("button.btn.btn-secondary", { type: "button", onclick: this.lookup }, "Retry profile")]) : null,
        h("a.btn.btn-primary", { href: Page.nameUrl(r.tld, r.name), onclick: Page.handleLinkClick }, "View name details")
      ]);
    }

    render() {
      return h("div.card.stack-sm", { key: "name-lookup" }, [
        h("div", [h("h2", "Find a name"), h("p.mid", "Check availability or find the wallet and profile behind a name.")]),
        h("label.field", { for: "lookup-name" }, "Name"),
        h("div.input-row.wrap-sm", [
          h("input.input", { id: "lookup-name", type: "text", value: this.input, placeholder: "yourname or yourname.epix", oninput: this.handleInput, onkeydown: this.handleKey, autocomplete: "off", spellcheck: false, "aria-describedby": "lookup-name-help", "aria-invalid": this.validation ? "true" : "false" }),
          h("button.btn.btn-primary", { type: "button", onclick: this.lookup, disabled: this.loading || !this.input.trim() }, "Search")
        ]),
        h("p.lookup-hint.small.dim", { id: "lookup-name-help" }, this.validation || "1–64 letters, numbers, or internal hyphens. You can paste a full .epix name."),
        h("div.stack-sm", { "aria-live": "polite", "aria-busy": this.loading ? "true" : "false" }, [
          this.loading ? h("p.mid", { key: "loading", role: "status" }, "Looking up " + Text.normalizeName(this.input) + ".epix...") : null,
          this.error ? retry(this.error, this.lookup) : null,
          this.renderResult(),
          !this.input.trim() ? h("div.lookup-empty", { key: "empty" }, "Enter a name to get started. No wallet connection needed.") : null
        ])
      ]);
    }
  }

  class WalletLookup {
    constructor() {
      this.input = "";
      this.address = "";
      this.names = [];
      this.primary = null;
      this.total = 0;
      this.loading = false;
      this.searched = false;
      this.error = "";
      this.warning = "";
      this.seq = 0;
      this.page = 0;
      this.size = 10;
      this.handleInput = this.handleInput.bind(this);
      this.handleKey = this.handleKey.bind(this);
      this.lookup = this.lookup.bind(this);
      this.previous = this.previous.bind(this);
      this.next = this.next.bind(this);
    }

    handleInput(e) {
      this.input = e.target.value;
      ++this.seq;
      this.loading = false;
      this.searched = false;
      this.names = [];
      this.error = "";
      this.warning = "";
      Page.render();
    }
    handleKey(e) { if (e.key === "Enter") { e.preventDefault(); this.lookup(); } }
    previous() { if (this.page > 0) this.page--; Page.render(); }
    next() { if ((this.page + 1) * this.size < this.names.length) this.page++; Page.render(); }

    async lookup() {
      var address = this.input.trim();
      var seq = ++this.seq;
      this.error = "";
      this.warning = "";
      this.names = [];
      this.primary = null;
      this.searched = false;
      this.page = 0;
      this.loading = false;
      if (!ethers.isAddress(address) && !Bech32.isBech32Address(address)) {
        this.error = "Enter a valid 0x wallet address or an epix1 address with a valid checksum.";
        Page.render();
        return;
      }
      this.address = address;
      this.loading = true;
      Page.render();
      try {
        var b32 = ethers.isAddress(address) ? Bech32.evmToBech32(address) : address;
        var results = await Promise.all([
          Rest.namesAll(b32),
          Rest.reverse(b32).catch(function () { return { ok: false }; })
        ]);
        if (seq !== this.seq) return;
        var primaryResponse = results[1];
        this.primary = primaryResponse.ok && primaryResponse.data ? primaryResponse.data.primary_name : null;
        if (!primaryResponse.ok && primaryResponse.status !== 404) this.warning = "Names loaded, but the primary name could not be checked.";
        this.names = results[0].names.slice();
        var primary = this.primary;
        if (primary) this.names.sort(function (a, b) {
          var aPrimary = a.name === primary.name && a.tld === primary.tld;
          var bPrimary = b.name === primary.name && b.tld === primary.tld;
          return Number(bPrimary) - Number(aPrimary);
        });
        this.total = results[0].total;
        this.searched = true;
      } catch (e) {
        if (seq !== this.seq) return;
        this.error = "Could not load this wallet's names. " + errorMessage(e, "Please try again.");
      }
      this.loading = false;
      Page.render();
    }

    render() {
      var self = this;
      var start = this.page * this.size;
      return h("div.card.stack-sm", { key: "wallet-lookup" }, [
        h("div", [h("h2", "Find a wallet's names"), h("p.mid", "See every name owned by an EVM or Epix wallet.")]),
        h("label.field", { for: "lookup-wallet" }, "Wallet address"),
        h("div.input-row.wrap-sm", [
          h("input.input.input-mono", { id: "lookup-wallet", value: this.input, placeholder: "0x... or epix1...", oninput: this.handleInput, onkeydown: this.handleKey, autocomplete: "off", spellcheck: false, "aria-describedby": "lookup-wallet-help" }),
          h("button.btn.btn-primary", { type: "button", onclick: this.lookup, disabled: this.loading || !this.input.trim() }, "Look up wallet")
        ]),
        h("p.lookup-hint.small.dim", { id: "lookup-wallet-help" }, "Use the wallet that owns the name. To find a linked EpixNet identity, choose Identity above."),
        h("div.stack-sm", { "aria-live": "polite", "aria-busy": this.loading ? "true" : "false" }, [
          this.loading ? h("p.mid", { key: "loading", role: "status" }, "Loading all names...") : null,
          this.error ? retry(this.error, this.lookup) : null,
          this.warning ? h("p.text-warn", { key: "warning" }, this.warning) : null,
          this.searched ? h("div.lookup-result.stack-sm", { key: "result" }, [
            h("div.row-between", [h("h2.result-title", Text.plural(this.total, "name")), h("span.mono.small.mid", Text.truncateAddress(this.address))]),
            this.names.length ? h("div.stack-sm", { key: "names" }, this.names.slice(start, start + this.size).map(function (entry) {
              var isPrimary = self.primary && entry.name === self.primary.name && entry.tld === self.primary.tld;
              return h("a.subcard-sm.row-between", { key: entry.tld + "/" + entry.name, href: Page.nameUrl(entry.tld, entry.name), onclick: Page.handleLinkClick }, [
                h("span.row-gap", [h("span", entry.name + "." + entry.tld), isPrimary ? h("span.pill.pill-accent", "Primary") : null]), h("span.small", "View details")
              ]);
            })) : h("p.mid", { key: "none" }, "This wallet does not own any names. A linked EpixNet address can be checked in Identity lookup."),
            this.names.length > this.size ? h("div.row-between", { key: "pagination" }, [
              h("button.btn.btn-secondary", { type: "button", onclick: this.previous, disabled: this.page === 0 }, "Previous"),
              h("span.small.mid", String(start + 1) + "–" + Math.min(start + this.size, this.names.length) + " of " + this.names.length),
              h("button.btn.btn-secondary", { type: "button", onclick: this.next, disabled: start + this.size >= this.names.length }, "Next")
            ]) : null
          ]) : null
        ])
      ]);
    }
  }

  class IdentityLookup {
    constructor() {
      this.input = "";
      this.address = "";
      this.loading = false;
      this.error = "";
      this.searched = false;
      this.result = null;
      this.seq = 0;
      this.handleInput = this.handleInput.bind(this);
      this.handleKey = this.handleKey.bind(this);
      this.lookup = this.lookup.bind(this);
    }
    handleInput(e) {
      this.input = e.target.value;
      ++this.seq;
      this.loading = false;
      this.error = "";
      this.searched = false;
      this.result = null;
      Page.render();
    }
    handleKey(e) { if (e.key === "Enter") { e.preventDefault(); this.lookup(); } }

    async lookup() {
      var address = this.input.trim();
      var seq = ++this.seq;
      this.error = "";
      this.searched = false;
      this.result = null;
      this.loading = false;
      if (!Bech32.isBech32Address(address)) {
        this.error = "Enter a valid epix1 identity address with a valid checksum.";
        Page.render();
        return;
      }
      this.address = address;
      this.loading = true;
      Page.render();
      try {
        var response = await Rest.reverseIdentity(address);
        if (seq !== this.seq) return;
        if (!response.ok) throw new Error("The identity service did not return a result.");
        var data = response.data || {};
        if (data.name_record && data.name_record.name) {
          var identity = data.identity;
          this.result = {
            name: data.name_record.name, tld: data.name_record.tld, owner: data.name_record.owner,
            active: identity && typeof identity.active === "boolean" ? identity.active : null,
            label: identity ? identity.label || "" : "",
            addedAt: identity ? String(identity.added_at || "0") : "0",
            revokedAt: identity ? String(identity.revoked_at || "0") : "0"
          };
        }
        this.searched = true;
      } catch (e) {
        if (seq !== this.seq) return;
        this.error = "Could not look up this identity. " + errorMessage(e, "Please try again.");
      }
      this.loading = false;
      Page.render();
    }

    render() {
      var r = this.result;
      return h("div.card.stack-sm", { key: "identity-lookup" }, [
        h("div", [h("h2", "Find a linked identity"), h("p.mid", "Look up the name linked to an EpixNet identity and check its status.")]),
        h("label.field", { for: "lookup-identity" }, "EpixNet identity address"),
        h("div.input-row.wrap-sm", [
          h("input.input.input-mono", { id: "lookup-identity", value: this.input, placeholder: "epix1...", oninput: this.handleInput, onkeydown: this.handleKey, autocomplete: "off", spellcheck: false }),
          h("button.btn.btn-primary", { type: "button", onclick: this.lookup, disabled: this.loading || !this.input.trim() }, "Look up identity")
        ]),
        h("div.stack-sm", { "aria-live": "polite", "aria-busy": this.loading ? "true" : "false" }, [
          this.loading ? h("p.mid", { key: "loading", role: "status" }, "Looking up identity...") : null,
          this.error ? retry(this.error, this.lookup) : null,
          this.searched && r ? h("div.lookup-result.stack-sm", { key: "result" }, [
            h("div.row-between", [h("h2.result-title", r.name + "." + r.tld), h("span.pill", { classes: { "pill-ok": r.active === true, "pill-bad": r.active === false } }, r.active === true ? "Active" : r.active === false ? "Revoked" : "Status unavailable")]),
            h("div.kv", [h("span.k", "Identity"), h("span.v.mono", this.address)]),
            h("div.kv", [h("span.k", "Owner"), h("span.v.mono", r.owner)]),
            r.label ? h("div.kv", { key: "label" }, [h("span.k", "Label"), h("span.v", r.label)]) : null,
            r.addedAt !== "0" ? h("div.kv", { key: "added" }, [h("span.k", "Linked at block"), h("span.v.mono", r.addedAt)]) : null,
            r.active === false && r.revokedAt !== "0" ? h("div.kv", { key: "revoked" }, [h("span.k", "Revoked at block"), h("span.v.mono", r.revokedAt)]) : null,
            h("a.btn.btn-primary", { href: Page.nameUrl(r.tld, r.name), onclick: Page.handleLinkClick }, "View name details")
          ]) : null,
          this.searched && !r ? h("div.lookup-empty", { key: "empty" }, "No name is linked to this identity. If this is a wallet address, use Wallet lookup.") : null
        ])
      ]);
    }
  }

  class SearchPage {
    constructor() {
      this.mode = "name";
      this.name_search = new NameLookup();
      this.reverse = new WalletLookup();
      this.identity = new IdentityLookup();
      this.selectName = this.selectName.bind(this);
      this.selectWallet = this.selectWallet.bind(this);
      this.selectIdentity = this.selectIdentity.bind(this);
    }
    selectName() { this.mode = "name"; Page.render(); }
    selectWallet() { this.mode = "wallet"; Page.render(); }
    selectIdentity() { this.mode = "identity"; Page.render(); }
    render() {
      return h("div.stack.SearchPage", { key: "search" }, [
        h("div.page-head", [h("h1", "Search names & identities"), h("p", "Explore names, wallet ownership, and linked EpixNet identities.")]),
        h("div.lookup-tabs", { role: "group", "aria-label": "Lookup type" }, [
          h("button.lookup-tab", { type: "button", onclick: this.selectName, classes: { "is-active": this.mode === "name" }, "aria-pressed": this.mode === "name" ? "true" : "false" }, "Name"),
          h("button.lookup-tab", { type: "button", onclick: this.selectWallet, classes: { "is-active": this.mode === "wallet" }, "aria-pressed": this.mode === "wallet" ? "true" : "false" }, "Wallet"),
          h("button.lookup-tab", { type: "button", onclick: this.selectIdentity, classes: { "is-active": this.mode === "identity" }, "aria-pressed": this.mode === "identity" ? "true" : "false" }, "Identity")
        ]),
        this.mode === "name" ? this.name_search.render() : this.mode === "wallet" ? this.reverse.render() : this.identity.render()
      ]);
    }
  }
  window.SearchPage = SearchPage;
})();
