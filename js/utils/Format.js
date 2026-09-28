// Token and count formatting without converting chain integers to Number.
(function () {
  var EPIX_SCALE = 1000000000000000000n;

  function integer(value) {
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Unsafe integer");
    if (!/^-?\d+$/.test(String(value))) throw new Error("Invalid integer");
    return BigInt(value);
  }

  function epix(value, locale, fractionDigits) {
    var amount = integer(value);
    var negative = amount < 0n;
    if (negative) amount = -amount;
    if (fractionDigits !== undefined) {
      if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 18) throw new Error("Invalid precision");
      var step = 10n ** BigInt(18 - fractionDigits);
      amount = (amount + step / 2n) / step * step;
    }
    var whole = (amount / EPIX_SCALE).toLocaleString(locale);
    var fraction = (amount % EPIX_SCALE).toString().padStart(18, "0").replace(/0+$/, "");
    var decimal = new Intl.NumberFormat(locale).formatToParts(1.1).filter(function (p) { return p.type === "decimal"; })[0].value;
    return (negative ? "-" : "") + whole + (fraction ? decimal + fraction : "");
  }

  window.Format = {
    // A bigint fee as the old viem formatEther string ("100", not "100.0").
    ether: function (bi) {
      if (bi === undefined || bi === null) return "0";
      return ethers.formatEther(bi).replace(/\.0$/, "");
    },

    // aepix string -> localized EPIX; the input on failure (Prices page).
    epix: function (s, locale, fractionDigits) {
      try { return epix(s, locale, fractionDigits); } catch (e) { return String(s); }
    },

    // Invalid data is unavailable, never a fabricated zero balance.
    burned: function (s, locale, fractionDigits) {
      try { return epix(s, locale, fractionDigits); } catch (e) { return "Unavailable"; }
    },

    integer: function (value, locale) {
      return integer(value).toLocaleString(locale);
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
