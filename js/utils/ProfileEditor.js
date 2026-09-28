// Text edits for the bio toolbar. Selection offsets are textarea UTF-16 offsets.
(function () {
  function range(text, start, end) {
    start = Math.max(0, Math.min(text.length, Number(start) || 0));
    end = Math.max(start, Math.min(text.length, Number(end) || start));
    return { start: start, end: end };
  }

  function wrap(text, start, end, mark, placeholder) {
    var selected = text.slice(start, end);
    if (selected && text.slice(start - mark.length, start) === mark && text.slice(end, end + mark.length) === mark) {
      return { value: text.slice(0, start - mark.length) + selected + text.slice(end + mark.length), start: start - mark.length, end: end - mark.length };
    }
    var content = selected || placeholder;
    return { value: text.slice(0, start) + mark + content + mark + text.slice(end), start: start + mark.length, end: start + mark.length + content.length };
  }

  function lines(text, start, end, prefix, placeholder) {
    var first = text.lastIndexOf("\n", start - 1) + 1;
    if (start === 0) first = 0;
    var last = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
    if (last === -1) last = text.length;
    var parts = text.slice(first, last).split("\n");
    var remove = parts.every(function (line) { return line.indexOf(prefix) === 0; });
    var changed = parts.map(function (line) {
      return remove ? line.slice(prefix.length) : line.indexOf(prefix) === 0 ? line : prefix + (line || (parts.length === 1 ? placeholder : ""));
    }).join("\n");
    return { value: text.slice(0, first) + changed + text.slice(last), start: first, end: first + changed.length };
  }

  window.ProfileEditor = {
    format: function (text, start, end, kind) {
      text = String(text || "");
      var selected = range(text, start, end);
      start = selected.start; end = selected.end;
      if (kind === "bold") return wrap(text, start, end, "**", "bold text");
      if (kind === "italic") return wrap(text, start, end, "*", "italic text");
      if (kind === "heading") return lines(text, start, end, "# ", "Heading");
      if (kind === "list") return lines(text, start, end, "- ", "List item");
      if (kind === "quote") return lines(text, start, end, "> ", "Quote");
      if (kind === "code") {
        var content = text.slice(start, end) || "code";
        var longest = (content.match(/`+/g) || []).reduce(function (length, ticks) { return Math.max(length, ticks.length); }, 0);
        if (content.indexOf("\n") !== -1) {
          var fence = "`".repeat(Math.max(3, longest + 1));
          var opening = (start > 0 && text[start - 1] !== "\n" ? "\n" : "") + fence + "\n";
          var closing = "\n" + fence + (end < text.length && text[end] !== "\n" ? "\n" : "");
          return { value: text.slice(0, start) + opening + content + closing + text.slice(end), start: start + opening.length, end: start + opening.length + content.length };
        }
        var mark = "`".repeat(longest + 1), padding = /^`|`$/.test(content) ? " " : "";
        var prefix = mark + padding, suffix = padding + mark;
        return { value: text.slice(0, start) + prefix + content + suffix + text.slice(end), start: start + prefix.length, end: start + prefix.length + content.length };
      }
      return { value: text, start: start, end: end };
    },

    link: function (text, start, end, href) {
      text = String(text || "");
      var selected = range(text, start, end);
      var label = (text.slice(selected.start, selected.end) || "link text").replace(/([\\\[\]])/g, "\\$1");
      var target = String(href).replace(/[()<>\\\s]/g, function (character) {
        return /[()]/.test(character) ? "%" + character.charCodeAt(0).toString(16).toUpperCase() : encodeURIComponent(character);
      });
      var insert = "[" + label + "](" + target + ")";
      return { value: text.slice(0, selected.start) + insert + text.slice(selected.end), start: selected.start + 1, end: selected.start + 1 + label.length };
    }
  };
})();
