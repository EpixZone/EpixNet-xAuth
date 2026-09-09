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
