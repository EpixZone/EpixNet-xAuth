// The shell: a collapsible sidebar (wallet, nav, collapse toggle) beside the
// page content. Chrome-less mode (the link wizard opened from another xite)
// renders the content alone.
(function () {
  var NAV = [
    { id: "register", href: "?", label: "Register", icon: "plus" },
    { id: "search", href: "?Search", label: "Search", icon: "search" },
    { id: "my_names", href: "?MyNames", label: "My Names", icon: "user" },
    { id: "prices", href: "?Prices", label: "Prices", icon: "tag" },
    { id: "stats", href: "?Stats", label: "Stats", icon: "chart" }
  ];

  class Layout {
    constructor() {
      this.collapsed = false;
      try { this.collapsed = localStorage.getItem("xid_sidebar_collapsed") === "1"; } catch (e) {}
      this.handleToggle = this.handleToggle.bind(this);
    }

    handleToggle() {
      this.collapsed = !this.collapsed;
      try { localStorage.setItem("xid_sidebar_collapsed", this.collapsed ? "1" : "0"); } catch (e) {}
      Page.render();
      return false;
    }

    renderNav(item) {
      var active = Page.content === Page.pages[item.id];
      return h("a.nav-link", {
        key: item.id,
        href: item.href,
        title: item.label,
        onclick: Page.handleLinkClick,
        classes: { "is-active": active }
      }, [Icons[item.icon](), h("span.nav-label", item.label)]);
    }

    renderSidebar() {
      var self = this;
      return h("aside.sidebar", { key: "sidebar" }, [
        h("a.brand", { href: "?", onclick: Page.handleLinkClick, title: "xID" }, [
          h("img.brand-mark", { src: "img/xID.png", alt: "" }),
          h("span.brand-name", "xID")
        ]),
        h("div.sidebar-wallet", [Wallet.renderButton()]),
        h("nav.sidebar-nav", NAV.map(function (item) { return self.renderNav(item); })),
        h("div.sidebar-foot", [
          h("a.nav-link", {
            href: "#Collapse",
            title: this.collapsed ? "Expand sidebar" : "Collapse sidebar",
            onclick: this.handleToggle
          }, [Icons.collapse(this.collapsed), h("span.nav-label", "Collapse")])
        ])
      ]);
    }

    render(content) {
      var chrome = Page.chrome;
      return h("div.layout", {
        key: "layout",
        classes: { collapsed: chrome && this.collapsed, "no-chrome": !chrome }
      }, [
        chrome ? this.renderSidebar() : null,
        h("div.content", [h("main.main", { classes: { wizard: !chrome } }, [content])])
      ]);
    }
  }

  window.Layout = Layout;
})();
