// Inline SVG icons as maquette factories (the six sidebar glyphs, plus check,
// chevron, wallet and warning). Copied path data from the previous app.
(function () {
  function svg(viewBox, attrs, children) {
    var base = {
      viewBox: viewBox, fill: "none", stroke: "currentColor",
      "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round"
    };
    for (var k in attrs) base[k] = attrs[k];
    return h("svg", base, children);
  }

  window.Icons = {
    plus: function () { return svg("0 0 16 16", {}, [h("path", { d: "M8 3v10M3 8h10" })]); },
    search: function () { return svg("0 0 16 16", {}, [h("circle", { cx: "7", cy: "7", r: "4" }), h("path", { d: "M10 10l3 3" })]); },
    user: function () { return svg("0 0 16 16", {}, [h("circle", { cx: "8", cy: "5.5", r: "2.5" }), h("path", { d: "M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" })]); },
    tag: function () {
      return svg("0 0 16 16", {}, [
        h("path", { d: "M2 2h5.5l6.5 6.5-5.5 5.5L2 7.5V2z" }),
        h("circle", { cx: "5.5", cy: "5.5", r: "1", fill: "currentColor", stroke: "none" })
      ]);
    },
    chart: function () { return svg("0 0 16 16", {}, [h("path", { d: "M3 13V8M7 13V5M11 13V3" })]); },
    collapse: function (collapsed) {
      return svg("0 0 16 16", {}, [h("path", { d: collapsed ? "M6 3l5 5-5 5" : "M10 3L5 8l5 5" })]);
    },
    check: function (width) {
      return svg("0 0 24 24", { "stroke-width": String(width || 3) }, [h("path", { d: "M5 13l4 4L19 7" })]);
    },
    chevronDown: function () { return svg("0 0 24 24", { "stroke-width": "2" }, [h("path", { d: "M19 9l-7 7-7-7" })]); },
    wallet: function () {
      return svg("0 0 24 24", {}, [h("path", {
        d: "M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 6v3"
      })]);
    },
    warning: function () {
      return svg("0 0 24 24", {}, [h("path", {
        d: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
      })]);
    }
  };
})();
