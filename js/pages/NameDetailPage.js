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
    return tx.errorText ? h("p.text-err.small", { role: "alert" }, tx.errorText) : null;
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
            h("label.field", { for: "profile-avatar" }, "Avatar URL"),
            h("input.input", { id: "profile-avatar", type: "text", value: this.editAvatar, placeholder: "https://example.com/avatar.png", oninput: this.handleAvatarInput })
          ]),
          h("div", [
            h("label.field", { for: "profile-bio" }, "Bio"),
            h("textarea.textarea", { id: "profile-bio", rows: "3", value: this.editBio, placeholder: "Tell the world about yourself", oninput: this.handleBioInput })
          ]),
          h("div.row-gap", [
            h("button.btn.btn-primary", { type: "button", onclick: this.handleSave, disabled: tx.isBusy },
              tx.isPending ? "Confirming..." : tx.isConfirming ? "Waiting for tx..." : "Save Profile"),
            h("button.btn", { type: "button", onclick: this.handleCancel, disabled: tx.isBusy }, "Cancel")
          ]),
          txLine("Tx: ", tx),
          errLine(tx)
        ]);
      } else {
        body = h("div.row-gap", { style: "gap:16px" }, [
          page.avatar
            ? h("img.avatar", { src: page.avatar, alt: "avatar", referrerpolicy: "no-referrer", loading: "lazy", onerror: hideBroken })
            : h("div.avatar-empty", "?"),
          h("p.mid", page.profileError || page.bio || "No bio set")
        ]);
      }
      return h("div.card", { key: "profile" }, [
        h("div.card-head-inline", [
          h("h2", "Profile"),
          page.isOwner() && !this.editing ? h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: this.handleEdit }, "Edit") : null
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
          h("button.btn.btn-sm", { type: "button", onclick: this.handleCopy }, this.copied ? "Copied!" : "Copy"),
          page.isOwner() && !linked ? h("button.btn.btn-sm.btn-primary", { type: "button", onclick: this.handleLinkVisitor }, "Link as Identity") : null,
          linked ? h("span.pill.pill-ok", "Authorized Identity") : null
        ])
      ]);
    }

    renderForm() {
      var tx = this.addTx;
      return h("div.subcard.stack-sm", { style: "margin-bottom:16px" }, [
        h("div.grid-2", [
          h("div", [h("label.field", { for: "identity-address" }, "Identity Address"), h("input.input", { id: "identity-address", type: "text", value: this.identityAddress, placeholder: "0x... or epix1...", oninput: this.handleAddressInput })]),
          h("div", [h("label.field", { for: "identity-label" }, "Label (optional)"), h("input.input", { id: "identity-label", type: "text", value: this.identityLabel, placeholder: "laptop, server, etc.", oninput: this.handleLabelInput })])
        ]),
        h("button.btn.btn-primary", { type: "button", onclick: this.handleLink, disabled: tx.isBusy || !this.identityAddress },
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
      else if (page.identitiesError) list = h("p.text-err", { role: "alert" }, page.identitiesError);
      else if (page.identities.length === 0) list = h("p.dim", "No linked identities.");
      else list = h("div", [
        h("div", page.identities.map(function (p) { return self.renderIdentity(p); })),
        txLine("Revoke tx: ", this.revokeTx),
        errLine(this.revokeTx)
      ]);
      return h("div.card", { key: "identities" }, [
        h("div.card-head-inline", [
          h("h2", "Linked Identities"),
          owner ? h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: this.handleToggle }, this.adding ? "Cancel" : "+ Link Identity") : null
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
            : h("p.dim", page.contentRootError || "No content root (no active identities).")
        ])
      ]);
    }
  }

  class DnsRecordsSection {
    constructor(page) {
      this.page = page;
      this.records = [];
      this.loading = true;
      this.error = "";
      this.showAdd = false;
      this.recordType = 65280;
      this.recordValue = "";
      this.recordTTL = "3600";
      this.setTx = new TxState();
      this.delTx = new TxState();
      ["handleToggle", "handleAdd", "handleTypeChange", "handleValueInput", "handleTtlInput", "handleDeleteClick", "handleEditClick", "fetchRecords"].forEach(function (method) { this[method] = this[method].bind(this); }, this);
    }

    reset() {
      this.records = [];
      this.loading = true;
      this.error = "";
      this.showAdd = false;
      this.recordType = 65280;
      this.recordValue = "";
      this.recordTTL = "3600";
      this.setTx.reset();
      this.delTx.reset();
    }

    async fetchRecords() {
      var page = this.page, token = page.beginRead("dns");
      this.loading = true;
      this.error = "";
      Page.render();
      try {
        var res = await Rest.dns(page.tld, page.name);
        if (!page.isCurrent("dns", token)) return;
        if (!res.ok || !res.data || !Array.isArray(res.data.records)) throw new Error();
        this.records = res.data.records;
      } catch (e) {
        if (!page.isCurrent("dns", token)) return;
        this.error = "Could not load records. Try again before making changes.";
      }
      this.loading = false;
      Page.render();
    }

    existing(type) { return this.records.find(function (r) { return Number(r.record_type) === Number(type); }); }
    choose(type) {
      var record = this.existing(type);
      this.recordType = Number(type);
      this.recordValue = record ? record.value : "";
      this.recordTTL = record ? String(record.ttl) : "3600";
      this.setTx.reset();
    }
    handleToggle() {
      if (this.setTx.isBusy || this.delTx.isBusy) return false;
      this.showAdd = !this.showAdd;
      if (this.showAdd) this.choose(65280);
      Page.render();
      return false;
    }
    handleEditClick(e) {
      if (this.setTx.isBusy || this.delTx.isBusy) return false;
      this.choose(e.currentTarget.getAttribute("data-type"));
      this.showAdd = true;
      Page.render();
      return false;
    }
    handleTypeChange(e) { if (!this.setTx.isBusy && !this.delTx.isBusy) this.choose(e.target.value); Page.render(); }
    handleValueInput(e) { this.recordValue = e.target.value; Page.render(); }
    handleTtlInput(e) { this.recordTTL = e.target.value; Page.render(); }

    handleAdd() {
      var self = this, page = this.page;
      var checked = XidContract.recordValue(this.recordType, this.recordValue);
      if (!page.isOwner() || checked.error || XidContract.recordTtlError(this.recordTTL) || this.setTx.isBusy || this.delTx.isBusy || this.loading || this.error) return false;
      this.setTx.run("setDNSRecord", [page.name, page.tld, this.recordType, checked.value, Number(this.recordTTL)], function () {
        self.showAdd = false;
        self.recordValue = "";
        self.fetchRecords();
      });
      return false;
    }
    handleDeleteClick(e) { return this.del(Number(e.currentTarget.getAttribute("data-type"))); }
    del(type) {
      var self = this, page = this.page;
      if (!page.isOwner() || this.delTx.isBusy || this.setTx.isBusy) return false;
      this.delTx.run("deleteDNSRecord", [page.name, page.tld, type], function () { self.fetchRecords(); });
      return false;
    }

    renderForm() {
      var tx = this.setTx, type = this.recordType;
      var info = XidContract.recordInfo(type), epixnet = type === 65280;
      var existing = this.existing(type);
      var checked = XidContract.recordValue(type, this.recordValue);
      var valueError = this.recordValue ? checked.error : "";
      var ttlError = XidContract.recordTtlError(this.recordTTL);
      return h("div.record-form.stack-sm", { key: "record-form" }, [
        h("div", [
          h("label.field", { for: "dns-type" }, "What would you like to connect?"),
          h("select.select", { id: "dns-type", onchange: this.handleTypeChange, value: String(type), disabled: tx.isBusy || this.delTx.isBusy },
            XidContract.DNS_RECORD_TYPES.map(function (rt) {
              return h("option", { key: String(rt.type), value: String(rt.type) }, rt.title);
            }))
        ]),
        h("div.record-help.stack-sm", { id: "dns-type-help" }, [
          h("p", { style: "font-weight:600" }, info.help),
          epixnet ? h("ol.guide-steps", [
            h("li", "Publish your xite and open it in EpixNet."),
            h("li", "Copy its epix1... address from the address bar. You can also paste the full xite URL below."),
            h("li", "Save the record and confirm the transaction in your wallet.")
          ]) : h("p.small.mid", "These records store settings on EpixChain. This app does not provide public DNS hosting; a service must support xID records to use them."),
          epixnet ? h("p.small.mid", "Use the xite's address here. Your wallet address and linked login identity have different roles. This record points visitors to your xite; it does not publish content or grant account access.") : null
        ]),
        h("div", [
          h("label.field", { for: "dns-value" }, info.field),
          h("input.input.input-mono", { id: "dns-value", type: "text", value: this.recordValue, placeholder: info.placeholder, oninput: this.handleValueInput, disabled: tx.isBusy || this.delTx.isBusy, autocomplete: "off", "aria-describedby": "dns-value-help dns-value-error", "aria-invalid": valueError ? "true" : "false" }),
          h("p.dim.small", { id: "dns-value-help", style: "margin-top:6px" }, info.example),
          h("p.text-err.small", { id: "dns-value-error", role: "status" }, valueError)
        ]),
        epixnet && checked.value && !checked.error ? h("div.record-preview", [
          h("p.overline", "Your xite destination"),
          h("p.break", [h("strong", this.page.name + "." + this.page.tld), " → ", h("span.mono", checked.value)]),
          h("p.dim.small", "After confirmation, EpixNet can resolve your name to this xite. Existing resolver caches may take time to update.")
        ]) : null,
        h("details.record-advanced", [
          h("summary", "Cache duration (advanced)"),
          h("div.stack-sm", [
            h("label.field", { for: "dns-ttl" }, "TTL in seconds"),
            h("input.input", { id: "dns-ttl", type: "number", min: "0", max: "604800", step: "1", value: this.recordTTL, oninput: this.handleTtlInput, disabled: tx.isBusy || this.delTx.isBusy, "aria-describedby": "dns-ttl-help", "aria-invalid": ttlError ? "true" : "false" }),
            h("p.dim.small", { id: "dns-ttl-help" }, "Suggested cache duration for compatible clients. 3600 means one hour. Use 0 for the default, or 60 to 604800 seconds. Clients may use their own cache duration.")
          ])
        ]),
        ttlError ? h("p.text-err.small", { role: "alert" }, ttlError) : null,
        existing ? h("p.small.mid", "Saving replaces the existing " + info.label + " value. Each name has one record per type.") : null,
        h("button.btn.btn-primary", { type: "button", onclick: this.handleAdd, disabled: tx.isBusy || this.delTx.isBusy || !!checked.error || !!ttlError || this.loading || !!this.error },
          tx.isPending ? "Confirm in wallet..." : tx.isConfirming ? "Saving..." : epixnet ? "Save xite address" : existing ? "Update record" : "Save record")
      ]);
    }

    render() {
      var self = this, page = this.page, owner = page.isOwner();
      var records = this.records.slice().sort(function (a, b) { return (Number(a.record_type) === 65280 ? -1 : 1) - (Number(b.record_type) === 65280 ? -1 : 1); });
      return h("section.card.stack-sm", { key: "dns", "aria-labelledby": "records-heading" }, [
        h("div.card-head-inline", [
          h("h2", { id: "records-heading" }, "Xite & other records"),
          owner ? h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: this.handleToggle, disabled: this.setTx.isBusy || this.delTx.isBusy || this.loading || !!this.error, "aria-expanded": this.showAdd ? "true" : "false" }, this.showAdd ? "Cancel" : "+ Set a record") : null
        ]),
        h("p.mid", "Use an EpixNet record to give your published xite a memorable .epix address. Standard DNS records are available for compatible services."),
        this.showAdd && owner ? this.renderForm() : null,
        this.loading ? h("p.dim", { role: "status" }, "Loading records...")
          : this.error ? h("div.stack-sm", [h("p.text-err", { role: "alert" }, this.error), h("button.btn.btn-sm", { type: "button", onclick: this.fetchRecords }, "Retry")])
          : !records.length ? h("div.record-empty", [h("p", "No xite destination or other records yet."), h("p.small.dim", owner ? "Choose Set a record to connect your xite. EpixNet is selected for you." : "The owner has not set a xite destination.")])
          : h("div.stack-sm", records.map(function (r) {
              var type = Number(r.record_type), info = XidContract.recordInfo(type);
              return h("div.subcard-sm", { key: String(type) }, [
                h("div.row-between", [
                  h("div.row-gap", { key: "record-meta" }, [h("span.chip", XidContract.recordLabel(type)), h("span.small.mid", type === 65280 ? "Xite destination" : info.title)]),
                  owner ? h("div.row-gap", { key: "record-actions" }, [
                    h("button.btn-link", { type: "button", onclick: self.handleEditClick, "data-type": String(type), disabled: self.setTx.isBusy || self.delTx.isBusy }, "Edit"),
                    h("button.btn-link.danger", { type: "button", onclick: self.handleDeleteClick, "data-type": String(type), disabled: self.delTx.isBusy || self.setTx.isBusy }, "Delete")
                  ]) : null
                ]),
                h("p.mono.break", { style: "margin-top:8px" }, r.value),
                h("p.dim.small", { style: "margin-top:4px" }, "Cache duration: " + (Number(r.ttl) === 0 ? "client default" : r.ttl + " seconds"))
              ]);
            })),
        h("div", { role: "status", "aria-live": "polite" }, [
          h("div", { key: "record-save-status" }, [
            this.setTx.isSuccess ? h("p.text-ok", "Record saved. Resolver caches may take time to update.") : null,
            txLine("Saved record: ", this.setTx), errLine(this.setTx)
          ]),
          h("div", { key: "record-delete-status" }, [
            this.delTx.isSuccess ? h("p.text-ok", "Record deleted.") : null,
            txLine("Deleted record: ", this.delTx), errLine(this.delTx)
          ])
        ])
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
            h("label.field", { for: "transfer-recipient" }, "Recipient Address"),
            h("input.input.input-mono", { id: "transfer-recipient", type: "text", value: this.recipient, placeholder: "0x... or epix1...", oninput: this.handleInput }),
            this.recipient && !normalized ? h("p.text-err.small", { style: "margin-top:4px" }, "Invalid address") : null,
            this.isSelf() ? h("p.text-warn.small", { style: "margin-top:4px" }, "Cannot transfer to yourself") : null
          ]),
          h("button.btn.btn-danger.btn-block", { type: "button", onclick: this.handleTransfer, disabled: tx.isBusy || !normalized || this.isSelf() },
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
        h("button.disclosure", { type: "button", onclick: this.handleToggle, "aria-expanded": this.expanded ? "true" : "false", classes: { "is-open": this.expanded } }, [h("span.disclosure-tri", "▶"), "Transfer Name"]),
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
      this.readSeq = 0;
      this.reads = {};
      this.resolveError = "";
      this.profileError = "";
      this.identitiesError = "";
      this.contentRootError = "";
      this.primaryTx = new TxState();
      this.profile = new ProfileSection(this);
      this.linked = new LinkedIdentitiesSection(this);
      this.dns = new DnsRecordsSection(this);
      this.transfer = new TransferSection(this);
      this.handleSetPrimary = this.handleSetPrimary.bind(this);
      this.handleRetry = this.handleRetry.bind(this);
    }

    beginRead(key) { this.reads[key] = ++this.readSeq; return this.readSeq; }
    isCurrent(key, token) { return this.reads[key] === token; }
    leave() { this.reads = {}; }
    handleRetry() { this.enter(this.tld, this.name, this.linkIdentityParam); return false; }

    enter(tld, name, linkParam) {
      this.reads = {};
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
      this.loadPrimary();
      this.dns.fetchRecords();
    }

    onWalletChanged() {
      this.primaryName = "";
      this.primaryTld = "";
      this.primaryTx.reset();
      this.profile.reset();
      this.linked.reset();
      this.dns.reset();
      this.transfer.reset();
      this.loadPrimary();
      this.dns.fetchRecords();
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
      var token = this.beginRead("owner");
      this.resolveError = "";
      this.resolveLoading = true;
      Page.render();
      XidContract.read("resolve", [this.name, this.tld]).then(function (owner) {
        if (!self.isCurrent("owner", token)) return;
        self.owner = String(owner);
        self.resolveLoading = false;
        self.linked.onOwnerChanged();
        Page.render();
      }).catch(function () {
        if (!self.isCurrent("owner", token)) return;
        self.owner = null;
        self.resolveError = "Could not load this name. Check your connection and try again.";
        self.resolveLoading = false;
        Page.render();
      });
    }

    loadProfile() {
      var self = this;
      var token = this.beginRead("profile");
      this.profileError = "";
      XidContract.read("getProfile", [this.name, this.tld]).then(function (r) {
        if (!self.isCurrent("profile", token)) return;
        self.avatar = String(r[0] || "");
        self.bio = String(r[1] || "");
        Page.render();
      }).catch(function () {
        if (!self.isCurrent("profile", token)) return;
        self.profileError = "Could not load the profile. Refresh this name to try again.";
        Page.render();
      });
    }

    loadIdentities() {
      var self = this;
      var token = this.beginRead("identities");
      this.identitiesError = "";
      this.identitiesLoading = true;
      XidContract.read("getLinkedIdentities", [this.name, this.tld]).then(function (r) {
        if (!self.isCurrent("identities", token)) return;
        self.identities = XidContract.peersFrom(r);
        self.identitiesLoading = false;
        self.linked.onOwnerChanged();
        Page.render();
      }).catch(function () {
        if (!self.isCurrent("identities", token)) return;
        self.identitiesError = "Could not load linked identities. Refresh this name to try again.";
        self.identitiesLoading = false;
        Page.render();
      });
      this.loadContentRoot();
    }

    loadContentRoot() {
      var self = this;
      var token = this.beginRead("root");
      this.contentRootError = "";
      XidContract.read("getContentRoot", [this.name, this.tld]).then(function (r) {
        if (!self.isCurrent("root", token)) return;
        self.contentRoot = String(r[0] || "");
        self.contentRootUpdatedAt = r[1] || 0n;
        Page.render();
      }).catch(function () {
        if (!self.isCurrent("root", token)) return;
        self.contentRootError = "Could not load the content root.";
        Page.render();
      });
    }

    loadPrimary() {
      var self = this;
      var token = this.beginRead("primary");
      if (!Wallet.address) { this.primaryName = ""; this.primaryTld = ""; Page.render(); return; }
      XidContract.read("getPrimaryName", [Wallet.address]).then(function (r) {
        if (!self.isCurrent("primary", token)) return;
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
      if (this.resolveError || this.owner === XidContract.ZERO) {
        return h("div.stack", { key: "name-unavailable" }, [
          h("a.back-link", { href: "?Search", onclick: Page.handleLinkClick }, "← Back to Search"),
          h("h1.break", this.name + "." + this.tld),
          this.resolveError
            ? h("div.card.stack-sm", [h("p.text-err", { role: "alert" }, this.resolveError), h("button.btn", { type: "button", onclick: this.handleRetry }, "Try again")])
            : h("div.card.stack-sm", [h("p.mid", "This name is not registered."), h("a.btn.btn-primary", { href: "?Register&name=" + encodeURIComponent(this.name + "." + this.tld), onclick: Page.handleLinkClick }, "Register this name")])
        ]);
      }
      var owner = this.isOwner(), primary = this.isPrimary(), tx = this.primaryTx;
      return h("div.stack.NameDetailPage", { key: "name-" + this.tld + "-" + this.name }, [
        h("div", [
          h("a.back-link", { href: owner ? "?MyNames" : "?Search", onclick: Page.handleLinkClick }, owner ? "← Back to My Names" : "← Back to Search"),
          h("div.row-between", [h("h1.break", { style: "font-size:24px" }, [this.name, h("span.dim", "." + this.tld)]), h("button.btn.btn-sm", { type: "button", onclick: this.handleRetry }, "Refresh")]),
          this.owner ? h("p.mid", { style: "margin-top:4px" }, [
            "Owner: ", h("span.mono", { style: "color:var(--epix-text)" }, Text.truncateAddress(this.owner)),
            owner ? h("span.pill.pill-accent", { style: "margin-left:8px" }, "You") : null,
            primary ? h("span.pill.pill-ok", { style: "margin-left:8px" }, "Primary Name") : null
          ]) : null,
          owner && !primary ? h("button.btn.btn-primary", { type: "button", onclick: this.handleSetPrimary, disabled: tx.isBusy, style: "margin-top:12px" },
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
