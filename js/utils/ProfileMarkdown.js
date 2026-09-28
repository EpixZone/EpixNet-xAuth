// Marked supplies tokens only. Every visible node is built through maquette;
// raw HTML and image URLs are never inserted into the document.
(function () {
  var ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", colon: ":", Tab: "\t", NewLine: "\n" };

  function entities(value) {
    return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|colon|Tab|NewLine);/gi, function (match, entity) {
      if (entity.charAt(0) !== "#") return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match;
      var hex = entity.charAt(1).toLowerCase() === "x";
      var code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "\ufffd";
    });
  }

  function safeHref(input) {
    if (typeof input !== "string" || /[\u0000-\u001f\u007f\\]/.test(input)) return null;
    var value = entities(input).trim();
    if (!value || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
    // Check escaped control characters and disguised network-path links too.
    // The decoded probe is never used as the returned destination.
    var probe = value;
    for (var depth = 0; depth < 10; depth++) {
      if (/[\u0000-\u001f\u007f\\]/.test(probe) || /^\/\//.test(probe)) return null;
      var decoded = probe.replace(/%([0-9a-f]{2})/gi, function (match, hex) { return String.fromCharCode(parseInt(hex, 16)); });
      if (decoded === probe) break;
      if (depth === 9) return null;
      probe = decoded;
    }
    try {
      if (/^https?:\/\//i.test(value)) {
        var external = new URL(value);
        return /^(https?:)$/.test(external.protocol) && external.hostname ? external.href : null;
      }
      if (/^mailto:/i.test(value)) {
        var mail = new URL(value);
        return mail.protocol === "mailto:" ? mail.href : null;
      }
      // Relative destinations must be explicit so an obfuscated scheme is
      // never mistaken for an ordinary path. Preserve xite-relative links.
      if (!/^(\/|\.\/|\.\.\/|\?|#)/.test(value)) return null;
      var base = "https://profile.invalid/";
      var local = new URL(value, base);
      if (local.origin !== "https://profile.invalid" || local.protocol !== "https:" || /^\/\//.test(local.pathname)) return null;
      return value;
    } catch (e) {
      return null;
    }
  }

  function literal(token) { return String(token.raw !== undefined ? token.raw : token.text || ""); }

  function altText(tokens) {
    return (tokens || []).map(function (token) {
      if (token.tokens) return altText(token.tokens);
      if (token.type === "br") return " ";
      if (token.type === "codespan" || token.type === "html" || token.type === "escape") return String(token.text || "");
      return entities(token.text || "");
    }).join("");
  }

  function inline(tokens, path, depth) {
    return (tokens || []).map(function (token, index) {
      var key = path + "/" + index + ":" + token.type;
      if (depth > 32) return h("span", { key: key }, literal(token));
      var children;
      switch (token.type) {
        case "strong": case "em": case "del":
          return h(token.type, { key: key }, inline(token.tokens, key, depth + 1));
        case "link":
          children = inline(token.tokens, key, depth + 1);
          var href = safeHref(token.href);
          return href ? h("a", { key: key, href: href, target: "_blank", rel: "noopener noreferrer", title: token.title ? entities(token.title) : "" }, children)
            : h("span", { key: key }, children);
        case "image":
          return h("span.profile-image-alt", { key: key }, token.tokens ? altText(token.tokens) : entities(token.text));
        case "br": return h("br", { key: key });
        case "codespan": return h("code", { key: key }, String(token.text || ""));
        case "html": return h("span", { key: key }, literal(token));
        case "escape": return h("span", { key: key }, String(token.text || ""));
        case "text":
          return h("span", { key: key }, token.tokens ? inline(token.tokens, key, depth + 1) : token.escaped ? String(token.text || "") : entities(token.text));
        default: return h("span", { key: key }, literal(token));
      }
    });
  }

  function blocks(tokens, path, depth) {
    var out = [];
    (tokens || []).forEach(function (token, index) {
      var key = path + "/" + index + ":" + token.type;
      if (token.type === "space" || token.type === "def") return;
      if (depth > 32) { out.push(h("pre.profile-markdown-literal", { key: key }, literal(token))); return; }
      switch (token.type) {
        case "heading":
          out.push(h("h" + Math.min(6, Math.max(3, Number(token.depth) + 2)), { key: key }, inline(token.tokens, key, depth + 1)));
          break;
        case "paragraph":
          out.push(h("p", { key: key }, inline(token.tokens, key, depth + 1)));
          break;
        case "text":
          out.push(h("span", { key: key }, token.tokens ? inline(token.tokens, key, depth + 1) : entities(token.text)));
          break;
        case "blockquote":
          out.push(h("blockquote", { key: key }, blocks(token.tokens, key, depth + 1)));
          break;
        case "list":
          var properties = { key: key };
          if (token.ordered) properties.start = String(Number.isSafeInteger(token.start) ? token.start : 1);
          out.push(h(token.ordered ? "ol" : "ul", properties, (token.items || []).map(function (item, itemIndex) {
            var itemKey = key + "/item-" + itemIndex;
            var children = blocks(item.tokens, itemKey, depth + 1);
            if (item.task) children.unshift(h("span", { key: itemKey + "/task" }, item.checked ? "[x] " : "[ ] "));
            return h("li", { key: itemKey }, children);
          })));
          break;
        case "code":
          out.push(h("pre", { key: key }, [h("code", { key: key + "/code" }, String(token.text || ""))]));
          break;
        case "hr": out.push(h("hr", { key: key })); break;
        // HTML and unsupported Markdown (such as tables) remain readable text.
        default: out.push(h("pre.profile-markdown-literal", { key: key }, literal(token)));
      }
    });
    return out;
  }

  window.ProfileMarkdown = {
    safeHref: safeHref,
    render: function (text, key) {
      var source = String(text || "");
      var rootKey = key === undefined || key === null ? "profile-markdown" : String(key);
      var children;
      try {
        children = blocks(marked.lexer(source, { gfm: true, breaks: true, pedantic: false }), rootKey, 0);
      } catch (e) {
        children = [h("pre.profile-markdown-literal", { key: rootKey + "/plain" }, source)];
      }
      return h("div.profile-markdown", { key: rootKey }, children);
    }
  };
})();
