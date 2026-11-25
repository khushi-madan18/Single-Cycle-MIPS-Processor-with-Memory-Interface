#!/usr/bin/env python3
"""
export_sim_results.py - run every Verilog testbench with Icarus Verilog and
package the results for the web UI's "Testbench" and "Waveform" tabs.

    python3 tools/export_sim_results.py

It runs the full regression (tools/run_tests.py), then re-runs each compiled
testbench (simulation/*.vvp) to capture its console output, and writes

    ui/data/sim_results.js   testbench sources, console logs, test vectors, regression log
    ui/data/vcd_data.js      the VCD waveform dumps written by the testbenches

Nothing in these files is hand-made: logs and waveforms are exactly what
iverilog/vvp produced on this machine.
"""
import datetime
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIM = "simulation"
PROGRAMS = ["basic_test", "array_sum", "max_search", "factorial"]

UNIT_TBS = [
    dict(id="tb_alu", file="testbench/tb_alu.v", level="Unit", title="ALU and ALU control",
         dut=["src/alu.v", "src/alu_control.v"], marker="ALU TESTS PASSED",
         what="Applies fixed input vectors to the ALU (AND, OR, ADD, SUB, signed SLT, unused code) and checks "
              "the 32-bit result and the zero flag, including overflow wrap-around and negative numbers. "
              "Then checks that ALU control decodes ALUOp + funct correctly for every instruction."),
    dict(id="tb_control_unit", file="testbench/tb_control_unit.v", level="Unit", title="Main control unit",
         dut=["src/control_unit.v"], marker="ALL CONTROL UNIT TESTS PASSED",
         what="Drives every supported opcode (and one unknown opcode) into the control unit and compares all "
              "nine control outputs (RegDst, ALUSrc, MemtoReg, RegWrite, MemRead, MemWrite, Branch, Jump, ALUOp) "
              "with the control table."),
    dict(id="tb_mips_cpu", file="testbench/tb_mips_cpu.v", level="System", title="Complete processor (self-checking)",
         dut=["src/*.v"], marker="ALL TESTS PASSED", vcd="mips_cpu",
         what="Instantiates the top-level mips_cpu with programs/basic_test.mem, applies a 10 ns clock and reset, "
              "prints PC / instruction / ALU result / next PC on every cycle, then checks the final register "
              "and data-memory values."),
]
PROG_TITLES = {"basic_test": "Basic test (every instruction)", "array_sum": "Array sum",
               "max_search": "Maximum search", "factorial": "Factorial (6!)"}


def sh(cmd):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def read(path):
    with open(os.path.join(ROOT, path)) as f:
        return f.read()


def alu_vectors(src):
    """Parse the check_alu / check_ac calls in tb_alu.v into a test-vector table."""
    ops = {"0000": "AND", "0001": "OR", "0010": "ADD", "0110": "SUB", "0111": "SLT", "1111": "unused"}
    out = []
    for m in re.finditer(r"check_alu\(4'b(\d+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*(\d)\);\s*(?://\s*(.*))?", src):
        ctl, a, b, exp, z, note = m.groups()
        out.append(dict(kind="alu", op=ops.get(ctl, ctl), ctl=ctl, a=a.strip(), b=b.strip(), exp=exp.strip(), zero=z, note=(note or "").strip()))
    for m in re.finditer(r"check_ac\(2'b(\d+),\s*6'b([x\d]+),\s*4'b(\d+)\);\s*(?://\s*(.*))?", src):
        op, fn, exp, note = m.groups()
        out.append(dict(kind="ac", aluop=op, funct=fn, exp=exp, note=(note or "").strip()))
    return out


def program_expects(name):
    return [l.split("EXPECT", 1)[1].strip() for l in read("programs/%s.asm" % name).splitlines() if "# EXPECT" in l]


def main():
    rc, ver = sh(["iverilog", "-V"])
    ver = ver.splitlines()[0] if ver else "Icarus Verilog"
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    print("running the regression (tools/run_tests.py) ...")
    rc, regression = sh([sys.executable, "tools/run_tests.py"])
    summary = {}
    for line in regression.splitlines():
        m = re.match(r"(PASS|FAIL)\s+(\S+)(?:\s+-\s+(.*))?", line)
        if m:
            summary[m.group(2)] = (m.group(1) == "PASS", (m.group(3) or "").strip())
    passed = re.search(r"(\d+)/(\d+) passed", regression)

    tbs = []
    for tb in UNIT_TBS:
        _, log = sh(["vvp", "-n", "%s/%s.vvp" % (SIM, tb["id"])])
        ok = summary.get(tb["id"], (False, ""))[0]
        files = " ".join(tb["dut"] + [tb["file"]])
        entry = dict(tb, source=read(tb["file"]), log=log.rstrip(), ok=ok,
                     cmd="iverilog -g2001 -o simulation/%s.vvp %s\nvvp -n simulation/%s.vvp" % (tb["id"], files, tb["id"]))
        if tb["id"] == "tb_alu":
            entry["vectors"] = alu_vectors(entry["source"])
        tbs.append(entry)

    prog_src = read("testbench/tb_program.v")
    for name in PROGRAMS:
        _, log = sh(["vvp", "-n", "%s/%s.vvp" % (SIM, name)])
        ok, msg = summary.get("programs/%s.asm" % name, (False, ""))
        data = os.path.exists(os.path.join(ROOT, "programs", name + "_data.mem"))
        cmd = ("iverilog -g2001 -o simulation/{n}.vvp \\\n  -Ptb_program.IMEM_FILE=\\\"programs/{n}.mem\\\" \\\n" +
               ("  -Ptb_program.DMEM_FILE=\\\"programs/{n}_data.mem\\\" \\\n" if data else "") +
               "  -Ptb_program.OUT_PREFIX=\\\"simulation/{n}\\\" src/*.v testbench/tb_program.v\nvvp -n simulation/{n}.vvp").format(n=name)
        tbs.append(dict(id="tb_program:" + name, file="testbench/tb_program.v", level="Program", vcd=name,
                        title=PROG_TITLES.get(name, name), program=name, dut=["src/*.v"], source=prog_src,
                        log=log.rstrip(), ok=ok, result=msg, expects=program_expects(name), cmd=cmd,
                        what="Runs programs/%s.asm on the Verilog CPU until it halts, writes a per-cycle trace and a VCD "
                             "waveform. tools/run_tests.py then compares every cycle (PC, instruction, control signals, "
                             "ALU result, zero, write-back, memory writes, next PC) with the Python golden model, checks "
                             "all 32 registers and 256 memory words at the end, and checks the # EXPECT lines." % name))

    vcds = {}
    for key in ["mips_cpu"] + PROGRAMS:
        p = os.path.join(ROOT, SIM, key + ".vcd")
        if os.path.exists(p):
            vcds[key] = read(os.path.join(SIM, key + ".vcd"))

    out_dir = os.path.join(ROOT, "ui", "data")
    hdr = "// Generated by tools/export_sim_results.py - do not edit by hand.\n"
    res = dict(tool=ver, date=now, regression=regression.rstrip(),
               passed=int(passed.group(1)) if passed else 0, total=int(passed.group(2)) if passed else 0,
               testbenches=tbs)
    with open(os.path.join(out_dir, "sim_results.js"), "w") as f:
        f.write(hdr + "// Console output of every Verilog testbench, recorded with Icarus Verilog.\n")
        f.write("window.SIM_RESULTS = " + json.dumps(res, indent=1) + ";\n")
    with open(os.path.join(out_dir, "vcd_data.js"), "w") as f:
        f.write(hdr + "// VCD waveform dumps written by testbench/tb_mips_cpu.v and testbench/tb_program.v.\n")
        f.write("window.VCD_FILES = " + json.dumps(vcds, separators=(",", ":")) + ";\n")
    print("wrote ui/data/sim_results.js (%d testbenches, regression %s) and ui/data/vcd_data.js (%d dumps)"
          % (len(tbs), passed.group(0) if passed else "?", len(vcds)))
    return 0 if passed and passed.group(1) == passed.group(2) else 1


if __name__ == "__main__":
    sys.exit(main())
