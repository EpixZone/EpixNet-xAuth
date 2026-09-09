// One write's lifecycle, the way each page shows it: idle -> simulating ->
// pending (wallet prompt) -> confirming (in flight) -> success | error. One
// instance per button that sends a transaction.
(function () {
  class TxState {
    constructor() {
      this.reset();
    }

    reset() {
      this.status = "idle";
      this.hash = null;
      this.cosmosHash = null;
      this.error = null;
    }

    // Where "View transaction" goes: the Epix Explorer xite once the wrapping
    // Cosmos hash is known, the EVM explorer (scan) until then.
    get explorerUrl() {
      if (this.cosmosHash) return Chain.explorerTxUrl(this.cosmosHash);
      return this.hash ? Chain.evmTxUrl(this.hash) : "";
    }

    // Map the receipt's EVM hash to its Cosmos transaction. The tx index can
    // lag the receipt by a moment, so try a few times; a miss leaves the EVM
    // explorer link in place.
    resolveCosmosHash(hash) {
      var self = this;
      var attempt = 0;
      var tryOnce = function () {
        if (self.hash !== hash) return;
        Rest.cosmosTxHash(hash).then(function (cosmos) {
          if (self.hash !== hash) return;
          if (cosmos) {
            self.cosmosHash = cosmos;
            Page.render();
          } else if (++attempt < 4) {
            setTimeout(tryOnce, 1500);
          }
        }).catch(function () {
          if (++attempt < 4) setTimeout(tryOnce, 1500);
        });
      };
      tryOnce();
    }

    get isPending() { return this.status === "simulating" || this.status === "pending"; }
    get isConfirming() { return this.status === "confirming"; }
    get isSuccess() { return this.status === "success"; }
    get isBusy() { return this.isPending || this.isConfirming; }
    get errorText() { return this.error ? TxErrors.extract(this.error) : null; }

    // Run `fn(args)` on the contract; `onSuccess` fires after the receipt.
    run(fn, args, onSuccess) {
      var self = this;
      this.reset();
      this.status = "simulating";
      Page.render();
      return XidContract.write(fn, args, function (status, hash) {
        self.status = status;
        if (hash) self.hash = hash;
        Page.render();
      }).then(function (receipt) {
        if (self.hash) self.resolveCosmosHash(self.hash);
        if (onSuccess) onSuccess(receipt);
        Page.render();
        return receipt;
      }).catch(function (err) {
        self.status = "error";
        self.error = err;
        Page.render();
        return null;
      });
    }
  }

  window.TxState = TxState;
})();
