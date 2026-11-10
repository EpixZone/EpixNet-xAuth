// Human-readable reasons out of ethers v6 errors, in the same priority the
// old viem-based extractor used: a decoded revert reason, a custom error
// name, "execution reverted: ..." embedded in any message of the cause
// chain, raw Error(string) data, then the short message, then the first line.
(function () {
  var PATTERNS = [
    /execution reverted:\s*(.+?)(?:\n|$)/i,
    /reverted with the following reason:\s*\n*(.+?)(?:\n|$)/i
  ];

  function plain(v) {
    return typeof v === "bigint" ? v.toString() : v;
  }

  function epix(value) {
    var amount = BigInt(value), scale = 1000000000000000000n;
    var fraction = (amount % scale).toString().padStart(18, "0").replace(/0+$/, "");
    var decimal = new Intl.NumberFormat().formatToParts(1.1).find(function (part) { return part.type === "decimal"; }).value;
    return (amount / scale).toLocaleString() + (fraction ? decimal + fraction : "");
  }

  // Every object reachable through .cause / .error / .info.error, breadth-first.
  function chain(err) {
    var out = [], seen = [], queue = [err];
    while (queue.length && out.length < 12) {
      var cur = queue.shift();
      if (!cur || typeof cur !== "object" || seen.indexOf(cur) !== -1) continue;
      seen.push(cur);
      out.push(cur);
      if (cur.cause) queue.push(cur.cause);
      if (cur.error) queue.push(cur.error);
      if (cur.info && cur.info.error) queue.push(cur.info.error);
      if (cur.info && cur.info.payload && cur.info.payload.error) queue.push(cur.info.payload.error);
    }
    return out;
  }

  window.TxErrors = {
    // Keep extract() as the original technical detail for troubleshooting.
    friendly: function (err) {
      var objects = chain(err), detail = this.extract(err);
      if (objects.some(function (e) { return e.code === "ACTION_REJECTED" || e.code === 4001; })) {
        return "You cancelled the wallet request. Nothing was submitted.";
      }
      var changed = objects.find(function (e) { return e.code === "REGISTRATION_FEE_CHANGED"; });
      if (changed) return "The registration price changed. Review the updated fee before confirming.";
      var low = objects.find(function (e) { return e.code === "REGISTRATION_BALANCE_LOW"; });
      if (low && typeof low.balance === "bigint" && typeof low.registrationFee === "bigint" && typeof low.required === "bigint") {
        if (low.networkFee === null) return "Your wallet has " + epix(low.balance) + " EPIX on Epix. This name costs " + epix(low.registrationFee) + " EPIX to register, plus a network transaction fee.";
        return "This registration needs an estimated " + epix(low.required) + " EPIX including the network fee. Your wallet has " + epix(low.balance) + " EPIX on Epix.";
      }
      var spendable = detail.match(/spendable balance\s+(\d+)aepix\s+is smaller than\s+(\d+)aepix/i);
      if (spendable && /registration fee/i.test(detail)) {
        return "Your spendable balance on Epix is " + epix(spendable[1]) + " EPIX. This name costs " + epix(spendable[2]) + " EPIX to register, plus a network transaction fee.";
      }
      if (/insufficient registration fee|failed to charge registration fee/i.test(detail)) {
        return "There is not enough spendable EPIX on Epix to pay the registration fee. Add EPIX to this wallet, then check the cost again.";
      }
      if (objects.some(function (e) { return e.code === "INSUFFICIENT_FUNDS"; }) || /insufficient funds|funds for gas/i.test(detail)) {
        return "There is not enough EPIX on Epix to cover the transaction. Check the required amount and add EPIX to this wallet.";
      }
      if (/aepix\b/i.test(detail)) return "The transaction could not be completed. Check the cost and your EPIX balance, or open the technical details.";
      return detail;
    },

    decodeErrorString: function (hex) {
      try {
        var decoded = ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + hex.slice(10));
        return decoded[0] || null;
      } catch (e) {
        return null;
      }
    },

    extract: function (err) {
      if (!err || typeof err !== "object") return "Transaction failed";
      if (err.code === "ACTION_REJECTED") return "User rejected the request.";
      var objects = chain(err);
      var i, c;
      for (i = 0; i < objects.length; i++) {
        c = objects[i];
        if (typeof c.reason === "string" && c.reason && c.reason !== "rejected" &&
            c.reason.indexOf("exceeds block gas limit") === -1 &&
            c.reason.indexOf("failed to broadcast") === -1) {
          return c.reason;
        }
        if (c.revert && typeof c.revert.name === "string" && c.revert.name !== "Error") {
          var args = c.revert.args ? ": " + JSON.stringify(Array.from(c.revert.args, plain)) : "";
          return c.revert.name + args;
        }
        if (c.data && typeof c.data === "object" && typeof c.data.errorName === "string") {
          return c.data.errorName + (c.data.args ? ": " + JSON.stringify(c.data.args) : "");
        }
      }
      for (i = 0; i < objects.length; i++) {
        c = objects[i];
        var fields = ["message", "details", "shortMessage"];
        for (var f = 0; f < fields.length; f++) {
          var val = c[fields[f]];
          if (typeof val !== "string") continue;
          for (var p = 0; p < PATTERNS.length; p++) {
            var m = val.match(PATTERNS[p]);
            if (m && m[1] && m[1].trim()) return m[1].trim();
          }
        }
        if (typeof c.data === "string" && c.data.indexOf("0x08c379a0") === 0) {
          var decoded = this.decodeErrorString(c.data);
          if (decoded) return decoded;
        }
      }
      if (typeof err.shortMessage === "string" && err.shortMessage) return err.shortMessage;
      if (typeof err.message === "string" && err.message) return err.message.split("\n")[0];
      return "Transaction failed";
    }
  };
})();
