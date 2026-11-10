// Shared registration presentation. Quotes and balances come from the chain;
// both entry points keep their existing navigation and transaction lifecycle.
(function () {
  class RegistrationCard {
    constructor(cost) {
      this.cost = cost;
      this.fundingOpen = false;
      this.copyStatus = "";
      this.toggleFunding = this.toggleFunding.bind(this);
      this.copyAddress = this.copyAddress.bind(this);
    }

    toggleFunding() {
      this.fundingOpen = !this.fundingOpen;
      Page.render();
      return false;
    }

    async copyAddress() {
      var address = Wallet.bech32;
      if (!address || !navigator.clipboard) return;
      try {
        await navigator.clipboard.writeText(address);
        if (address !== Wallet.bech32) return;
        this.copyStatus = "Epix address copied.";
      } catch (e) {
        if (address !== Wallet.bech32) return;
        this.copyStatus = "Could not copy. Select the address above to copy it.";
      }
      Page.render();
    }

    static error(tx) {
      if (!tx.errorText) return null;
      return h("div.registration-error.msg.msg-err.stack-sm", { key: "transaction-error", role: "alert" }, [
        h("p", tx.friendlyErrorText || tx.errorText),
        tx.errorDetails ? h("details", [
          h("summary", "Technical details"),
          h("pre.registration-technical", tx.errorDetails)
        ]) : null
      ]);
    }

    renderFunding(id) {
      if (!this.fundingOpen) return null;
      return h("div.registration-funding.stack-sm", { id: id + "-funding", key: "funding" }, [
        h("h3", "Get EPIX"),
        h("p.small.mid", [
          "Buy on ",
          h("a.text-link", { href: "https://app.osmosis.zone/", target: "_blank", rel: "noopener noreferrer" }, "Osmosis DEX"),
          " or find exchanges on ",
          h("a.text-link", { href: "https://www.coingecko.com/en/coins/epix#markets", target: "_blank", rel: "noopener noreferrer" }, "CoinGecko"),
          "."
        ]),
        h("p.small.mid", "Send EPIX to your wallet on the Epix network."),
        Wallet.bech32 ? h("div.stack-sm", [
          h("span.small.mid", "Your Epix address"),
          h("code.small.break", Wallet.bech32),
          h("button.btn.btn-secondary", { type: "button", onclick: this.copyAddress }, "Copy Epix address"),
          h("p.small", { role: "status" }, this.copyStatus)
        ]) : h("p.small.mid", "Connect to see your receive address."),
        h("a.text-link.small", { href: "https://github.com/EpixZone/.github/blob/main/SUPPORT.md", target: "_blank", rel: "noopener noreferrer" }, "Community help")
      ]);
    }

    notice(options) {
      var cost = this.cost;
      if (!Wallet.isConnected()) return ["Connect to check your balance", "Connecting is free and sends no transaction. Your wallet asks for separate approval before registration."];
      if (Wallet.chainOk === false) return ["Switch your wallet to Epix", "EPIX needs to be on the Epix network. Your wallet can add Epix if it is missing."];
      if (options.resolving) return ["Checking the current price", "The registration fee is being fetched from the chain for this name."];
      if (!options.available || options.fee === null) return null;
      if (cost.balanceLoading) return ["Checking your balance", "Registration and network fees are paid in EPIX on Epix."];
      if (cost.balanceError) return ["Balance unavailable", "Check your balance again before registering. A failed balance check does not mean your balance is zero."];
      if (cost.insufficient) {
        var required = cost.total === null ? "Add enough for registration and the network fee." : "You need about " + Format.epix(cost.total - cost.balance) + " EPIX more, including the estimated network fee.";
        return ["Add EPIX to continue", "This name costs " + Format.epix(options.fee) + " EPIX. Your balance is " + Format.epix(cost.balance) + " EPIX. " + required];
      }
      if (cost.loading) return ["Estimating the network fee", "The registration fee is separate from the cost of processing the transaction."];
      if (cost.networkFee === null) return ["Network fee estimate unavailable", "Review the network fee in your wallet before approving. The registration fee is charged separately."];
      return null;
    }

    render(options) {
      var cost = this.cost, tx = options.tx, id = options.id;
      var connected = Wallet.isConnected(), rightChain = Wallet.chainOk !== false;
      var fee = options.fee === null ? (options.resolving ? "Checking..." : options.input && !options.invalid ? "Unavailable" : "Enter a valid name") : Format.epix(options.fee) + " EPIX";
      var network = !connected ? "Check after connecting" : !rightChain ? "Switch to Epix" : cost.loading ? "Estimating..." : cost.networkFee === null ? "Estimate unavailable" : "≈ " + Format.epix(cost.networkFee) + " EPIX";
      var balance = !connected ? "Connect to check" : !rightChain ? "Switch to check" : cost.balanceLoading ? "Checking..." : cost.balance === null ? "Unavailable" : Format.epix(cost.balance) + " EPIX";
      var notice = this.notice(options);
      var nameState = options.success ? "registered" : options.invalid ? "invalid" : options.resolving ? "checking" : options.available ? "available" : options.taken ? "taken" : "neutral";
      var label = tx.status === "simulating" ? "Checking transaction..." : tx.isPending ? "Confirm in your wallet..." : tx.isConfirming ? "Waiting for confirmation..." : "Register " + (options.name ? options.name + "." + options.tld : "name");
      return h("div.registration-card." + (options.embedded ? "subcard" : "card"), { key: id + "-card" }, [
        options.embedded ? h("h3.registration-intro", "Register a new name") : null,
        h("div.registration-grid", [
          h("section.registration-name.stack-sm", { "aria-label": "Choose a name" }, [
            h("label.field.field-lg", { for: id }, ".epix name"),
            h("input.input", {
              id: id, type: "text", value: options.input, placeholder: "yourname.epix", oninput: options.onInput,
              onkeydown: options.onKeyDown, autocomplete: "off", spellcheck: false, disabled: tx.isBusy,
              "data-name-state": nameState,
              "aria-describedby": id + "-help " + id + "-rules " + id + "-status",
              "aria-invalid": nameState === "invalid" || nameState === "taken" ? "true" : "false"
            }),
            h("p.small.mid", { id: id + "-help" }, "Your public display name"),
            h("p.small.dim", { id: id + "-rules" }, "1–64 letters, numbers, or internal hyphens. Full .epix names are accepted."),
            h("div.registration-status.stack-sm", { id: id + "-status", "aria-live": "polite", "aria-busy": options.resolving ? "true" : "false" }, [options.status]),
            h("p.small.mid", "One registration, no renewals."),
            h("details.registration-purpose", [
              h("summary", "What can I use this name for?"),
              h("p.small.mid", "Your wallet owns the name. Add a profile, link your EpixNet login identities, or point it to a published xite. You can also manage records, choose a primary name, and transfer ownership.")
            ]),
            options.linking ? h("p.small.mid", [h("strong", "Next: link your login identity. "), "Registration and linking are separate transactions. Each has a network fee."]) : null
          ]),
          h("section.registration-cost.stack-sm", { "aria-label": "Cost and wallet", "aria-live": "polite" }, [
            h("h2", "Cost and wallet"),
            h("dl.registration-fees", [
              h("div", [h("dt", "One-time registration"), h("dd.registration-fee", { "data-name": options.name || "" }, fee)]),
              h("div", [h("dt", "Network fee"), h("dd", network)]),
              cost.total !== null ? h("div", { key: "total" }, [h("dt", "Estimated total"), h("dd", "≈ " + Format.epix(cost.total) + " EPIX")]) : null,
              h("div", { key: "balance" }, [h("dt", "Balance on Epix"), h("dd", balance)])
            ]),
            notice ? h("div.registration-notice.msg.msg-warn.stack-sm", { key: "notice" }, [h("strong", notice[0]), h("p.small", notice[1])]) : null,
            !connected ? h("button.btn.btn-primary.btn-block", { key: "connect", type: "button", onclick: Wallet.handleConnectClick, disabled: Wallet.connecting }, Wallet.connecting ? "Connecting..." : "Connect wallet") : !rightChain ? h("button.btn.btn-primary.btn-block", { key: "switch", type: "button", onclick: Wallet.handleSwitchClick }, "Switch wallet to Epix") : !options.success ? h("button.btn.btn-primary.btn-block", { key: "register", type: "button", onclick: options.onRegister, disabled: !options.canRegister }, label) : null,
            Wallet.connectError ? h("p.text-err.small", { key: "connect-error", role: "alert" }, Wallet.connectError) : null,
            h("div.registration-actions.row-gap", [
              h("button.btn", { type: "button", classes: { "btn-primary": cost.insufficient, "btn-secondary": !cost.insufficient }, onclick: this.toggleFunding, "aria-expanded": this.fundingOpen ? "true" : "false", "aria-controls": id + "-funding" }, this.fundingOpen ? "Close funding help" : "How to get EPIX"),
              connected ? h("button.btn.btn-ghost", { key: "refresh", type: "button", onclick: options.onRefresh, disabled: tx.isBusy || options.resolving || cost.loading || cost.balanceLoading }, "Check balance and price") : null
            ]),
            this.renderFunding(id),
            RegistrationCard.error(tx),
            tx.hash && !options.success ? h("a.text-link.small", { key: "receipt", href: tx.explorerUrl, target: "_blank", rel: "noopener noreferrer" }, "View transaction") : null,
            options.tiers || h("a.text-link.small", { key: "prices", href: "?Prices", onclick: Page.handleLinkClick }, "How registration pricing works"),
            h("details.registration-help", [
              h("summary", "Wallet and fee details"),
              h("div.stack-sm", [
                h("p.small.mid", "The registration fee is fetched from the chain as the name changes and checked again before approval. It is burned and charged directly to your account. Network fees vary."),
                Wallet.renderHelp()
              ])
            ])
          ])
        ])
      ]);
    }
  }
  window.RegistrationCard = RegistrationCard;
})();
