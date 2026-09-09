// BIP-173 bech32, hand-written so the xite carries no npm package. Only what
// the app needs: encode/decode, EVM <-> epix1 conversion, and validators.
(function () {
  var CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  var GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  var PREFIX = "epix";

  function polymod(values) {
    var chk = 1;
    for (var p = 0; p < values.length; p++) {
      var top = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ values[p];
      for (var i = 0; i < 5; i++) {
        if ((top >> i) & 1) chk ^= GEN[i];
      }
    }
    return chk;
  }

  function hrpExpand(hrp) {
    var r = [];
    for (var i = 0; i < hrp.length; i++) r.push(hrp.charCodeAt(i) >> 5);
    r.push(0);
    for (i = 0; i < hrp.length; i++) r.push(hrp.charCodeAt(i) & 31);
    return r;
  }

  function createChecksum(hrp, data) {
    var values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
    var mod = polymod(values) ^ 1;
    var ret = [];
    for (var p = 0; p < 6; p++) ret.push((mod >> (5 * (5 - p))) & 31);
    return ret;
  }

  function convertBits(data, from, to, pad) {
    var acc = 0, bits = 0, ret = [], maxv = (1 << to) - 1;
    for (var i = 0; i < data.length; i++) {
      var v = data[i];
      if (v < 0 || (v >> from) !== 0) return null;
      acc = (acc << from) | v;
      bits += from;
      while (bits >= to) {
        bits -= to;
        ret.push((acc >> bits) & maxv);
      }
    }
    if (pad) {
      if (bits > 0) ret.push((acc << (to - bits)) & maxv);
    } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
      return null;
    }
    return ret;
  }

  function encode(hrp, bytes) {
    var words = convertBits(Array.from(bytes), 8, 5, true);
    var combined = words.concat(createChecksum(hrp, words));
    var out = hrp + "1";
    for (var i = 0; i < combined.length; i++) out += CHARSET.charAt(combined[i]);
    return out;
  }

  // Lowercase only (an address is never shown mixed-case here); null when
  // the string is not valid bech32.
  function decode(str) {
    if (typeof str !== "string" || str.length > 90 || str !== str.toLowerCase()) return null;
    var pos = str.lastIndexOf("1");
    if (pos < 1 || pos + 7 > str.length) return null;
    var hrp = str.slice(0, pos);
    var data = [];
    for (var i = pos + 1; i < str.length; i++) {
      var d = CHARSET.indexOf(str.charAt(i));
      if (d === -1) return null;
      data.push(d);
    }
    if (polymod(hrpExpand(hrp).concat(data)) !== 1) return null;
    var bytes = convertBits(data.slice(0, -6), 5, 8, false);
    if (!bytes) return null;
    return { hrp: hrp, bytes: bytes };
  }

  window.Bech32 = {
    PREFIX: PREFIX,
    encode: encode,
    decode: decode,

    evmToBech32: function (evm) {
      var hex = String(evm || "").replace(/^0x/i, "");
      var bytes = [];
      for (var i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
      return encode(PREFIX, bytes);
    },

    bech32ToEvm: function (str) {
      var d = decode(str);
      if (!d) return null;
      return "0x" + d.bytes.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    },

    // Strict: prefix `epix`, a 20-byte payload, a valid checksum.
    isBech32Address: function (str) {
      var d = decode(String(str || "").trim());
      return !!d && d.hrp === PREFIX && d.bytes.length === 20;
    },

    // The loose gate the search page's lookup buttons used.
    looksLikeBech32: function (str) {
      str = String(str || "").trim();
      return str.indexOf("epix1") === 0 && str.length > 10;
    },

    // Accept either 0x... (checksum-validated) or epix1... and return an
    // EVM address, or null.
    normalizeToEvmAddress: function (str) {
      var t = String(str || "").trim();
      if (typeof ethers !== "undefined" && ethers.isAddress(t)) return t;
      if (window.Bech32.isBech32Address(t)) return window.Bech32.bech32ToEvm(t);
      return null;
    }
  };
})();
