// xID: decentralized identity and naming for EpixChain, as a plain xite.
//
// One page, query-string routes: `?` Register, `?Search`, `?MyNames`,
// `?Name/<tld>/<name>`, `?Prices`, `?Stats`, `?LinkIdentity`. When the real
// query string carries `linkIdentity` (the node sends users here to link an
// identity address to their xID name), the link wizard renders alone.
(function () {
  var EpixFrame = window.EpixFrame;
  window.h = maquette.h;

  class XidApp extends EpixFrame {
    init() {
      this.site_info = null;
      this.server_info = null;
      this.params = {};
      this.history_state = {};
      this.chrome = true;
      this.link_mode = false;
      this.peer_address = "";
      this.return_to = "";
      this.projector = maquette.createProjector();
      this.handleLinkClick = this.handleLinkClick.bind(this);
      this.renderShell = this.renderShell.bind(this);
      this.returnFalse = function () { return false; };

      var real = new URLSearchParams(window.location.search);
      var linked = real.get("linkIdentity") || real.get("address") || "";
      var routed = Text.queryParse(window.location.search.replace(/^\?/, ""));
      var on_name_page = routed.urls && routed.urls[0] === "Name";
      this.link_mode = !!linked && !on_name_page;
      this.peer_address = linked;
      this.return_to = Text.safeReturnTo(real.get("returnTo") || "");

      this.layout = new Layout();
      this.pages = {
        register: new RegisterPage(),
        search: new SearchPage(),
        my_names: new MyNamesPage(),
        name_detail: new NameDetailPage(),
        prices: new PricesPage(),
        stats: new StatsPage(),
        add_peer: new AddPeerPage()
      };
      this.content = this.pages.register;
      this.boot();
    }

    // The node's chain endpoints and this xite's identity come from the
    // wrapper; a page opened outside it falls back to the defaults after a
    // short wait.
    boot() {
      var self = this;
      var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 2000); });
      var server = this.wrapper_nonce ? this.cmd("serverInfo") : Promise.resolve(null);
      var site = this.wrapper_nonce ? this.cmd("siteInfo") : Promise.resolve(null);
      var state = this.wrapper_nonce ? this.cmd("wrapperGetState") : Promise.resolve(null);
      Promise.race([Promise.all([server, site, state]), timeout]).then(function (results) {
        var server_info = results ? results[0] : null;
        self.server_info = server_info;
        self.site_info = results ? results[1] : null;
        self.history_state = (results && results[2]) || {};
        if (server_info) Chain.init(server_info); else Chain.initDefaults();
        Wallet.init();
        self.route(window.location.search.replace(/^\?/, ""));
        self.projector.replace($("#App"), self.renderShell);
        var overlay = $("#loading-overlay");
        if (overlay) {
          overlay.classList.add("fade-out");
          setTimeout(function () { overlay.style.display = "none"; }, 250);
        }
      });
    }

    get isEmbedded() {
      return !!this.wrapper_nonce;
    }

    get auth_address() {
      return (this.site_info && this.site_info.auth_address) || null;
    }

    render() {
      this.projector.scheduleRender();
    }

    renderShell() {
      return this.layout.render(this.content.render());
    }

    nameUrl(tld, name) {
      return "?Name/" + encodeURIComponent(tld) + "/" + encodeURIComponent(name);
    }

    route(query) {
      this.params = Text.queryParse(query || "");
      var urls = this.params.urls || [""];
      this.chrome = !this.link_mode;
      if (this.link_mode) {
        this.content = this.pages.add_peer;
        this.pages.add_peer.enter(this.peer_address, this.return_to);
      } else {
        switch (urls[0]) {
          case "Search": this.content = this.pages.search; break;
          case "MyNames": this.content = this.pages.my_names; this.pages.my_names.enter(); break;
          case "Name":
            this.content = this.pages.name_detail;
            this.pages.name_detail.enter(
              decodeURIComponent(urls[1] || Chain.DEFAULT_TLD),
              decodeURIComponent(urls[2] || ""),
              this.params.linkIdentity || null
            );
            break;
          case "Prices": this.content = this.pages.prices; this.pages.prices.enter(); break;
          case "Stats": this.content = this.pages.stats; this.pages.stats.enter(); break;
          case "LinkIdentity":
            this.content = this.pages.add_peer;
            this.pages.add_peer.enter(this.peer_address, this.return_to);
            break;
          default: this.content = this.pages.register; break;
        }
      }
      this.render();
    }

    setUrl(url, mode) {
      if (mode == null) mode = "push";
      url = url.replace(/.*?\?/, "");
      if (this.history_state.url === url) return false;
      this.history_state.url = url;
      this.history_state.scrollTop = 0;
      if (this.isEmbedded) {
        var cmd = mode === "replace" ? "wrapperReplaceState" : "wrapperPushState";
        this.cmd(cmd, [this.history_state, "", url]);
      } else {
        history[mode === "replace" ? "replaceState" : "pushState"](this.history_state, "", "?" + url);
      }
      this.route(url);
      window.scrollTo(0, 0);
      return false;
    }

    navigate(url) {
      return this.setUrl(url);
    }

    handleLinkClick(e) {
      var el = e.currentTarget;
      var href = el.getAttribute("href");
      if (!href || e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return true;
      this.setUrl(href);
      e.preventDefault();
      return false;
    }

    onWalletChanged() {
      for (var k in this.pages) {
        if (this.pages[k].onWalletChanged) this.pages[k].onWalletChanged();
      }
      this.render();
    }

    onRequest(cmd, message) {
      var params = message.params;
      if (cmd === "setSiteInfo") {
        this.site_info = params;
        this.render();
      } else if (cmd === "wrapperPopState") {
        var state = params && params.state;
        var url = (state && state.url) ||
          (params && params.href && params.href.indexOf("?") !== -1 ? params.href.replace(/.*\?/, "") : "");
        this.history_state.url = url;
        this.route(url);
        if (state && state.scrollTop) window.scrollTo(0, state.scrollTop);
      } else if (cmd === "wrapperOpenedWebsocket") {
        var self = this;
        this.cmd("siteInfo", {}, function (site_info) { self.site_info = site_info; self.render(); });
      } else if (this.isEmbedded) {
        this.log("Unknown command", cmd);
      }
      // Standalone, window.parent is this window: our own innerReady and
      // wrapperGetState echo back here and are ignored.
    }
  }

  // Standalone (no wrapper) back/forward.
  window.addEventListener("popstate", function (e) {
    if (window.Page && !Page.isEmbedded) Page.route(window.location.search.replace(/^\?/, ""));
  });

  window.Page = new XidApp();
})();
