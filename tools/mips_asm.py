#!/usr/bin/env python3
"""
mips_asm.py - Assembler, disassembler and reference (golden-model) simulator
for the single-cycle MIPS processor in this repository.

Supported instructions (the same set the Verilog CPU implements):
    R-type : add, sub, and, or, slt        rd, rs, rt
    I-type : addi                          rt, rs, imm
             lw, sw                        rt, offset(rs)
             beq                           rs, rt, label
    J-type : j                             label
    Pseudo : nop                           (= sll $0,$0,0 = 0x00000000)
             halt                          (= j to itself)

Assembler directives:
    .text            following lines are instructions (default)
    .data            following lines are data words for data memory
    label: .word a, b, c   initialised data words (decimal, hex, negative)
    label: .space n        n zero words

Labels in .data are BYTE addresses in data memory (starting at 0), so they can
be used as immediates / offsets:  addi $t0, $zero, array   lw $t1, n($zero)

Test expectations can be written as comments in the .asm file:
    # EXPECT $s0 = 110
    # EXPECT mem[result] = 110
    # EXPECT mem[array+4] = 7

Usage:
    python3 tools/mips_asm.py programs/array_sum.asm            # writes .mem files + listing
    python3 tools/mips_asm.py programs/array_sum.asm --run      # also runs the golden model
    python3 tools/mips_asm.py --explain 0x01095020              # decode one machine word
"""

import argparse
import os
import re
import sys

# ---------------------------------------------------------------------------
# ISA tables
# ---------------------------------------------------------------------------

REG_NAMES = ["$zero", "$at", "$v0", "$v1", "$a0", "$a1", "$a2", "$a3",
             "$t0", "$t1", "$t2", "$t3", "$t4", "$t5", "$t6", "$t7",
             "$s0", "$s1", "$s2", "$s3", "$s4", "$s5", "$s6", "$s7",
             "$t8", "$t9", "$k0", "$k1", "$gp", "$sp", "$fp", "$ra"]
REG_NUM = {name: i for i, name in enumerate(REG_NAMES)}
REG_NUM.update({"$%d" % i: i for i in range(32)})
REG_NUM["$s8"] = 30

OPCODES = {"rtype": 0b000000, "lw": 0b100011, "sw": 0b101011,
           "beq": 0b000100, "addi": 0b001000, "j": 0b000010}
FUNCTS = {"add": 0b100000, "sub": 0b100010, "and": 0b100100,
          "or": 0b100101, "slt": 0b101010}
FUNCT_NAME = {v: k for k, v in FUNCTS.items()}

# Control-unit truth table (must match src/control_unit.v and docs/architecture.md)
#            RegDst ALUSrc MemtoReg RegWrite MemRead MemWrite Branch Jump ALUOp
CONTROL = {
    0b000000: dict(reg_dst=1, alu_src=0, mem_to_reg=0, reg_write=1, mem_read=0, mem_write=0, branch=0, jump=0, alu_op=0b10),
    0b100011: dict(reg_dst=0, alu_src=1, mem_to_reg=1, reg_write=1, mem_read=1, mem_write=0, branch=0, jump=0, alu_op=0b00),
    0b101011: dict(reg_dst=0, alu_src=1, mem_to_reg=0, reg_write=0, mem_read=0, mem_write=1, branch=0, jump=0, alu_op=0b00),
    0b000100: dict(reg_dst=0, alu_src=0, mem_to_reg=0, reg_write=0, mem_read=0, mem_write=0, branch=1, jump=0, alu_op=0b01),
    0b001000: dict(reg_dst=0, alu_src=1, mem_to_reg=0, reg_write=1, mem_read=0, mem_write=0, branch=0, jump=0, alu_op=0b00),
    0b000010: dict(reg_dst=0, alu_src=0, mem_to_reg=0, reg_write=0, mem_read=0, mem_write=0, branch=0, jump=1, alu_op=0b00),
}
NOP_CONTROL = dict(reg_dst=0, alu_src=0, mem_to_reg=0, reg_write=0, mem_read=0, mem_write=0, branch=0, jump=0, alu_op=0b00)

# ALU control (must match src/alu_control.v)
ALU_AND, ALU_OR, ALU_ADD, ALU_SUB, ALU_SLT = 0b0000, 0b0001, 0b0010, 0b0110, 0b0111
FUNCT_TO_ALU = {0b100000: ALU_ADD, 0b100010: ALU_SUB, 0b100100: ALU_AND,
                0b100101: ALU_OR, 0b101010: ALU_SLT}

MASK32 = 0xFFFFFFFF
MEM_WORDS = 256


class AsmError(Exception):
    pass


def to_signed32(x):
    x &= MASK32
    return x - (1 << 32) if x & 0x80000000 else x


def sign_extend16(x):
    x &= 0xFFFF
    return x - 0x10000 if x & 0x8000 else x


# ---------------------------------------------------------------------------
# Assembler
# ---------------------------------------------------------------------------

def _strip_comment(line):
    return re.split(r"#|//|;", line, maxsplit=1)[0].strip()


def _parse_int(tok):
    tok = tok.strip()
    try:
        return int(tok, 0)
    except ValueError:
        raise AsmError("bad number '%s'" % tok)


class Program:
    """Result of assembling a source file."""

    def __init__(self):
        self.text = []        # list of dicts: addr, word, asm, src_line, fields
        self.data = []        # list of ints (data memory words starting at byte 0)
        self.data_comments = {}
        self.labels = {}      # text labels -> byte address
        self.data_labels = {} # data labels -> byte address
        self.expects = []     # (kind, target, value, line)


def assemble(source, filename="<input>"):
    prog = Program()
    lines = source.splitlines()

    # ---- pass 1: labels, data, and the list of instructions ----
    section = "text"
    pending = []  # (addr, mnemonic, operands, original text, line no)
    for lineno, raw in enumerate(lines, 1):
        m = re.match(r"\s*#\s*EXPECT\s+(.*)$", raw, re.I)
        if m:
            prog.expects.append(_parse_expect(m.group(1), lineno))
            continue
        line = _strip_comment(raw)
        if not line:
            continue
        # one or more "label:" prefixes
        while True:
            m = re.match(r"^([A-Za-z_][\w]*)\s*:\s*(.*)$", line)
            if not m:
                break
            label, line = m.group(1), m.group(2).strip()
            if label in prog.labels or label in prog.data_labels:
                raise AsmError("%s:%d: duplicate label '%s'" % (filename, lineno, label))
            if section == "text":
                prog.labels[label] = 4 * len(pending)
            else:
                prog.data_labels[label] = 4 * len(prog.data)
        if not line:
            continue
        if line.startswith("."):
            parts = line.split(None, 1)
            d = parts[0].lower()
            arg = parts[1] if len(parts) > 1 else ""
            if d == ".text":
                section = "text"
            elif d == ".data":
                section = "data"
            elif d == ".word":
                if section != "data":
                    raise AsmError("%s:%d: .word only allowed in .data" % (filename, lineno))
                for v in arg.split(","):
                    prog.data_comments[len(prog.data)] = raw.strip()
                    prog.data.append(_parse_int(v) & MASK32)
            elif d == ".space":
                prog.data.extend([0] * _parse_int(arg))
            else:
                raise AsmError("%s:%d: unknown directive %s" % (filename, lineno, d))
            continue
        if section != "text":
            raise AsmError("%s:%d: instruction in .data section" % (filename, lineno))
        parts = line.split(None, 1)
        mnem = parts[0].lower()
        ops = [o.strip() for o in parts[1].split(",")] if len(parts) > 1 else []
        pending.append((4 * len(pending), mnem, ops, line, lineno))

    if len(pending) > MEM_WORDS:
        raise AsmError("program has %d instructions; instruction memory holds %d" % (len(pending), MEM_WORDS))
    if len(prog.data) > MEM_WORDS:
        raise AsmError("data section has %d words; data memory holds %d" % (len(prog.data), MEM_WORDS))

    # ---- pass 2: encode ----
    for addr, mnem, ops, text, lineno in pending:
        try:
            word, fields = encode(mnem, ops, addr, prog)
        except AsmError as e:
            raise AsmError("%s:%d: %s  (in '%s')" % (filename, lineno, e, text))
        prog.text.append(dict(addr=addr, word=word, asm=text, line=lineno, fields=fields))
    return prog


def _reg(tok):
    t = tok.strip().lower()
    if t not in REG_NUM:
        raise AsmError("unknown register '%s'" % tok)
    return REG_NUM[t]


def _value(tok, prog):
    """Immediate: number, data label, text label, or label+/-number."""
    tok = tok.strip()
    m = re.match(r"^([A-Za-z_]\w*)\s*([+-]\s*\w+)?$", tok)
    if m and (m.group(1) in prog.data_labels or m.group(1) in prog.labels):
        base = prog.data_labels.get(m.group(1), prog.labels.get(m.group(1)))
        off = _parse_int(m.group(2).replace(" ", "")) if m.group(2) else 0
        return base + off
    return _parse_int(tok)


def _check_imm16(v):
    if not (-32768 <= v <= 65535):
        raise AsmError("immediate %d does not fit in 16 bits" % v)
    return v & 0xFFFF


def encode(mnem, ops, addr, prog):
    """Return (32-bit word, field breakdown dict)."""
    def need(n):
        if len(ops) != n:
            raise AsmError("'%s' needs %d operands, got %d" % (mnem, n, len(ops)))

    if mnem == "nop":
        need(0)
        return 0, dict(fmt="R", opcode=0, rs=0, rt=0, rd=0, shamt=0, funct=0)
    if mnem == "halt":
        need(0)
        target = addr
        return _encode_j(target), dict(fmt="J", opcode=OPCODES["j"], target=(target >> 2) & 0x3FFFFFF)

    if mnem in FUNCTS:
        need(3)
        rd, rs, rt = _reg(ops[0]), _reg(ops[1]), _reg(ops[2])
        f = dict(fmt="R", opcode=0, rs=rs, rt=rt, rd=rd, shamt=0, funct=FUNCTS[mnem])
        word = (rs << 21) | (rt << 16) | (rd << 11) | FUNCTS[mnem]
        return word, f

    if mnem == "addi":
        need(3)
        rt, rs = _reg(ops[0]), _reg(ops[1])
        imm = _check_imm16(_value(ops[2], prog))
        f = dict(fmt="I", opcode=OPCODES["addi"], rs=rs, rt=rt, imm=imm)
        return (OPCODES["addi"] << 26) | (rs << 21) | (rt << 16) | imm, f

    if mnem in ("lw", "sw"):
        need(2)
        rt = _reg(ops[0])
        m = re.match(r"^(.*)\((\$\w+)\)$", ops[1].replace(" ", ""))
        if not m:
            raise AsmError("expected offset($reg), got '%s'" % ops[1])
        off = _value(m.group(1), prog) if m.group(1) else 0
        rs = _reg(m.group(2))
        imm = _check_imm16(off)
        f = dict(fmt="I", opcode=OPCODES[mnem], rs=rs, rt=rt, imm=imm)
        return (OPCODES[mnem] << 26) | (rs << 21) | (rt << 16) | imm, f

    if mnem == "beq":
        need(3)
        rs, rt = _reg(ops[0]), _reg(ops[1])
        tgt = ops[2]
        if tgt in prog.labels:
            offset = (prog.labels[tgt] - (addr + 4)) // 4
        else:
            offset = _parse_int(tgt)  # raw word offset
        if not (-32768 <= offset <= 32767):
            raise AsmError("branch offset %d out of range" % offset)
        imm = offset & 0xFFFF
        f = dict(fmt="I", opcode=OPCODES["beq"], rs=rs, rt=rt, imm=imm)
        return (OPCODES["beq"] << 26) | (rs << 21) | (rt << 16) | imm, f

    if mnem == "j":
        need(1)
        tgt = ops[0]
        if tgt in prog.labels:
            target = prog.labels[tgt]
        else:
            target = _parse_int(tgt) * 4  # raw word address (e.g. "j 10")
        return _encode_j(target), dict(fmt="J", opcode=OPCODES["j"], target=(target >> 2) & 0x3FFFFFF)

    raise AsmError("unsupported instruction '%s'" % mnem)


def _encode_j(byte_addr):
    return (OPCODES["j"] << 26) | ((byte_addr >> 2) & 0x3FFFFFF)


def _parse_expect(text, lineno):
    m = re.match(r"^\s*(\$\w+)\s*=\s*(\S+)\s*$", text)
    if m:
        return ("reg", m.group(1).lower(), _parse_int(m.group(2)), lineno)
    m = re.match(r"^\s*mem\[(.+?)\]\s*=\s*(\S+)\s*$", text)
    if m:
        return ("mem", m.group(1).strip(), _parse_int(m.group(2)), lineno)
    raise AsmError("line %d: cannot parse EXPECT '%s'" % (lineno, text))


# ---------------------------------------------------------------------------
# Disassembler / explainer
# ---------------------------------------------------------------------------

def decode(word):
    """Split a 32-bit word into its fields and return a readable description."""
    op = (word >> 26) & 0x3F
    rs = (word >> 21) & 0x1F
    rt = (word >> 16) & 0x1F
    rd = (word >> 11) & 0x1F
    shamt = (word >> 6) & 0x1F
    funct = word & 0x3F
    imm = word & 0xFFFF
    target = word & 0x3FFFFFF
    R = REG_NAMES
    if op == 0:
        if word == 0:
            return dict(fmt="R", asm="nop", opcode=op, rs=rs, rt=rt, rd=rd, shamt=shamt, funct=funct)
        name = FUNCT_NAME.get(funct, "r-funct?%d" % funct)
        return dict(fmt="R", asm="%s %s, %s, %s" % (name, R[rd], R[rs], R[rt]),
                    opcode=op, rs=rs, rt=rt, rd=rd, shamt=shamt, funct=funct)
    if op == OPCODES["j"]:
        return dict(fmt="J", asm="j 0x%08x" % (target << 2), opcode=op, target=target)
    if op == OPCODES["addi"]:
        return dict(fmt="I", asm="addi %s, %s, %d" % (R[rt], R[rs], sign_extend16(imm)), opcode=op, rs=rs, rt=rt, imm=imm)
    if op in (OPCODES["lw"], OPCODES["sw"]):
        n = "lw" if op == OPCODES["lw"] else "sw"
        return dict(fmt="I", asm="%s %s, %d(%s)" % (n, R[rt], sign_extend16(imm), R[rs]), opcode=op, rs=rs, rt=rt, imm=imm)
    if op == OPCODES["beq"]:
        return dict(fmt="I", asm="beq %s, %s, %+d" % (R[rs], R[rt], sign_extend16(imm)), opcode=op, rs=rs, rt=rt, imm=imm)
    return dict(fmt="?", asm="unknown opcode %d (acts as NOP)" % op, opcode=op)


def field_breakdown(word, fmt):
    """Binary breakdown string, e.g. '001000 | 00000 | 01000 | 0000000000000101'."""
    b = format(word & MASK32, "032b")
    if fmt == "R":
        cuts = [(0, 6, "opcode"), (6, 11, "rs"), (11, 16, "rt"), (16, 21, "rd"), (21, 26, "shamt"), (26, 32, "funct")]
    elif fmt == "J":
        cuts = [(0, 6, "opcode"), (6, 32, "target")]
    else:
        cuts = [(0, 6, "opcode"), (6, 11, "rs"), (11, 16, "rt"), (16, 32, "immediate")]
    bits = " | ".join(b[a:z] for a, z, _ in cuts)
    names = " | ".join(n.center(z - a) if len(n) <= z - a else n for a, z, n in cuts)
    return bits, names


def explain(word):
    d = decode(word)
    bits, names = field_breakdown(word, d["fmt"] if d["fmt"] != "?" else "I")
    out = ["hex      0x%08X" % word,
           "binary   %s" % bits,
           "fields   %s" % names,
           "format   %s-type" % d["fmt"],
           "assembly %s" % d["asm"]]
    ctrl = CONTROL.get(d["opcode"], NOP_CONTROL)
    out.append("control  " + " ".join("%s=%s" % (k, format(v, "02b") if k == "alu_op" else v) for k, v in ctrl.items()))
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Golden-model simulator (instruction-set simulator)
# ---------------------------------------------------------------------------

class GoldenModel:
    """Executes machine code exactly as the single-cycle CPU should."""

    def __init__(self, imem_words, dmem_words=()):
        self.imem = list(imem_words) + [0] * (MEM_WORDS - len(imem_words))
        self.dmem = list(dmem_words) + [0] * (MEM_WORDS - len(dmem_words))
        self.regs = [0] * 32
        self.pc = 0
        self.cycles = 0
        self.halted = False
        self.trace = []

    def step(self):
        pc = self.pc
        instr = self.imem[(pc >> 2) & 0xFF]
        op = (instr >> 26) & 0x3F
        rs, rt, rd = (instr >> 21) & 0x1F, (instr >> 16) & 0x1F, (instr >> 11) & 0x1F
        funct = instr & 0x3F
        imm_ext = sign_extend16(instr & 0xFFFF) & MASK32
        c = CONTROL.get(op, NOP_CONTROL)

        if c["alu_op"] == 0b00:
            alu_ctrl = ALU_ADD
        elif c["alu_op"] == 0b01:
            alu_ctrl = ALU_SUB
        else:
            alu_ctrl = FUNCT_TO_ALU.get(funct, ALU_ADD)

        a = self.regs[rs]
        b = imm_ext if c["alu_src"] else self.regs[rt]
        if alu_ctrl == ALU_AND:
            res = a & b
        elif alu_ctrl == ALU_OR:
            res = a | b
        elif alu_ctrl == ALU_ADD:
            res = (a + b) & MASK32
        elif alu_ctrl == ALU_SUB:
            res = (a - b) & MASK32
        else:
            res = 1 if to_signed32(a) < to_signed32(b) else 0
        zero = int(res == 0)

        mem_rdata = self.dmem[(res >> 2) & 0xFF] if c["mem_read"] else 0
        wb = mem_rdata if c["mem_to_reg"] else res
        wreg = rd if c["reg_dst"] else rt

        pc4 = (pc + 4) & MASK32
        if c["jump"]:
            npc = (pc4 & 0xF0000000) | ((instr & 0x3FFFFFF) << 2)
        elif c["branch"] and zero:
            npc = (pc4 + (imm_ext << 2)) & MASK32
        else:
            npc = pc4

        rec = dict(cycle=self.cycles, pc=pc, instr=instr, alu_ctrl=alu_ctrl, alu_result=res,
                   zero=zero, write_reg=wreg, write_back=wb, mem_wdata=self.regs[rt],
                   next_pc=npc, **c)
        self.trace.append(rec)

        # state updates (clock edge)
        if c["mem_write"]:
            self.dmem[(res >> 2) & 0xFF] = self.regs[rt]
        if c["reg_write"] and wreg != 0:
            self.regs[wreg] = wb
        self.pc = npc
        self.cycles += 1
        if npc == pc:
            self.halted = True
        return rec

    def run(self, max_cycles=5000):
        while not self.halted and self.cycles < max_cycles:
            self.step()
        return self


# ---------------------------------------------------------------------------
# Output files
# ---------------------------------------------------------------------------

def write_outputs(prog, base):
    """Write <base>.mem, <base>_data.mem (if data), <base>.lst. Returns paths."""
    name = os.path.basename(base)
    with open(base + ".mem", "w") as f:
        f.write("// %s.mem - generated by tools/mips_asm.py (instruction memory)\n" % name)
        for t in prog.text:
            f.write("%08X  // 0x%03X  %s\n" % (t["word"], t["addr"], t["asm"]))
        _pad(f, len(prog.text))
    paths = [base + ".mem"]
    if prog.data:
        with open(base + "_data.mem", "w") as f:
            f.write("// %s_data.mem - generated by tools/mips_asm.py (data memory)\n" % name)
            inv = {v: k for k, v in prog.data_labels.items()}
            for i, w in enumerate(prog.data):
                lab = inv.get(4 * i)
                f.write("%08X  // 0x%03X  %s%d\n" % (w, 4 * i, (lab + ": ") if lab else "", to_signed32(w)))
            _pad(f, len(prog.data))
        paths.append(base + "_data.mem")
    with open(base + ".lst", "w") as f:
        f.write(listing(prog))
    paths.append(base + ".lst")
    return paths


def _pad(f, used):
    """Fill the rest of the 256-word memory with zeros (see src/*_memory.v)."""
    if used < MEM_WORDS:
        f.write("// --- unused words (zero padding up to %d words) ---\n" % MEM_WORDS)
        for _ in range(MEM_WORDS - used):
            f.write("00000000\n")


def listing(prog):
    out = ["Assembly -> machine code conversion listing", "=" * 78]
    inv = {v: k for k, v in prog.labels.items()}
    for t in prog.text:
        fmt = t["fields"]["fmt"]
        bits, names = field_breakdown(t["word"], fmt)
        lab = inv.get(t["addr"])
        if lab:
            out.append("%s:" % lab)
        out.append("0x%08X  %-32s  ->  0x%08X   (%s-type)" % (t["addr"], t["asm"], t["word"], fmt))
        out.append("            %s" % names)
        out.append("            %s" % bits)
        fl = t["fields"]
        desc = ", ".join("%s=%d" % (k, v) for k, v in fl.items() if k != "fmt")
        out.append("            %s" % desc)
    if prog.data:
        out.append("")
        out.append("Data memory (byte address : value)")
        out.append("-" * 78)
        inv = {v: k for k, v in prog.data_labels.items()}
        for i, w in enumerate(prog.data):
            lab = inv.get(4 * i, "")
            out.append("0x%03X  %-10s 0x%08X  (%d)" % (4 * i, lab, w, to_signed32(w)))
    return "\n".join(out) + "\n"


def check_expects(prog, regs, dmem):
    """Return list of (ok, message) for each EXPECT line."""
    results = []
    for kind, target, value, lineno in prog.expects:
        if kind == "reg":
            n = REG_NUM.get(target)
            got = to_signed32(regs[n])
            label = target
        else:
            addr = _value(target, prog)
            got = to_signed32(dmem[(addr >> 2) & 0xFF])
            label = "mem[%s] (0x%03X)" % (target, addr)
        ok = got == to_signed32(value)
        results.append((ok, "%s = %d (expected %d)" % (label, got, to_signed32(value))))
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", nargs="?", help=".asm file to assemble")
    ap.add_argument("-o", "--out", help="output base name (default: same as source without .asm)")
    ap.add_argument("--run", action="store_true", help="run the golden-model simulator and check EXPECT lines")
    ap.add_argument("--explain", metavar="HEX", help="decode a single 32-bit machine word")
    args = ap.parse_args()

    if args.explain:
        print(explain(int(args.explain, 16)))
        return 0
    if not args.source:
        ap.error("give a .asm file or --explain HEX")

    with open(args.source) as f:
        try:
            prog = assemble(f.read(), args.source)
        except AsmError as e:
            print("error:", e, file=sys.stderr)
            return 1
    base = args.out or os.path.splitext(args.source)[0]
    for p in write_outputs(prog, base):
        print("wrote", p)

    if args.run:
        gm = GoldenModel([t["word"] for t in prog.text], prog.data).run()
        print("golden model: %s after %d cycles" % ("halted" if gm.halted else "STOPPED (no halt)", gm.cycles))
        bad = 0
        for ok, msg in check_expects(prog, gm.regs, gm.dmem):
            print("  %s  %s" % ("PASS" if ok else "FAIL", msg))
            bad += not ok
        return 1 if bad else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
