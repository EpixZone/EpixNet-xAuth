// Name detail: owner and primary status, profile, linked identities with the
// content root, DNS records, and (owner only) transfer.
(function () {
  // Stable handlers: maquette forbids a new function per render.
  function hideBroken(e) { e.target.style.display = "none"; }

  function txLine(prefix, tx) {
    if (!tx.hash) return null;
    return h("p.tx-line", [
      prefix,
      h("a.text-link", { href: tx.explorerUrl, target: "_blank", rel: "noreferrer" }, tx.hash.slice(0, 16) + "...")
    ]);
  }

  function errLine(tx) {
    return tx.errorText ? h("p.text-err.small", tx.errorText) : null;
  }

  class ProfileSection {
    constructor(page) {
      this.page = page;
      this.editing = false;
      this.editAvatar = "";
      this.editBio = "";
      this.tx = new TxState();
      this.handleEdit = this.handleEdit.bind(this);
      this.handleCancel = this.handleCancel.bind(this);
      this.handleSave = this.handleSave.bind(this);
      this.handleAvatarInput = this.handleAvatarInput.bind(this);
      this.handleBioInput = this.handleBioInput.bind(this);
    }

    reset() { this.editing = false; this.tx.reset(); }
    handleEdit() { this.editAvatar = this.page.avatar; this.editBio = this.page.bio; this.editing = true; Page.render(); return false; }
    handleCancel() { if (!this.tx.isBusy) { this.editing = false; Page.render(); } return false; }
    handleAvatarInput(e) { this.editAvatar = e.target.value; }
    handleBioInput(e) { this.editBio = e.target.value; }

    handleSave() {
      var self = this, page = this.page;
      if (this.tx.isBusy) return false;
      this.tx.run("updateProfile", [page.name, page.tld, this.editAvatar, this.editBio], function () {
        self.editing = false;
        page.loadProfile();
      });
      return false;
    }

    render() {
      var page = this.page, tx = this.tx;
      var body;
      if (this.editing) {
        body = h("div.stack-sm", [
          h("div", [
            h("label.field", "Avatar URL"),
            h("input.input", { type: "text", value: this.editAvatar, placeholder: "https://example.com/avatar.png", oninput: this.handleAvatarInput })
          ]),
          h("div", [
            h("label.field", "Bio"),
            h("textarea.textarea", { rows: "3", value: this.editBio, placeholder: "Tell the world about yourself", oninput: this.handleBioInput })
          ]),
          h("div.row-gap", [
            h("a.btn.btn-primary", { href: "#Save", onclick: this.handleSave, classes: { disabled: tx.isBusy } },
              tx.isPending ? "Confirming..." : tx.isConfirming ? "Waiting for tx..." : "Save Profile"),
            h("a.btn", { href: "#Cancel", onclick: this.handleCancel, classes: { disabled: tx.isBusy } }, "Cancel")
          ]),
          txLine("Tx: ", tx),
          errLine(tx)
        ]);
      } else {
        body = h("div.row-gap", { style: "gap:16px" }, [
          page.avatar
            ? h("img.avatar", { src: page.avatar, alt: "avatar", referrerpolicy: "no-referrer", loading: "lazy", onerror: hideBroken })
            : h("div.avatar-empty", "?"),
          h("p.mid", page.bio || "No bio set")
        ]);
      }
      return h("div.card", { key: "profile" }, [
        h("div.card-head-inline", [
          h("h2", "Profile"),
          page.isOwner() && !this.editing ? h("a.btn.btn-ghost.btn-sm", { href: "#Edit", onclick: this.handleEdit }, "Edit") : null
        ]),
        body
      ]);
    }
  }

  class LinkedIdentitiesSection {
    constructor(page) {
      this.page = page;
      this.adding = false;
      this.identityAddress = "";
      this.identityLabel = "";
      this.copied = false;
      this.copyTimer = null;
      this.addTx = new TxState();
      this.revokeTx = new TxState();
      this.prefilled = false;
      this.handleToggle = this.handleToggle.bind(this);
      this.handleCopy = this.handleCopy.bind(this);
      this.handleLinkVisitor = this.handleLinkVisitor.bind(this);
      this.handleLink = this.handleLink.bind(this);
      this.handleAddressInput = this.handleAddressInput.bind(this);
      this.handleLabelInput = this.handleLabelInput.bind(this);
      this.handleRevokeClick = this.handleRevokeClick.bind(this);
    }

    reset() {
      this.adding = false;
      this.identityAddress = "";
      this.identityLabel = "";
      this.prefilled = false;
      this.addTx.reset();
      this.revokeTx.reset();
    }

    // `?linkIdentity=` pre-fills and opens the form once the owner is known.
    onOwnerChanged() {
      var page = this.page;
      if (page.linkIdentityParam && page.isOwner() && !this.prefilled) {
        this.identityAddress = page.linkIdentityParam;
        this.adding = true;
        this.prefilled = true;
      }
    }

    handleToggle() { this.adding = !this.adding; Page.render(); return false; }
    handleAddressInput(e) { this.identityAddress = e.target.value; Page.render(); }
    handleLabelInput(e) { this.identityLabel = e.target.value; }

    handleCopy() {
      var self = this;
      var auth = Page.auth_address;
      if (auth && navigator.clipboard) navigator.clipboard.writeText(auth);
      this.copied = true;
      if (this.copyTimer) clearTimeout(this.copyTimer);
      this.copyTimer = setTimeout(function () { self.copied = false; Page.render(); }, 2000);
      Page.render();
      return false;
    }

    handleLinkVisitor() {
      this.identityAddress = Page.auth_address || "";
      this.adding = true;
      Page.render();
      return false;
    }

    handleLink() {
      var self = this, page = this.page;
      if (!this.identityAddress || this.addTx.isBusy) return false;
      this.addTx.run("linkIdentity", [page.name, page.tld, this.identityAddress, this.identityLabel], function () {
        // Tell the wrapper (an iframe overlay listens) that the identity landed.
        if (page.linkIdentityParam) {
          window.parent.postMessage({ type: "xid-identity-linked", address: page.linkIdentityParam }, "*");
        }
        self.adding = false;
        self.identityAddress = "";
        self.identityLabel = "";
        page.loadIdentities();
      });
      return false;
    }

    handleRevokeClick(e) {
      return this.unlink(e.currentTarget.getAttribute("data-address"));
    }

    unlink(addr) {
      var page = this.page;
      if (this.revokeTx.isBusy) return false;
      this.revokeTx.run("unlinkIdentity", [page.name, page.tld, addr], function () { page.loadIdentities(); });
      return false;
    }

    renderVisitor() {
      var auth = Page.auth_address;
      if (!auth) return null;
      var page = this.page;
      var linked = page.identities.some(function (p) { return p.address === auth && p.active; });
      return h("div.subcard-sm.row-between", { style: "margin-bottom:16px" }, [
        h("div", { style: "min-width:0" }, [
          h("p.field", { style: "margin-bottom:4px" }, "Your EpixNet Identity"),
          h("p.mono.break", auth)
        ]),
        h("div.row-gap", { style: "flex:none" }, [
          h("a.btn.btn-sm", { href: "#Copy", onclick: this.handleCopy }, this.copied ? "Copied!" : "Copy"),
          page.isOwner() && !linked ? h("a.btn.btn-sm.btn-primary", { href: "#Link", onclick: this.handleLinkVisitor }, "Link as Identity") : null,
          linked ? h("span.pill.pill-ok", "Authorized Identity") : null
        ])
      ]);
    }

    renderForm() {
      var tx = this.addTx;
      return h("div.subcard.stack-sm", { style: "margin-bottom:16px" }, [
        h("div.grid-2", [
          h("div", [h("label.field", "Identity Address"), h("input.input", { type: "text", value: this.identityAddress, placeholder: "0x... or epix1...", oninput: this.handleAddressInput })]),
          h("div", [h("label.field", "Label (optional)"), h("input.input", { type: "text", value: this.identityLabel, placeholder: "laptop, server, etc.", oninput: this.handleLabelInput })])
        ]),
        h("a.btn.btn-primary", { href: "#LinkIdentity", onclick: this.handleLink, classes: { disabled: tx.isBusy || !this.identityAddress } },
          tx.isPending ? "Confirming..." : tx.isConfirming ? "Waiting for tx..." : "Link Identity"),
        txLine("Tx: ", tx),
        errLine(tx)
      ]);
    }

    renderIdentity(peer) {
      var self = this, page = this.page;
      return h("div.identity-item", { key: peer.address, classes: { "is-revoked": !peer.active } }, [
        h("div.row-between", [
          h("div.row-gap", [
            peer.active ? h("span.pill.pill-ok", "Active") : h("span.pill.pill-bad", "Revoked"),
            peer.label ? h("span.chip", peer.label) : null
          ]),
          page.isOwner() && peer.active
            ? h("button.btn-link.warn", { onclick: this.handleRevokeClick, "data-address": peer.address, disabled: this.revokeTx.isBusy }, "Revoke")
            : null
        ]),
        h("p.mono.identity-addr.break", { style: "margin-top:4px", classes: { "is-revoked": !peer.active } }, peer.address),
        h("div.meta-row", [
          peer.addedAt > 0n ? h("span", "Added block #" + Format.block(peer.addedAt)) : null,
          !peer.active && peer.revokedAt > 0n ? h("span", "Revoked block #" + Format.block(peer.revokedAt)) : null
        ])
      ]);
    }

    render() {
      var self = this, page = this.page;
      var owner = page.isOwner();
      var list;
      if (page.identitiesLoading) list = h("p.dim", "Loading identities...");
      else if (page.identities.length === 0) list = h("p.dim", "No linked identities.");
      else list = h("div", [
        h("div", page.identities.map(function (p) { return self.renderIdentity(p); })),
        txLine("Revoke tx: ", this.revokeTx),
        errLine(this.revokeTx)
      ]);
      return h("div.card", { key: "identities" }, [
        h("div.card-head-inline", [
          h("h2", "Linked Identities"),
          owner ? h("a.btn.btn-ghost.btn-sm", { href: "#AddIdentity", onclick: this.handleToggle }, this.adding ? "Cancel" : "+ Link Identity") : null
        ]),
        this.renderVisitor(),
        this.adding && owner ? this.renderForm() : null,
        owner && page.identities.some(function (p) { return !p.active; }) ? h("div.msg.msg-warn", { style: "margin-bottom:16px" }, [
          h("strong", "Warning:"),
          " If an identity key was compromised, you must manually update the content root on each site where that identity had access to remove any unauthorized content."
        ]) : null,
        list,
        h("div", { style: "margin-top:16px;padding-top:16px;border-top:1px solid var(--epix-border)" }, [
          h("div.row-between", { style: "margin-bottom:8px" }, [
            h("h3.overline", "Content Root"),
            h("span.dim.small", "Auto-computed from active identities")
          ]),
          page.contentRoot
            ? h("div", [
                h("p.mono.break", page.contentRoot),
                h("p.dim.small", "Updated at Block #" + Format.block(page.contentRootUpdatedAt))
              ])
            : h("p.dim", "No content root (no active identities).")
        ])
      ]);
    }
  }

  class DnsRecordsSection {
    constructor(page) {
      this.page = page;
      this.records = [];
      this.loading = true;
      this.showAdd = false;
      this.recordType = 0;
      this.recordValue = "";
      this.recordTTL = "3600";
      this.setTx = new TxState();
      this.delTx = new TxState();
      this.handleToggle = this.handleToggle.bind(this);
      this.handleAdd = this.handleAdd.bind(this);
      this.handleTypeChange = this.handleTypeChange.bind(this);
      this.handleValueInput = this.handleValueInput.bind(this);
      this.handleTtlInput = this.handleTtlInput.bind(this);
      this.handleDeleteClick = this.handleDeleteClick.bind(this);
    }

    reset() {
      this.records = [];
      this.loading = true;
      this.showAdd = false;
      this.recordType = 0;
      this.recordValue = "";
      this.recordTTL = "3600";
      this.setTx.reset();
      this.delTx.reset();
    }

    async fetchRecords() {
      var page = this.page;
      this.loading = true;
      Page.render();
      try {
        var res = await Rest.dns(page.tld, page.name);
        this.records = (res.data && res.data.records) || [];
      } catch (e) {
        this.records = [];
      }
      this.loading = false;
      Page.render();
    }

    handleToggle() { this.showAdd = !this.showAdd; Page.render(); return false; }
    handleTypeChange(e) { this.recordType = Number(e.target.value); Page.render(); }
    handleValueInput(e) { this.recordValue = e.target.value; Page.render(); }
    handleTtlInput(e) { this.recordTTL = e.target.value; }

    handleAdd() {
      var self = this, page = this.page;
      if (!this.recordType || !this.recordValue || this.setTx.isBusy) return false;
      this.setTx.run("setDNSRecord", [page.name, page.tld, this.recordType, this.recordValue, parseInt(this.recordTTL, 10) || 0], function () {
        self.showAdd = false;
        self.recordValue = "";
        self.fetchRecords();
      });
      return false;
    }

    handleDeleteClick(e) {
      return this.del(Number(e.currentTarget.getAttribute("data-type")));
    }

    del(type) {
      var self = this, page = this.page;
      if (this.delTx.isBusy) return false;
      this.delTx.run("deleteDNSRecord", [page.name, page.tld, type], function () { self.fetchRecords(); });
      return false;
    }

    renderForm() {
      var tx = this.setTx;
      var options = [h("option", { value: "0", selected: this.recordType === 0 }, "Select...")].concat(
        XidContract.DNS_RECORD_TYPES.map(function (rt) {
          return h("option", { key: String(rt.type), value: String(rt.type), selected: this.recordType === rt.type }, rt.label + " (" + rt.type + ")");
        }, this)
      );
      return h("div.subcard.stack-sm", { style: "margin-bottom:16px" }, [
        h("div.grid-3", [
          h("div", [h("label.field", "Type"), h("select.select", { onchange: this.handleTypeChange, value: String(this.recordType) }, options)]),
          h("div", [h("label.field", "Value"), h("input.input", { type: "text", value: this.recordValue, placeholder: XidContract.recordPlaceholder(this.recordType), oninput: this.handleValueInput })]),
          h("div", [h("label.field", "TTL (seconds)"), h("input.input", { type: "number", value: this.recordTTL, oninput: this.handleTtlInput })])
        ]),
        h("a.btn.btn-primary", { href: "#AddRecord", onclick: this.handleAdd, classes: { disabled: tx.isBusy || !this.recordType || !this.recordValue } },
          tx.isPending ? "Confirming..." : tx.isConfirming ? "Waiting for tx..." : "Add Record"),
        txLine("Tx: ", tx),
        errLine(tx)
      ]);
    }

    render() {
      var self = this, page = this.page;
      var owner = page.isOwner();
      var list;
      if (this.loading) list = h("p.dim", "Loading records...");
      else if (this.records.length === 0) list = h("p.dim", "No DNS records configured.");
      else list = h("div", [
        h("div", this.records.map(function (r) {
          return h("div.subcard-sm.row-between", { key: String(r.record_type), style: "margin-bottom:8px" }, [
            h("div.row-gap", { style: "gap:16px" }, [
              h("span.chip", XidContract.recordLabel(r.record_type)),
              h("span.mono.break", r.value),
              h("span.dim.small", "TTL: " + r.ttl + "s")
            ]),
            owner ? h("button.btn-link.danger", { onclick: self.handleDeleteClick, "data-type": String(r.record_type), disabled: self.delTx.isBusy }, "Delete") : null
          ]);
        })),
        txLine("Delete tx: ", this.delTx),
        errLine(this.delTx)
      ]);
      return h("div.card", { key: "dns" }, [
        h("div.card-head-inline", [
          h("h2", "DNS Records"),
          owner ? h("a.btn.btn-ghost.btn-sm", { href: "#AddRecord", onclick: this.handleToggle }, this.showAdd ? "Cancel" : "+ Add Record") : null
        ]),
        this.showAdd && owner ? this.renderForm() : null,
        list
      ]);
    }
  }

  class TransferSection {
    constructor(page) {
      this.page = page;
      this.expanded = false;
      this.recipient = "";
      this.tx = new TxState();
      this.handleToggle = this.handleToggle.bind(this);
      this.handleInput = this.handleInput.bind(this);
      this.handleTransfer = this.handleTransfer.bind(this);
    }

    reset() { this.expanded = false; this.recipient = ""; this.tx.reset(); }
    handleToggle() { this.expanded = !this.expanded; Page.render(); return false; }
    handleInput(e) { this.recipient = e.target.value; Page.render(); }
    normalized() { return this.recipient ? Bech32.normalizeToEvmAddress(this.recipient) : null; }
    isSelf() {
      var n = this.normalized();
      return !!(n && Wallet.address && n.toLowerCase() === Wallet.address.toLowerCase());
    }

    handleTransfer() {
      var page = this.page;
      var to = this.normalized();
      if (!to || this.isSelf() || this.tx.isBusy) return false;
      this.tx.run("transferName", [page.name, page.tld, to], function () { page.loadOwner(); });
      return false;
    }

    render() {
      var page = this.page, tx = this.tx;
      var normalized = this.normalized();
      var form = h("div.card", { style: "margin-top:16px" }, [
        h("h2", "Transfer"),
        h("p.mid", { style: "margin:4px 0 16px" }, ["Transfer ownership of ", h("span", { style: "color:var(--epix-text);font-weight:500" }, page.name + "." + page.tld), " to another address. This is irreversible."]),
        h("div.stack-sm", [
          h("div", [
            h("label.field", "Recipient Address"),
            h("input.input.input-mono", { type: "text", value: this.recipient, placeholder: "0x... or epix1...", oninput: this.handleInput }),
            this.recipient && !normalized ? h("p.text-err.small", { style: "margin-top:4px" }, "Invalid address") : null,
            this.isSelf() ? h("p.text-warn.small", { style: "margin-top:4px" }, "Cannot transfer to yourself") : null
          ]),
          h("a.btn.btn-danger.btn-block", { href: "#Transfer", onclick: this.handleTransfer, classes: { disabled: tx.isBusy || !normalized || this.isSelf() } },
            tx.isPending ? "Confirm in Wallet..." : tx.isConfirming ? "Transferring..." : "Transfer Name"),
          tx.hash ? h("div.tx-box", [
            h("p.mid.small", { style: "margin-bottom:4px" }, "Transaction"),
            h("a.text-link.mono.small.break", { href: tx.explorerUrl, target: "_blank", rel: "noreferrer" }, tx.hash.slice(0, 20) + "..."),
            tx.isSuccess ? h("p.text-ok", { style: "margin-top:8px" }, "Transfer successful! Name ownership has been transferred.") : null
          ]) : null,
          errLine(tx)
        ])
      ]);
      return h("div", { key: "transfer" }, [
        h("button.disclosure", { onclick: this.handleToggle, classes: { "is-open": this.expanded } }, [h("span.disclosure-tri", "▶"), "Transfer Name"]),
        this.expanded ? form : null
      ]);
    }
  }

  class NameDetailPage {
    constructor() {
      this.tld = Chain.DEFAULT_TLD;
      this.name = "";
      this.linkIdentityParam = null;
      this.owner = null;
      this.resolveLoading = true;
      this.avatar = "";
      this.bio = "";
      this.identities = [];
      this.identitiesLoading = true;
      this.contentRoot = "";
      this.contentRootUpdatedAt = 0n;
      this.primaryName = "";
      this.primaryTld = "";
      this.primaryTx = new TxState();
      this.profile = new ProfileSection(this);
      this.linked = new LinkedIdentitiesSection(this);
      this.dns = new DnsRecordsSection(this);
      this.transfer = new TransferSection(this);
      this.handleSetPrimary = this.handleSetPrimary.bind(this);
    }

    enter(tld, name, linkParam) {
      var changed = tld !== this.tld || name !== this.name;
      this.tld = tld;
      this.name = name;
      this.linkIdentityParam = linkParam;
      if (changed) {
        this.owner = null;
        this.avatar = "";
        this.bio = "";
        this.identities = [];
        this.contentRoot = "";
        this.contentRootUpdatedAt = 0n;
        this.primaryTx.reset();
        this.profile.reset();
        this.linked.reset();
        this.dns.reset();
        this.transfer.reset();
      }
      this.loadOwner();
      this.loadProfile();
      this.loadIdentities();
      this.loadContentRoot();
      this.loadPrimary();
      this.dns.fetchRecords();
    }

    onWalletChanged() {
      this.loadPrimary();
      this.linked.onOwnerChanged();
    }

    isOwner() {
      return !!(Wallet.address && this.owner && Wallet.address.toLowerCase() === this.owner.toLowerCase());
    }

    isPrimary() {
      return this.primaryName === this.name && this.primaryTld === this.tld;
    }

    loadOwner() {
      var self = this;
      this.resolveLoading = true;
      Page.render();
      XidContract.read("resolve", [this.name, this.tld]).then(function (owner) {
        self.owner = String(owner);
        self.resolveLoading = false;
        self.linked.onOwnerChanged();
        Page.render();
      }).catch(function () {
        self.owner = null;
        self.resolveLoading = false;
        Page.render();
      });
    }

    loadProfile() {
      var self = this;
      XidContract.read("getProfile", [this.name, this.tld]).then(function (r) {
        self.avatar = String(r[0] || "");
        self.bio = String(r[1] || "");
        Page.render();
      }).catch(function () {});
    }

    loadIdentities() {
      var self = this;
      this.identitiesLoading = true;
      XidContract.read("getLinkedIdentities", [this.name, this.tld]).then(function (r) {
        self.identities = XidContract.peersFrom(r);
        self.identitiesLoading = false;
        self.linked.onOwnerChanged();
        Page.render();
      }).catch(function () {
        self.identitiesLoading = false;
        Page.render();
      });
      this.loadContentRoot();
    }

    loadContentRoot() {
      var self = this;
      XidContract.read("getContentRoot", [this.name, this.tld]).then(function (r) {
        self.contentRoot = String(r[0] || "");
        self.contentRootUpdatedAt = r[1] || 0n;
        Page.render();
      }).catch(function () {});
    }

    loadPrimary() {
      var self = this;
      if (!Wallet.address) { this.primaryName = ""; this.primaryTld = ""; Page.render(); return; }
      XidContract.read("getPrimaryName", [Wallet.address]).then(function (r) {
        self.primaryName = String(r[0] || "");
        self.primaryTld = String(r[1] || "");
        Page.render();
      }).catch(function () {});
    }

    handleSetPrimary() {
      var self = this;
      if (this.primaryTx.isBusy) return false;
      this.primaryTx.run("setPrimaryName", [this.name, this.tld], function () { self.loadPrimary(); });
      return false;
    }

    render() {
      if (this.resolveLoading && this.owner === null) {
        return h("p.mid", { key: "name-loading", style: "padding:32px 0" }, "Loading...");
      }
      var owner = this.isOwner(), primary = this.isPrimary(), tx = this.primaryTx;
      return h("div.stack.NameDetailPage", { key: "name-" + this.tld + "-" + this.name }, [
        h("div", [
          h("a.back-link", { href: "?MyNames", onclick: Page.handleLinkClick }, "← Back to My Names"),
          h("h1", { style: "font-size:24px" }, [this.name, h("span.dim", "." + this.tld)]),
          this.owner ? h("p.mid", { style: "margin-top:4px" }, [
            "Owner: ", h("span.mono", { style: "color:var(--epix-text)" }, Text.truncateAddress(this.owner)),
            owner ? h("span.pill.pill-accent", { style: "margin-left:8px" }, "You") : null,
            primary ? h("span.pill.pill-ok", { style: "margin-left:8px" }, "Primary Name") : null
          ]) : null,
          owner && !primary ? h("a.btn.btn-primary", { href: "#SetPrimary", onclick: this.handleSetPrimary, classes: { disabled: tx.isBusy }, style: "margin-top:12px" },
            tx.isPending ? "Confirming..." : tx.isConfirming ? "Setting..." : "Set as Primary Name") : null,
          tx.isSuccess ? h("p.text-ok", { style: "margin-top:4px" }, "Primary name updated!") : null,
          errLine(tx)
        ]),
        this.profile.render(),
        this.linked.render(),
        this.dns.render(),
        owner ? this.transfer.render() : null
      ]);
    }
  }

  window.NameDetailPage = NameDetailPage;
})();
