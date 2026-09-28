// Text helpers: the query-string router format every xite uses
// (`?Page/arg&key=value`), address truncation, and the returnTo guard.
(function () {
  window.Text = {
    // A pasted full .epix name and a bare label refer to the same name.
    // Do not truncate: a shortened name could register a different identity.
    normalizeName: function (value) {
      var name = String(value || "").trim().toLowerCase();
      var tld = (window.Chain && Chain.DEFAULT_TLD) || "epix";
      var suffix = "." + tld;
      return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
    },

    nameInput: function (value) {
      var name = this.normalizeName(value);
      var tld = (window.Chain && Chain.DEFAULT_TLD) || "epix";
      var error = "";
      if (!name) error = "Enter a name.";
      else if (name.length > 64) error = "Names can contain up to 64 characters.";
      else if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
        error = "Use letters, numbers, and hyphens. A name cannot start or end with a hyphen.";
      }
      return { name: name, tld: tld, valid: !error, error: error };
    },

    // "?Name/epix/foo&linkIdentity=epix1..." -> {url, urls, linkIdentity}
    queryParse: function (query) {
      var params = {};
      var parts = (query || "").split("&");
      for (var j = 0; j < parts.length; j++) {
        var part = parts[j];
        if (!part) continue;
        var ref = part.split("=");
        var key = ref[0], val = ref.slice(1).join("=");
        if (val) {
          params[decodeURIComponent(key)] = decodeURIComponent(val);
        } else {
          params.url = decodeURIComponent(key);
          params.urls = params.url.split("/");
        }
      }
      return params;
    },

    queryEncode: function (params) {
      var back = [];
      if (params.url) back.push(params.url);
      for (var key in params) {
        var val = params[key];
        if (!val || key === "url" || key === "urls") continue;
        back.push(encodeURIComponent(key) + "=" + encodeURIComponent(val));
      }
      return back.join("&");
    },

    // "0x" + 6 chars ... 6 chars, the shape the old app printed.
    truncateAddress: function (addr, chars) {
      if (!addr) return "";
      chars = chars || 6;
      return addr.slice(0, chars + 2) + "..." + addr.slice(-chars);
    },

    // Only a same-origin path (`/epix1...`, `/Config`) may be navigated to
    // after linking; a full URL in `returnTo` is ignored.
    safeReturnTo: function (v) {
      if (typeof v !== "string" || !/^\/(?!\/)/.test(v) || /[\u0000-\u001f\u007f\\]/.test(v)) return "";
      // Browsers remove tabs/newlines and treat backslashes as slashes when
      // navigating. Validate the parsed destination as well as its spelling.
      try {
        var base = "https://xid-return.invalid";
        return new URL(v, base).origin === base ? v : "";
      } catch (e) {
        return "";
      }
    },

    plural: function (n, word) {
      return n + " " + word + (n === 1 ? "" : "s");
    }
  };
})();
