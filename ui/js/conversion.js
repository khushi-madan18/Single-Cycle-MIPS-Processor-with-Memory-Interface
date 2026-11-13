/*
 * conversion.js - "Conversion" tab: shows every transformation an instruction
 * goes through, from assembly text to a 32-bit word (assembler side) and from
 * that word to control signals, ALU result, memory access and write-back
 * (hardware side, using the values from the executed clock cycle).
 */
(function () {
  "use strict";
  const R = () => MIPS.REG_NAMES;
  const H = v => MIPS.hex8(v);
  const S = v => MIPS.s32(v);
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

  const FIELD_COLORS = { opcode: "var(--f-op)", rs: "var(--f-rs)", rt: "var(--f-rt)", rd: "var(--f-rd)",
    shamt: "var(--f-sh)", funct: "var(--f-fn)", immediate: "var(--f-imm)", target: "var(--f-tg)" };

  function fieldList(word, fmt) {
    const op = (word >>> 26) & 63, rs = (word >>> 21) & 31, rt = (word >>> 16) & 31, rd = (word >>> 11) & 31,
      sh = (word >>> 6) & 31, fn = word & 63, imm = word & 0xFFFF, tg = word & 0x3FFFFFF;
    if (fmt === "R") return [["opcode", 6, op], ["rs", 5, rs], ["rt", 5, rt], ["rd", 5, rd], ["shamt", 5, sh], ["funct", 6, fn]];
    if (fmt === "J") return [["opcode", 6, op], ["target", 26, tg]];
    return [["opcode", 6, op], ["rs", 5, rs], ["rt", 5, rt], ["immediate", 16, imm]];
  }

  function fieldNote(name, v, fmt, word) {
    if (name === "rs" || name === "rt" || name === "rd") return `${v} = ${R()[v]}`;
    if (name === "opcode") return `${v}${MIPS.OPCODE_NAME[v] ? " · " + MIPS.OPCODE_NAME[v] : ""}`;
    if (name === "funct") return `${v}${MIPS.FUNCT_NAME[v] ? " · " + MIPS.FUNCT_NAME[v] : ""}`;
    if (name === "immediate") return `${v}${MIPS.sext16(v) < 0 ? " = " + MIPS.sext16(v) : ""}`;
    if (name === "target") return `${v} (×4 = 0x${(v * 4).toString(16).toUpperCase()})`;
    return String(v);
  }

  function bitsHTML(word, fmt, delay0 = 0) {
    return `<div class="bits">${fieldList(word, fmt).map(([n, w, v], i) => {
      const b = MIPS.bin(v, w);
      return `<div class="field" style="--fc:${FIELD_COLORS[n]};animation-delay:${delay0 + i * 70}ms">
        <div class="fn">${n}</div>
        <div class="fb">${[...b].map(c => `<span class="${c === "1" ? "one" : ""}">${c}</span>`).join("")}</div>
        <div class="fv">${fieldNote(n, v, fmt, word)}</div></div>`;
    }).join("")}</div>`;
  }

  function nibblesHTML(word) {
    const b = MIPS.bin(word, 32);
    let h = "";
    for (let i = 0; i < 8; i++) {
      const nb = b.slice(i * 4, i * 4 + 4);
      h += `<div class="nib" style="animation-delay:${i * 55}ms"><span class="b">${nb}</span><span class="arr">▼</span><span class="h">${parseInt(nb, 2).toString(16).toUpperCase()}</span></div>`;
    }
    return `<div class="nibbles">${h}</div>`;
  }

  function step(n, title, body, opts = {}) {
    return `<div class="step${opts.hw ? " hw" : ""}" style="animation-delay:${opts.delay || 0}ms">
      <div class="num">${n}</div>
      <div class="card"><div class="title">${title}${opts.tag ? `<span class="tag ${opts.tag}">${opts.tag}</span>` : ""}</div>${body}</div></div>`;
  }

  function tokenKind(tok, entry) {
    if (tok === entry.mnem) return "mn";
    if (/^\$/.test(tok)) return "reg";
    if (/^-?(0x[0-9a-f]+|\d+)$/i.test(tok)) return "num";
    return "lab";
  }

  function tokens(entry) {
    const out = [entry.mnem];
    entry.ops.forEach(o => {
      const m = o.replace(/\s/g, "").match(/^(.*)\((\$\w+)\)$/);
      if (m) { if (m[1]) out.push(m[1]); out.push("(", m[2], ")"); } else out.push(o);
    });
    return out;
  }

  function softwareSteps(entry, prog) {
    const fmt = entry.fields.fmt;
    const word = entry.word;
    const toks = tokens(entry);
    let d = 0, n = 1;
    const parts = [];
    const lab = Object.keys(prog.labels).find(k => prog.labels[k] === entry.addr);

    parts.push(step(n++, "Source line", `<div class="desc">Line ${entry.line}${lab ? ` · label <code>${esc(lab)}</code>` : ""}: <code>${esc(entry.asm)}</code></div>`, { delay: d }));
    d += 90;
    parts.push(step(n++, "Tokenize", `<div class="tokens">${toks.map((t, i) => t === "(" || t === ")" ? `<span class="muted">${t}</span>` :
      `<span class="token ${tokenKind(t, entry)}" style="animation-delay:${d + i * 60}ms">${esc(t)}</span>`).join("")}</div>
      <div class="desc" style="margin-top:6px">The mnemonic <code>${esc(entry.mnem)}</code> selects the encoding; the operands are registers, numbers or labels.</div>`, { delay: d }));
    d += 90;
    const res = entry.steps.map(s => `<code>${esc(s.token)}</code><span class="arrow">→</span>
      <span class="to">${s.kind === "register" ? `${s.value} <span class="muted">(${MIPS.bin(s.value, 5)})</span>` : s.value}</span><span class="why">${esc(s.note)}</span>`).join("");
    parts.push(step(n++, "Resolve names to numbers", `<div class="resolve">${res}</div>`, { delay: d }));
    d += 90;
    const fmtDesc = { R: "R-type (register): opcode 000000, operation chosen by the funct field",
      I: "I-type (immediate): opcode + two registers + 16-bit immediate", J: "J-type (jump): opcode + 26-bit target" }[fmt];
    parts.push(step(n++, `Choose format: ${fmt}-type`, `<div class="desc">${fmtDesc}. Opcode for <code>${esc(entry.mnem)}</code> = ${entry.fields.opcode} = <code>${MIPS.bin(entry.fields.opcode, 6)}</code>.</div>`, { delay: d }));
    d += 90;
    parts.push(step(n++, "Pack the fields into 32 bits", bitsHTML(word, fmt, d), { delay: d }));
    d += 120;
    parts.push(step(n++, "Binary → hexadecimal", `${nibblesHTML(word)}
      <div class="hexbig"><span class="h">0x${H(word)}</span><span class="d">= ${word >>> 0} unsigned · stored in instruction memory at byte 0x${entry.addr.toString(16).toUpperCase()} (word ${entry.addr >> 2})</span></div>`, { delay: d }));
    return { html: parts.join(""), next: n, delay: d };
  }

  function hardwareSteps(r, startN, d0) {
    let n = startN, d = d0;
    const parts = [];
    const c = r;
    const isR = r.op === 0;
    const known = r.op in MIPS.CONTROL;
    const usesRs = known && !r.jump;
    const readsRt = known && (isR || r.branch || r.mem_write);
    const name = MIPS.ALU_NAME[r.aluCtrl];

    parts.push(step(n++, "Fetch", `<dl class="kv"><dt>PC</dt><dd>0x${H(r.pc)}</dd>
      <dt>Instruction memory</dt><dd>IMEM[0x${H(r.pc)} → word ${(r.pc >>> 2) & 255}] = 0x${H(r.instr)}</dd>
      <dt>PC + 4</dt><dd>0x${H(r.pc4)}</dd></dl>`, { hw: 1, tag: "IF", delay: d }));
    d += 90;

    const chips = MIPS.CTRL_KEYS.map((k, i) => `<span class="cchip${r[k] ? " on" : ""}" style="animation-delay:${d + i * 35}ms">${MIPS.CTRL_LABEL[k]}=${r[k]}</span>`).join("") +
      `<span class="cchip on" style="animation-delay:${d + 320}ms">ALUOp=${MIPS.bin(r.alu_op, 2)}</span>`;
    let aluCtl;
    if (r.alu_op === 2) aluCtl = `ALUOp <code>10</code> means “look at funct”: funct <code>${MIPS.bin(r.funct, 6)}</code> (${MIPS.FUNCT_NAME[r.funct] || "?"}) → ALU control <code>${MIPS.bin(r.aluCtrl, 4)}</code> = <b>${name}</b>`;
    else if (r.alu_op === 1) aluCtl = `ALUOp <code>01</code> → ALU control <code>0110</code> = <b>SUB</b> (BEQ compares by subtracting)`;
    else aluCtl = r.jump ? `ALU not used by J` : `ALUOp <code>00</code> → ALU control <code>0010</code> = <b>ADD</b> (${r.mem_read || r.mem_write ? "address = base + offset" : "register + immediate"})`;
    parts.push(step(n++, "Decode: opcode → control signals", `<div class="desc" style="margin-bottom:6px">Opcode <code>${MIPS.bin(r.op, 6)}</code> enters the control unit (${MIPS.OPCODE_NAME[r.op] || "unknown → NOP"}):</div>
      <div class="ctrl-chips">${chips}</div><div class="desc" style="margin-top:8px">${aluCtl}</div>`, { hw: 1, tag: "ID", delay: d }));
    d += 90;

    if (usesRs) {
      let body = `<dl class="kv"><dt>rs = ${R()[r.rs]}</dt><dd>${S(r.a)} (0x${H(r.a)})</dd>`;
      if (readsRt) body += `<dt>rt = ${R()[r.rt]}</dt><dd>${S(r.rd2)} (0x${H(r.rd2)})</dd>`;
      body += `</dl>`;
      if (r.alu_src || r.branch) {
        const b16 = MIPS.bin(r.imm16, 16), sign = b16[0];
        body += `<div class="calc" style="margin-top:6px"><span class="bin">imm16 ${b16.slice(0, 1)}<span>${b16.slice(1)}</span></span><br>
          <span class="bin">sign-extend → <span class="sx">${sign.repeat(16)}</span>${b16}</span><br>
          = <span class="res">${MIPS.sext16(r.imm16)}</span> <span class="muted">(0x${H(r.immExt)})</span></div>`;
      }
      parts.push(step(n++, r.alu_src || r.branch ? "Read registers + sign-extend immediate" : "Read registers", body, { hw: 1, tag: "ID", delay: d }));
      d += 90;

      const sym = { ADD: "+", SUB: "−", AND: "AND", OR: "OR", SLT: "<" }[name];
      const bSrc = r.alu_src ? "imm" : R()[r.rt];
      let calc;
      if (name === "SLT") calc = `${S(r.a)} <span class="op">&lt;</span> ${S(r.b)} ? <span class="op">→</span> <span class="res">${r.aluResult}</span>`;
      else if (name === "AND" || name === "OR") calc = `<span class="bin">&nbsp;&nbsp;${MIPS.bin(r.a, 32)}<br>${name === "AND" ? "&amp;" : "|"} ${MIPS.bin(r.b, 32)}<br>= ${MIPS.bin(r.aluResult, 32)}</span><br>= <span class="res">${S(r.aluResult)}</span>`;
      else calc = `${S(r.a)} <span class="op">${sym}</span> ${S(r.b)} <span class="op">=</span> <span class="res">${S(r.aluResult)}</span> <span class="muted">(0x${H(r.aluResult)})</span>`;
      parts.push(step(n++, `Execute: ALU ${name}`, `<div class="desc">A = ${R()[r.rs]}, B = ${bSrc} (ALUSrc = ${r.alu_src})</div>
        <div class="calc">${calc}</div><div class="desc">Zero flag = <b>${r.zero}</b></div>`, { hw: 1, tag: "EX", delay: d }));
      d += 90;
    }

    let mem;
    if (r.mem_read) mem = `Address = ${S(r.a)} + ${MIPS.sext16(r.imm16)} = <code>0x${H(r.aluResult)}</code> → word ${(r.aluResult >>> 2) & 255}<br>DMEM read → <b>${S(r.memRdata)}</b> <span class="muted">(0x${H(r.memRdata)})</span>`;
    else if (r.mem_write) mem = `Address = ${S(r.a)} + ${MIPS.sext16(r.imm16)} = <code>0x${H(r.aluResult)}</code> → word ${(r.aluResult >>> 2) & 255}<br>DMEM[0x${H(r.aluResult)}] ← ${R()[r.rt]} = <b>${S(r.memWdata)}</b> <span class="muted">(was ${S(r.oldMemValue)})</span>`;
    else mem = `<span class="pill-no">no memory access</span> MemRead = MemWrite = 0`;
    parts.push(step(n++, "Memory access", `<div class="desc">${mem}</div>`, { hw: 1, tag: "MEM", delay: d }));
    d += 90;

    let wb;
    if (r.reg_write && r.writeReg !== 0) wb = `MemtoReg = ${r.mem_to_reg} → ${r.mem_to_reg ? "data from memory" : "ALU result"}; RegDst = ${r.reg_dst} → ${r.reg_dst ? "rd" : "rt"}<br><code>${R()[r.writeReg]}</code> ← <b>${S(r.writeBack)}</b> <span class="muted">(was ${S(r.oldWriteRegValue)})</span>`;
    else if (r.reg_write) wb = `Write to <code>$zero</code> is ignored (register 0 is hard-wired)`;
    else wb = `<span class="pill-no">no register write</span> RegWrite = 0`;
    let npc;
    if (r.jump) npc = `Jump: {PC+4[31:28] = ${MIPS.bin(r.pc4 >>> 28, 4)}, target ${(r.instr & 0x3FFFFFF)}, 00} = <b>0x${H(r.jumpTarget)}</b>${r.nextPc === r.pc ? ` <span class="pill-ok">halt loop</span>` : ""}`;
    else if (r.branch) npc = `Branch & Zero = ${r.branch} & ${r.zero} = <b>${r.takeBranch}</b> → ${r.takeBranch
      ? `<span class="pill-ok">taken</span> PC+4 + (${MIPS.sext16(r.imm16)} × 4) = <b>0x${H(r.branchTarget)}</b>`
      : `<span class="pill-no">not taken</span> PC+4 = <b>0x${H(r.pc4)}</b>`}`;
    else npc = `PC + 4 = <b>0x${H(r.nextPc)}</b>`;
    parts.push(step(n++, "Write-back + next PC (on the rising clock edge)", `<div class="desc">${wb}</div><div class="desc" style="margin-top:6px">${npc}</div>`, { hw: 1, tag: "WB", delay: d }));
    return parts.join("");
  }

  function render(el, { entry, rec, prog, isCurrent }) {
    if (!entry) {
      el.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24"><path d="M4 7h11l-3-3M20 17H9l3 3"/></svg>
        <div><b>Nothing to show yet</b><br>Assemble a program and press <kbd>Step</kbd>, or click an instruction in the editor / Machine Code tab.</div></div>`;
      return;
    }
    const sw = softwareSteps(entry, prog);
    const fmt = entry.fields.fmt;
    const hw = rec ? hardwareSteps(rec, sw.next, sw.delay + 60)
      : `<div class="empty" style="min-height:120px"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
         <div>Not executed yet.<br><span class="muted">Step the program until this instruction runs to see its hardware values.</span></div></div>`;
    el.innerHTML = `
      <div class="conv-head">
        <span class="asm-big">${esc(entry.asm)}</span>
        <span class="chip fmt-${fmt}">${fmt}-type</span>
        <span class="chip">0x${H(entry.word)}</span>
        ${rec ? `<span class="chip">cycle ${rec.cycle}</span>` : ""}
        ${isCurrent ? `<span class="chip" style="background:var(--ok-soft);color:var(--ok)">last executed</span>` : ""}
        <span class="spacer"></span>
        <span class="muted" style="font-size:12px">Tip: click any instruction line in the editor to inspect it</span>
      </div>
      <div class="conv-cols">
        <div class="conv-col"><h4>Assembler · text → machine code<i></i></h4><div class="steps">${sw.html}</div></div>
        <div class="conv-col"><h4>Processor · machine code → result (one clock cycle)<i></i></h4><div class="steps">${hw}</div></div>
      </div>`;
  }

  window.Conversion = { render, bitsHTML, fieldList, FIELD_COLORS };
})();
