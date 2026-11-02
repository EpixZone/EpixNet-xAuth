// Profile and search use the same square crop and local thumbnail cache.
(function () {
  var SIZE = 56; // Largest .avatar in css/all.css.
  var MAX_SAMPLE_SIDE = 512;
  var KEY = "xid.avatar-thumbnails.v1";
  var LIMIT = 32;
  var LIFETIME = 24 * 60 * 60 * 1000;
  var entries = [], loading, resizer;
  var writes = Promise.resolve();

  function displayUrl(value) {
    try {
      var url = new URL(value, document.baseURI);
      if (!/^https?:$/.test(url.protocol) || !/(^|\.)gravatar\.com$/i.test(url.hostname) ||
          !/^\/avatar\/(?:[a-f\d]{32}|[a-f\d]{64})(?:\.jpg)?\/?$/i.test(url.pathname)) return value;
      url.searchParams.delete("size");
      url.searchParams.set("s", SIZE);
      return url.href;
    } catch (_) { return value; }
  }

  function fresh(list) {
    if (!Array.isArray(list)) return [];
    var now = Date.now();
    return list.filter(function (item) {
      return item && typeof item.url === "string" && item.expires > now && item.expires <= now + LIFETIME &&
        (item.png === null || (typeof item.png === "string" && item.png.length < 20000 &&
          /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.png)));
    }).slice(0, LIMIT);
  }

  // Android's opaque xite frame uses the wrapper's per-xite storage.
  // Fall back to this page's memory if either storage backend is unavailable.
  function storageReply(request) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error("Avatar storage unavailable")); }, 1000);
      request.then(function (data) {
        clearTimeout(timer);
        resolve(data);
      }, function (error) { clearTimeout(timer); reject(error); });
    });
  }

  async function wrapperData() {
    var data = await storageReply(Page.getLocalStorage());
    if (data && (data.error || typeof data !== "object" || Array.isArray(data))) throw new Error("Invalid xite storage");
    return data || {};
  }

  async function readCache() {
    try {
      var saved = Page.isEmbedded ? (await wrapperData())[KEY] : JSON.parse(localStorage.getItem(KEY));
      entries = fresh(saved);
    } catch (_) { /* The image can still load. */ }
  }

  function remember(url, png) {
    var item = { url: url, png: png, expires: Date.now() + LIFETIME };
    function prepend(list) {
      return [item].concat(fresh(list).filter(function (old) { return old.url !== url; })).slice(0, LIMIT);
    }
    entries = prepend(entries);
    writes = writes.then(async function () {
      if (Page.isEmbedded) {
        var data = await wrapperData();
        data[KEY] = prepend(data[KEY]);
        // The wrapper stores message.params itself as the xite's object.
        await storageReply(Page.cmd("wrapperSetLocalStorage", data));
      } else {
        localStorage.setItem(KEY, JSON.stringify(prepend(JSON.parse(localStorage.getItem(KEY)))));
      }
    }).catch(function () { /* Quotas and disabled storage only affect subsequent visits. */ });
  }

  async function thumbnail(image) {
    var width = image.naturalWidth, height = image.naturalHeight;
    var side = Math.min(width, height);
    // Crop as object-fit: cover would. Limit the working raster before
    // applying the JS filter, including for very large or panoramic images.
    var sample = document.createElement("canvas");
    sample.width = sample.height = Math.min(MAX_SAMPLE_SIDE, side);
    var context = sample.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, Math.floor((width - side) / 2), Math.floor((height - side) / 2), side, side,
      0, 0, sample.width, sample.height);
    if (side <= SIZE) return sample.toDataURL("image/png");

    var result = document.createElement("canvas");
    result.width = result.height = SIZE;
    if (!resizer) resizer = pica({ features: ["js"] });
    await resizer.resize(sample, result, { filter: "lanczos3" });
    return result.toDataURL("image/png");
  }

  async function loadLocalAvatar(image, url) {
    if (!loading) loading = readCache();
    await loading;
    if (!image.isConnected) return;
    var cached = fresh(entries).find(function (item) { return item.url === url; });
    function hideBroken() { image.style.display = "none"; }
    function original() {
      image.removeAttribute("crossorigin");
      image.onerror = hideBroken;
      // A host can permit <img> display while forbidding pixel reads.
      // Remember that outcome so later views can load it directly.
      image.onload = cached ? null : function () { remember(url, null); };
      image.src = url;
    }
    if (cached) {
      if (!cached.png) { original(); return; }
      image.onerror = original;
      image.src = cached.png;
      return;
    }
    image.crossOrigin = "anonymous";
    image.onerror = original;
    image.onload = async function () {
      image.onload = null;
      try {
        var png = await thumbnail(image);
        remember(url, png);
        if (image.isConnected) image.src = png;
      } catch (_) { /* Keep the already displayed image if it cannot be resized. */ }
    };
    image.src = url;
  }

  async function mount(image) {
    var source = image.getAttribute("data-avatar-url");
    var url = displayUrl(source);
    if (Page.isEmbedded) {
      var shared = await EpixAvatar.get(source, SIZE, Page);
      if (!image.isConnected) return;
      if (shared) {
        image.onerror = function () { loadLocalAvatar(image, url); };
        image.src = shared;
        return;
      }
    }
    return loadLocalAvatar(image, url);
  }

  window.ProfileAvatar = {
    render: function (source, alt) {
      return h("img.avatar", { key: source, "data-avatar-url": source, alt: alt, referrerpolicy: "no-referrer", loading: "lazy", afterCreate: mount });
    }
  };
})();
