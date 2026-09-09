// Text helpers: the query-string router format every xite uses
// (`?Page/arg&key=value`), address truncation, and the returnTo guard.
(function () {
  window.Text = {
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
      return /^\/[^\/\\]/.test(v || "") ? v : "";
    },

    plural: function (n, word) {
      return n + " " + word + (n === 1 ? "" : "s");
    }
  };
})();
