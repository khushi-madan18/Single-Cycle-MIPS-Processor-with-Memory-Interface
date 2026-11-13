#!/usr/bin/env python3
"""
run_tests.py - full regression for the single-cycle MIPS CPU.

  1. Unit tests      : testbench/tb_alu.v, testbench/tb_control_unit.v
  2. Basic testbench : testbench/tb_mips_cpu.v (self-checking, programs/basic_test.mem)
  3. Program tests   : every programs/*.asm is
        a) assembled to machine code (tools/mips_asm.py)
        b) executed on the Python golden model
        c) simulated on the Verilog CPU (testbench/tb_program.v)
        d) compared CYCLE BY CYCLE: PC, instruction, all control signals,
           ALU control/result, zero flag, write-back, memory writes, next PC
        e) compared at the end: all 32 registers and all 256 data-memory words
        f) checked against the hand-computed "# EXPECT" lines in the .asm file

Run from the repository root:   python3 tools/run_tests.py
Requires Icarus Verilog (iverilog, vvp).
"""

import glob
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import mips_asm as M  # noqa: E402

SIM = "simulation"
SRC = sorted(glob.glob("src/*.v"))
CTRL_KEYS = ["reg_dst", "alu_src", "mem_to_reg", "reg_write", "mem_read", "mem_write", "branch", "jump"]


def sh(cmd):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def run_tb(name, files, extra=()):
    vvp = "%s/%s.vvp" % (SIM, name)
    rc, out = sh(["iverilog", "-g2001", "-o", vvp] + list(extra) + files)
    if rc:
        return False, out
    rc, out = sh(["vvp", "-n", vvp])
    return rc == 0, out


def parse_trace(path):
    rows = []
    with open(os.path.join(ROOT, path)) as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            t = line.split()
            r = dict(cycle=int(t[0]), pc=int(t[1], 16), instr=int(t[2], 16))
            for i, k in enumerate(CTRL_KEYS):
                r[k] = int(t[3 + i])
            r["alu_op"] = int(t[11], 2)
            r["alu_ctrl"] = int(t[12], 2)
            r["alu_result"] = int(t[13], 16)
            r["zero"] = int(t[14])
            r["write_reg"] = int(t[15])
            r["write_back"] = int(t[16], 16)
            r["mem_write_en"] = int(t[17])
            r["mem_addr"] = int(t[18], 16)
            r["mem_wdata"] = int(t[19], 16)
            r["next_pc"] = int(t[20], 16)
            rows.append(r)
    return rows


def parse_state(path):
    regs, mem, info = [0] * 32, [0] * 256, {}
    with open(os.path.join(ROOT, path)) as f:
        for line in f:
            t = line.split()
            if t[0] == "reg":
                regs[int(t[1])] = int(t[2], 16)
            elif t[0] == "mem":
                mem[int(t[1])] = int(t[2], 16)
            else:
                info[t[0]] = int(t[1])
    return regs, mem, info


def compare_cycles(gold, rtl):
    errs = []
    if len(gold) != len(rtl):
        errs.append("cycle count differs: golden %d, RTL %d" % (len(gold), len(rtl)))
    for g, r in zip(gold, rtl):
        keys = ["pc", "instr"] + CTRL_KEYS + ["alu_op", "alu_ctrl", "alu_result", "zero", "write_reg", "write_back", "next_pc"]
        for k in keys:
            if g[k] != r[k]:
                errs.append("cycle %d (pc 0x%08x): %s golden=%x rtl=%x" % (g["cycle"], g["pc"], k, g[k], r[k]))
        if r["mem_write_en"] != g["mem_write"]:
            errs.append("cycle %d: mem write enable golden=%d rtl=%d" % (g["cycle"], g["mem_write"], r["mem_write_en"]))
        if g["mem_write"] and r["mem_wdata"] != g["mem_wdata"]:
            errs.append("cycle %d: store data golden=%x rtl=%x" % (g["cycle"], g["mem_wdata"], r["mem_wdata"]))
        # the control signals must also match the documented table for this opcode
        expected = M.CONTROL.get((r["instr"] >> 26) & 0x3F, M.NOP_CONTROL)
        for k in CTRL_KEYS + ["alu_op"]:
            if r[k] != expected[k]:
                errs.append("cycle %d: control %s=%d but table says %d" % (r["cycle"], k, r[k], expected[k]))
        if len(errs) > 20:
            errs.append("... (stopping after 20 differences)")
            break
    return errs


def test_program(asm_path):
    name = os.path.splitext(os.path.basename(asm_path))[0]
    base = os.path.join("programs", name)
    with open(os.path.join(ROOT, asm_path)) as f:
        prog = M.assemble(f.read(), asm_path)
    M.write_outputs(prog, os.path.join(ROOT, base))

    gm = M.GoldenModel([t["word"] for t in prog.text], prog.data).run()

    params = ['-Ptb_program.IMEM_FILE="%s.mem"' % base,
              '-Ptb_program.OUT_PREFIX="%s/%s"' % (SIM, name)]
    if prog.data:
        params.append('-Ptb_program.DMEM_FILE="%s_data.mem"' % base)
    ok, out = run_tb(name, SRC + ["testbench/tb_program.v"], params)
    if not ok:
        return False, ["simulation failed:\n" + out]

    rtl_trace = parse_trace("%s/%s_trace.txt" % (SIM, name))
    regs, mem, info = parse_state("%s/%s_state.txt" % (SIM, name))

    errs = []
    if not gm.halted:
        errs.append("golden model did not halt")
    if not info.get("halted"):
        errs.append("RTL did not halt")
    errs += compare_cycles(gm.trace, rtl_trace)
    for i in range(32):
        if regs[i] != gm.regs[i]:
            errs.append("final %s: golden=%d rtl=%d" % (M.REG_NAMES[i], M.to_signed32(gm.regs[i]), M.to_signed32(regs[i])))
    for i in range(256):
        if mem[i] != gm.dmem[i]:
            errs.append("final mem[0x%03x]: golden=%d rtl=%d" % (4 * i, M.to_signed32(gm.dmem[i]), M.to_signed32(mem[i])))
    exp = M.check_expects(prog, regs, mem)
    errs += ["EXPECT failed: " + msg for ok_, msg in exp if not ok_]
    summary = "%d instr, %d cycles, %d EXPECT checks" % (len(prog.text), len(rtl_trace), len(exp))
    return not errs, errs or [summary]


def main():
    os.makedirs(os.path.join(ROOT, SIM), exist_ok=True)
    results = []

    for name, files, marker in [
        ("tb_alu", ["src/alu.v", "src/alu_control.v", "testbench/tb_alu.v"], "ALU TESTS PASSED"),
        ("tb_control_unit", ["src/control_unit.v", "testbench/tb_control_unit.v"], "ALL CONTROL UNIT TESTS PASSED"),
        ("tb_mips_cpu", SRC + ["testbench/tb_mips_cpu.v"], "ALL TESTS PASSED"),
    ]:
        ok, out = run_tb(name, files)
        ok = ok and marker in out and "FAIL" not in out
        results.append((name, ok, [] if ok else [out]))

    for asm in sorted(glob.glob(os.path.join(ROOT, "programs", "*.asm"))):
        rel = os.path.relpath(asm, ROOT)
        ok, msgs = test_program(rel)
        results.append((rel, ok, msgs))

    # Package programs + Verilog traces for the web UI, then check that the
    # UI's JavaScript model agrees with the RTL on every cycle.
    sh([sys.executable, "tools/export_ui_data.py"])
    if subprocess.run(["which", "node"], capture_output=True).returncode == 0:
        rc, out = sh(["node", "tools/check_ui_model.js"])
        results.append(("ui/js/isa.js vs RTL (node)", rc == 0, [] if rc == 0 else [out]))

    # Logisim circuit vs RTL (only when Java + Logisim-evolution are installed)
    jar = os.environ.get("LOGISIM_JAR", "/Applications/Logisim-evolution.app/Contents/app/logisim-evolution-4.0.0-all.jar")
    if os.path.exists(jar) and subprocess.run(["which", "java"], capture_output=True).returncode == 0:
        rc, out = sh([sys.executable, "tools/logisim/verify_logisim.py"])
        results.append(("logisim/mips_single_cycle.circ vs RTL", rc == 0, [] if rc == 0 else [out]))

    print("=" * 70)
    for name, ok, msgs in results:
        print("%-6s %s" % ("PASS" if ok else "FAIL", name), ("- " + msgs[0]) if ok and msgs else "")
        if not ok:
            for m in msgs:
                print("        " + m.replace("\n", "\n        "))
    failed = sum(not ok for _, ok, _ in results)
    print("=" * 70)
    print("%d/%d passed" % (len(results) - failed, len(results)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
