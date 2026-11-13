/*
 * editor.js - lightweight code editor: a transparent <textarea> on top of a
 * syntax-highlighted <pre>, with line numbers, breakpoints and line markers.
 */
(function () {
  "use strict";
  const LINE_H = 22, PAD_TOP = 12;

  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function highlightLine(line) {
    // comment part
    let code = line, com = "";
    const m = line.match(/(#|\/\/|;)/);
    if (m) { code = line.slice(0, m.index); com = line.slice(m.index); }
    let out = "";
    const re = /([A-Za-z_]\w*:)|(\.[a-z]+)|(\$\w+)|(-?0x[0-9a-fA-F]+|-?\d+)|([A-Za-z_]\w*)|(\s+|.)/g;
    let t, first = true;
    while ((t = re.exec(code))) {
      if (t[1]) out += `<span class="tk-lab">${esc(t[1])}</span>`;
      else if (t[2]) out += `<span class="tk-dir">${esc(t[2])}</span>`;
      else if (t[3]) out += `<span class="tk-reg">${esc(t[3])}</span>`;
      else if (t[4]) out += `<span class="tk-num">${esc(t[4])}</span>`;
      else if (t[5]) {
        if (first) { out += `<span class="tk-mn">${esc(t[5])}</span>`; first = false; }
        else out += `<span class="tk-lab">${esc(t[5])}</span>`;
        continue;
      } else out += esc(t[6]);
      if (t[1] === undefined && t[6] === undefined) first = false;
    }
    if (com) out += `<span class="${/#\s*EXPECT/i.test(com) ? "tk-exp" : "tk-com"}">${esc(com)}</span>`;
    return out;
  }

  class Editor {
    constructor(opts) {
      this.ta = opts.textarea; this.pre = opts.highlight; this.gutter = opts.gutter;
      this.layer = opts.lineLayer; this.scroller = opts.scroller;
      this.onChange = opts.onChange || (() => {});
      this.onBreakpoint = opts.onBreakpoint || (() => {});
      this.breakpoints = new Set();
      this.markers = {};            // name -> line number
      this.markerEls = {};
      this.ta.addEventListener("input", () => { this.render(); this.onChange(this.ta.value); });
      this.ta.addEventListener("keydown", e => this.keydown(e));
      this.gutter.addEventListener("click", e => {
        const d = e.target.closest("div[data-line]");
        if (!d) return;
        const n = +d.dataset.line;
        this.breakpoints.has(n) ? this.breakpoints.delete(n) : this.breakpoints.add(n);
        this.renderGutter(); this.onBreakpoint(this.breakpoints);
      });
    }
    get value() { return this.ta.value; }
    set value(v) { this.ta.value = v; this.breakpoints.clear(); this.render(); this.scroller.scrollTo({ top: 0 }); }

    keydown(e) {
      if (e.key === "Tab") {
        e.preventDefault();
        const s = this.ta.selectionStart, en = this.ta.selectionEnd;
        this.ta.setRangeText("    ", s, en, "end");
        this.render(); this.onChange(this.ta.value);
      }
    }
    render() {
      const lines = this.ta.value.split("\n");
      this.pre.innerHTML = lines.map(highlightLine).join("\n") + "\n";
      this.lineCount = lines.length;
      this.renderGutter();
    }
    renderGutter() {
      let h = "";
      for (let i = 1; i <= this.lineCount; i++) {
        const cls = [this.breakpoints.has(i) ? "bp" : "", this.markers.cur === i ? "cur" : ""].join(" ").trim();
        h += `<div data-line="${i}"${cls ? ` class="${cls}"` : ""}>${i}</div>`;
      }
      this.gutter.innerHTML = h;
    }
    /* name: 'cur' | 'last' | 'err' | 'sel'; line: 1-based or null */
    mark(name, line) {
      this.markers[name] = line;
      let el = this.markerEls[name];
      if (!el) { el = document.createElement("div"); el.className = `line-hl ${name}`; this.layer.appendChild(el); this.markerEls[name] = el; }
      if (!line) { el.style.opacity = 0; }
      else { el.style.opacity = 1; el.style.top = `${PAD_TOP + (line - 1) * LINE_H}px`; }
      if (name === "cur") this.renderGutter();
    }
    reveal(line) {
      if (!line) return;
      const top = PAD_TOP + (line - 1) * LINE_H;
      const s = this.scroller, view = s.clientHeight;
      if (top < s.scrollTop + 40 || top > s.scrollTop + view - 120)
        s.scrollTo({ top: Math.max(0, top - view / 3), behavior: "smooth" });
    }
  }
  window.Editor = Editor;
})();
