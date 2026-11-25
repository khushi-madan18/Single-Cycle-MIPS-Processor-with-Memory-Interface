/*
 * app.js - main controller of the single-cycle MIPS simulator UI.
 */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const H = v => MIPS.hex8(v);
  const S = v => MIPS.s32(v);
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const store = {
    get(k, d) { try { const v = localStorage.getItem("mips-ui:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("mips-ui:" + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  const state = {
    prog: null, machine: null, history: [], lastRec: null, sampleId: null, fileName: "untitled.asm",
    running: false, timer: null, speed: store.get("speed", 4), regFmt: "hex", memView: "used",
    follow: true, selectedAddr: null, rtl: null, rtlName: null, verify: [], asmError: null,
    started: false, prevRegs: null,
  };

  /* ------------------------------------------------------------ setup */
  const editor = new Editor({
    textarea: $("#source"), highlight: $("#highlight"), gutter: $("#gutter"),
    lineLayer: $("#lineLayer"), scroller: $("#editor"),
    onChange: debounce(() => { markDirty(); assemble(); }, 350),
  });
  const datapath = new Datapath($("#datapath"), { stageStrip: $("#stageStrip"), tooltip: $("#tooltip") });

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  function toast(msg, kind = "info", ms = 3200) {
    const t = document.createElement("div");
    t.className = `toast ${kind}`; t.innerHTML = `<i></i><span>${msg}</span>`;
    $("#toasts").appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, ms);
  }

  function setStatus(kind) {
    const p = $("#statusPill");
    p.className = `status-pill ${kind}`;
    p.querySelector(".label").textContent = kind.toUpperCase();
    document.body.classList.toggle("running", kind === "running");
  }

  /* ------------------------------------------------------------ theme */
  function applyTheme(t) { document.documentElement.dataset.theme = t; store.set("theme", t); }
  applyTheme(store.get("theme", window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  $("#themeBtn").addEventListener("click", () => { applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"); wave.draw(); });

  /* ------------------------------------------------------------ programs */
  function fillProgramSelect() {
    const sel = $("#programSelect");
    sel.innerHTML = SAMPLE_PROGRAMS.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join("") +
      `<option value="__custom" disabled>Custom program</option>`;
    sel.addEventListener("change", () => {
      const p = SAMPLE_PROGRAMS.find(x => x.id === sel.value);
      if (p) loadSource(p.source, p.id + ".asm", p.id);
    });
  }

  function loadSource(src, name, sampleId) {
    stop();
    state.sampleId = sampleId; state.fileName = name;
    $("#fileName").textContent = name;
    $("#dirtyDot").classList.add("hidden");
    $("#programSelect").value = sampleId || "__custom";
    editor.value = src;
    assemble(true);
    toast(`Loaded <b>${esc(name)}</b>`, "ok", 1800);
  }

  function markDirty() {
    const sample = SAMPLE_PROGRAMS.find(p => p.id === state.sampleId);
    const dirty = !sample || sample.source !== editor.value;
    $("#dirtyDot").classList.toggle("hidden", !dirty);
    if (dirty) $("#programSelect").value = "__custom";
    else $("#programSelect").value = state.sampleId;
  }

  $("#fileInput").addEventListener("change", e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => loadSource(String(rd.result), f.name, null);
    rd.readAsText(f); e.target.value = "";
  });

  /* ------------------------------------------------------------ assemble */
  function assemble(quiet) {
    stop();
    const st = $("#asmState");
    try {
      state.prog = MIPS.assemble(editor.value);
      state.asmError = null;
      st.className = "asm-state ok"; st.lastElementChild.textContent = `Assembled · ${state.prog.text.length} instr · ${state.prog.data.length} data words`;
      $("#errorBar").classList.add("hidden");
      editor.mark("err", null);
      resetMachine();
    } catch (e) {
      state.prog = null; state.asmError = e;
      st.className = "asm-state err"; st.lastElementChild.textContent = "Error";
      $("#errorText").textContent = (e.line ? `Line ${e.line}: ` : "") + e.message;
      $("#errorBar").classList.remove("hidden");
      editor.mark("err", e.line || null);
      setStatus("error");
      setControls();
      if (!quiet) { /* inline error is enough while typing */ }
    }
  }

  function currentRtl() {
    const sample = SAMPLE_PROGRAMS.find(p => p.id === state.sampleId);
    if (sample && sample.source === editor.value && window.RTL_TRACES && RTL_TRACES[sample.id])
      return { trace: RTL_TRACES[sample.id], name: sample.id + " (tb_program.v, Icarus Verilog)" };
    if (state.customTrace) return state.customTrace;
    return null;
  }

  function resetMachine() {
    stop();
    if (!state.prog) return;
    state.machine = new MIPS.Machine(state.prog.text.map(t => t.word), state.prog.data);
    state.history = []; state.lastRec = null; state.follow = true; state.selectedAddr = null;
    state.verify = []; state.started = false; state.prevRegs = null;
    const r = currentRtl(); state.rtl = r && r.trace; state.rtlName = r && r.name;
    datapath.reset();
    $("#dpInstr").textContent = "";
    if (window.VCD_FILES && VCD_FILES[state.sampleId] && state.waveKey !== state.sampleId && !state.waveCustom) loadWave(state.sampleId);
    setStatus("ready");
    renderAll(false);
  }

  /* ------------------------------------------------------------ execution */
  function lineOfAddr(addr) {
    const t = state.prog && state.prog.text[addr >>> 2];
    return t ? t.line : null;
  }

  function stepOnce({ animate = true, render = true } = {}) {
    const m = state.machine;
    if (!m) return null;
    if (m.halted) { toast("Program has halted. Press Reset to run it again.", "warn"); stop(); return null; }
    state.prevRegs = m.regs.slice();
    state.history.push(m.snapshot());
    if (state.history.length > 6000) state.history.shift();
    const rec = m.step();
    state.lastRec = rec; state.started = true; state.follow = true;
    verifyRec(rec);
    if (render) renderAfterStep(rec, animate);
    if (m.halted) onHalt();
    return rec;
  }

  function verifyRec(rec) {
    const t = state.rtl && state.rtl[rec.cycle];
    if (!state.rtl) return;
    const mine = [rec.pc, rec.instr, MIPS.CTRL_KEYS.map(k => rec[k]).join(""), rec.alu_op, rec.aluCtrl, rec.aluResult,
      rec.zero, rec.writeReg, rec.writeBack, rec.mem_write, rec.nextPc];
    const diff = t ? mine.map((v, i) => v !== t[i]) : mine.map(() => true);
    state.verify[rec.cycle] = { rec, rtl: t, diff, ok: !diff.some(Boolean) };
  }

  function onHalt() {
    stop();
    setStatus("halted");
    const res = MIPS.checkExpects(state.prog, state.machine.regs, state.machine.dmem);
    const okN = res.filter(r => r.ok).length;
    let msg = `Halted after <b>${state.machine.cycles}</b> cycles`;
    if (res.length) msg += ` · EXPECT checks <b>${okN}/${res.length}</b> passed`;
    toast(msg, okN === res.length ? "ok" : "err", 4500);
  }

  function back() {
    stop();
    const s = state.history.pop();
    if (!s) { toast("Already at the first cycle", "warn", 1500); return; }
    state.machine.restore(s);
    state.verify.length = state.machine.trace.length;
    state.lastRec = state.machine.trace[state.machine.trace.length - 1] || null;
    state.prevRegs = state.history.length ? state.history[state.history.length - 1].regs : null;
    state.follow = true;
    setStatus(state.machine.cycles ? "paused" : "ready");
    if (state.lastRec) renderAfterStep(state.lastRec, false);
    else { datapath.reset(); renderAll(false); }
  }

  function animParams() {
    const sp = state.running ? state.speed : 2;
    const stageMs = Math.max(30, Math.min(230, 1000 / sp / 6));
    document.documentElement.style.setProperty("--anim", Math.max(.25, Math.min(1, stageMs / 230)).toFixed(2));
    return { stageMs, packets: !state.running || state.speed <= 8 };
  }

  function run() {
    if (!state.machine || state.running) return;
    if (state.machine.halted) { resetMachine(); }
    state.running = true; setStatus("running"); setControls();
    let first = true;
    const tick = () => {
      if (!state.running) return;
      const line = lineOfAddr(state.machine.pc);
      if (!first && editor.breakpoints.has(line)) {
        stop(); setStatus("paused"); toast(`Breakpoint at line ${line}`, "warn", 2000); return;
      }
      first = false;
      stepOnce();
      if (state.running) state.timer = setTimeout(tick, 1000 / state.speed);
    };
    tick();
  }

  function stop() {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (state.running) { state.running = false; if (state.machine && !state.machine.halted) setStatus("paused"); }
    setControls();
  }

  function runToEnd() {
    if (!state.machine) return;
    stop();
    if (state.machine.halted) { toast("Program has already halted", "warn", 1500); return; }
    let n = 0, first = true;
    while (!state.machine.halted && n < 5000) {
      const line = lineOfAddr(state.machine.pc);
      if (!first && editor.breakpoints.has(line)) { toast(`Breakpoint at line ${line}`, "warn", 2000); break; }
      first = false;
      stepOnce({ render: false }); n++;
    }
    if (n >= 5000) toast("Stopped after 5000 cycles (no halt reached)", "err");
    if (state.lastRec) renderAfterStep(state.lastRec, true);
    if (!state.machine.halted) setStatus("paused");
  }

  /* ------------------------------------------------------------ rendering */
  function setControls() {
    const ok = !!state.machine && !state.asmError;
    const halted = ok && state.machine.halted;
    $("#btnStep").disabled = !ok || state.running || halted;
    $("#btnEnd").disabled = !ok || state.running || halted;
    $("#btnBack").disabled = !ok || state.running || !state.history.length;
    $("#btnReset").disabled = !ok;
    $("#btnRun").disabled = !ok;
  }

  function renderAll(animate) {
    renderEditorMarks();
    renderRegs(null);
    renderMem(null);
    renderStats();
    renderConversion();
    renderListing();
    renderTimeline();
    renderVerify();
    syncWave();
    setControls();
  }

  function renderAfterStep(rec, animate) {
    if (!state.running || true) setStatus(state.machine.halted ? "halted" : state.running ? "running" : "paused");
    const ap = animParams();
    datapath.show(rec, { animate, packets: ap.packets, stageMs: ap.stageMs });
    $("#dpInstr").textContent = `cycle ${rec.cycle} · 0x${H(rec.pc)} · ${MIPS.decode(rec.instr).asm}`;
    renderEditorMarks();
    renderRegs(rec);
    renderMem(rec);
    renderStats(true);
    renderConversion();
    renderListing();
    renderTimeline();
    renderVerify();
    syncWave();
    setControls();
  }

  function renderEditorMarks() {
    const m = state.machine;
    if (!m || !state.prog) { editor.mark("cur", null); editor.mark("last", null); return; }
    const cur = m.halted ? null : lineOfAddr(m.pc);
    const last = state.lastRec ? lineOfAddr(state.lastRec.pc) : null;
    editor.mark("last", last);
    editor.mark("cur", cur);
    editor.mark("sel", !state.follow && state.selectedAddr != null ? lineOfAddr(state.selectedAddr) : null);
    editor.reveal(cur || last);
    $("#pcVal").textContent = "0x" + H(m.pc);
  }

  /* registers */
  function renderRegs(rec) {
    const m = state.machine;
    const box = $("#regs");
    if (!box.children.length) {
      box.innerHTML = MIPS.REG_NAMES.map((n, i) => `<div class="reg${i === 0 ? " zero" : ""}" data-i="${i}"><span class="n">r${i}</span><span class="nm">${n}</span><span class="v">0</span></div>`).join("");
    }
    const regs = m ? m.regs : new Array(32).fill(0);
    const rows = box.children;
    for (let i = 0; i < 32; i++) {
      const v = regs[i];
      rows[i].querySelector(".v").textContent = state.regFmt === "hex" ? "0x" + H(v) : String(S(v));
      rows[i].classList.remove("written", "read");
    }
    if (rec) {
      const f = rec.op in MIPS.CONTROL && !rec.jump;
      if (f) rows[rec.rs].classList.add("read");
      if (f && (rec.op === 0 || rec.branch || rec.mem_write)) rows[rec.rt].classList.add("read");
      if (rec.reg_write && rec.writeReg) {
        const el = rows[rec.writeReg];
        void el.offsetWidth; el.classList.add("written");
        const top = el.offsetTop - box.offsetTop;
        if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 30) box.scrollTo({ top: top - 60, behavior: "smooth" });
      }
    }
  }
  $("#regFmt").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state.regFmt = b.dataset.v; $$("#regFmt button").forEach(x => x.classList.toggle("on", x === b));
    renderRegs(state.lastRec);
  });

  /* memory */
  function renderMem(rec) {
    const m = state.machine, box = $("#mem");
    if (!m) { box.innerHTML = ""; return; }
    const labels = {};
    Object.entries(state.prog.dataLabels).forEach(([k, v]) => labels[v >>> 2] = k);
    const rdIdx = rec && rec.mem_read ? (rec.aluResult >>> 2) & 255 : -1;
    const wrIdx = rec && rec.mem_write ? (rec.aluResult >>> 2) & 255 : -1;
    const touched = new Set(m.trace.filter(r => r.mem_read || r.mem_write).map(r => (r.aluResult >>> 2) & 255));
    let rows = [], prevShown = -1;
    for (let i = 0; i < 256; i++) {
      const show = state.memView === "all" || i < state.prog.data.length || m.dmem[i] !== 0 || labels[i] || touched.has(i);
      if (!show) continue;
      if (state.memView !== "all" && prevShown >= 0 && i - prevShown > 1) rows.push(`<tr class="gap"><td colspan="4">⋯ ${i - prevShown - 1} zero words ⋯</td></tr>`);
      prevShown = i;
      const cls = i === wrIdx ? "wr" : i === rdIdx ? "rd" : "";
      rows.push(`<tr class="${cls}" data-i="${i}"><td>0x${(i * 4).toString(16).toUpperCase().padStart(3, "0")}</td><td class="lab">${labels[i] || ""}</td><td class="hex">${H(m.dmem[i])}</td><td class="dec">${S(m.dmem[i])}</td></tr>`);
    }
    if (!rows.length) rows.push(`<tr class="gap"><td colspan="4">all 256 words are zero</td></tr>`);
    box.innerHTML = `<table><thead><tr><th>Addr</th><th>Label</th><th>Hex</th><th style="text-align:right">Dec</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
    const hit = box.querySelector("tr.wr, tr.rd");
    if (hit) {
      const top = hit.offsetTop;
      if (top < box.scrollTop + 24 || top > box.scrollTop + box.clientHeight - 30) box.scrollTo({ top: top - box.clientHeight / 2, behavior: "smooth" });
    }
  }
  $("#memView").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state.memView = b.dataset.v; $$("#memView button").forEach(x => x.classList.toggle("on", x === b));
    renderMem(state.lastRec);
  });

  /* stats */
  const STAT_DEFS = [
    ["cycles", "Cycles", "#4f46e5", '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M10 2h4"/>'],
    ["cpi", "CPI", "#0ea5e9", '<path d="M3 12h4l3-8 4 16 3-8h4"/>'],
    ["alu", "ALU ops", "#ef4444", '<path d="M4 4l16 6v4L4 20v-6l4-2-4-2z"/>'],
    ["loads", "Loads", "#22c55e", '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>'],
    ["stores", "Stores", "#f97316", '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>'],
    ["branches", "Branches", "#a855f7", '<path d="M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a9 9 0 01-9 9"/>'],
    ["jumps", "Jumps", "#eab308", '<path d="M5 12h14M13 6l6 6-6 6"/>'],
    ["writes", "Reg writes", "#10b981", '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'],
  ];
  function computeStats() {
    const t = state.machine ? state.machine.trace : [];
    const s = { cycles: t.length, cpi: t.length ? "1.00" : "–", alu: 0, loads: 0, stores: 0, branches: "0", jumps: 0, writes: 0 };
    let br = 0, taken = 0;
    const mix = { "R-type": 0, ADDI: 0, LW: 0, SW: 0, BEQ: 0, J: 0 };
    t.forEach(r => {
      if (r.op === 0) { s.alu++; mix["R-type"]++; }
      else if (r.op === 8) { s.alu++; mix.ADDI++; }
      else if (r.op === 35) { s.loads++; mix.LW++; }
      else if (r.op === 43) { s.stores++; mix.SW++; }
      else if (r.op === 4) { br++; taken += r.takeBranch; mix.BEQ++; }
      else if (r.op === 2) { s.jumps++; mix.J++; }
      if (r.reg_write && r.writeReg) s.writes++;
    });
    s.branches = `${taken}/${br}`;
    return { s, mix };
  }
  let lastStats = {};
  function renderStats(bump) {
    const { s, mix } = computeStats();
    const g = $("#statsGrid");
    if (!g.children.length) {
      g.innerHTML = STAT_DEFS.map(([k, label, col, ico]) => `<div class="stat" data-k="${k}" title="${label}">
        <span class="ico" style="background:${col}1f;color:${col}"><svg viewBox="0 0 24 24">${ico}</svg></span>
        <span><div class="v">0</div><div class="k">${label}</div></span></div>`).join("");
    }
    STAT_DEFS.forEach(([k]) => {
      const el = g.querySelector(`[data-k="${k}"]`);
      const v = String(s[k]);
      el.querySelector(".v").textContent = v;
      if (bump && lastStats[k] !== v) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
      lastStats[k] = v;
    });
    const total = Object.values(mix).reduce((a, b) => a + b, 0) || 1;
    const cols = { "R-type": "#ec4899", ADDI: "#6366f1", LW: "#22c55e", SW: "#f97316", BEQ: "#a855f7", J: "#eab308" };
    const mb = $("#mixBars");
    mb.innerHTML = Object.keys(mix).map(k => `<span style="width:${(mix[k] / total * 100).toFixed(1)}%;background:${cols[k]}" title="${k}: ${mix[k]}"></span>`).join("");
    let lg = mb.nextElementSibling;
    if (!lg || !lg.classList.contains("mix-legend")) { lg = document.createElement("div"); lg.className = "mix-legend"; mb.after(lg); }
    lg.innerHTML = Object.keys(mix).map(k => `<span><i style="background:${cols[k]}"></i>${k} ${mix[k]}</span>`).join("");
  }

  /* conversion */
  function conversionTarget() {
    if (!state.prog) return {};
    let addr, rec;
    if (!state.follow && state.selectedAddr != null) {
      addr = state.selectedAddr;
      const tr = state.machine.trace;
      for (let i = tr.length - 1; i >= 0; i--) if (tr[i].pc === addr) { rec = tr[i]; break; }
    } else if (state.lastRec) { addr = state.lastRec.pc; rec = state.lastRec; }
    else addr = 0;
    return { entry: state.prog.text[addr >>> 2], rec, isCurrent: rec && rec === state.lastRec };
  }
  let lastConvKey = "";
  function renderConversion() {
    const t = conversionTarget();
    const key = t.entry ? `${t.entry.addr}|${t.entry.word}|${t.rec ? t.rec.cycle : "-"}|${document.documentElement.dataset.theme}` : "none";
    if (key === lastConvKey && state.running) return;
    lastConvKey = key;
    Conversion.render($("#conversion"), { entry: t.entry, rec: t.rec, prog: state.prog, isCurrent: t.isCurrent });
  }

  function selectAddr(addr, reveal) {
    if (!state.prog || !state.prog.text[addr >>> 2]) return;
    state.follow = false; state.selectedAddr = addr;
    lastConvKey = "";
    renderConversion(); renderListing(); renderEditorMarks();
    if (reveal) switchTab("conversion");
  }

  // clicking a line in the editor inspects that instruction
  $("#source").addEventListener("click", () => {
    if (!state.prog) return;
    const ta = $("#source");
    const line = ta.value.slice(0, ta.selectionStart).split("\n").length;
    const e = state.prog.text.find(t => t.line === line);
    if (e) selectAddr(e.addr, false);
  });

  /* listing */
  function renderListing() {
    const el = $("#listing");
    if (!state.prog) { el.innerHTML = `<div class="empty">Fix the assembly error to see the machine code.</div>`; return; }
    const curPc = state.machine && !state.machine.halted ? state.machine.pc : -1;
    const inv = {}; Object.entries(state.prog.labels).forEach(([k, v]) => inv[v] = k);
    const rows = state.prog.text.map(t => {
      const fl = Conversion.fieldList(t.word, t.fields.fmt);
      const bf = fl.map(([n, w, v]) => `<span style="--fc:${Conversion.FIELD_COLORS[n]}" title="${n} = ${v}">${MIPS.bin(v, w)}</span>`).join("");
      const cls = [t.addr === curPc ? "cur" : "", !state.follow && t.addr === state.selectedAddr ? "sel" : ""].join(" ");
      return `<tr class="${cls}" data-addr="${t.addr}"><td>0x${t.addr.toString(16).toUpperCase().padStart(3, "0")}</td><td class="lab">${inv[t.addr] ? esc(inv[t.addr]) + ":" : ""}</td>
        <td>${esc(t.asm)}</td><td><span class="bf">${bf}</span></td><td class="hex">${H(t.word)}</td><td>${t.fields.fmt}</td></tr>`;
    }).join("");
    el.innerHTML = `<div class="listing-tools">
        <button class="btn soft" id="dlMem"><svg viewBox="0 0 24 24"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>Download .mem</button>
        ${state.prog.data.length ? `<button class="btn soft" id="dlData"><svg viewBox="0 0 24 24"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>Download _data.mem</button>` : ""}
        <span class="muted">Same machine code as <code>tools/mips_asm.py</code>, padded to 256 words. Loads straight into the Verilog testbench with <code>$readmemh</code>.</span></div>
      <table class="lst"><thead><tr><th>Address</th><th>Label</th><th>Assembly</th><th>Binary (fields)</th><th>Hex</th><th>Fmt</th></tr></thead><tbody>${rows}</tbody></table>`;
    el.querySelectorAll("tr[data-addr]").forEach(tr => tr.addEventListener("click", () => selectAddr(+tr.dataset.addr, true)));
    $("#dlMem").addEventListener("click", () => download(state.fileName.replace(/\.\w+$/, "") + ".mem", memFile("instruction memory", state.prog.text.map(t => [t.word, `0x${t.addr.toString(16).toUpperCase().padStart(3, "0")}  ${t.asm}`]))));
    const dd = $("#dlData");
    if (dd) dd.addEventListener("click", () => {
      const inv2 = {}; Object.entries(state.prog.dataLabels).forEach(([k, v]) => inv2[v] = k);
      download(state.fileName.replace(/\.\w+$/, "") + "_data.mem", memFile("data memory", state.prog.data.map((w, i) => [w, `0x${(i * 4).toString(16).toUpperCase().padStart(3, "0")}  ${inv2[i * 4] ? inv2[i * 4] + ": " : ""}${S(w)}`])));
    });
  }
  function memFile(kind, items) {
    const name = state.fileName.replace(/\.\w+$/, "");
    let s = `// ${name}.mem - generated by the MIPS UI (${kind})\n`;
    items.forEach(([w, c]) => s += `${H(w)}  // ${c}\n`);
    if (items.length < 256) { s += `// --- unused words (zero padding up to 256 words) ---\n`; for (let i = items.length; i < 256; i++) s += "00000000\n"; }
    return s;
  }
  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Saved <b>${esc(name)}</b>`, "ok", 1800);
  }

  /* timeline */
  function stagesOf(r) {
    const known = r.op in MIPS.CONTROL;
    return { IF: true, ID: true, EX: known, MEM: !!(r.mem_read || r.mem_write), WB: !!(r.reg_write && r.writeReg) };
  }
  function renderTimeline() {
    const el = $("#timeline");
    const tr = state.machine ? state.machine.trace : [];
    if (!tr.length) {
      el.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg><div>No cycles yet. Press <kbd>Step</kbd> or <kbd>Run</kbd>.</div></div>`;
      return;
    }
    const N = 24, end = tr.length, start = Math.max(0, end - N);
    const rows = tr.slice(start, end);
    const cols = rows.length;
    let h = `<div class="tl-note">Single-cycle: each instruction completes all of its stages inside <b>one</b> clock cycle (CPI = 1). Grey segments are stages the instruction does not use.
      <span class="lgd"><i style="background:#facc15"></i>IF</span><span class="lgd"><i style="background:#60a5fa"></i>ID</span><span class="lgd"><i style="background:#f87171"></i>EX</span><span class="lgd"><i style="background:#4ade80"></i>MEM</span><span class="lgd"><i style="background:#c084fc"></i>WB</span></div>`;
    h += `<div class="tl" style="grid-template-columns: minmax(200px, max-content) repeat(${cols}, 96px)">`;
    h += `<div class="h first">Instruction</div>` + rows.map(r => `<div class="h">${r.cycle + 1}</div>`).join("");
    rows.forEach((r, i) => {
      const st = stagesOf(r);
      const isLast = r === state.lastRec;
      h += `<div class="name${isLast ? " row-cur" : ""}" style="${isLast ? "color:var(--primary);font-weight:700" : ""}">${esc(MIPS.decode(r.instr).asm)}</div>`;
      for (let c = 0; c < cols; c++) {
        h += `<div class="cell">${c === i ? `<div class="blk"${isLast ? "" : ' style="animation:none"'}>${["IF", "ID", "EX", "MEM", "WB"].map(s => `<span class="${st[s] ? s : "off"}">${s}</span>`).join("")}</div>` : ""}</div>`;
      }
    });
    h += `</div>`;
    el.innerHTML = h;
    const page = el.parentElement;
    if (page.classList.contains("on")) page.scrollTo({ top: page.scrollHeight, left: page.scrollWidth, behavior: "smooth" });
  }

  /* verification */
  function renderVerify() {
    const el = $("#verify");
    const badge = $("#rtlBadge");
    const rows = state.verify.filter(Boolean);
    const loadBtn = `<label class="btn soft"><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>Load a Verilog trace…<input type="file" id="traceInput" accept=".txt" hidden></label>`;
    if (!state.rtl) {
      badge.classList.add("hidden");
      el.innerHTML = `<div class="verify-sum"><div class="grow"><b>No Verilog trace for this program</b>
        <p>Traces for the built-in samples are included. For your own program, save it as <code>programs/NAME.asm</code>, run <code>make sim PROG=NAME</code>, then load <code>simulation/NAME_trace.txt</code> here.</p></div>${loadBtn}</div>`;
      bindTraceInput();
      return;
    }
    const okN = rows.filter(r => r.ok).length, bad = rows.length - okN;
    badge.classList.toggle("hidden", !rows.length);
    badge.classList.toggle("bad", bad > 0);
    badge.querySelector("span").textContent = bad ? `RTL mismatch ${bad}` : `RTL match ${okN}/${rows.length}`;
    const total = state.rtl.length;
    const head = `<div class="verify-sum ${rows.length ? (bad ? "bad" : "ok") : ""}">
      <span class="big">${rows.length ? `${okN}/${rows.length}` : `0/${total}`}</span>
      <div class="grow"><b>${rows.length ? (bad ? "Differences found between this model and the Verilog RTL" : "Every executed cycle matches the Verilog simulation") : "Step the program to compare each cycle with the Verilog RTL"}</b>
      <p>Reference: <code>${esc(state.rtlName)}</code> · ${total} cycles recorded. Compared per cycle: PC, instruction, 8 control signals, ALUOp, ALU control, ALU result, Zero, write register, write-back data, MemWrite, next PC.</p></div>${loadBtn}</div>`;
    const show = rows.slice(-300);
    const fields = ["PC", "Instr", "Control", "ALUOp", "ALUctl", "ALU result", "Zero", "WReg", "WB data", "MemW", "Next PC"];
    const fmt = (i, v) => v === undefined ? "–" : i === 2 ? v : i === 3 ? MIPS.bin(v, 2) : i === 4 ? MIPS.bin(v, 4) : (i === 6 || i === 7 || i === 9) ? v : H(v);
    const body = show.map(r => {
      const mine = [r.rec.pc, r.rec.instr, MIPS.CTRL_KEYS.map(k => r.rec[k]).join(""), r.rec.alu_op, r.rec.aluCtrl, r.rec.aluResult, r.rec.zero, r.rec.writeReg, r.rec.writeBack, r.rec.mem_write, r.rec.nextPc];
      return `<tr><td>${r.rec.cycle}</td><td>${esc(MIPS.decode(r.rec.instr).asm)}</td>${mine.map((v, i) => `<td class="${r.diff[i] ? "diff" : ""}${i === 2 ? " ctl" : ""}" title="${r.diff[i] ? "RTL: " + fmt(i, r.rtl && r.rtl[i]) : "matches RTL"}">${fmt(i, v)}</td>`).join("")}
        <td class="${r.ok ? "ok" : "bad"}">${r.ok ? "✓ match" : "✗ differs"}</td></tr>`;
    }).reverse().join("");
    el.innerHTML = head + (rows.length ? `<table class="vt"><thead><tr><th>Cycle</th><th>Instruction</th>${fields.map(f => `<th>${f}</th>`).join("")}<th>Result</th></tr></thead><tbody>${body}</tbody></table>` : "");
    bindTraceInput();
  }
  function bindTraceInput() {
    const inp = $("#traceInput"); if (!inp) return;
    inp.addEventListener("change", e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const tr = parseTrace(String(rd.result));
        if (!tr.length) { toast("That file does not look like a tb_program.v trace", "err"); return; }
        state.customTrace = { trace: tr, name: f.name };
        state.rtl = tr; state.rtlName = f.name;
        state.verify = []; state.machine.trace.forEach(verifyRec);
        renderVerify(); toast(`Loaded Verilog trace <b>${esc(f.name)}</b> (${tr.length} cycles)`, "ok");
      };
      rd.readAsText(f);
    });
  }
  function parseTrace(text) {
    const out = [];
    text.split("\n").forEach(line => {
      if (!line.trim() || line.startsWith("#")) return;
      const t = line.trim().split(/\s+/);
      if (t.length < 21) return;
      out.push([parseInt(t[1], 16) >>> 0, parseInt(t[2], 16) >>> 0, t.slice(3, 11).join(""), parseInt(t[11], 2), parseInt(t[12], 2),
        parseInt(t[13], 16) >>> 0, +t[14], +t[15], parseInt(t[16], 16) >>> 0, +t[17], parseInt(t[20], 16) >>> 0]);
    });
    return out;
  }

  /* ------------------------------------------------------------ testbench + waveform */
  const WAVE_LABEL = id => id === "mips_cpu" ? "mips_cpu.vcd · tb_mips_cpu.v" : `${id}.vcd · tb_program.v`;
  const wave = new WaveViewer($("#wave"), {
    onSource: id => { state.waveCustom = false; loadWave(id); },
    onCustom: () => { state.waveKey = null; state.waveCustom = true; syncWave(); },
    onCycle: k => gotoCycle(k),
  });
  function loadWave(id) {
    if (!window.VCD_FILES || !VCD_FILES[id]) return;
    state.waveKey = id;
    wave.setSources(Object.keys(VCD_FILES).map(k => ({ id: k, label: WAVE_LABEL(k) })), id);
    wave.load(VCD_FILES[id], `simulation/${id}.vcd`);
    syncWave();
  }
  function waveLinked() {
    const s = SAMPLE_PROGRAMS.find(p => p.id === state.sampleId);
    return !!(state.waveKey && s && s.id === state.waveKey && s.source === editor.value && state.machine);
  }
  function syncWave() {
    if (!wave.vcd) return;
    const on = waveLinked();
    wave.setLinked(on, on ? `Linked to simulator · ${state.lastRec ? "cycle " + state.lastRec.cycle : "click a cycle"}` : "");
    wave.setCycle(on && state.lastRec ? state.lastRec.cycle : null, on);
  }
  // jump the simulator to clock cycle k (used by the waveform)
  function gotoCycle(k) {
    if (!state.prog) return;
    stop(); resetMachine();
    while (!state.machine.halted && state.machine.cycles <= k) stepOnce({ render: false });
    if (state.lastRec) renderAfterStep(state.lastRec, false);
  }
  const tbView = new TestbenchView($("#testbench"), {
    onWave: id => { state.waveCustom = false; loadWave(id); switchTab("wave"); },
    onProgram: id => { const p = SAMPLE_PROGRAMS.find(x => x.id === id); if (p) loadSource(p.source, p.id + ".asm", p.id); },
  });

  /* ------------------------------------------------------------ tabs & panels */
  function switchTab(name) {
    $$("#drawerTabs .tab").forEach(t => t.classList.toggle("on", t.dataset.tab === name));
    $$(".tab-page").forEach(p => p.classList.toggle("on", p.dataset.page === name));
    moveInk();
    store.set("tab", name);
    if (document.body.classList.contains("drawer-min")) toggleDrawer(false);
    if (name === "wave") requestAnimationFrame(() => wave.draw());
    if (name === "timeline") { const p = $('[data-page="timeline"]'); setTimeout(() => p.scrollTo({ top: p.scrollHeight, left: p.scrollWidth, behavior: "smooth" }), 50); }
  }
  function moveInk() {
    const on = $("#drawerTabs .tab.on"), ink = $("#tabInk");
    if (!on) return;
    ink.style.left = on.offsetLeft + "px"; ink.style.width = on.offsetWidth + "px";
  }
  $$("#drawerTabs .tab").forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));
  window.addEventListener("resize", moveInk);

  function toggleDrawer(force) {
    const min = typeof force === "boolean" ? force : !document.body.classList.contains("drawer-min");
    document.body.classList.toggle("drawer-min", min);
    store.set("drawerMin", min);
  }
  $("#drawerToggle").addEventListener("click", () => toggleDrawer());

  $$(".panel").forEach(p => {
    const key = "panel:" + p.dataset.panel;
    if (store.get(key, false)) p.classList.add("collapsed");
    p.querySelector(".panel-head").addEventListener("click", () => {
      p.classList.toggle("collapsed"); store.set(key, p.classList.contains("collapsed"));
    });
  });

  /* splitters */
  function dragSplit(el, onMove) {
    el.addEventListener("pointerdown", e => {
      e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add("drag"); document.body.classList.add("dragging");
      const mv = ev => onMove(ev);
      const up = () => { el.classList.remove("drag"); document.body.classList.remove("dragging"); el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); };
      el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up);
    });
  }
  dragSplit($("#splitV"), e => {
    const w = Math.max(280, Math.min(window.innerWidth - 420, e.clientX - 12));
    document.documentElement.style.setProperty("--left-w", w + "px"); store.set("leftW", w);
  });
  dragSplit($("#splitH"), e => {
    document.body.classList.remove("drawer-min");
    const h = Math.max(120, Math.min(window.innerHeight - 220, window.innerHeight - e.clientY - 12));
    document.documentElement.style.setProperty("--drawer-h", h + "px"); store.set("drawerH", h);
    moveInk();
  });
  if (store.get("leftW")) document.documentElement.style.setProperty("--left-w", store.get("leftW") + "px");
  if (store.get("drawerH")) document.documentElement.style.setProperty("--drawer-h", store.get("drawerH") + "px");
  if (store.get("drawerMin", false)) document.body.classList.add("drawer-min");

  /* ------------------------------------------------------------ controls */
  $("#btnStep").addEventListener("click", () => { stop(); stepOnce(); });
  $("#btnBack").addEventListener("click", back);
  $("#btnRun").addEventListener("click", () => state.running ? (stop(), setStatus("paused")) : run());
  $("#btnEnd").addEventListener("click", runToEnd);
  $("#btnReset").addEventListener("click", () => { resetMachine(); toast("Processor reset: PC = 0, registers and memory reloaded", "info", 1800); });
  const sp = $("#speed");
  sp.value = state.speed; $("#speedVal").textContent = state.speed + "/s";
  sp.addEventListener("input", () => { state.speed = +sp.value; $("#speedVal").textContent = sp.value + "/s"; store.set("speed", state.speed); });

  const modal = $("#helpModal");
  $("#helpBtn").addEventListener("click", () => modal.classList.remove("hidden"));
  modal.addEventListener("click", e => { if (e.target === modal || e.target.closest("[data-close]")) modal.classList.add("hidden"); });

  document.addEventListener("keydown", e => {
    const inEditor = document.activeElement === $("#source");
    if (e.key === "Escape") { modal.classList.add("hidden"); if (inEditor) $("#source").blur(); return; }
    if (e.key === "F10" && e.shiftKey) { e.preventDefault(); back(); return; }
    if (e.key === "F10") { e.preventDefault(); if (!$("#btnStep").disabled) { stop(); stepOnce(); } return; }
    if (e.key === "F5") { e.preventDefault(); $("#btnRun").click(); return; }
    if (e.key === "F8") { e.preventDefault(); runToEnd(); return; }
    if (inEditor || e.metaKey || e.ctrlKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === "ArrowRight") { e.preventDefault(); if (!$("#btnStep").disabled) { stop(); stepOnce(); } }
    else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    else if (e.key === " ") { e.preventDefault(); $("#btnRun").click(); }
    else if (e.key === "r" || e.key === "R") resetMachine();
    else if (["1", "2", "3", "4", "5", "6"].includes(e.key)) switchTab(["conversion", "listing", "timeline", "verify", "testbench", "wave"][+e.key - 1]);
    else if (e.key === "?") modal.classList.remove("hidden");
  });

  /* ------------------------------------------------------------ boot */
  fillProgramSelect();
  tbView.render();
  const first = SAMPLE_PROGRAMS[0];
  state.sampleId = first.id; state.fileName = first.id + ".asm";
  $("#fileName").textContent = state.fileName;
  $("#programSelect").value = first.id;
  editor.value = first.source;
  assemble(true);
  switchTab(store.get("tab", "conversion"));
  requestAnimationFrame(moveInk);
  window.__mipsUI = { state, stepOnce, back, run, stop, runToEnd, resetMachine, loadSource, selectAddr, switchTab, wave, loadWave, gotoCycle };
})();
