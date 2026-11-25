/*
 * waveform.js - VCD parser and waveform viewer (GTKWave-style) for the
 * dumps written by the Verilog testbenches ($dumpfile / $dumpvars).
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------ VCD parser */
  function parseVCD(text) {
    const tok = text.split(/\s+/);
    const vcd = { date: "", version: "", timescale: "1ns", unitPs: 1000, vars: [], sig: {}, end: 0 };
    const scope = [];
    let i = 0, t = 0, header = true;
    const readUntilEnd = () => { const out = []; while (i < tok.length && tok[i] !== "$end") out.push(tok[i++]); i++; return out.join(" "); };
    const unitPs = s => {
      const m = /^(\d+)\s*(s|ms|us|ns|ps|fs)$/.exec(s.replace(/\s+/g, ""));
      if (!m) return 1;
      return +m[1] * { s: 1e12, ms: 1e9, us: 1e6, ns: 1e3, ps: 1, fs: 1e-3 }[m[2]];
    };
    while (i < tok.length) {
      const w = tok[i++];
      if (!w) continue;
      if (header) {
        if (w === "$date") vcd.date = readUntilEnd().trim();
        else if (w === "$version") vcd.version = readUntilEnd().trim();
        else if (w === "$timescale") { vcd.timescale = readUntilEnd().trim(); vcd.unitPs = unitPs(vcd.timescale); }
        else if (w === "$comment") readUntilEnd();
        else if (w === "$scope") { const p = readUntilEnd().split(" "); scope.push(p[1] || p[0]); }
        else if (w === "$upscope") { readUntilEnd(); scope.pop(); }
        else if (w === "$var") {
          const p = readUntilEnd().split(" ");
          const [type, width, code, ref] = p;
          const range = p[4] && p[4].startsWith("[") ? p[4] : "";
          const v = { type, width: +width, code, name: ref, range, path: scope.concat(ref).join(".") };
          vcd.vars.push(v);
          if (!vcd.sig[code]) vcd.sig[code] = { width: +width, times: [], vals: [] };
        } else if (w === "$enddefinitions") { readUntilEnd(); header = false; }
        continue;
      }
      const c = w[0];
      if (c === "#") { t = +w.slice(1); if (t > vcd.end) vcd.end = t; }
      else if (c === "$") { if (w === "$comment") readUntilEnd(); }
      else if (c === "b" || c === "B") push(tok[i++], w.slice(1).toLowerCase());
      else if (c === "r" || c === "R") push(tok[i++], w.slice(1));
      else if ("01xXzZ".includes(c)) push(w.slice(1), c.toLowerCase());
    }
    function push(code, val) {
      const s = vcd.sig[code]; if (!s) return;
      const n = s.times.length;
      if (n && s.times[n - 1] === t) { s.vals[n - 1] = val; return; }
      if (n && s.vals[n - 1] === val) return;
      s.times.push(t); s.vals.push(val);
    }
    vcd.vars = vcd.vars.filter(v => v.type !== "parameter");
    return vcd;
  }

  function valueAt(s, t) {
    let lo = 0, hi = s.times.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (s.times[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r < 0 ? "x" : s.vals[r];
  }

  // derive the clock period and the time at which each clock cycle's values are sampled
  function clockInfo(vcd) {
    const find = suf => vcd.vars.filter(v => v.path === suf || v.path.endsWith("." + suf)).sort((a, b) => a.path.length - b.path.length)[0];
    const clk = find("clk"), rst = find("reset");
    if (!clk) return null;
    const s = vcd.sig[clk.code];
    const rises = [], falls = [];
    s.times.forEach((t, k) => (s.vals[k] === "1" ? rises : falls).push(t));
    if (rises.length < 2) return null;
    const period = rises[2] !== undefined ? rises[2] - rises[1] : rises[1] - rises[0];
    let tStart = 0;
    if (rst) {
      const r = vcd.sig[rst.code];
      for (let k = 0; k < r.times.length; k++) if (r.vals[k] === "0" && k > 0) { tStart = r.times[k]; break; }
    }
    const first = falls.find(t => t >= tStart);
    if (first === undefined) return null;
    const samples = [];
    for (let t = first; t <= vcd.end; t += period) samples.push(t);
    return { period, samples, start: tStart };
  }

  /* ------------------------------------------------------------ formatting */
  function fmtVal(val, width, radix) {
    if (width === 1) return val;
    if (/[xz]/.test(val)) return /^[x]+$/.test(val) ? "x" : /^[z]+$/.test(val) ? "z" : "x…";
    const n = width > 32 ? null : parseInt(val, 2) >>> 0;
    if (n === null) return "…";
    if (radix === "dec") return String(width === 32 ? n | 0 : n);
    if (radix === "bin") return val.padStart(width, "0");
    if (radix === "asm" && width === 32 && window.MIPS) return MIPS.decode(n).asm;
    return n.toString(16).toUpperCase().padStart(Math.ceil(width / 4), "0");
  }

  const DEFAULT_GROUPS = [
    ["Clock & reset", ["clk", "reset"]],
    ["Instruction fetch", ["core.pc_current", "core.instruction:asm", "core.instruction"]],
    ["Control unit", ["core.reg_dst", "core.alu_src", "core.mem_to_reg", "core.reg_write", "core.mem_read", "core.mem_write", "core.branch", "core.jump", "core.alu_op:bin"]],
    ["Register file & ALU", ["core.read_data1", "core.alu_b", "core.alu_ctrl:bin", "core.alu_result", "core.zero"]],
    ["Data memory", ["core.dmem_addr", "core.dmem_wdata", "core.mem_data"]],
    ["Write-back & next PC", ["core.write_reg:dec", "core.write_back", "core.next_pc"]],
  ];

  /* ------------------------------------------------------------ viewer */
  class WaveViewer {
    constructor(root, opts = {}) {
      this.root = root; this.opts = opts;
      this.vcd = null; this.rows = []; this.radix = "hex";
      this.view0 = 0; this.pxPerT = 0.01; this.cursor = null; this.hover = null; this.curCycle = null;
      this.ROW = 26; this.GROUP = 22; this.RULER = 40;
      this.build();
    }

    build() {
      this.root.innerHTML = `
        <div class="wv-bar">
          <div class="select-wrap soft" title="Waveform dump"><svg viewBox="0 0 24 24"><path d="M3 12h3l3-7 4 14 3-7h5"/></svg><select class="wv-src" aria-label="VCD file"></select></div>
          <label class="btn soft"><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>Load .vcd<input type="file" class="wv-file" accept=".vcd" hidden></label>
          <div class="select-wrap soft" title="Add a signal"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><select class="wv-add" aria-label="Add signal"></select></div>
          <span class="seg wv-radix"><button data-v="hex" class="on">HEX</button><button data-v="dec">DEC</button></span>
          <span class="wv-zoom">
            <button class="icon-btn small" data-z="out" title="Zoom out (Ctrl + wheel)"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-4-4"/></svg></button>
            <button class="icon-btn small" data-z="in" title="Zoom in (Ctrl + wheel)"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M11 8v6M20 20l-4-4"/></svg></button>
            <button class="icon-btn small" data-z="fit" title="Zoom to fit"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
          </span>
          <span class="wv-link" title="The cursor follows the simulator. Click a clock cycle in the waveform to jump the simulator to it."></span>
          <span class="wv-info muted"></span>
        </div>
        <div class="wv-body">
          <div class="wv-names"></div>
          <div class="wv-vals"></div>
          <div class="wv-wave">
            <canvas class="wv-ruler"></canvas>
            <canvas class="wv-canvas"></canvas>
          </div>
        </div>
        <div class="wv-scrollbar"><div class="wv-thumb"></div></div>`;
      const q = s => this.root.querySelector(s);
      this.el = { src: q(".wv-src"), file: q(".wv-file"), add: q(".wv-add"), radix: q(".wv-radix"), info: q(".wv-info"), link: q(".wv-link"),
        body: q(".wv-body"), names: q(".wv-names"), vals: q(".wv-vals"), wave: q(".wv-wave"), ruler: q(".wv-ruler"), canvas: q(".wv-canvas"),
        bar: q(".wv-scrollbar"), thumb: q(".wv-thumb") };

      this.el.src.addEventListener("change", () => this.opts.onSource && this.opts.onSource(this.el.src.value));
      this.el.file.addEventListener("change", e => {
        const f = e.target.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => { this.load(String(rd.result), f.name); this.opts.onCustom && this.opts.onCustom(f.name); };
        rd.readAsText(f); e.target.value = "";
      });
      this.el.add.addEventListener("change", () => {
        const v = this.vcd && this.vcd.vars[+this.el.add.value];
        if (v) { this.rows.push({ v, fmt: null }); this.renderRows(); this.draw(); }
        this.el.add.value = "";
      });
      this.el.radix.addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        this.radix = b.dataset.v; this.el.radix.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
        this.renderVals(); this.draw();
      });
      this.root.querySelector(".wv-zoom").addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        const W = this.waveW();
        if (b.dataset.z === "fit") this.fit();
        else this.zoomAt(b.dataset.z === "in" ? 2 : 0.5, this.cursor != null ? this.cursor : this.view0 + W / 2 / this.pxPerT);
      });
      this.el.names.addEventListener("click", e => {
        const x = e.target.closest("[data-rm]"); if (!x) return;
        this.rows.splice(+x.dataset.rm, 1); this.renderRows(); this.draw();
      });

      const cv = this.el.canvas, ru = this.el.ruler;
      const tAt = e => this.view0 + (e.clientX - cv.getBoundingClientRect().left) / this.pxPerT;
      [cv, ru].forEach(c => {
        c.addEventListener("mousemove", e => { this.hover = tAt(e); this.draw(); });
        c.addEventListener("mouseleave", () => { this.hover = null; this.draw(); });
        c.addEventListener("click", e => {
          const t = tAt(e);
          const k = this.cycleAt(t);
          if (k != null && this.opts.onCycle && this.linked) { this.opts.onCycle(k); return; }
          this.cursor = k != null ? this.clock.samples[k] : t; this.renderVals(); this.draw();
        });
        c.addEventListener("wheel", e => {
          if (!this.vcd) return;
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.zoomAt(e.deltaY < 0 ? 1.25 : 0.8, tAt(e)); }
          else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
            e.preventDefault(); this.pan((e.shiftKey ? e.deltaY : e.deltaX) / this.pxPerT);
          }
        }, { passive: false });
      });
      // custom horizontal scrollbar
      let drag = null;
      this.el.thumb.addEventListener("pointerdown", e => { drag = { x: e.clientX, v: this.view0 }; this.el.thumb.setPointerCapture(e.pointerId); e.preventDefault(); });
      this.el.thumb.addEventListener("pointermove", e => {
        if (!drag) return;
        const W = this.el.bar.clientWidth;
        this.view0 = drag.v + (e.clientX - drag.x) * (this.vcd.end / W); this.clampView(); this.draw();
      });
      this.el.thumb.addEventListener("pointerup", () => { drag = null; });
      this.el.bar.addEventListener("pointerdown", e => {
        if (e.target !== this.el.bar || !this.vcd) return;
        const r = this.el.bar.getBoundingClientRect();
        this.view0 = (e.clientX - r.left) / r.width * this.vcd.end - this.waveW() / this.pxPerT / 2; this.clampView(); this.draw();
      });
      new ResizeObserver(() => this.draw()).observe(this.el.wave);
    }

    setSources(list, sel) {
      this.el.src.innerHTML = list.map(s => `<option value="${s.id}">${s.label}</option>`).join("");
      if (sel) this.el.src.value = sel;
    }

    load(text, label) {
      this.vcd = parseVCD(text);
      this.label = label;
      this.clock = clockInfo(this.vcd);
      const vcd = this.vcd;
      const find = suf => vcd.vars.filter(v => v.path === suf || v.path.endsWith("." + suf)).sort((a, b) => a.path.length - b.path.length)[0];
      this.rows = [];
      DEFAULT_GROUPS.forEach(([g, list]) => {
        const items = list.map(s => { const [p, fmt] = s.split(":"); const v = find(p); return v && { v, fmt: fmt || null }; }).filter(Boolean);
        if (items.length) { this.rows.push({ group: g }); this.rows.push(...items); }
      });
      if (!this.rows.length) this.rows = vcd.vars.slice(0, 24).map(v => ({ v, fmt: null }));
      // "add signal" list grouped by scope
      const byScope = {};
      vcd.vars.forEach((v, k) => { const sc = v.path.split(".").slice(0, -1).join(".") || "(top)"; (byScope[sc] = byScope[sc] || []).push([k, v]); });
      this.el.add.innerHTML = `<option value="">Add signal…</option>` + Object.entries(byScope).map(([sc, vs]) =>
        `<optgroup label="${sc}">${vs.map(([k, v]) => `<option value="${k}">${v.name}${v.width > 1 ? ` [${v.width - 1}:0]` : ""}</option>`).join("")}</optgroup>`).join("");
      const ns = this.vcd.unitPs;
      this.el.info.innerHTML = `${label} · ${vcd.vars.length} signals · ${this.fmtTime(vcd.end)}` +
        (this.clock ? ` · clock ${this.fmtTime(this.clock.period)}` : "") + (vcd.date ? ` · dumped ${vcd.date.replace(/\s+/g, " ")}` : "");
      this.cursor = this.clock ? this.clock.samples[0] : 0;
      this.curCycle = null;
      this.renderRows();
      requestAnimationFrame(() => this.fit());
      void ns;
    }

    setLinked(on, text) {
      this.linked = on;
      this.el.link.className = "wv-link" + (on ? " on" : "");
      this.el.link.innerHTML = on ? `<i></i>${text || "Linked to simulator"}` : "";
    }

    // put the cursor on clock cycle k (from the simulator)
    setCycle(k, reveal = true) {
      if (!this.vcd || !this.clock) return;
      this.curCycle = k;
      if (k == null || k < 0) { this.renderVals(); this.draw(); return; }
      const t = this.clock.samples[Math.min(k, this.clock.samples.length - 1)];
      this.cursor = t;
      if (reveal) {
        const W = this.waveW() / this.pxPerT;
        if (t < this.view0 + W * 0.08 || t > this.view0 + W * 0.92) { this.view0 = t - W * 0.5; this.clampView(); }
      }
      this.renderVals(); this.draw();
    }

    cycleAt(t) {
      if (!this.clock) return null;
      const P = this.clock.period, s0 = this.clock.samples[0];
      const k = Math.floor((t - (s0 - P / 2)) / P);
      return k >= 0 && k < this.clock.samples.length ? k : null;
    }

    fmtTime(t) {
      const ps = t * this.vcd.unitPs;
      return ps >= 1e3 ? `${+(ps / 1e3).toFixed(ps % 1e3 ? 1 : 0)} ns` : `${ps} ps`;
    }

    waveW() { return Math.max(100, this.el.wave.clientWidth); }
    fit() { if (!this.vcd) return; this.pxPerT = this.waveW() / Math.max(1, this.vcd.end); this.view0 = 0; this.draw(); }
    zoomAt(f, t) {
      if (!this.vcd) return;
      const W = this.waveW();
      const minP = W / Math.max(1, this.vcd.end), maxP = 60 / (this.clock ? this.clock.period / 10 : 1);
      const np = Math.max(minP, Math.min(maxP, this.pxPerT * f));
      const x = (t - this.view0) * this.pxPerT;
      this.pxPerT = np; this.view0 = t - x / np; this.clampView(); this.draw();
    }
    pan(dt) { this.view0 += dt; this.clampView(); this.draw(); }
    clampView() {
      const span = this.waveW() / this.pxPerT;
      this.view0 = Math.max(0, Math.min(this.view0, Math.max(0, this.vcd.end - span)));
    }

    rowFmt(r) { return r.fmt || (r.v.width === 1 ? "bin" : this.radix); }

    renderRows() {
      const n = [`<div class="wv-hcell">Signal</div>`], v = [`<div class="wv-hcell">Value</div>`];
      this.rows.forEach((r, k) => {
        if (r.group) { n.push(`<div class="wv-grp">${r.group}</div>`); v.push(`<div class="wv-grp"></div>`); return; }
        const short = r.v.path.split(".").slice(-2).join(".").replace(/^(tb_\w+|dut)\./, "");
        const label = r.fmt === "asm" ? `${r.v.name} <em>asm</em>` : `${short}${r.v.width > 1 ? `<small>[${r.v.width - 1}:0]</small>` : ""}`;
        n.push(`<div class="wv-name" title="${r.v.path} (${r.v.type}, ${r.v.width} bit${r.v.width > 1 ? "s" : ""})"><span>${label}</span><button data-rm="${k}" title="Remove">×</button></div>`);
        v.push(`<div class="wv-val" data-k="${k}"></div>`);
      });
      this.el.names.innerHTML = n.join(""); this.el.vals.innerHTML = v.join("");
      this.renderVals();
    }

    renderVals() {
      if (!this.vcd) return;
      const t = this.cursor;
      this.el.vals.querySelectorAll(".wv-val").forEach(el => {
        const r = this.rows[+el.dataset.k];
        const val = t == null ? "" : fmtVal(valueAt(this.vcd.sig[r.v.code], t), r.v.width, this.rowFmt(r));
        el.textContent = val; el.title = val;
        el.classList.toggle("x", /^x|^z/.test(val));
      });
    }

    colors() {
      const cs = getComputedStyle(document.documentElement);
      const g = k => cs.getPropertyValue(k).trim();
      const dark = document.documentElement.dataset.theme === "dark";
      return { bg: g("--surface"), alt: g("--surface-2"), grid: g("--border"), text: g("--text"), muted: g("--muted"),
        bit: dark ? "#4ade80" : "#15803d", bus: dark ? "#818cf8" : "#4f46e5", busFill: dark ? "rgba(129,140,248,.12)" : "rgba(79,70,229,.07)",
        x: "#ef4444", cursor: "#f59e0b", band: dark ? "rgba(245,158,11,.10)" : "rgba(245,158,11,.12)", hover: dark ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.18)" };
    }

    prep(c, w, h) {
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
        c.style.width = w + "px"; c.style.height = h + "px";
      }
      const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); return x;
    }

    draw() {
      if (!this.vcd || !this.root.offsetParent) return;
      const W = this.waveW(), C = this.colors();
      const H = this.rows.reduce((a, r) => a + (r.group ? this.GROUP : this.ROW), 0);
      const t0 = this.view0, t1 = t0 + W / this.pxPerT, X = t => (t - t0) * this.pxPerT;
      const mono = getComputedStyle(document.documentElement).getPropertyValue("--mono") || "monospace";

      // scrollbar
      const fr = Math.min(1, (t1 - t0) / this.vcd.end);
      this.el.thumb.style.width = Math.max(4, fr * 100) + "%";
      this.el.thumb.style.left = (t0 / this.vcd.end * 100) + "%";
      this.el.bar.classList.toggle("full", fr >= 0.999);

      /* ruler */
      const r = this.prep(this.el.ruler, W, this.RULER);
      r.fillStyle = C.bg; r.fillRect(0, 0, W, this.RULER);
      const unit = this.vcd.unitPs;
      const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].map(n => n * 1000 / unit);
      const step = steps.find(s => s * this.pxPerT >= 64) || steps[steps.length - 1];
      r.font = `10.5px ${mono}`; r.fillStyle = C.muted; r.strokeStyle = C.grid; r.textBaseline = "top";
      for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
        const x = Math.round(X(t)) + 0.5;
        r.beginPath(); r.moveTo(x, 0); r.lineTo(x, 8); r.stroke();
        r.fillText(this.fmtTime(t), x + 3, 2);
      }
      if (this.clock) {
        const P = this.clock.period, pxP = P * this.pxPerT;
        const every = pxP >= 26 ? 1 : pxP >= 13 ? 2 : pxP >= 6 ? 5 : pxP >= 3 ? 10 : 20;
        r.textAlign = "center"; r.textBaseline = "middle"; r.font = `600 10px ${mono}`;
        this.clock.samples.forEach((s, k) => {
          if (s < t0 - P || s > t1 + P) return;
          const x = X(s);
          if (k === this.curCycle) { r.fillStyle = C.cursor; r.fillRect(x - Math.max(12, pxP / 2 - 1), 18, Math.max(24, pxP - 2), 18); }
          if (k % every === 0 || k === this.curCycle) { r.fillStyle = k === this.curCycle ? "#111" : C.text; r.fillText(String(k), x, 27); }
        });
        r.textAlign = "left";
      }
      r.fillStyle = C.grid; r.fillRect(0, this.RULER - 1, W, 1);

      /* waves */
      const g = this.prep(this.el.canvas, W, Math.max(H, 10));
      g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
      // current cycle band + clock-edge grid
      if (this.clock) {
        const P = this.clock.period;
        if (this.curCycle != null && this.clock.samples[this.curCycle] !== undefined) {
          const s = this.clock.samples[this.curCycle];
          g.fillStyle = C.band; g.fillRect(X(s - P / 2), 0, P * this.pxPerT, H);
        }
        if (P * this.pxPerT >= 6) {
          g.strokeStyle = C.grid; g.setLineDash([2, 3]); g.beginPath();
          this.clock.samples.forEach(s => { const e = s - P / 2; if (e >= t0 && e <= t1) { const x = Math.round(X(e)) + 0.5; g.moveTo(x, 0); g.lineTo(x, H); } });
          g.stroke(); g.setLineDash([]);
        }
      }
      let y = 0;
      g.font = `11px ${mono}`; g.textBaseline = "middle";
      this.rows.forEach(row => {
        if (row.group) { g.fillStyle = C.alt; g.fillRect(0, y, W, this.GROUP); y += this.GROUP; return; }
        const s = this.vcd.sig[row.v.code], fmt = this.rowFmt(row);
        const top = y + 5, bot = y + this.ROW - 5, mid = (top + bot) / 2;
        let k = Math.max(0, s.times.findIndex((tt, j) => j === s.times.length - 1 || s.times[j + 1] > t0));
        if (row.v.width === 1) {
          g.lineWidth = 1.5; g.beginPath();
          let prevY = null;
          for (; k < s.times.length && s.times[k] <= t1; k++) {
            const xa = Math.max(-2, X(s.times[k])), xb = Math.min(W + 2, X(k + 1 < s.times.length ? s.times[k + 1] : this.vcd.end));
            const v = s.vals[k];
            if (v === "x" || v === "z") {
              g.stroke(); g.strokeStyle = C.x; g.beginPath(); g.moveTo(xa, mid); g.lineTo(xb, mid); g.stroke(); g.beginPath(); prevY = null; continue;
            }
            const yy = v === "1" ? top : bot;
            g.strokeStyle = C.bit;
            if (prevY === null) g.moveTo(xa, yy); else { g.lineTo(xa, prevY); g.lineTo(xa, yy); }
            if (v === "1") { g.save(); g.fillStyle = C.bit + "22"; g.fillRect(xa, top, xb - xa, bot - top); g.restore(); }
            g.lineTo(xb, yy); prevY = yy;
          }
          g.stroke(); g.lineWidth = 1;
        } else {
          for (; k < s.times.length && s.times[k] <= t1; k++) {
            const xa = X(s.times[k]), xb = X(k + 1 < s.times.length ? s.times[k + 1] : this.vcd.end);
            const v = s.vals[k], isX = /x|z/.test(v);
            const d = Math.min(3, (xb - xa) / 2);
            g.beginPath();
            g.moveTo(xa, mid); g.lineTo(xa + d, top); g.lineTo(xb - d, top); g.lineTo(xb, mid); g.lineTo(xb - d, bot); g.lineTo(xa + d, bot); g.closePath();
            g.fillStyle = isX ? "rgba(239,68,68,.12)" : C.busFill; g.fill();
            g.strokeStyle = isX ? C.x : C.bus; g.stroke();
            const txt = fmtVal(v, row.v.width, fmt);
            const room = Math.min(xb, W) - Math.max(xa, 0) - 8;
            if (room > 10) {
              let t = txt;
              if (g.measureText(t).width > room) { while (t.length > 1 && g.measureText(t + "…").width > room) t = t.slice(0, -1); t = t.length > 1 ? t + "…" : ""; }
              if (t) { g.fillStyle = isX ? C.x : C.text; g.fillText(t, Math.max(xa, 0) + 5, mid + 0.5); }
            }
          }
        }
        g.fillStyle = C.grid; g.fillRect(0, y + this.ROW - 0.5, W, 0.5);
        y += this.ROW;
      });
      // hover + cursor lines
      const vline = (t, col, w, dash) => {
        if (t == null || t < t0 || t > t1) return;
        const x = Math.round(X(t)) + 0.5;
        [g, r].forEach(c => { c.strokeStyle = col; c.lineWidth = w; c.setLineDash(dash || []); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, c === g ? H : 17); if (c === r) { c.moveTo(x, this.RULER - 3); c.lineTo(x, this.RULER); } c.stroke(); c.setLineDash([]); c.lineWidth = 1; });
      };
      vline(this.hover, C.hover, 1, [3, 3]);
      vline(this.cursor, C.cursor, 2);
      if (this.cursor != null && this.cursor >= t0 && this.cursor <= t1) {
        const lbl = this.fmtTime(this.cursor), x = X(this.cursor);
        r.font = `600 10px ${mono}`; const w = r.measureText(lbl).width + 8;
        const lx = Math.min(W - w - 2, x + 4);
        r.fillStyle = C.cursor; r.fillRect(lx, 2, w, 13); r.fillStyle = "#111"; r.textBaseline = "middle"; r.fillText(lbl, lx + 4, 9);
      }
    }
  }

  window.WaveViewer = WaveViewer;
  window.parseVCD = parseVCD;
})();
