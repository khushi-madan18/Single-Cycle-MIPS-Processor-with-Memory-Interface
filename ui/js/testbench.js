/*
 * testbench.js - "Testbench" tab: every Verilog testbench of the project, its
 * source, what it checks, the exact console output recorded from Icarus
 * Verilog and a link to its VCD waveform (ui/data/sim_results.js).
 */
(function () {
  "use strict";
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const KW = new Set(("module endmodule input output inout wire reg integer parameter localparam assign always initial begin end if else case casez " +
    "endcase default for while repeat forever posedge negedge or and not task endtask function endfunction generate endgenerate genvar").split(" "));
  function hlVerilog(src) {
    return src.split("\n").map(line => {
      let out = "", i = 0;
      while (i < line.length) {
        const rest = line.slice(i);
        let m;
        if (rest.startsWith("//")) { out += `<span class="c">${esc(rest)}</span>`; break; }
        if ((m = /^"(?:[^"\\]|\\.)*"/.exec(rest))) { out += `<span class="s">${esc(m[0])}</span>`; i += m[0].length; continue; }
        if ((m = /^\$\w+/.exec(rest))) { out += `<span class="sys">${esc(m[0])}</span>`; i += m[0].length; continue; }
        if ((m = /^`\w+/.exec(rest))) { out += `<span class="pp">${esc(m[0])}</span>`; i += m[0].length; continue; }
        if ((m = /^(\d+)?'[sS]?[bBhHdDoO][0-9a-fA-FxXzZ_]+|^\d[\d_]*/.exec(rest))) { out += `<span class="n">${esc(m[0])}</span>`; i += m[0].length; continue; }
        if ((m = /^[A-Za-z_]\w*/.exec(rest))) { out += KW.has(m[0]) ? `<span class="k">${m[0]}</span>` : esc(m[0]); i += m[0].length; continue; }
        out += esc(line[i]); i++;
      }
      return out;
    }).join("\n");
  }

  function hlLog(log) {
    return log.split("\n").map(l => {
      const e = esc(l);
      if (/\bFAIL|FAILED|did NOT/.test(l)) return `<span class="lf">${e}</span>`;
      if (/\bPASS|PASSED|halted after/.test(l)) return `<span class="lp">${e}</span>`;
      if (/^=+|^cycle \d+/.test(l)) return `<span class="lh">${e}</span>`;
      if (/VCD info|\$finish/.test(l)) return `<span class="lm">${e}</span>`;
      return e;
    }).join("\n");
  }

  const LEVEL_COL = { Unit: "#0ea5e9", System: "#a855f7", Program: "#22c55e" };

  class TestbenchView {
    constructor(root, opts) {
      this.root = root; this.opts = opts || {};
      this.sel = 0; this.sub = "log";
      this.data = window.SIM_RESULTS;
      this.root.addEventListener("click", e => this.onClick(e));
    }

    onClick(e) {
      const card = e.target.closest("[data-tb]");
      if (card) { this.sel = +card.dataset.tb; this.sub = "log"; this.render(); return; }
      const sub = e.target.closest("[data-sub]");
      if (sub) { this.sub = sub.dataset.sub; this.render(); return; }
      const w = e.target.closest("[data-wave]");
      if (w && this.opts.onWave) { this.opts.onWave(w.dataset.wave); return; }
      const p = e.target.closest("[data-prog]");
      if (p && this.opts.onProgram) { this.opts.onProgram(p.dataset.prog); return; }
      if (e.target.closest("[data-reglog]")) { this.sel = -1; this.render(); }
    }

    checksOf(tb) {
      if (tb.vectors) return `${tb.vectors.length} checks`;
      if (tb.id === "tb_control_unit") return `${(tb.log.match(/\bPASS\b/g) || []).length} opcodes`;
      if (tb.id === "tb_mips_cpu") return `${(tb.log.match(/\bPASS\b/g) || []).length} checks`;
      if (tb.result) return tb.result.replace(/(\d+) instr, /, "").replace(" EXPECT checks", " EXPECT");
      return "";
    }

    render() {
      const d = this.data;
      if (!d) { this.root.innerHTML = `<div class="empty">No testbench results found (ui/data/sim_results.js). Run <code>python3 tools/export_sim_results.py</code>.</div>`; return; }
      const allOk = d.passed === d.total && d.total > 0;
      const sum = `<div class="verify-sum ${allOk ? "ok" : "bad"}">
        <span class="big">${d.passed}/${d.total}</span>
        <div class="grow"><b>${allOk ? "Full regression passed: every testbench and cross-check" : "Some tests failed"}</b>
        <p>${esc(d.tool)} · recorded ${esc(d.date)} · <code>make test</code> runs ${d.testbenches.length} Verilog testbench runs plus the web-UI and Logisim cross-checks. Click a testbench to see its code, its console output and its waveform.</p></div>
        <button class="btn soft" data-reglog><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>Regression log</button></div>`;
      const list = d.testbenches.map((tb, k) => `
        <button class="tb-card${k === this.sel ? " on" : ""}" data-tb="${k}">
          <span class="lvl" style="--c:${LEVEL_COL[tb.level]}">${tb.level}</span>
          <span class="tb-t"><b>${esc(tb.program ? tb.program + ".asm" : tb.file.split("/").pop())}</b><small>${esc(tb.program ? "tb_program.v · " + tb.title : tb.title)}</small><small class="tb-n">${esc(this.checksOf(tb))}</small></span>
          <span class="res ${tb.ok ? "ok" : "bad"}">${tb.ok ? "PASS" : "FAIL"}</span>
        </button>`).join("");
      let detail;
      if (this.sel < 0) {
        detail = `<div class="tb-dh"><div><h3>Full regression · <code>python3 tools/run_tests.py</code></h3>
          <p class="muted">Unit tests, the system test, 4 programs compared cycle by cycle with the golden model, the web-UI model vs RTL and the Logisim circuit vs RTL.</p></div></div>
          <pre class="console">${hlLog(d.regression)}</pre>`;
      } else {
        const tb = d.testbenches[this.sel];
        const subs = [["log", "Console output"]];
        if (tb.vectors) subs.push(["vec", `Test vectors (${tb.vectors.length})`]);
        if (tb.expects) subs.push(["chk", "Checks"]);
        subs.push(["src", "Testbench code"], ["cmd", "How to run"]);
        if (!subs.find(s => s[0] === this.sub)) this.sub = "log";
        let body = "";
        if (this.sub === "log") body = `<pre class="console">${hlLog(tb.log)}</pre>`;
        else if (this.sub === "src") body = `<pre class="console code">${hlVerilog(tb.source)}</pre>`;
        else if (this.sub === "cmd") body = `<pre class="console">${esc(tb.cmd)}</pre><p class="muted">Run from the repository root with Icarus Verilog. <code>make test</code> runs all of them.</p>`;
        else if (this.sub === "vec") body = this.vectorTable(tb);
        else if (this.sub === "chk") body = `<table class="vt tb-vt"><thead><tr><th>Check</th><th>Expected</th><th>Result</th></tr></thead><tbody>
            <tr><td>Every clock cycle vs Python golden model</td><td>PC, instruction, 8 control signals, ALUOp, ALU control, ALU result, zero, write register, write-back, MemWrite, store data, next PC</td><td class="ok">✓ ${esc((tb.result.match(/(\d+) cycles/) || ["", "?"])[1])} cycles match</td></tr>
            <tr><td>Final state vs golden model</td><td>all 32 registers and 256 data-memory words</td><td class="ok">✓ match</td></tr>
            ${tb.expects.map(x => `<tr><td><code># EXPECT</code></td><td><code>${esc(x)}</code></td><td class="${tb.ok ? "ok" : "bad"}">${tb.ok ? "✓ pass" : "✗"}</td></tr>`).join("")}
          </tbody></table>`;
        detail = `<div class="tb-dh"><div>
            <h3><span class="lvl" style="--c:${LEVEL_COL[tb.level]}">${tb.level}</span> ${esc(tb.title)} <span class="res ${tb.ok ? "ok" : "bad"}">${tb.ok ? "PASS" : "FAIL"}</span></h3>
            <p>${esc(tb.what)}</p>
            <p class="muted">Testbench <code>${esc(tb.file)}</code> · design under test <code>${tb.dut.map(esc).join("</code> <code>")}</code></p></div>
            <div class="tb-act">${tb.vcd ? `<button class="btn soft" data-wave="${tb.vcd}"><svg viewBox="0 0 24 24"><path d="M3 12h3l3-7 4 14 3-7h5"/></svg>Open waveform</button>` : ""}
            ${tb.program ? `<button class="btn soft" data-prog="${tb.program}"><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>Load in simulator</button>` : ""}</div></div>
          <div class="seg tb-sub">${subs.map(([k, l]) => `<button data-sub="${k}" class="${k === this.sub ? "on" : ""}">${l}</button>`).join("")}</div>
          ${body}`;
      }
      this.root.innerHTML = sum + `<div class="tb-grid"><div class="tb-list">${list}</div><div class="tb-detail">${detail}</div></div>`;
    }

    vectorTable(tb) {
      const vs = tb.vectors, mark = tb.ok ? `<td class="ok">✓ pass</td>` : `<td class="bad">see log</td>`;
      const alu = vs.filter(v => v.kind === "alu"), ac = vs.filter(v => v.kind === "ac");
      const lit = s => esc(s.replace(/^32'h/, "0x").replace(/^32'd/, "").replace(/_/g, ""));
      return `<table class="vt tb-vt"><thead><tr><th>#</th><th>ALU op</th><th>ALU control</th><th>a</th><th>b</th><th>Expected result</th><th>Zero</th><th>Note</th><th>Result</th></tr></thead><tbody>
        ${alu.map((v, i) => `<tr><td>${i + 1}</td><td><b>${v.op}</b></td><td>${v.ctl}</td><td>${lit(v.a)}</td><td>${lit(v.b)}</td><td>${lit(v.exp)}</td><td>${v.zero}</td><td class="muted">${esc(v.note)}</td>${mark}</tr>`).join("")}
        </tbody></table>
        <table class="vt tb-vt" style="margin-top:12px"><thead><tr><th>#</th><th>ALUOp</th><th>funct</th><th>Expected ALU control</th><th>Instruction</th><th>Result</th></tr></thead><tbody>
        ${ac.map((v, i) => `<tr><td>${alu.length + i + 1}</td><td>${v.aluop}</td><td>${v.funct}</td><td>${v.exp}</td><td class="muted">${esc(v.note)}</td>${mark}</tr>`).join("")}
        </tbody></table>
        <p class="muted">The testbench prints only failures; the recorded run ended with <code>${esc((tb.log.match(/ALL \d+ ALU TESTS PASSED|\d+ of \d+ ALU TESTS FAILED/) || ["?"])[0])}</code>.</p>`;
    }
  }

  window.TestbenchView = TestbenchView;
})();
