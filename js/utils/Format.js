// Number formatting that prints exactly what the old app printed.
(function () {
  window.Format = {
    // A bigint fee as the old viem formatEther string ("100", not "100.0").
    ether: function (bi) {
      if (bi === undefined || bi === null) return "0";
      return ethers.formatEther(bi).replace(/\.0$/, "");
    },

    // aepix string -> localized EPIX; the input on failure (Prices page).
    epix: function (s) {
      try { return Number(ethers.formatEther(BigInt(s))).toLocaleString(); } catch (e) { return s; }
    },

    // aepix string -> localized EPIX; "0" on failure (Stats page).
    burned: function (s) {
      try { return Number(ethers.formatEther(BigInt(s))).toLocaleString(); } catch (e) { return "0"; }
    },

    // Price tier rows: "1 character", "2-3 characters", "6+ characters".
    tierLabel: function (tier, i, tiers) {
      var prev = i > 0 ? tiers[i - 1].max_length : 0;
      var min = prev + 1, max = tier.max_length;
      if (max >= 4294967295 || max >= 1000) return min + "+ characters";
      if (min === max) return min + " character" + (min !== 1 ? "s" : "");
      return min + "–" + max + " characters";
    },

    isCurrentTier: function (len, i, tiers) {
      return len > 0 && len <= tiers[i].max_length && (i === 0 || len > tiers[i - 1].max_length);
    },

    // A block number (bigint or string) with thousands separators.
    block: function (v) {
      try { return BigInt(v).toLocaleString(); } catch (e) { return String(v); }
    }
  };
})();
