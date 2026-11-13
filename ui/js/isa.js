/*
 * isa.js - MIPS assembler, decoder and single-cycle reference model for the UI.
 * This is a line-by-line port of tools/mips_asm.py (same instruction set, same
 * control table, same encodings). tools/run_tests.py checks that both agree.
 * Works in the browser (window.MIPS) and in Node (module.exports).
 */
(function (root) {
  "use strict";

  const REG_NAMES = ["$zero", "$at", "$v0", "$v1", "$a0", "$a1", "$a2", "$a3",
    "$t0", "$t1", "$t2", "$t3", "$t4", "$t5", "$t6", "$t7",
    "$s0", "$s1", "$s2", "$s3", "$s4", "$s5", "$s6", "$s7",
    "$t8", "$t9", "$k0", "$k1", "$gp", "$sp", "$fp", "$ra"];
  const REG_NUM = {};
  REG_NAMES.forEach((n, i) => { REG_NUM[n] = i; REG_NUM["$" + i] = i; });
  REG_NUM["$s8"] = 30;

  const OPCODES = { rtype: 0b000000, lw: 0b100011, sw: 0b101011, beq: 0b000100, addi: 0b001000, j: 0b000010 };
  const FUNCTS = { add: 0b100000, sub: 0b100010, and: 0b100100, or: 0b100101, slt: 0b101010 };
  const FUNCT_NAME = {}; Object.keys(FUNCTS).forEach(k => FUNCT_NAME[FUNCTS[k]] = k);
  const OPCODE_NAME = { 0: "R-type", 35: "lw", 43: "sw", 4: "beq", 8: "addi", 2: "j" };

  // Control-unit truth table (same as src/control_unit.v)
  const C = (reg_dst, alu_src, mem_to_reg, reg_write, mem_read, mem_write, branch, jump, alu_op) =>
    ({ reg_dst, alu_src, mem_to_reg, reg_write, mem_read, mem_write, branch, jump, alu_op });
  const CONTROL = {
    0b000000: C(1, 0, 0, 1, 0, 0, 0, 0, 0b10),
    0b100011: C(0, 1, 1, 1, 1, 0, 0, 0, 0b00),
    0b101011: C(0, 1, 0, 0, 0, 1, 0, 0, 0b00),
    0b000100: C(0, 0, 0, 0, 0, 0, 1, 0, 0b01),
    0b001000: C(0, 1, 0, 1, 0, 0, 0, 0, 0b00),
    0b000010: C(0, 0, 0, 0, 0, 0, 0, 1, 0b00),
  };
  const NOP_CONTROL = C(0, 0, 0, 0, 0, 0, 0, 0, 0b00);
  const CTRL_KEYS = ["reg_dst", "alu_src", "mem_to_reg", "reg_write", "mem_read", "mem_write", "branch", "jump"];
  const CTRL_LABEL = { reg_dst: "RegDst", alu_src: "ALUSrc", mem_to_reg: "MemtoReg", reg_write: "RegWrite",
    mem_read: "MemRead", mem_write: "MemWrite", branch: "Branch", jump: "Jump", alu_op: "ALUOp" };

  const ALU = { AND: 0b0000, OR: 0b0001, ADD: 0b0010, SUB: 0b0110, SLT: 0b0111 };
  const ALU_NAME = { 0: "AND", 1: "OR", 2: "ADD", 6: "SUB", 7: "SLT" };
  const FUNCT_TO_ALU = { 0b100000: ALU.ADD, 0b100010: ALU.SUB, 0b100100: ALU.AND, 0b100101: ALU.OR, 0b101010: ALU.SLT };
  const MEM_WORDS = 256;

  const u32 = x => x >>> 0;
  const s32 = x => x | 0;
  const sext16 = x => { x &= 0xFFFF; return x & 0x8000 ? x - 0x10000 : x; };
  const hex8 = x => u32(x).toString(16).toUpperCase().padStart(8, "0");
  // unsigned binary string of the low n bits (n <= 32); avoids JS signed bitwise results
  const bin = (x, n) => (n >= 32 ? u32(x) : u32(x) % Math.pow(2, n)).toString(2).padStart(n, "0");

  class AsmError extends Error {
    constructor(msg, line) { super(msg); this.line = line; }
  }

  function stripComment(line) { return line.split(/#|\/\/|;/)[0].trim(); }

  function parseInt0(tok) {
    tok = String(tok).trim();
    let neg = false;
    if (tok.startsWith("-")) { neg = true; tok = tok.slice(1); } else if (tok.startsWith("+")) tok = tok.slice(1);
    let v;
    if (/^0x[0-9a-f]+$/i.test(tok)) v = parseInt(tok, 16);
    else if (/^0b[01]+$/i.test(tok)) v = parseInt(tok.slice(2), 2);
    else if (/^0o[0-7]+$/i.test(tok)) v = parseInt(tok.slice(2), 8);
    else if (/^\d+$/.test(tok)) v = parseInt(tok, 10);
    else throw new AsmError(`bad number '${tok}'`);
    return neg ? -v : v;
  }

  function parseExpect(text, line) {
    let m = text.match(/^\s*(\$\w+)\s*=\s*(\S+)\s*$/);
    if (m) return { kind: "reg", target: m[1].toLowerCase(), value: parseInt0(m[2]), line };
    m = text.match(/^\s*mem\[(.+?)\]\s*=\s*(\S+)\s*$/);
    if (m) return { kind: "mem", target: m[1].trim(), value: parseInt0(m[2]), line };
    throw new AsmError(`cannot parse EXPECT '${text}'`, line);
  }

  /* ------------------------------------------------------------------ */
  /* Assembler                                                           */
  /* ------------------------------------------------------------------ */
  function assemble(source) {
    const prog = { text: [], data: [], labels: {}, dataLabels: {}, expects: [], lineToAddr: {} };
    const lines = source.split(/\r?\n/);
    let section = "text";
    const pending = [];

    lines.forEach((raw, idx) => {
      const lineno = idx + 1;
      const em = raw.match(/^\s*#\s*EXPECT\s+(.*)$/i);
      if (em) { prog.expects.push(parseExpect(em[1], lineno)); return; }
      let line = stripComment(raw);
      if (!line) return;
      let m;
      while ((m = line.match(/^([A-Za-z_]\w*)\s*:\s*(.*)$/))) {
        const label = m[1]; line = m[2].trim();
        if (label in prog.labels || label in prog.dataLabels) throw new AsmError(`duplicate label '${label}'`, lineno);
        if (section === "text") prog.labels[label] = 4 * pending.length;
        else prog.dataLabels[label] = 4 * prog.data.length;
      }
      if (!line) return;
      if (line.startsWith(".")) {
        const parts = line.split(/\s+/);
        const d = parts[0].toLowerCase();
        const arg = line.slice(parts[0].length).trim();
        if (d === ".text") section = "text";
        else if (d === ".data") section = "data";
        else if (d === ".word") {
          if (section !== "data") throw new AsmError(".word only allowed in .data", lineno);
          arg.split(",").forEach(v => {
            try { prog.data.push(u32(parseInt0(v))); } catch (e) { throw new AsmError(e.message, lineno); }
          });
        } else if (d === ".space") {
          const n = parseInt0(arg); for (let i = 0; i < n; i++) prog.data.push(0);
        } else throw new AsmError(`unknown directive ${d}`, lineno);
        return;
      }
      if (section !== "text") throw new AsmError("instruction in .data section", lineno);
      const sp = line.search(/\s/);
      const mnem = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
      const ops = sp < 0 ? [] : line.slice(sp).split(",").map(s => s.trim()).filter(s => s.length);
      pending.push({ addr: 4 * pending.length, mnem, ops, text: line, line: lineno });
    });

    if (pending.length > MEM_WORDS) throw new AsmError(`program has ${pending.length} instructions; memory holds ${MEM_WORDS}`);
    if (prog.data.length > MEM_WORDS) throw new AsmError(`data has ${prog.data.length} words; memory holds ${MEM_WORDS}`);

    for (const p of pending) {
      let enc;
      try { enc = encode(p.mnem, p.ops, p.addr, prog); }
      catch (e) { throw new AsmError(e.message, p.line); }
      prog.text.push({ addr: p.addr, word: enc.word, asm: p.text, line: p.line, mnem: p.mnem, ops: p.ops,
        fields: enc.fields, steps: enc.steps });
      prog.lineToAddr[p.line] = p.addr;
    }
    return prog;
  }

  function reg(tok, steps) {
    const t = tok.trim().toLowerCase();
    if (!(t in REG_NUM)) throw new AsmError(`unknown register '${tok}'`);
    steps && steps.push({ token: tok.trim(), kind: "register", value: REG_NUM[t],
      note: `register ${REG_NAMES[REG_NUM[t]]} is number ${REG_NUM[t]}` });
    return REG_NUM[t];
  }

  function value(tok, prog, steps) {
    tok = tok.trim();
    const m = tok.match(/^([A-Za-z_]\w*)\s*([+-]\s*\w+)?$/);
    if (m && (m[1] in prog.dataLabels || m[1] in prog.labels)) {
      const isData = m[1] in prog.dataLabels;
      const base = isData ? prog.dataLabels[m[1]] : prog.labels[m[1]];
      const off = m[2] ? parseInt0(m[2].replace(/\s/g, "")) : 0;
      steps && steps.push({ token: tok, kind: "label", value: base + off,
        note: `${isData ? "data" : "code"} label '${m[1]}' is at byte address 0x${(base).toString(16).toUpperCase()}${off ? ` ${off > 0 ? "+" : "-"} ${Math.abs(off)}` : ""}` });
      return base + off;
    }
    const v = parseInt0(tok);
    steps && steps.push({ token: tok, kind: "number", value: v, note: `immediate ${v}` });
    return v;
  }

  function imm16(v) {
    if (v < -32768 || v > 65535) throw new AsmError(`immediate ${v} does not fit in 16 bits`);
    return v & 0xFFFF;
  }

  function encode(mnem, ops, addr, prog) {
    const steps = [];
    const need = n => { if (ops.length !== n) throw new AsmError(`'${mnem}' needs ${n} operands, got ${ops.length}`); };
    if (mnem === "nop") {
      need(0);
      return { word: 0, fields: { fmt: "R", opcode: 0, rs: 0, rt: 0, rd: 0, shamt: 0, funct: 0 }, steps: [{ token: "nop", kind: "pseudo", value: 0, note: "pseudo-instruction: sll $0,$0,0 = 0x00000000" }] };
    }
    if (mnem === "halt") {
      need(0);
      steps.push({ token: "halt", kind: "pseudo", value: addr, note: `pseudo-instruction: j to itself (0x${addr.toString(16).toUpperCase()})` });
      const target = (addr >>> 2) & 0x3FFFFFF;
      return { word: u32((OPCODES.j << 26) | target), fields: { fmt: "J", opcode: OPCODES.j, target }, steps };
    }
    if (mnem in FUNCTS) {
      need(3);
      const rd = reg(ops[0], steps), rs = reg(ops[1], steps), rt = reg(ops[2], steps);
      steps.push({ token: mnem, kind: "funct", value: FUNCTS[mnem], note: `R-type: opcode 0, funct for ${mnem} = ${FUNCTS[mnem]}` });
      return { word: u32((rs << 21) | (rt << 16) | (rd << 11) | FUNCTS[mnem]),
        fields: { fmt: "R", opcode: 0, rs, rt, rd, shamt: 0, funct: FUNCTS[mnem] }, steps };
    }
    if (mnem === "addi") {
      need(3);
      const rt = reg(ops[0], steps), rs = reg(ops[1], steps);
      const v = value(ops[2], prog, steps);
      const imm = imm16(v);
      return { word: u32((OPCODES.addi << 26) | (rs << 21) | (rt << 16) | imm),
        fields: { fmt: "I", opcode: OPCODES.addi, rs, rt, imm }, steps };
    }
    if (mnem === "lw" || mnem === "sw") {
      need(2);
      const rt = reg(ops[0], steps);
      const m = ops[1].replace(/\s/g, "").match(/^(.*)\((\$\w+)\)$/);
      if (!m) throw new AsmError(`expected offset($reg), got '${ops[1]}'`);
      const off = m[1] ? value(m[1], prog, steps) : 0;
      const rs = reg(m[2], steps);
      const imm = imm16(off);
      return { word: u32((OPCODES[mnem] << 26) | (rs << 21) | (rt << 16) | imm),
        fields: { fmt: "I", opcode: OPCODES[mnem], rs, rt, imm }, steps };
    }
    if (mnem === "beq") {
      need(3);
      const rs = reg(ops[0], steps), rt = reg(ops[1], steps);
      const tgt = ops[2].trim();
      let offset;
      if (tgt in prog.labels) {
        offset = (prog.labels[tgt] - (addr + 4)) / 4;
        steps.push({ token: tgt, kind: "branch", value: offset,
          note: `offset = (target 0x${prog.labels[tgt].toString(16).toUpperCase()} − (PC+4 = 0x${(addr + 4).toString(16).toUpperCase()})) ÷ 4 = ${offset}` });
      } else {
        offset = parseInt0(tgt);
        steps.push({ token: tgt, kind: "number", value: offset, note: `raw word offset ${offset}` });
      }
      if (offset < -32768 || offset > 32767) throw new AsmError(`branch offset ${offset} out of range`);
      const imm = offset & 0xFFFF;
      return { word: u32((OPCODES.beq << 26) | (rs << 21) | (rt << 16) | imm),
        fields: { fmt: "I", opcode: OPCODES.beq, rs, rt, imm }, steps };
    }
    if (mnem === "j") {
      need(1);
      const tgt = ops[0].trim();
      let byteAddr;
      if (tgt in prog.labels) byteAddr = prog.labels[tgt];
      else byteAddr = parseInt0(tgt) * 4;
      const target = (byteAddr >>> 2) & 0x3FFFFFF;
      steps.push({ token: tgt, kind: "jump", value: target,
        note: `target field = byte address 0x${byteAddr.toString(16).toUpperCase()} ÷ 4 = ${target}` });
      return { word: u32((OPCODES.j << 26) | target), fields: { fmt: "J", opcode: OPCODES.j, target }, steps };
    }
    throw new AsmError(`unsupported instruction '${mnem}'`);
  }

  /* ------------------------------------------------------------------ */
  /* Decoder                                                             */
  /* ------------------------------------------------------------------ */
  function decode(word) {
    word = u32(word);
    const op = (word >>> 26) & 0x3F, rs = (word >>> 21) & 0x1F, rt = (word >>> 16) & 0x1F,
      rd = (word >>> 11) & 0x1F, shamt = (word >>> 6) & 0x1F, funct = word & 0x3F,
      imm = word & 0xFFFF, target = word & 0x3FFFFFF;
    const R = REG_NAMES;
    if (op === 0) {
      if (word === 0) return { fmt: "R", asm: "nop", name: "nop", opcode: op, rs, rt, rd, shamt, funct };
      const name = FUNCT_NAME[funct] || `funct?${funct}`;
      return { fmt: "R", asm: `${name} ${R[rd]}, ${R[rs]}, ${R[rt]}`, name, opcode: op, rs, rt, rd, shamt, funct };
    }
    if (op === OPCODES.j) return { fmt: "J", asm: `j 0x${hex8(target << 2)}`, name: "j", opcode: op, target };
    if (op === OPCODES.addi) return { fmt: "I", asm: `addi ${R[rt]}, ${R[rs]}, ${sext16(imm)}`, name: "addi", opcode: op, rs, rt, imm };
    if (op === OPCODES.lw || op === OPCODES.sw) {
      const n = op === OPCODES.lw ? "lw" : "sw";
      return { fmt: "I", asm: `${n} ${R[rt]}, ${sext16(imm)}(${R[rs]})`, name: n, opcode: op, rs, rt, imm };
    }
    if (op === OPCODES.beq) return { fmt: "I", asm: `beq ${R[rs]}, ${R[rt]}, ${sext16(imm) >= 0 ? "+" : ""}${sext16(imm)}`, name: "beq", opcode: op, rs, rt, imm };
    return { fmt: "?", asm: `unknown opcode ${op} (NOP)`, name: "?", opcode: op, rs, rt, imm };
  }

  /* ------------------------------------------------------------------ */
  /* Single-cycle reference model                                         */
  /* ------------------------------------------------------------------ */
  class Machine {
    constructor(imem, dmem) {
      this.imem = Array.from({ length: MEM_WORDS }, (_, i) => u32(imem[i] || 0));
      this.dmem = Array.from({ length: MEM_WORDS }, (_, i) => u32(dmem[i] || 0));
      this.regs = new Array(32).fill(0);
      this.pc = 0; this.cycles = 0; this.halted = false; this.trace = [];
    }
    snapshot() {
      return { regs: this.regs.slice(), dmem: this.dmem.slice(), pc: this.pc, cycles: this.cycles,
        halted: this.halted, traceLen: this.trace.length };
    }
    restore(s) {
      this.regs = s.regs.slice(); this.dmem = s.dmem.slice(); this.pc = s.pc; this.cycles = s.cycles;
      this.halted = s.halted; this.trace.length = s.traceLen;
    }
    step() {
      const pc = this.pc;
      const instr = this.imem[(pc >>> 2) & 0xFF];
      const op = (instr >>> 26) & 0x3F, rs = (instr >>> 21) & 0x1F, rt = (instr >>> 16) & 0x1F,
        rd = (instr >>> 11) & 0x1F, funct = instr & 0x3F;
      const imm16v = instr & 0xFFFF;
      const immExt = u32(sext16(imm16v));
      const c = CONTROL[op] || NOP_CONTROL;
      const aluCtrl = c.alu_op === 0 ? ALU.ADD : c.alu_op === 1 ? ALU.SUB : (FUNCT_TO_ALU[funct] ?? ALU.ADD);
      const a = this.regs[rs], rd2 = this.regs[rt];
      const b = c.alu_src ? immExt : rd2;
      let res;
      switch (aluCtrl) {
        case ALU.AND: res = u32(a & b); break;
        case ALU.OR: res = u32(a | b); break;
        case ALU.ADD: res = u32(a + b); break;
        case ALU.SUB: res = u32(a - b); break;
        default: res = s32(a) < s32(b) ? 1 : 0;
      }
      const zero = res === 0 ? 1 : 0;
      const memRdata = c.mem_read ? this.dmem[(res >>> 2) & 0xFF] : 0;
      const wb = c.mem_to_reg ? memRdata : res;
      const wreg = c.reg_dst ? rd : rt;
      const pc4 = u32(pc + 4);
      const branchTarget = u32(pc4 + u32(immExt << 2));
      const jumpTarget = u32((pc4 & 0xF0000000) | ((instr & 0x3FFFFFF) << 2));
      const takeBranch = c.branch && zero ? 1 : 0;
      const npc = c.jump ? jumpTarget : takeBranch ? branchTarget : pc4;
      const rec = Object.assign({ cycle: this.cycles, pc, instr, op, rs, rt, rd, funct, imm16: imm16v, immExt,
        a, b, rd2, aluCtrl, aluResult: res, zero, memRdata, writeBack: wb, writeReg: wreg,
        memWdata: rd2, pc4, branchTarget, jumpTarget, takeBranch, nextPc: npc,
        oldWriteRegValue: this.regs[wreg], oldMemValue: c.mem_write ? this.dmem[(res >>> 2) & 0xFF] : 0 }, c);
      this.trace.push(rec);
      if (c.mem_write) this.dmem[(res >>> 2) & 0xFF] = rd2;
      if (c.reg_write && wreg !== 0) this.regs[wreg] = wb;
      this.pc = npc; this.cycles++;
      if (npc === pc) this.halted = true;
      return rec;
    }
    run(max = 5000) { while (!this.halted && this.cycles < max) this.step(); return this; }
  }

  function checkExpects(prog, regs, dmem) {
    return prog.expects.map(e => {
      let got, label;
      if (e.kind === "reg") { got = s32(regs[REG_NUM[e.target]]); label = e.target; }
      else {
        const addr = value(e.target, prog, null);
        got = s32(dmem[(addr >>> 2) & 0xFF]); label = `mem[${e.target}]`;
      }
      return { ok: got === s32(e.value), label, got, expected: s32(e.value) };
    });
  }

  const MIPS = { REG_NAMES, REG_NUM, OPCODES, OPCODE_NAME, FUNCTS, FUNCT_NAME, CONTROL, NOP_CONTROL, CTRL_KEYS,
    CTRL_LABEL, ALU, ALU_NAME, MEM_WORDS, AsmError, assemble, decode, Machine, checkExpects,
    u32, s32, sext16, hex8, bin };
  if (typeof module !== "undefined" && module.exports) module.exports = MIPS;
  else root.MIPS = MIPS;
})(typeof window !== "undefined" ? window : globalThis);
