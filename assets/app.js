/*!
 * AI 模特脸参考库 · 中文版
 * 零依赖、零构建：数据在 assets/data.js，图片在 assets/。
 */
(function () {
  "use strict";

  var SECS = window.FACE_SECTIONS || [];
  var LENS = window.FACE_LENGTHS || [];
  var RAW = window.FACE_ITEMS || [];

  var PAGE = 120;
  var LS = {
    fav: "face.fav",
    prompt: "face.prompts",
    ai: "face.ai",
    theme: "face.theme",
    seq: "face.seq",
    local: "face.local"
  };

  var DEFAULT_TPL = [
    "你是人像摄影与 AI 绘图领域的提示词工程师。用户会给出发长与发型风格，请写一条用于生成「同一张脸」的英文文生图提示词。",
    "要求：",
    "1) 只输出提示词本身，60–90 个英文词，逗号分隔的短语，不要解释、不要编号、不要负面词。",
    "2) 必须覆盖：脸型与年龄感、五官特征、肤质、发型细节（发长 / 刘海 / 层次 / 发色）、妆容、光线、镜头与构图、画质。",
    "3) 构图：正面、纯色浅色背景、半身、自然中性表情、真实摄影质感。",
    "4) 不得出现真人姓名、品牌名、水印。",
    "发长：{{len}}",
    "风格：{{style}}"
  ].join("\n");

  /* ---------- 小工具 ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmt(n) { return Number(n).toLocaleString("zh-CN"); }
  function mb(b) { return b ? (b / 1048576).toFixed(1) + " MB" : "—"; }
  function readJSON(key, dflt) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? dflt : v; }
    catch (e) { return dflt; }
  }
  function writeJSON(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {}
  }
  var toastTimer = 0;
  function toast(msg) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1900);
  }
  function copyText(txt) {
    function lastResort() {
      try { window.prompt("自动复制被浏览器拦下了，按 ⌘/Ctrl+C 手动复制：", txt); } catch (e) {}
      return false;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt).then(function () { return true; }, function () {
        return fallbackCopy(txt) ? true : lastResort();
      });
    }
    return Promise.resolve(fallbackCopy(txt) ? true : lastResort());
  }
  function fallbackCopy(txt) {
    try {
      var ta = el("textarea");
      ta.value = txt;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* ---------- 状态 ---------- */
  var state = {
    sec: "face",
    len: -1,
    tag: "",
    q: "",
    sort: "default",
    shown: 0,
    list: []
  };
  var favs = new Set(readJSON(LS.fav, []));
  var prompts = readJSON(LS.prompt, {});
  var aiCfg = readJSON(LS.ai, { key: "", base: "https://api.deepseek.com", model: "deepseek-chat", tpl: DEFAULT_TPL });
  if (!aiCfg.tpl) aiCfg.tpl = DEFAULT_TPL;

  /* ---------- 数据 ---------- */
  var ITEMS = RAW.map(function (it) {
    return {
      id: it.i,
      s: it.s,
      l: it.l,
      t: it.t || "",
      w: it.w,
      h: it.h,
      b: it.b,
      thumb: "assets/thumb/" + it.i + ".webp",
      full: "assets/full/" + it.i + ".png",
      local: false,
      created: 0,
      _hay: (it.i + " " + (LENS[it.l] || "") + " " + (it.t || "")).toLowerCase()
    };
  });
  var BUILTIN = ITEMS.slice();

  var REMOTE_BASE = "https://ai-portrait-gallery.pages.dev/img/full/";
  var localFullOK = true;
  function fullURLOf(it) {
    if (it.local) return it.full;
    return localFullOK ? it.full : REMOTE_BASE + it.id + ".png";
  }
  function probeFull() {
    /* assets/full 可能没随仓库分发（4.5 GB），探一下再决定下载按钮指向哪里 */
    if (location.protocol.indexOf("http") !== 0 || !BUILTIN.length) return;
    fetch("assets/full/" + BUILTIN[0].id + ".png", { method: "HEAD" }).then(function (r) {
      if (!r.ok) throw new Error("missing");
    }).catch(function () {
      localFullOK = false;
      /* 探测是异步的，首屏卡片可能已经渲染出来了，这里就地把链接改掉 */
      $$(".card").forEach(function (li) {
        var a = li.querySelector(".dl");
        if (a && li.dataset.id) a.href = REMOTE_BASE + li.dataset.id + ".png";
      });
      var dl = $("#lb-download");
      if (dl) dl.textContent = "下载原图（原站）";
      if (lbIndex >= 0) renderLb();
    });
  }

  function lenName(l) { return LENS[l] || "未分类"; }
  function secName(s) { return (SECS[s] && SECS[s].name) || "正面人脸"; }
  function label(it) { return it.t ? lenName(it.l) + "・" + it.t : lenName(it.l); }

  /* ---------- 本地上传图（IndexedDB） ---------- */
  var db = null;
  function openDB() {
    return new Promise(function (res) {
      if (db) return res(db);
      if (!window.indexedDB) return res(null);
      /* 某些环境（file:// 被策略禁用、隐私模式、沙箱）里 open 既不成功也不报错，加个看门狗 */
      var settled = false;
      var timer = setTimeout(function () { if (!settled) { settled = true; res(null); } }, 2500);
      var req = indexedDB.open("face-library", 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains("items")) d.createObjectStore("items", { keyPath: "id" });
      };
      req.onsuccess = function () { settled = true; clearTimeout(timer); db = req.result; res(db); };
      req.onerror = function () { settled = true; clearTimeout(timer); res(null); };
    });
  }
  function idbAll() {
    return openDB().then(function (d) {
      if (!d) return [];
      return new Promise(function (res) {
        var out = [];
        var tx = d.transaction("items", "readonly");
        var req = tx.objectStore("items").openCursor();
        req.onsuccess = function (e) {
          var c = e.target.result;
          if (c) { out.push(c.value); c.continue(); } else res(out);
        };
        req.onerror = function () { res(out); };
      });
    });
  }
  function idbPut(rec) {
    return openDB().then(function (d) {
      if (!d) return false;
      return new Promise(function (res) {
        var tx = d.transaction("items", "readwrite");
        tx.objectStore("items").put(rec);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      });
    });
  }
  function idbDel(id) {
    return openDB().then(function (d) {
      if (!d) return false;
      return new Promise(function (res) {
        var tx = d.transaction("items", "readwrite");
        tx.objectStore("items").delete(id);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      });
    });
  }

  /* file:// 下 Chrome 会禁用 IndexedDB，这里退回 localStorage（dataURL，容量有限但能用） */
  function lsRows() { return readJSON(LS.local, []); }
  function lsSave(rec) {
    var rows = lsRows().filter(function (r) { return r.id !== rec.id; });
    rows.push(rec);
    try { localStorage.setItem(LS.local, JSON.stringify(rows)); return true; }
    catch (e) { return false; }
  }
  function lsDel(id) { writeJSON(LS.local, lsRows().filter(function (r) { return r.id !== id; })); }

  function blobToDataURL(b) {
    return new Promise(function (res) {
      if (!b) return res("");
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { res(""); };
      fr.readAsDataURL(b);
    });
  }

  /* 统一成展示用结构：IndexedDB 走 objectURL，localStorage 直接是 dataURL */
  function loadLocalRows() {
    return idbAll().then(function (rows) {
      var fromIDB = rows.map(function (r) {
        var thumbURL = r.thumb ? URL.createObjectURL(r.thumb) : "";
        return {
          id: r.id, s: r.s || 0, l: r.l || 0, t: r.t || "",
          w: r.w || 0, h: r.h || 0, b: r.b || (r.blob ? r.blob.size : 0),
          thumbURL: thumbURL,
          fullURL: r.blob ? URL.createObjectURL(r.blob) : thumbURL,
          created: r.created || 0
        };
      });
      var fromLS = lsRows().map(function (r) {
        return {
          id: r.id, s: r.s || 0, l: r.l || 0, t: r.t || "",
          w: r.w || 0, h: r.h || 0, b: r.b || 0,
          thumbURL: r.thumb || r.full || "",
          fullURL: r.full || r.thumb || "",
          created: r.created || 0
        };
      });
      return fromIDB.concat(fromLS);
    });
  }

  function mergeLocal() {
    return loadLocalRows().then(function (rows) {
      if (!rows.length) return;
      var mine = rows.map(function (r) {
        return {
          id: r.id, s: r.s, l: r.l, t: r.t, w: r.w, h: r.h, b: r.b,
          thumb: r.thumbURL, full: r.fullURL,
          local: true, created: r.created,
          _hay: (r.id + " " + lenName(r.l) + " " + r.t).toLowerCase()
        };
      }).sort(function (a, b) { return a.id.localeCompare(b.id); });
      ITEMS = mine.concat(ITEMS);
      var n = $("#stat-local");
      if (n) n.textContent = String(mine.length);
      var t = $("#stat-total");
      if (t) t.textContent = fmt(ITEMS.length);
    });
  }

  /* 先写 IndexedDB；不可用或失败时退回 localStorage */
  function saveLocalRecord(rec) {
    return idbPut(rec).then(function (ok) {
      if (ok) return "idb";
      return blobToDataURL(rec.blob).then(function (fullURL) {
        return blobToDataURL(rec.thumb).then(function (thumbURL) {
          var row = {
            id: rec.id, s: rec.s, l: rec.l, t: rec.t, w: rec.w, h: rec.h,
            b: rec.b, full: fullURL, thumb: thumbURL, created: rec.created
          };
          return lsSave(row) ? "ls" : "fail";
        });
      });
    });
  }
  function deleteLocalRecord(id) {
    return idbDel(id).then(function () { lsDel(id); return true; });
  }

  /* ---------- 主题 ---------- */
  function applyTheme(mode) {
    var dark = mode === "dark" || (mode === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }
  var themeMode = localStorage.getItem(LS.theme) || "auto";
  applyTheme(themeMode);
  var themeBtn = $("#theme-btn");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var nowDark = document.documentElement.getAttribute("data-theme") === "dark";
      themeMode = nowDark ? "light" : "dark";
      localStorage.setItem(LS.theme, themeMode);
      applyTheme(themeMode);
      toast(nowDark ? "已切换到浅色" : "已切换到深色");
    });
  }

  /* ---------- 榜单（原站下载榜快照） ---------- */
  var RANK = {
    cats: ["综合", "短发", "中短发", "中长发", "长发"],
    top: {
      "综合": ["f71f980dde3", "f06fe4f6b36", "fac96077717", "f29201630d2", "fb223f53ef2", "f1de83b5df8", "faa41cb8657", "f009cba9893", "f192f568573", "f9c4277fe1f"],
      "短发": ["f71f980dde3", "f06fe4f6b36", "fac96077717", "f29201630d2", "fb223f53ef2", "f1de83b5df8", "faa41cb8657", "f009cba9893", "f192f568573", "f9c4277fe1f"],
      "中短发": ["f1eca675421", "fd2238cae24", "f311772f2d7", "ff99e2b582d", "f6464f359a9", "f4f4a6dd0b2", "fab36beac51", "f13de982eff", "f0700e56c83", "f06e6c1eadf"],
      "中长发": ["f16e87577ba", "f1359b46252", "f041ee5b0fd", "f8ef1f742be", "f0f60d4ec73", "f86edd8c1bb", "f2bcf83c430", "f1abc7a1ae5", "f1bcefe667c", "f2393554c88"],
      "长发": ["f002475397d", "ffde08c58a0", "f20b4f103de", "fe1b0b63a01", "f043d620012", "f54f3483e87", "fe0c5f18f06", "f000fa12e8d", "ff5fadcca9f", "f325330ec04"]
    }
  };

  function renderRanking() {
    var wrap = $("#ranking");
    var tabsEl = $("#rank-tabs");
    var listEl = $("#rank-list");
    if (!wrap || !tabsEl || !listEl) return;
    var byId = {};
    ITEMS.forEach(function (it) { byId[it.id] = it; });
    var cats = RANK.cats.filter(function (c) {
      return (RANK.top[c] || []).some(function (id) { return byId[id]; });
    });
    if (!cats.length) return;
    var current = cats[0];

    function show(cat) {
      current = cat;
      $$(".chip", tabsEl).forEach(function (b) {
        b.setAttribute("aria-selected", b.dataset.cat === cat ? "true" : "false");
      });
      listEl.textContent = "";
      var items = (RANK.top[cat] || []).map(function (id) { return byId[id]; }).filter(Boolean);
      items.forEach(function (it, i) {
        var li = el("li", "rank-item" + (i < 3 ? " rank-top" : ""));
        var b = el("button", "thumb-btn");
        b.type = "button";
        b.setAttribute("aria-label", "第 " + (i + 1) + " 名 " + label(it) + "，点击放大");
        var img = new Image();
        img.src = it.thumb;
        img.loading = "lazy";
        img.alt = "AI 生成的虚构人物（" + label(it) + "）";
        b.appendChild(img);
        b.appendChild(el("span", "rank-no", String(i + 1)));
        b.addEventListener("click", function () { openLightboxByItem(it, items); });
        li.appendChild(b);
        listEl.appendChild(li);
      });
      listEl.scrollLeft = 0;
    }

    cats.forEach(function (cat) {
      var b = el("button", "chip", cat);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.dataset.cat = cat;
      b.addEventListener("click", function () { show(cat); });
      tabsEl.appendChild(b);
    });
    show(current);
    var note = $("#rank-note");
    if (note) note.textContent = "原站下载榜快照 · 2026-10-30";
    wrap.hidden = false;
  }

  /* ---------- 首屏拼图 ---------- */
  function renderHero() {
    var box = $("#hero-faces");
    if (!box) return;
    var faces = ITEMS.filter(function (it) { return it.s === 0; });
    if (!faces.length) return;
    var picks = [faces[0]];
    [1, 2, 3].forEach(function (l) {
      if (picks.length >= 3) return;
      for (var i = 0; i < faces.length; i++) {
        if (faces[i].l === l && picks.indexOf(faces[i]) < 0) { picks.push(faces[i]); return; }
      }
    });
    picks.slice(0, 3).forEach(function (it, i) {
      var f = el("figure", "hf hf-" + (i + 1));
      var img = new Image();
      img.src = it.thumb;
      img.alt = "";
      img.decoding = "async";
      if (i === 0) img.fetchPriority = "high";
      f.appendChild(img);
      f.appendChild(el("figcaption", null, lenName(it.l)));
      box.appendChild(f);
    });
  }

  /* ---------- 筛选 ---------- */
  var TAG_WORDS = ["波波头", "狼尾", "空气刘海", "齐刘海", "无刘海", "黑发", "挑染", "烫", "层次", "米色", "灰", "韩系"];

  function basePool() {
    if (state.sec === "fav") return ITEMS.filter(function (it) { return favs.has(it.id); });
    var s = state.sec === "styling" ? 1 : 0;
    return ITEMS.filter(function (it) { return it.s === s; });
  }

  function applyFilters() {
    var arr = basePool();
    if (state.len >= 0) arr = arr.filter(function (it) { return it.l === state.len; });
    if (state.tag) arr = arr.filter(function (it) { return it.t.indexOf(state.tag) >= 0; });
    if (state.q) {
      var words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      arr = arr.filter(function (it) {
        for (var i = 0; i < words.length; i++) if (it._hay.indexOf(words[i]) < 0) return false;
        return true;
      });
    }
    if (state.sort === "id") arr = arr.slice().sort(function (a, b) { return a.id.localeCompare(b.id); });
    else if (state.sort === "size") arr = arr.slice().sort(function (a, b) { return (b.b || 0) - (a.b || 0); });
    else if (state.sort === "new") {
      arr = arr.slice().sort(function (a, b) {
        if (a.local !== b.local) return a.local ? -1 : 1;
        return (b.created || 0) - (a.created || 0);
      });
    }
    state.list = arr;
    state.shown = 0;
    var grid = $("#grid");
    grid.textContent = "";
    updateCounts();
    updateEmpty();
    showMore();
  }

  function updateCounts() {
    var all = basePool();
    var secJa = state.sec === "fav" ? "收藏" : secName(state.sec === "styling" ? 1 : 0);
    var c = $("#count");
    if (c) c.textContent = secJa + " 全 " + fmt(all.length) + " 张 / 显示 " + fmt(state.list.length) + " 张";
    var note = $("#sec-note");
    if (note) {
      if (state.sec === "fav") note.textContent = "你点过星标的图都在这里，存在本机浏览器。";
      else note.textContent = (SECS[state.sec === "styling" ? 1 : 0] || {}).note || "";
    }
    var nf = $("#n-face"), ns = $("#n-styling"), nv = $("#n-fav");
    if (nf) nf.textContent = fmt(ITEMS.filter(function (it) { return it.s === 0; }).length);
    if (ns) ns.textContent = fmt(ITEMS.filter(function (it) { return it.s === 1; }).length);
    if (nv) nv.textContent = fmt(favs.size);
  }

  function updateEmpty() {
    var e = $("#empty");
    if (!e) return;
    if (state.list.length) { e.hidden = true; return; }
    e.hidden = false;
    if (state.sec === "fav") { e.innerHTML = "<b>还没有收藏</b>把鼠标移到图片上，点右上角的星标就能存进这里。"; return; }
    if (state.q || state.len >= 0 || state.tag) {
      e.innerHTML = "<b>没有匹配的图</b>试试少几个关键词，或点「全部」重置筛选。";
      return;
    }
    e.innerHTML = "<b>这里还没有图</b>换个分区看看。";
  }

  function buildFilters() {
    var box = $("#filters");
    if (!box) return;
    box.textContent = "";
    var pool = basePool();
    var counts = {};
    pool.forEach(function (it) { counts[it.l] = (counts[it.l] || 0) + 1; });
    var all = el("button", "chip");
    all.type = "button";
    all.dataset.len = "-1";
    all.appendChild(document.createTextNode("全部"));
    all.appendChild(el("small", null, fmt(pool.length)));
    all.addEventListener("click", function () { setLen(-1); });
    box.appendChild(all);
    LENS.forEach(function (name, i) {
      if (!counts[i]) return;
      var b = el("button", "chip");
      b.type = "button";
      b.dataset.len = String(i);
      b.appendChild(document.createTextNode(name));
      b.appendChild(el("small", null, fmt(counts[i])));
      b.addEventListener("click", function () { setLen(i); });
      box.appendChild(b);
    });
    markPressed(box, "len", String(state.len));

    var tagBox = $("#tags");
    if (!tagBox) return;
    tagBox.textContent = "";
    var tagCounts = {};
    pool.forEach(function (it) {
      TAG_WORDS.forEach(function (w) { if (it.t.indexOf(w) >= 0) tagCounts[w] = (tagCounts[w] || 0) + 1; });
    });
    TAG_WORDS.forEach(function (w) {
      var n = tagCounts[w] || 0;
      if (n < 4) return;
      var b = el("button", "chip tag");
      b.type = "button";
      b.dataset.tag = w;
      b.appendChild(document.createTextNode(w));
      b.appendChild(el("small", null, fmt(n)));
      b.addEventListener("click", function () { setTag(state.tag === w ? "" : w); });
      tagBox.appendChild(b);
    });
    markPressed(tagBox, "tag", state.tag);
  }

  function markPressed(box, key, val) {
    $$(".chip", box).forEach(function (b) {
      var on = (b.dataset[key] || "") === val && val !== "";
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setLen(i) {
    state.len = i;
    markPressed($("#filters"), "len", String(i));
    applyFilters();
  }
  function setTag(t) {
    state.tag = t;
    markPressed($("#tags"), "tag", t);
    applyFilters();
  }

  function setSection(sec) {
    state.sec = sec;
    state.len = -1;
    state.tag = "";
    $$("#sections .seg").forEach(function (b) {
      b.setAttribute("aria-selected", b.dataset.sec === sec ? "true" : "false");
      b.tabIndex = b.dataset.sec === sec ? 0 : -1;
    });
    buildFilters();
    applyFilters();
  }

  /* ---------- 卡片 ---------- */
  function makeCard(it) {
    var li = el("li", "card");
    li.dataset.id = it.id;

    var btn = el("button", "ph loading");
    btn.type = "button";
    btn.setAttribute("aria-label", label(it) + "，编号 " + it.id + "，点击放大");
    var img = new Image();
    img.src = it.thumb;
    img.alt = "AI 生成的虚构人物（" + label(it) + "）";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("load", function () { btn.classList.remove("loading"); }, { once: true });
    btn.appendChild(img);
    if (it.local) btn.appendChild(el("span", "badge local", "本地"));
    if (prompts[it.id]) btn.appendChild(el("span", "ai-dot", "AI"));
    btn.addEventListener("click", function () { openLightboxByItem(it); });
    li.appendChild(btn);

    var star = el("button", "star-btn" + (favs.has(it.id) ? " on" : ""));
    star.type = "button";
    star.innerHTML = "★";
    star.setAttribute("aria-label", (favs.has(it.id) ? "取消收藏 " : "收藏 ") + it.id);
    star.setAttribute("aria-pressed", favs.has(it.id) ? "true" : "false");
    star.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleFav(it.id, star);
    });
    li.appendChild(star);

    var meta = el("div", "meta");
    meta.appendChild(el("span", "len", lenName(it.l)));
    var sty = el("span", "sty", it.t || "—");
    if (it.t) sty.title = it.t;
    meta.appendChild(sty);
    var dl = el("a", "dl");
    dl.href = fullURLOf(it);
    dl.setAttribute("download", "face-" + it.id + ".png");
    dl.title = "下载原图 PNG " + mb(it.b);
    dl.setAttribute("aria-label", "下载 " + it.id + " 的原图");
    dl.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg><span>PNG</span>';
    dl.addEventListener("click", function (e) { e.stopPropagation(); });
    meta.appendChild(dl);
    li.appendChild(meta);
    return li;
  }

  function showMore() {
    var grid = $("#grid");
    if (!grid) return;
    var end = Math.min(state.shown + PAGE, state.list.length);
    var frag = document.createDocumentFragment();
    for (var i = state.shown; i < end; i++) frag.appendChild(makeCard(state.list[i]));
    grid.appendChild(frag);
    state.shown = end;
    var more = $("#more");
    if (more) {
      var left = state.list.length - state.shown;
      more.hidden = left <= 0;
      more.textContent = "加载更多（还剩 " + fmt(left) + " 张）";
    }
    var c = $("#count");
    if (c) {
      var secJa = state.sec === "fav" ? "收藏" : secName(state.sec === "styling" ? 1 : 0);
      c.textContent = secJa + " 全 " + fmt(basePool().length) + " 张 / 显示 " + fmt(state.shown) + " 张";
    }
  }

  /* ---------- 收藏 ---------- */
  function toggleFav(id, btn) {
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    writeJSON(LS.fav, Array.from(favs));
    if (btn) {
      btn.classList.toggle("on", favs.has(id));
      btn.setAttribute("aria-pressed", favs.has(id) ? "true" : "false");
      btn.setAttribute("aria-label", (favs.has(id) ? "取消收藏 " : "收藏 ") + id);
    }
    $$('.card[data-id="' + id + '"] .star-btn').forEach(function (b) {
      b.classList.toggle("on", favs.has(id));
      b.setAttribute("aria-pressed", favs.has(id) ? "true" : "false");
    });
    updateCounts();
    if (state.sec === "fav") applyFilters();
    var lbFav = $("#lb-fav");
    if (lbFav && lbFav.dataset.id === id) syncLbFav(id);
  }
  function syncLbFav(id) {
    var b = $("#lb-fav");
    if (!b) return;
    var on = favs.has(id);
    b.dataset.id = id;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.textContent = on ? "★ 已收藏" : "☆ 收藏";
  }

  /* ---------- 灯箱 ---------- */
  var lbEl, lbImg, lbIndex = -1, lbList = null, lastFocus = null;

  function openLightboxByItem(it, list) {
    var arr = list || state.list;
    var idx = arr.indexOf(it);
    if (idx < 0) { arr = [it]; idx = 0; }
    lbList = arr;
    openLightbox(idx);
  }

  function openLightbox(i) {
    lbIndex = i;
    lastFocus = document.activeElement;
    lbEl.hidden = false;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(function () { lbEl.classList.add("open"); });
    renderLb();
    var c = $("#lb-close");
    if (c) c.focus();
  }

  function closeLightbox() {
    lbEl.classList.remove("open");
    document.body.style.overflow = "";
    setTimeout(function () { lbEl.hidden = true; }, 180);
    lbIndex = -1;
    lbList = null;
    if (lbImg) lbImg.removeAttribute("src");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function renderLb() {
    var arr = lbList || state.list;
    var it = arr[lbIndex];
    if (!it) return;

    lbImg.src = it.thumb;
    lbImg.alt = "AI 生成的虚构人物（" + label(it) + "）";
    var big = new Image();
    big.onload = function () { if (lbIndex >= 0 && (lbList || state.list)[lbIndex] === it) lbImg.src = big.src; };
    big.src = it.full;

    $("#lb-id").childNodes[0].nodeValue = it.id;
    var arrNow = lbList || state.list;
    $("#lb-sub").textContent = (it.local ? "本地上传" : "内置素材") + " · " + (lbIndex + 1) + " / " + arrNow.length;
    $("#lb-sec").textContent = secName(it.s);
    $("#lb-len").textContent = lenName(it.l);
    $("#lb-sty").textContent = it.t || "—";
    $("#lb-size").textContent = it.w && it.h ? it.w + " × " + it.h : "—";
    $("#lb-bytes").textContent = mb(it.b);

    var dl = $("#lb-download");
    dl.href = fullURLOf(it);
    dl.setAttribute("download", "face-" + it.id + ".png");
    dl.textContent = localFullOK ? "下载原图（PNG）" : "下载原图（原站）";
    syncLbFav(it.id);
    $("#lb-del").hidden = !it.local;

    var ta = $("#lb-prompt");
    ta.value = prompts[it.id] || "";
    ta.dataset.id = it.id;

    $("#lb-prev").disabled = lbIndex <= 0;
    $("#lb-next").disabled = lbIndex >= (lbList || state.list).length - 1;
  }

  function step(d) {
    var arr = lbList || state.list;
    var n = lbIndex + d;
    if (n < 0 || n >= arr.length) return;
    lbIndex = n;
    renderLb();
  }

  /* ---------- AI 提示词 ---------- */
  function buildTpl(it) {
    return aiCfg.tpl
      .replace(/\{\{len\}\}/g, lenName(it.l))
      .replace(/\{\{style\}\}/g, it.t || "（无具体风格，按发长写一条通用的人脸参考提示词）");
  }

  function genPrompt(it) {
    if (!aiCfg.key) {
      toast("先在「AI 设置」里填 API Key");
      openDialog("dlg-ai");
      return;
    }
    var btn = $("#lb-gen");
    var old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "生成中…";
    var base = (aiCfg.base || "https://api.deepseek.com").replace(/\/+$/, "");
    fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + aiCfg.key },
      body: JSON.stringify({
        model: aiCfg.model || "deepseek-chat",
        messages: [
          { role: "system", content: buildTpl(it) },
          { role: "user", content: "编号：" + it.id + "；发长：" + lenName(it.l) + "；风格：" + (it.t || "无") }
        ],
        temperature: 0.85,
        max_tokens: 420
      })
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      var txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!txt) throw new Error("返回为空");
      txt = txt.trim().replace(/^["'“]|["'”]$/g, "");
      prompts[it.id] = txt;
      writeJSON(LS.prompt, prompts);
      var ta = $("#lb-prompt");
      if (ta.dataset.id === it.id) ta.value = txt;
      toast("已生成，可编辑后复制");
      var card = $('.card[data-id="' + it.id + '"]');
      if (card && !$(".ai-dot", card)) card.querySelector(".ph").appendChild(el("span", "ai-dot", "AI"));
    }).catch(function (e) {
      toast("生成失败：" + e.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = old;
    });
  }

  /* ---------- 上传 ---------- */
  var pending = [];

  function nextSeq() {
    var n = parseInt(localStorage.getItem(LS.seq) || "0", 10) + 1;
    localStorage.setItem(LS.seq, String(n));
    return n;
  }

  function makeThumb(file) {
    return new Promise(function (res) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var W = 400, H = 500;
        var c = document.createElement("canvas");
        c.width = W; c.height = H;
        var ctx = c.getContext("2d");
        var s = Math.max(W / img.width, H / img.height);
        var w = img.width * s, h = img.height * s;
        ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
        c.toBlob(function (b) {
          URL.revokeObjectURL(url);
          res({ blob: b, w: img.width, h: img.height });
        }, "image/webp", 0.9);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(null); };
      img.src = url;
    });
  }

  function addFiles(files) {
    Array.prototype.forEach.call(files, function (f) {
      if (!/^image\//.test(f.type)) return;
      var row = { file: f, len: 0, style: "", sec: 0, url: URL.createObjectURL(f) };
      pending.push(row);
    });
    renderPending();
  }

  function renderPending() {
    var box = $("#up-list");
    if (!box) return;
    box.textContent = "";
    pending.forEach(function (row, i) {
      var item = el("div", "up-item");
      var img = new Image();
      img.src = row.url;
      img.alt = "";
      item.appendChild(img);

      var mid = el("div");
      var r1 = el("div", "row");
      var secSel = el("select");
      [["0", "正面人脸"], ["1", "造型"]].forEach(function (o) {
        var op = el("option", null, o[1]);
        op.value = o[0];
        secSel.appendChild(op);
      });
      secSel.value = String(row.sec);
      secSel.addEventListener("change", function () { row.sec = parseInt(secSel.value, 10) || 0; });
      var lenSel = el("select");
      LENS.forEach(function (n, li) {
        var op = el("option", null, n);
        op.value = String(li);
        lenSel.appendChild(op);
      });
      lenSel.value = String(row.len);
      lenSel.addEventListener("change", function () { row.len = parseInt(lenSel.value, 10) || 0; });
      var styleIn = el("input");
      styleIn.type = "text";
      styleIn.placeholder = "风格关键词，如：空气刘海 黑发";
      styleIn.value = row.style;
      styleIn.addEventListener("input", function () { row.style = styleIn.value; });
      r1.appendChild(secSel);
      r1.appendChild(lenSel);
      r1.appendChild(styleIn);
      mid.appendChild(r1);
      var tip = el("p", "ai-hint", row.file.name + " · " + (row.file.size / 1048576).toFixed(1) + " MB");
      mid.appendChild(tip);
      item.appendChild(mid);

      var rm = el("button", "rm", "×");
      rm.type = "button";
      rm.setAttribute("aria-label", "移除");
      rm.addEventListener("click", function () {
        URL.revokeObjectURL(row.url);
        pending.splice(i, 1);
        renderPending();
      });
      item.appendChild(rm);
      box.appendChild(item);
    });
  }

  function saveUploads() {
    if (!pending.length) { toast("先选几张图"); return; }
    var bad = pending.filter(function (r) { return !r.style.trim(); });
    if (bad.length) { toast("还有 " + bad.length + " 张没填风格关键词"); return; }
    var btn = $("#up-save");
    btn.disabled = true;
    btn.textContent = "保存中…";
    var chain = Promise.resolve();
    var saved = 0;
    pending.forEach(function (row) {
      chain = chain.then(function () {
        return makeThumb(row.file).then(function (t) {
          if (!t) return;
          var id = "M-" + String(nextSeq()).padStart(4, "0");
          return saveLocalRecord({
            id: id,
            s: row.sec,
            l: row.len,
            t: row.style.trim(),
            w: t.w,
            h: t.h,
            b: row.file.size,
            blob: row.file,
            thumb: t.blob,
            created: Date.now()
          }).then(function (where) { if (where !== "fail") saved += 1; });
        });
      });
    });
    chain.then(function () {
      btn.disabled = false;
      btn.textContent = "保存到我的图库";
      pending.forEach(function (r) { URL.revokeObjectURL(r.url); });
      pending = [];
      renderPending();
      var dlg = $("#dlg-upload");
      if (dlg) dlg.close();
      toast("已保存 " + saved + " 张，刷新后仍在你的图库里");
      if (saved) mergeLocal().then(function () {
        setSection(state.sec);
        renderRanking();
      });
    });
  }

  /* ---------- 弹窗 ---------- */
  function openDialog(id) {
    var d = document.getElementById(id);
    if (!d) return;
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
    if (id === "dlg-ai") fillAiForm();
  }
  function fillAiForm() {
    $("#ai-key").value = aiCfg.key || "";
    $("#ai-base").value = aiCfg.base || "https://api.deepseek.com";
    $("#ai-model").value = aiCfg.model || "deepseek-chat";
    $("#ai-tpl").value = aiCfg.tpl || DEFAULT_TPL;
  }

  /* ---------- 初始化 ---------- */
  function init() {
    lbEl = $("#lb");
    lbImg = $("#lb-img");

    // 顶部弹层按钮
    $$("[data-open]").forEach(function (b) {
      b.addEventListener("click", function () { openDialog(b.dataset.open); });
    });
    $$("[data-close]").forEach(function (b) {
      b.addEventListener("click", function () {
        var d = b.closest("dialog");
        if (d) d.close();
      });
    });

    // 分区
    $$("#sections .seg").forEach(function (b) {
      b.addEventListener("click", function () { setSection(b.dataset.sec); });
    });

    // 搜索
    var input = $("#search");
    var wrap = $("#search-wrap");
    var timer = 0;
    input.addEventListener("input", function () {
      wrap.classList.toggle("has-value", input.value.length > 0);
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.q = input.value.trim();
        applyFilters();
      }, 180);
    });
    $("#search-clear").addEventListener("click", function () {
      input.value = "";
      wrap.classList.remove("has-value");
      state.q = "";
      applyFilters();
      input.focus();
    });

    // 排序
    $("#sort").addEventListener("change", function (e) {
      state.sort = e.target.value;
      applyFilters();
    });

    // 随机
    $("#random-btn").addEventListener("click", function () {
      if (!state.list.length) return;
      var it = state.list[Math.floor(Math.random() * state.list.length)];
      openLightboxByItem(it);
    });

    // 更多
    $("#more").addEventListener("click", showMore);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting && state.shown < state.list.length) showMore();
      }, { rootMargin: "500px" }).observe($("#sentinel"));
    }

    // 灯箱
    $("#lb-close").addEventListener("click", closeLightbox);
    $("#lb-prev").addEventListener("click", function () { step(-1); });
    $("#lb-next").addEventListener("click", function () { step(1); });
    lbEl.addEventListener("click", function (e) { if (e.target === lbEl) closeLightbox(); });
    document.addEventListener("keydown", function (e) {
      if (lbEl.hidden) return;
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    });

    $("#lb-fav").addEventListener("click", function () {
      var arr = lbList || state.list;
      var it = arr[lbIndex];
      if (it) toggleFav(it.id);
    });
    $("#lb-copy").addEventListener("click", function () {
      var arr = lbList || state.list;
      var it = arr[lbIndex];
      if (!it) return;
      copyText(it.id).then(function (ok) { toast(ok ? "已复制编号 " + it.id : "复制失败，请手动选中"); });
    });
    $("#lb-download").addEventListener("click", function () {
      var arr = lbList || state.list;
      var it = arr[lbIndex];
      if (it) toast("开始下载 " + it.id + ".png");
    });
    $("#lb-del").addEventListener("click", function () {
      var arr = lbList || state.list;
      var it = arr[lbIndex];
      if (!it || !it.local) return;
      if (!confirm("确定删除这张自己上传的图吗？此操作不可撤销。")) return;
      deleteLocalRecord(it.id).then(function () {
        ITEMS = ITEMS.filter(function (x) { return x.id !== it.id; });
        var t = $("#stat-total");
        if (t) t.textContent = fmt(ITEMS.length);
        closeLightbox();
        setSection(state.sec);
        toast("已删除");
      });
    });

    // 提示词
    $("#lb-gen").addEventListener("click", function () {
      var arr = lbList || state.list;
      var it = arr[lbIndex];
      if (it) genPrompt(it);
    });
    $("#lb-copy-prompt").addEventListener("click", function () {
      var ta = $("#lb-prompt");
      if (!ta.value.trim()) { toast("还没有提示词"); return; }
      copyText(ta.value).then(function (ok) { toast(ok ? "提示词已复制" : "复制失败"); });
    });
    $("#lb-prompt").addEventListener("input", function () {
      var id = this.dataset.id;
      if (!id) return;
      if (this.value.trim()) prompts[id] = this.value; else delete prompts[id];
      writeJSON(LS.prompt, prompts);
    });

    // 上传
    var drop = $("#drop");
    var fileInput = $("#file-input");
    drop.addEventListener("click", function (e) {
      if (e.target === fileInput) return;
      fileInput.click();
    });
    fileInput.addEventListener("change", function () { addFiles(fileInput.files); fileInput.value = ""; });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("hot"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("hot"); });
    });
    drop.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
    $("#up-save").addEventListener("click", saveUploads);

    // AI 设置
    $("#ai-save").addEventListener("click", function () {
      aiCfg = {
        key: $("#ai-key").value.trim(),
        base: $("#ai-base").value.trim() || "https://api.deepseek.com",
        model: $("#ai-model").value.trim() || "deepseek-chat",
        tpl: $("#ai-tpl").value || DEFAULT_TPL
      };
      writeJSON(LS.ai, aiCfg);
      toast("设置已保存");
      var d = $("#dlg-ai");
      if (d) d.close();
    });
    $("#ai-test").addEventListener("click", function () {
      var key = $("#ai-key").value.trim();
      if (!key) { toast("先填 API Key"); return; }
      var base = ($("#ai-base").value.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
      var btn = $("#ai-test");
      btn.disabled = true;
      btn.textContent = "测试中…";
      fetch(base + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({
          model: $("#ai-model").value.trim() || "deepseek-chat",
          messages: [{ role: "user", content: "回复两个字：正常" }],
          max_tokens: 12
        })
      }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function () { toast("连接正常"); })
        .catch(function (e) { toast("连接失败：" + e.message); })
        .then(function () { btn.disabled = false; btn.textContent = "测试连接"; });
    });

    // 首屏
    var sf = $("#stat-face"), ss = $("#stat-styling"), st = $("#stat-total");
    if (sf) sf.textContent = fmt(BUILTIN.filter(function (x) { return x.s === 0; }).length);
    if (ss) ss.textContent = fmt(BUILTIN.filter(function (x) { return x.s === 1; }).length);
    if (st) st.textContent = fmt(BUILTIN.length);

    renderHero();
    renderRanking();
    probeFull();
    setSection("face");

    mergeLocal().then(function () {
      buildFilters();
      applyFilters();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
