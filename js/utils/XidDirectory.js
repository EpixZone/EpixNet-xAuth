// Local user manifests carry the publication time of each xID's data.
// No chain transaction history or xite database schema is needed.
(function () {
  window.XidDirectory = {
    latest: async function (limit) {
      if (!Page.isEmbedded) throw new Error("Open this xite in EpixNet to see recent xIDs.");
      limit = Math.min(5, Math.max(1, Math.floor(Number(limit) || 5)));
      // Wrapper requests can remain unresolved if the websocket disconnects
      // mid-query. Release the loading state so retry/reconnect can recover.
      var timer, rows;
      try {
        rows = await Promise.race([
          Page.cmd("fileQuery", { dir_inner_path: "data/users/*/content.json", query: "" }),
          new Promise(function (_, reject) {
            timer = setTimeout(function () { reject(new Error("The xID data directory did not respond. Please try again.")); }, 15000);
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (!Array.isArray(rows)) throw new Error("Could not read the xID data directory.");

      var names = new Map();
      rows.forEach(function (row) {
        if (!row || typeof row.inner_path !== "string") return;
        // fileQuery returns the matched directory as inner_path, not the
        // manifest's own inner_path field. Ignore unrelated folders/files.
        var match = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.([a-z]{2,16})$/.exec(row.inner_path);
        if (!match || match[1].length > 64 || !Number.isFinite(row.modified) || row.modified <= 0) return;
        if (!row.files || typeof row.files !== "object" || Array.isArray(row.files) ||
            !Object.keys(row.files).some(function (file) { return /^data(?:-[0-9a-z]+)?\.json$/.test(file); })) return;
        var date = new Date(row.modified * 1000);
        if (!Number.isFinite(date.getTime())) return;
        var previous = names.get(row.inner_path);
        if (!previous || row.modified > previous.modified) {
          names.set(row.inner_path, { name: match[1], tld: match[2], modified: row.modified, timestamp: date.toISOString() });
        }
      });
      return Array.from(names.values()).sort(function (a, b) {
        return b.modified - a.modified || (a.name + "." + a.tld).localeCompare(b.name + "." + b.tld);
      }).slice(0, limit).map(function (entry) {
        return { name: entry.name, tld: entry.tld, timestamp: entry.timestamp };
      });
    }
  };
})();
