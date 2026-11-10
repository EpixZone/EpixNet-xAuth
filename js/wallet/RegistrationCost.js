// A quote belongs to one name and wallet context. Unknown amounts stay unknown.
(function () {
  class RegistrationCost {
    constructor() { this.generation = 0; this.clear(); }

    clear() {
      ++this.generation;
      this.name = this.tld = "";
      this.fee = null;
      this.resetEstimate();
      this.estimateStatus = "no_quote";
    }

    resetEstimate() {
      this.context = null;
      this.balanceValue = this.networkFeeValue = null;
      this.balanceLoadingValue = this.loading = false;
      this.balanceErrorValue = this.estimateError = null;
    }

    current(context) {
      return !!context && context.address === Wallet.address && context.raw === Wallet.raw &&
        context.revision === Wallet.revision && context.chainOk === Wallet.chainOk;
    }

    get balance() {
      if (this.fee === null) return typeof Wallet.balanceRaw === "bigint" ? Wallet.balanceRaw : null;
      return this.current(this.context) ? this.balanceValue : null;
    }
    get balanceLoading() { return this.fee === null ? !!Wallet.balanceLoading : this.balanceLoadingValue; }
    get balanceError() { return this.fee === null ? Wallet.balanceError || null : this.balanceErrorValue; }
    get networkFee() { return this.current(this.context) ? this.networkFeeValue : null; }
    get total() { return this.fee !== null && this.networkFee !== null ? this.fee + this.networkFee : null; }
    get insufficient() {
      return this.balance !== null && this.fee !== null && this.balance < (this.total === null ? this.fee : this.total);
    }

    setQuote(name, tld, fee) {
      this.clear();
      if (typeof fee !== "bigint" || fee < 0n || !name || !tld) return Promise.resolve();
      this.name = name;
      this.tld = tld;
      this.fee = fee;
      return this.refresh();
    }

    onWalletChanged() { return this.refresh(); }

    async refresh() {
      var generation = ++this.generation;
      this.resetEstimate();
      if (this.fee === null) { this.estimateStatus = "no_quote"; return; }
      if (!Wallet.address) { this.estimateStatus = "wallet_required"; return; }
      if (Wallet.chainOk === false) { this.estimateStatus = "wrong_network"; return; }
      var context = this.context = {
        address: Wallet.address, raw: Wallet.raw, revision: Wallet.revision, chainOk: Wallet.chainOk
      };
      var valid = () => generation === this.generation && this.current(context);
      this.loading = this.balanceLoadingValue = true;
      this.estimateStatus = "loading";
      Page.render();
      var balance = null;
      try { balance = await Wallet.loadBalance(); } catch (error) { /* Keep the balance unavailable. */ }
      if (!valid()) return;
      if (typeof balance !== "bigint" || balance < 0n) balance = null;
      this.balanceValue = balance;
      this.balanceLoadingValue = false;
      this.balanceErrorValue = Wallet.balanceError || (balance === null ? "Could not check your EPIX balance. Try again." : null);
      if (balance !== null && balance < this.fee) {
        this.loading = false;
        this.estimateStatus = "insufficient";
        Page.render();
        return;
      }
      try {
        var networkFee = await XidContract.estimateNetworkFee("register", [this.name, this.tld], context.address);
        if (!valid()) return;
        this.networkFeeValue = networkFee;
        this.estimateStatus = this.insufficient ? "insufficient" : "ready";
      } catch (error) {
        if (!valid()) return;
        this.estimateStatus = "unavailable";
        this.estimateError = error;
      }
      if (!valid()) return;
      this.loading = false;
      Page.render();
    }
  }
  window.RegistrationCost = RegistrationCost;
})();
