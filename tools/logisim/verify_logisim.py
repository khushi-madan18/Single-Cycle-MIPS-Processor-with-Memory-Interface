#!/usr/bin/env python3
"""
verify_logisim.py - runs every sample program on the Logisim circuit (headless,
`logisim -tty table,halt`) and compares it with the Verilog simulation.

For each programs/<name>.asm:
  1. build a copy of the circuit with that program in the instruction ROM
  2. load programs/<name>_data.mem into the data RAM (-l) and run until halt
  3. compare EVERY clock cycle with simulation/<name>_trace.txt (Verilog):
     PC, instruction, 8 control signals, ALUOp, ALU control, ALU result,
     Zero, write register, write-back data, MemWrite, next PC
  4. compare the final data memory (--save) with simulation/<name>_state.txt

Run `python3 tools/run_tests.py` first (it creates the Verilog traces), then:
    python3 tools/logisim/verify_logisim.py
"""
import glob
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))   # repository root
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "tools"))
import generate_circuit as G  # noqa: E402
from run_tests import parse_trace, parse_state, CTRL_KEYS  # noqa: E402

FIELDS = ["pc", "instr", "ctrl", "alu_op", "alu_ctrl", "alu_result", "zero", "write_reg", "write_back", "mem_write_en", "next_pc"]


def to_int(cell):
    b = cell.replace(" ", "")
    return None if any(ch not in "01" for ch in b) else int(b, 2)


def run_program(name, tmpdir):
    words = G.read_mem(os.path.join(ROOT, "programs", name + ".mem"))
    data = G.read_mem(os.path.join(ROOT, "programs", name + "_data.mem"))
    circ = G.build(words, os.path.join(tmpdir, name + ".circ"))
    image = os.path.join(tmpdir, name + "_data.img")
    with open(image, "w") as f:
        f.write("v2.0 raw\n" + " ".join("%x" % w for w in (data or [0])) + "\n")
    saved = os.path.join(tmpdir, name + "_ram_after.img")
    cmd = ["java", "-jar", G.JAR, circ, "-tty", "table,halt", "-l", image, "--save", saved]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    rows = []
    for line in r.stdout.splitlines():
        cells = line.split("\t")
        if len(cells) != len(FIELDS):
            continue
        vals = [to_int(c) for c in cells]
        rows.append(dict(zip(FIELDS, vals), ctrl_s=cells[2].replace(" ", "")))
    ram = []
    if os.path.exists(saved):
        text = open(saved).read().split("\n", 1)          # header line, e.g. "v3.0 hex words plain"
        for tok in (text[1] if len(text) > 1 else "").split():
            if "*" in tok:
                n, v = tok.split("*")
                ram += [int(v, 16)] * int(n)
            else:
                ram.append(int(tok, 16))
    return rows, ram, r.stdout + r.stderr


def compare(name, rows, ram):
    errs = []
    rtl = parse_trace(os.path.join("simulation", name + "_trace.txt"))
    _, rtl_mem, _ = parse_state(os.path.join("simulation", name + "_state.txt"))
    if len(rows) != len(rtl):
        errs.append("cycle count: logisim %d, verilog %d" % (len(rows), len(rtl)))
    for k, (lg, vr) in enumerate(zip(rows, rtl)):
        exp = {"pc": vr["pc"], "instr": vr["instr"], "ctrl": "".join(str(vr[c]) for c in CTRL_KEYS), "alu_op": vr["alu_op"],
               "alu_ctrl": vr["alu_ctrl"], "alu_result": vr["alu_result"], "zero": vr["zero"], "write_reg": vr["write_reg"],
               "write_back": vr["write_back"], "mem_write_en": vr["mem_write_en"], "next_pc": vr["next_pc"]}
        for f in FIELDS:
            got = lg["ctrl_s"] if f == "ctrl" else lg[f]
            if f == "write_back" and not (vr["reg_write"] or vr["mem_read"] or lg["write_back"] is not None):
                continue
            if got != exp[f]:
                errs.append("cycle %d (pc 0x%x) %s: logisim %s, verilog %s" % (k, vr["pc"], f, got, exp[f]))
        if len(errs) > 15:
            break
    ram = (ram + [0] * 256)[:256]
    bad = [i for i in range(256) if ram[i] != rtl_mem[i]]
    if bad:
        errs.append("final data memory differs at words %s" % bad[:8])
    return errs, len(rtl)


def main():
    if not os.path.exists(G.JAR):
        sys.exit("Logisim-evolution jar not found: set LOGISIM_JAR")
    os.chdir(ROOT)
    progs = sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob("programs/*.asm"))
    fails = 0
    with tempfile.TemporaryDirectory() as tmp:
        for name in progs:
            if not os.path.exists(os.path.join("simulation", name + "_trace.txt")):
                print("SKIP   %s (run python3 tools/run_tests.py first)" % name)
                continue
            rows, ram, out = run_program(name, tmp)
            errs, n = compare(name, rows, ram)
            print("%s   logisim %-12s %3d cycles, %s" % ("FAIL" if errs else "PASS", name, len(rows),
                                                          "differences:" if errs else "every cycle + final data memory match Verilog"))
            for e in errs:
                print("         " + e)
            if not rows:
                print(out[-1500:])
            fails += bool(errs)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
