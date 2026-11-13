#!/usr/bin/env node
// check_ui_model.js - verifies that the UI's JavaScript assembler/model (ui/js/isa.js)
// produces exactly the same machine code as tools/mips_asm.py and exactly the same
// per-cycle behaviour as the Verilog simulation. Run: node tools/check_ui_model.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const MIPS = require(path.join(ROOT, "ui/js/isa.js"));
global.window = {};
require(path.join(ROOT, "ui/data/programs.js"));
require(path.join(ROOT, "ui/data/rtl_traces.js"));
const { SAMPLE_PROGRAMS, RTL_TRACES } = global.window;

let fails = 0;
for (const p of SAMPLE_PROGRAMS) {
  const errs = [];
  const prog = MIPS.assemble(p.source);
  const memWords = fs.readFileSync(path.join(ROOT, "programs", p.id + ".mem"), "utf8")
    .split("\n").map(l => l.split("//")[0].trim()).filter(Boolean).map(h => parseInt(h, 16) >>> 0);
  prog.text.forEach((t, i) => { if (t.word !== memWords[i]) errs.push(`word ${i}: js ${MIPS.hex8(t.word)} py ${MIPS.hex8(memWords[i])}`); });
  const m = new MIPS.Machine(prog.text.map(t => t.word), prog.data).run();
  const rtl = RTL_TRACES[p.id] || [];
  if (rtl.length !== m.trace.length) errs.push(`cycles: js ${m.trace.length} rtl ${rtl.length}`);
  m.trace.forEach((r, i) => {
    const t = rtl[i]; if (!t) return;
    const ctrl = MIPS.CTRL_KEYS.map(k => r[k]).join("");
    const mine = [r.pc, r.instr, ctrl, r.alu_op, r.aluCtrl, r.aluResult, r.zero, r.writeReg, r.writeBack, r.mem_write, r.nextPc];
    mine.forEach((v, k) => { if (v !== t[k] && errs.length < 10) errs.push(`cycle ${i} field ${k}: js ${v} rtl ${t[k]}`); });
  });
  MIPS.checkExpects(prog, m.regs, m.dmem).forEach(e => { if (!e.ok) errs.push(`EXPECT ${e.label}=${e.got} want ${e.expected}`); });
  console.log(`${errs.length ? "FAIL" : "PASS"}  ui model ${p.id} (${m.trace.length} cycles match RTL)`);
  errs.forEach(e => console.log("      " + e));
  fails += errs.length ? 1 : 0;
}
process.exit(fails ? 1 : 0);
