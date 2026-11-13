/*
 * datapath.js - animated SVG of the single-cycle MIPS datapath.
 * Every wire knows its pipeline stage (for the staged animation) and a rule
 * that says whether the current instruction uses it.
 */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const STAGES = ["IF", "ID", "EX", "MEM", "WB"];
  const pts = a => "M" + a.map(p => p.join(" ")).join(" L");

  // flags derived from one execution record
  function flags(r) {
    const known = r.op in MIPS.CONTROL;
    const isR = r.op === 0;
    const usesRs = known && !r.jump;
    const readsRt = known && (isR || r.branch || r.mem_write);
    return { known, isR, usesRs, readsRt };
  }

  const WIRES = [
    // IF
    { id: "pc_out", st: "IF", d: [[80, 290], [120, 290]], on: () => true },
    { id: "pc_add", st: "IF", d: [[104, 290], [104, 57], [140, 57]], on: () => true },
    { id: "four", st: "IF", d: [[124, 99], [140, 99]], on: () => true },
    { id: "instr", st: "IF", d: [[240, 290], [270, 290]], on: () => true, bus: 1 },
    { id: "pc4", st: "IF", d: [[180, 78], [700, 78]], on: () => true },
    // ID
    { id: "trunk", st: "ID", d: [[270, 30], [270, 478]], on: () => true, bus: 1 },
    { id: "op", st: "ID", d: [[270, 170], [300, 170]], on: () => true },
    { id: "rs", st: "ID", d: [[270, 255], [520, 255]], on: (r, f) => f.usesRs },
    { id: "rt", st: "ID", d: [[270, 285], [520, 285]], on: (r, f) => f.readsRt },
    { id: "rt_dst", st: "ID", d: [[270, 285], [300, 285], [300, 334], [466, 334]], on: r => r.reg_write && !r.reg_dst },
    { id: "rd", st: "ID", d: [[270, 366], [466, 366]], on: r => r.reg_write && r.reg_dst },
    { id: "wreg", st: "ID", d: [[488, 350], [520, 350]], on: r => r.reg_write },
    { id: "imm_in", st: "ID", d: [[270, 445], [548, 445]], on: r => r.alu_src || r.branch },
    { id: "funct", st: "ID", d: [[270, 478], [735, 478], [735, 460], [750, 460]], on: (r, f) => f.isR },
    { id: "jaddr", st: "ID", d: [[270, 30], [380, 30]], on: r => r.jump },
    { id: "rd1", st: "ID", d: [[650, 269], [752, 269]], on: (r, f) => f.usesRs },
    { id: "rd2", st: "ID", d: [[650, 335], [692, 335]], on: (r, f) => f.readsRt && !r.alu_src },
    // EX
    { id: "imm_out", st: "EX", d: [[632, 445], [678, 445]], on: r => r.alu_src || r.branch },
    { id: "imm_alu", st: "EX", d: [[678, 445], [678, 375], [692, 375]], on: r => r.alu_src },
    { id: "imm_shift", st: "EX", d: [[678, 445], [678, 203]], on: r => r.branch },
    { id: "shift_badd", st: "EX", d: [[678, 177], [678, 120], [700, 120]], on: r => r.branch },
    { id: "alub", st: "EX", d: [[714, 355], [752, 355]], on: (r, f) => f.usesRs },
    { id: "aluctl", st: "EX", d: [[790, 444], [790, 358]], on: (r, f) => f.usesRs },
    { id: "jtarget", st: "EX", d: [[454, 30], [912, 30], [912, 64], [930, 64]], on: r => r.jump },
    { id: "badd_out", st: "EX", d: [[742, 99], [770, 99], [770, 122], [800, 122]], on: r => r.branch },
    { id: "zero", st: "EX", d: [[812, 295], [828, 295], [828, 212], [760, 212], [760, 180], [772, 180]], on: r => r.branch },
    { id: "and_out", st: "EX", d: [[802, 173], [811, 173], [811, 138]], on: r => r.branch },
    { id: "alu_res", st: "EX", d: [[812, 327], [840, 327]], on: (r, f) => f.usesRs && !r.branch },
    // MEM
    { id: "alu_mem", st: "MEM", d: [[840, 327], [868, 327]], on: r => r.mem_read || r.mem_write },
    { id: "rd2_mem", st: "MEM", d: [[650, 335], [668, 335], [668, 425], [848, 425], [848, 375], [868, 375]], on: r => r.mem_write },
    { id: "mem_rd", st: "MEM", d: [[983, 320], [1012, 320]], on: r => r.mem_read },
    { id: "alu_bypass", st: "MEM", d: [[840, 327], [840, 440], [1000, 440], [1000, 400], [1012, 400]], on: r => r.reg_write && !r.mem_to_reg },
    // WB
    { id: "wb", st: "WB", d: [[1034, 358], [1060, 358], [1060, 505], [505, 505], [505, 378], [520, 378]], on: r => r.reg_write },
    { id: "pc4_pcsrc", st: "WB", d: [[686, 78], [686, 48], [786, 48], [786, 74], [800, 74]], on: r => !r.jump && !r.takeBranch },
    { id: "pcsrc_out", st: "WB", d: [[822, 98], [870, 98], [870, 118], [930, 118]], on: r => !r.jump },
    { id: "npc", st: "WB", d: [[952, 91], [1078, 91], [1078, 10], [14, 10], [14, 290], [36, 290]], on: () => true },
  ];

  const adder = (x, y, w, h) => `M${x} ${y} L${x + w} ${y + h * .3} L${x + w} ${y + h * .7} L${x} ${y + h} L${x} ${y + h * .6} L${x + w * .25} ${y + h * .5} L${x} ${y + h * .4} Z`;
  const alu = (x, y, w, h) => `M${x} ${y} L${x + w} ${y + h * .3} L${x + w} ${y + h * .7} L${x} ${y + h} L${x} ${y + h * .58} L${x + w * .22} ${y + h * .5} L${x} ${y + h * .42} Z`;
  const muxPath = (x, y, w, h) => `M${x} ${y + w / 2} A${w / 2} ${w / 2} 0 0 1 ${x + w} ${y + w / 2} L${x + w} ${y + h - w / 2} A${w / 2} ${w / 2} 0 0 1 ${x} ${y + h - w / 2} Z`;

  function mux(id, x, y, w, h, in0y, in1y, flip) {
    return `<g class="block mux" id="b_${id}" data-tip="${id}">
      <path d="${muxPath(x, y, w, h)}"/>
      <text class="m0" x="${x + w / 2}" y="${in0y + 3}" text-anchor="middle">${flip ? 1 : 0}</text>
      <text class="m1" x="${x + w / 2}" y="${in1y + 3}" text-anchor="middle">${flip ? 0 : 1}</text>
    </g>`;
  }
  function tag(id, label, x, y, sx, sy, ex, ey) {
    const w = label.length * 5.4 + 22;
    return `<line class="ctl" id="cw_${id}" x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}"/>
      <g class="ctl-tag" id="ct_${id}"><rect x="${x - w / 2}" y="${y - 8}" width="${w}" height="16" rx="8"/>
      <text x="${x}" y="${y + 3}" text-anchor="middle"><tspan>${label}</tspan> <tspan class="tv">0</tspan></text></g>`;
  }
  function val(id, x, y) {
    return `<g class="val off" id="v_${id}" data-x="${x}" data-y="${y}"><rect x="${x}" y="${y - 8}" width="10" height="16" rx="5"/><text x="${x}" y="${y + 3}" text-anchor="middle"></text></g>`;
  }
  const lbl = (x, y, t, anchor = "start") => `<text class="wlabel" x="${x}" y="${y}" text-anchor="${anchor}">${t}</text>`;

  function buildSVG() {
    const ctrlRows = ["reg_dst", "alu_src", "mem_to_reg", "reg_write", "mem_read", "mem_write", "branch", "jump", "alu_op"]
      .map((k, i) => `<g class="ctrl-row" id="cr_${k}"><text class="k" x="314" y="${135 + i * 11.6}">${MIPS.CTRL_LABEL[k]}</text><text class="v" x="436" y="${135 + i * 11.6}" text-anchor="end">0</text></g>`).join("");
    return `<svg class="dp" viewBox="0 0 1100 520" xmlns="${NS}" role="img" aria-label="Single-cycle MIPS datapath">
      <g id="wires">${WIRES.map(w => `<path class="wire${w.bus ? " bus" : ""}" id="w_${w.id}" d="${pts(w.d)}"/>`).join("")}</g>
      <g class="dots">
        ${[[104, 290], [686, 78], [300, 285], [668, 335], [678, 445], [678, 375], [840, 327]].map(p => `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="3"/>`).join("")}
      </g>
      ${lbl(276, 24, "[25:0]")}${lbl(276, 164, "[31:26]")}${lbl(276, 249, "[25:21] rs")}${lbl(304, 279, "[20:16] rt")}
      ${lbl(276, 360, "[15:11] rd")}${lbl(276, 439, "[15:0] imm")}${lbl(276, 472, "[5:0] funct")}
      ${lbl(560, 23, "jump target = {PC+4[31:28], addr × 4}", "middle")}${lbl(118, 103, "4", "middle")}
      ${lbl(14, 6, "next PC", "start")}

      <!-- blocks -->
      <g class="block" id="b_pc" data-tip="pc"><rect x="36" y="250" width="44" height="80" rx="6"/><text x="58" y="294" text-anchor="middle">PC</text></g>
      <g class="block" id="b_add4" data-tip="add4"><path d="${adder(140, 43, 40, 70)}"/><text x="166" y="82" text-anchor="middle" font-size="9">Add</text></g>
      <g class="block" id="b_imem" data-tip="imem"><rect x="120" y="225" width="120" height="130" rx="8"/>
        <text x="180" y="276" text-anchor="middle">Instruction</text><text x="180" y="290" text-anchor="middle">Memory</text>
        <text class="port" x="124" y="304">Read addr</text><text class="port" x="236" y="304" text-anchor="end">Instr[31:0]</text></g>
      <g class="block" id="b_ctrl" data-tip="ctrl"><rect x="300" y="100" width="150" height="140" rx="16"/><text x="375" y="118" text-anchor="middle">Control Unit</text>${ctrlRows}</g>
      <g class="block" id="b_rf" data-tip="rf"><rect x="520" y="228" width="130" height="165" rx="8"/>
        <text x="585" y="312" text-anchor="middle">Registers</text>
        <text class="port" x="525" y="258">Read reg 1</text><text class="port" x="525" y="288">Read reg 2</text>
        <text class="port" x="525" y="353">Write reg</text><text class="port" x="525" y="381">Write data</text>
        <text class="port" x="645" y="272" text-anchor="end">Read data 1</text><text class="port" x="645" y="338" text-anchor="end">Read data 2</text></g>
      <g class="block" id="b_sext" data-tip="sext"><ellipse cx="590" cy="445" rx="42" ry="17"/><text x="590" y="442" text-anchor="middle" font-size="9">Sign</text><text x="590" y="452" text-anchor="middle" font-size="9">extend</text></g>
      <g class="block" id="b_shift" data-tip="shift"><ellipse cx="678" cy="190" rx="30" ry="13"/><text x="678" y="193" text-anchor="middle" font-size="8.5">Shift ≪2</text></g>
      <g class="block" id="b_jshift" data-tip="jshift"><rect x="380" y="20" width="74" height="20" rx="10"/><text x="417" y="33" text-anchor="middle" font-size="8.5">Shift ≪2</text></g>
      <g class="block" id="b_badd" data-tip="badd"><path d="${adder(700, 64, 42, 70)}"/><text x="727" y="103" text-anchor="middle" font-size="9">Add</text></g>
      <g class="block" id="b_and" data-tip="and"><path d="M772 158 H787 A15 15 0 0 1 787 188 H772 Z"/><text x="786" y="176" text-anchor="middle" font-size="8">AND</text></g>
      <g class="block" id="b_alu" data-tip="alu"><path d="${alu(752, 240, 60, 145)}"/><text x="790" y="316" text-anchor="middle">ALU</text>
        <text class="port" x="808" y="292" text-anchor="end">zero</text><text class="port" x="808" y="338" text-anchor="end">result</text></g>
      <g class="block" id="b_aluctl" data-tip="aluctl"><ellipse cx="790" cy="460" rx="40" ry="16"/><text x="790" y="457" text-anchor="middle" font-size="9">ALU</text><text x="790" y="467" text-anchor="middle" font-size="9">control</text></g>
      <g class="block" id="b_dmem" data-tip="dmem"><rect x="868" y="265" width="115" height="130" rx="8"/>
        <text x="925" y="345" text-anchor="middle">Data</text><text x="925" y="359" text-anchor="middle">Memory</text>
        <text class="port" x="872" y="330">Address</text><text class="port" x="872" y="378">Write data</text><text class="port" x="979" y="323" text-anchor="end">Read data</text></g>
      ${mux("regdst", 466, 322, 22, 56, 334, 366)}
      ${mux("alusrc", 692, 318, 22, 74, 335, 375)}
      ${mux("mtr", 1012, 300, 22, 116, 400, 320)}
      ${mux("pcsrc", 800, 58, 22, 80, 74, 122)}
      ${mux("jmux", 930, 48, 22, 86, 118, 64)}

      <!-- control signal tags -->
      ${tag("reg_dst", "RegDst", 477, 304, 477, 312, 477, 322)}
      ${tag("reg_write", "RegWrite", 585, 212, 585, 220, 585, 228)}
      ${tag("alu_src", "ALUSrc", 703, 300, 703, 308, 703, 318)}
      ${tag("alu_op", "ALUOp", 790, 492, 790, 484, 790, 476)}
      ${tag("mem_write", "MemWrite", 925, 249, 925, 257, 925, 265)}
      ${tag("mem_read", "MemRead", 925, 411, 925, 403, 925, 395)}
      ${tag("mem_to_reg", "MemtoReg", 1023, 284, 1023, 292, 1023, 300)}
      ${tag("branch", "Branch", 722, 166, 744, 166, 772, 166)}
      ${tag("jump", "Jump", 941, 152, 941, 144, 941, 134)}

      <!-- live values -->
      ${val("pc", 100, 277)}${val("pc4", 430, 66)}${val("instr", 180, 372)}${val("rd1", 704, 257)}
      ${val("rd2", 664, 322)}${val("imm", 590, 480)}${val("res", 846, 312)}${val("zero", 860, 212)}
      ${val("mdata", 1000, 306)}${val("wb", 780, 505)}${val("npc", 560, 10)}${val("bt", 721, 147)}${val("jt", 680, 30)}
      <g id="packets"></g>
    </svg>`;
  }

  const TIPS = {
    pc: ["Program Counter", "pc.v", "32-bit register holding the address of the current instruction. Loads next PC on every rising clock edge; synchronous reset to 0."],
    add4: ["PC + 4 adder", "branch_jump_logic.v", "Computes the address of the next sequential instruction (instructions are 4 bytes)."],
    imem: ["Instruction Memory", "instruction_memory.v", "256 × 32-bit ROM, asynchronous read. Address bits [9:2] select the word."],
    ctrl: ["Main Control Unit", "control_unit.v", "Decodes the 6-bit opcode into the 9 control signals that steer the datapath."],
    rf: ["Register File", "register_file.v", "32 × 32-bit registers. Two asynchronous read ports (rs, rt), one write port on the clock edge. $zero is hard-wired to 0."],
    sext: ["Sign Extension", "sign_extension.v", "Copies bit 15 of the 16-bit immediate into bits 31..16 to form a 32-bit signed value."],
    shift: ["Shift left 2", "branch_jump_logic.v", "Multiplies the branch offset by 4 (word offset → byte offset)."],
    jshift: ["Jump shift", "branch_jump_logic.v", "Forms the jump target: {PC+4[31:28], instr[25:0], 00}."],
    badd: ["Branch target adder", "branch_jump_logic.v", "Branch target = PC + 4 + (sign-extended offset × 4)."],
    and: ["Branch decision", "branch_jump_logic.v", "Branch is taken when Branch = 1 AND the ALU Zero flag = 1 (rs − rt = 0)."],
    alu: ["ALU", "alu.v", "32-bit AND, OR, ADD, SUB, signed SLT. Zero flag is 1 when the result is 0."],
    aluctl: ["ALU Control", "alu_control.v", "Combines ALUOp from the control unit with the funct field to pick the ALU operation."],
    dmem: ["Data Memory", "data_memory.v", "256 × 32-bit RAM. Asynchronous read when MemRead = 1, write on the clock edge when MemWrite = 1."],
    regdst: ["RegDst multiplexer", "mips_core.v", "Chooses the destination register: rt (I-type) or rd (R-type)."],
    alusrc: ["ALUSrc multiplexer", "mips_core.v", "Chooses the ALU's second operand: register rt or the sign-extended immediate."],
    mtr: ["MemtoReg multiplexer", "mips_core.v", "Chooses what is written back: the ALU result or the data loaded from memory."],
    pcsrc: ["PCSrc multiplexer", "branch_jump_logic.v", "Chooses PC + 4 or the branch target."],
    jmux: ["Jump multiplexer", "branch_jump_logic.v", "Chooses the jump target when Jump = 1."],
  };

  const shortHex = v => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(2, "0");

  class Datapath {
    constructor(container, opts = {}) {
      this.el = container;
      this.el.innerHTML = buildSVG();
      this.svg = this.el.querySelector("svg");
      this.packets = this.svg.querySelector("#packets");
      this.wireEls = {};
      WIRES.forEach(w => this.wireEls[w.id] = this.svg.querySelector("#w_" + w.id));
      this.stageStrip = opts.stageStrip;
      this.timers = [];
      this.rec = null;
      this.tooltip = opts.tooltip;
      this.svg.addEventListener("mousemove", e => this.tip(e));
      this.svg.addEventListener("mouseleave", () => this.tooltip && this.tooltip.classList.remove("show"));
    }

    tip(e) {
      const g = e.target.closest("[data-tip]");
      if (!g || !this.tooltip) { this.tooltip && this.tooltip.classList.remove("show"); return; }
      const [name, file, desc] = TIPS[g.dataset.tip];
      const live = this.liveInfo(g.dataset.tip);
      this.tooltip.innerHTML = `<b>${name}</b> · <code>${file}</code><br>${desc}${live ? `<br><br>${live}` : ""}`;
      const x = Math.min(e.clientX + 14, window.innerWidth - 320), y = Math.min(e.clientY + 14, window.innerHeight - 160);
      this.tooltip.style.left = x + "px"; this.tooltip.style.top = y + "px";
      this.tooltip.classList.add("show");
    }
    liveInfo(id) {
      const r = this.rec; if (!r) return "";
      const R = MIPS.REG_NAMES, H = MIPS.hex8, S = MIPS.s32;
      switch (id) {
        case "pc": return `This cycle: <code>0x${H(r.pc)}</code> → next <code>0x${H(r.nextPc)}</code>`;
        case "imem": return `Fetched <code>0x${H(r.instr)}</code> from word ${r.pc >>> 2}`;
        case "rf": return `Read ${R[r.rs]} = <code>${S(r.a)}</code>, ${R[r.rt]} = <code>${S(r.rd2)}</code>` + (r.reg_write ? `<br>Write ${R[r.writeReg]} ← <code>${S(r.writeBack)}</code>` : "");
        case "alu": return `${MIPS.ALU_NAME[r.aluCtrl]}(<code>${S(r.a)}</code>, <code>${S(r.b)}</code>) = <code>${S(r.aluResult)}</code>, zero = ${r.zero}`;
        case "aluctl": return `ALUOp ${MIPS.bin(r.alu_op, 2)} + funct ${MIPS.bin(r.funct, 6)} → ${MIPS.bin(r.aluCtrl, 4)} (${MIPS.ALU_NAME[r.aluCtrl]})`;
        case "sext": return `<code>${MIPS.bin(r.imm16, 16)}</code> → <code>0x${H(r.immExt)}</code> (${S(r.immExt)})`;
        case "dmem": return r.mem_read ? `Read [0x${H(r.aluResult)}] = <code>${S(r.memRdata)}</code>` : r.mem_write ? `Write [0x${H(r.aluResult)}] ← <code>${S(r.memWdata)}</code>` : "Not accessed this cycle";
        case "ctrl": return `opcode <code>${MIPS.bin(r.op, 6)}</code> (${MIPS.OPCODE_NAME[r.op] || "unknown"})`;
        case "badd": return `<code>0x${H(r.pc4)}</code> + (${MIPS.sext16(r.imm16)} × 4) = <code>0x${H(r.branchTarget)}</code>`;
        case "and": return `Branch ${r.branch} AND Zero ${r.zero} = <b>${r.takeBranch}</b>`;
        default: return "";
      }
    }

    clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; this.packets.innerHTML = ""; }

    setVal(id, text, show, animate) {
      const g = this.svg.querySelector("#v_" + id);
      if (!g) return;
      if (!show) { g.classList.add("off"); return; }
      const t = g.querySelector("text"), r = g.querySelector("rect");
      const x = +g.dataset.x, w = text.length * 5.5 + 12;
      t.textContent = text;
      r.setAttribute("x", x - w / 2); r.setAttribute("width", w);
      g.classList.remove("off");
      if (animate) { g.classList.remove("pop"); void g.getBBox(); g.classList.add("pop"); }
    }

    reset() {
      this.clearTimers();
      this.rec = null;
      this.svg.querySelectorAll(".wire").forEach(w => w.classList.remove("on", "flow"));
      this.svg.querySelectorAll(".block").forEach(b => b.classList.remove("on", "pulse"));
      this.svg.querySelectorAll(".val").forEach(v => v.classList.add("off"));
      this.svg.querySelectorAll(".ctl, .ctl-tag, .ctrl-row, .dot").forEach(c => c.classList.remove("on"));
      this.svg.querySelectorAll(".mux text").forEach(t => t.classList.remove("sel"));
      this.stageStrip && this.stageStrip.querySelectorAll("[data-stage]").forEach(s => s.classList.remove("on", "skip"));
    }

    /* Show one executed instruction. animate: staged animation; packets: moving dots */
    show(r, { animate = true, packets = true, stageMs = 230 } = {}) {
      this.reset();
      if (!r) return;
      this.rec = r;
      const f = flags(r);
      const H = MIPS.hex8, S = MIPS.s32;

      // control unit rows + tags (decoded in ID)
      const ctrlApply = () => {
        MIPS.CTRL_KEYS.concat("alu_op").forEach(k => {
          const v = r[k];
          const on = k === "alu_op" ? true : !!v;
          const row = this.svg.querySelector("#cr_" + k);
          row.classList.toggle("on", !!v);
          row.querySelector(".v").textContent = k === "alu_op" ? MIPS.bin(v, 2) : v;
          const tg = this.svg.querySelector("#ct_" + k), cw = this.svg.querySelector("#cw_" + k);
          if (tg) {
            tg.querySelector(".tv").textContent = k === "alu_op" ? MIPS.bin(v, 2) : v;
            tg.classList.toggle("on", k === "alu_op" ? f.usesRs : !!v);
            cw.classList.toggle("on", k === "alu_op" ? f.usesRs : !!v);
          }
        });
        const sel = (id, one) => {
          const g = this.svg.querySelector("#b_" + id);
          g.querySelector(".m0").classList.toggle("sel", !one);
          g.querySelector(".m1").classList.toggle("sel", !!one);
        };
        sel("regdst", r.reg_dst); sel("alusrc", r.alu_src); sel("mtr", r.mem_to_reg);
        sel("pcsrc", r.takeBranch); sel("jmux", r.jump);
      };

      const blocksByStage = {
        IF: ["pc", "imem", "add4"],
        ID: ["ctrl", f.usesRs || r.reg_write ? "rf" : null, (r.alu_src || r.branch) ? "sext" : null, r.reg_write ? "regdst" : null, r.jump ? "jshift" : null],
        EX: [f.usesRs ? "alu" : null, f.usesRs ? "aluctl" : null, f.usesRs ? "alusrc" : null, r.branch ? "shift" : null, r.branch ? "badd" : null, r.branch ? "and" : null],
        MEM: [(r.mem_read || r.mem_write) ? "dmem" : null],
        WB: [r.reg_write ? "mtr" : null, r.reg_write ? "rf" : null, !r.jump ? "pcsrc" : null, "jmux", "pc"],
      };
      const stageUsed = { IF: true, ID: true, EX: f.usesRs || r.jump, MEM: !!(r.mem_read || r.mem_write), WB: !!r.reg_write || true };
      const vals = {
        IF: [["pc", shortHex(r.pc), true], ["pc4", shortHex(r.pc4), true], ["instr", H(r.instr), true]],
        ID: [["rd1", String(S(r.a)), f.usesRs], ["rd2", String(S(r.rd2)), f.readsRt], ["imm", String(MIPS.sext16(r.imm16)), r.alu_src || r.branch]],
        EX: [["res", String(S(r.aluResult)), f.usesRs], ["zero", "zero=" + r.zero, r.branch], ["bt", shortHex(r.branchTarget), r.branch], ["jt", shortHex(r.jumpTarget), r.jump]],
        MEM: [["mdata", String(S(r.memRdata)), r.mem_read]],
        WB: [["wb", `${MIPS.REG_NAMES[r.writeReg]} ← ${S(r.writeBack)}`, r.reg_write && r.writeReg !== 0], ["npc", "next PC " + shortHex(r.nextPc), true]],
      };

      const runStage = (st, i) => {
        const strip = this.stageStrip && this.stageStrip.querySelector(`[data-stage="${st}"]`);
        if (strip) { strip.classList.add("on"); strip.classList.toggle("skip", !stageUsed[st]); }
        if (st === "ID") ctrlApply();
        WIRES.filter(w => w.st === st).forEach(w => {
          if (!w.on(r, f)) return;
          const el = this.wireEls[w.id];
          el.classList.add("on", "flow");
          if (animate && packets) this.packet(w, stageMs);
        });
        blocksByStage[st].filter(Boolean).forEach(b => {
          const g = this.svg.querySelector("#b_" + b);
          g.classList.add("on");
          if (animate) { g.classList.remove("pulse"); void g.getBBox(); g.classList.add("pulse"); }
        });
        vals[st].forEach(([id, t, s]) => this.setVal(id, t, s, animate));
        // junction dots follow their wires
        const dotOn = [[104, 290, true], [686, 78, !r.jump && !r.takeBranch], [300, 285, r.reg_write && !r.reg_dst],
          [668, 335, r.mem_write], [678, 445, r.alu_src || r.branch], [678, 375, r.branch], [840, 327, f.usesRs && !r.branch]];
        this.svg.querySelectorAll(".dot").forEach((d, k) => d.classList.toggle("on", dotOn[k][2] && (st === "WB" || !animate)));
      };

      if (!animate) { STAGES.forEach(runStage); return; }
      STAGES.forEach((st, i) => this.timers.push(setTimeout(() => runStage(st, i), i * stageMs)));
    }

    packet(w, ms) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("r", w.bus ? 4.5 : 3.5);
      c.setAttribute("class", "packet");
      const am = document.createElementNS(NS, "animateMotion");
      am.setAttribute("dur", Math.max(0.18, ms / 1000 * 1.4) + "s");
      am.setAttribute("fill", "freeze");
      am.setAttribute("begin", "indefinite");
      am.setAttribute("path", pts(w.d));
      am.setAttribute("calcMode", "paced");
      c.appendChild(am);
      this.packets.appendChild(c);
      try { am.beginElement(); } catch (e) { /* older browsers */ }
      this.timers.push(setTimeout(() => c.remove(), ms * 1.4 + 120));
    }
  }

  window.Datapath = Datapath;
})();
