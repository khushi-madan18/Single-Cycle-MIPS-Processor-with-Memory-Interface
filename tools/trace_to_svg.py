#!/usr/bin/env python3
"""
trace_to_svg.py - draw a timing diagram (SVG) from the per-cycle trace that
testbench/tb_program.v writes during Verilog simulation.

    python3 tools/trace_to_svg.py simulation/basic_test_trace.txt docs/waveforms/basic_test.svg
    python3 tools/trace_to_svg.py simulation/array_sum_trace.txt  docs/waveforms/array_sum.svg --cycles 24

No external libraries needed. For the full waveform (every wire) open the
.vcd file from the same run in GTKWave or Surfer.
"""

import argparse
import os
import sys
from html import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mips_asm as M          # noqa: E402
from run_tests import parse_trace  # noqa: E402

BITS = [("RegDst", "reg_dst"), ("ALUSrc", "alu_src"), ("MemtoReg", "mem_to_reg"),
        ("RegWrite", "reg_write"), ("MemRead", "mem_read"), ("MemWrite", "mem_write"),
        ("Branch", "branch"), ("Jump", "jump"), ("Zero", "zero")]


def bus_rows(rows):
    return [
        ("PC", [("%X" % r["pc"]) for r in rows]),
        ("Instruction", [M.decode(r["instr"])["asm"] for r in rows]),
        ("Machine code", [("%08X" % r["instr"]) for r in rows]),
        ("ALUOp", [format(r["alu_op"], "02b") for r in rows]),
        ("ALU ctrl", [format(r["alu_ctrl"], "04b") for r in rows]),
        ("ALU result", [str(M.to_signed32(r["alu_result"])) for r in rows]),
        ("Write reg", [M.REG_NAMES[r["write_reg"]] if r["reg_write"] else "-" for r in rows]),
        ("Write data", [str(M.to_signed32(r["write_back"])) if r["reg_write"] else "-" for r in rows]),
        ("Next PC", [("%X" % r["next_pc"]) for r in rows]),
    ]


def render(rows, title):
    n = len(rows)
    lw, cw, rh = 110, 160, 26           # label width, cycle width, row height
    top = 56
    signals = 1 + len(bus_rows(rows)) + len(BITS)
    W = lw + n * cw + 20
    H = top + signals * rh + 30
    o = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" '
         'font-family="Menlo, Consolas, monospace" font-size="11">' % (W, H, W, H),
         '<rect width="100%" height="100%" fill="#ffffff"/>',
         '<text x="10" y="20" font-size="14" font-weight="bold" fill="#111">%s</text>' % escape(title),
         '<text x="10" y="38" fill="#555">One column = one clock cycle = one complete instruction '
         '(values sampled before the rising edge that commits them)</text>']
    for c in range(n):
        x = lw + c * cw
        o.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#e5e7eb"/>' % (x, top - 6, x, H - 20))
        o.append('<text x="%d" y="%d" fill="#888" font-size="9">c%d</text>' % (x + 3, H - 8, rows[c]["cycle"]))
    y = top

    def label(text, yy):
        o.append('<text x="10" y="%d" fill="#111">%s</text>' % (yy + rh * 0.62, escape(text)))

    # clock
    label("clk", y)
    path = []
    for c in range(n):
        x = lw + c * cw
        hi, lo = y + 5, y + rh - 5
        path += ["M%d %d" % (x, lo), "L%d %d" % (x, hi), "L%d %d" % (x + cw / 2, hi),
                 "L%d %d" % (x + cw / 2, lo), "L%d %d" % (x + cw, lo)]
    o.append('<path d="%s" stroke="#111" fill="none" stroke-width="1.2"/>' % " ".join(path))
    y += rh

    # buses
    for name, vals in bus_rows(rows):
        label(name, y)
        c = 0
        while c < n:
            e = c
            while e + 1 < n and vals[e + 1] == vals[c] and name not in ("PC", "Instruction", "Machine code"):
                e += 1
            x0, x1 = lw + c * cw + 2, lw + (e + 1) * cw - 2
            y0, y1, ym = y + 4, y + rh - 4, y + rh / 2
            o.append('<path d="M%d %d L%d %d L%d %d L%d %d L%d %d L%d %d Z" fill="#eef4ff" stroke="#2f5fb3"/>'
                     % (x0, ym, x0 + 4, y0, x1 - 4, y0, x1, ym, x1 - 4, y1, x0 + 4, y1))
            txt = vals[c]
            maxch = int((x1 - x0 - 8) / 6.7)
            if len(txt) > maxch:
                txt = txt[:max(1, maxch - 1)] + "…"
            o.append('<text x="%d" y="%d" fill="#123" text-anchor="middle">%s</text>'
                     % ((x0 + x1) / 2, ym + 4, escape(txt)))
            c = e + 1
        y += rh

    # single-bit control signals
    for name, key in BITS:
        label(name, y)
        hi, lo = y + 5, y + rh - 5
        pts, prev = [], None
        for c, r in enumerate(rows):
            v = r[key]
            x = lw + c * cw
            yy = hi if v else lo
            if prev is None:
                pts.append("M%d %d" % (x, yy))
            elif prev != v:
                pts.append("L%d %d" % (x, yy))
            pts.append("L%d %d" % (x + cw, yy))
            if v:
                o.append('<rect x="%d" y="%d" width="%d" height="%d" fill="#dcfce7"/>' % (x, hi, cw, lo - hi))
            prev = v
        o.append('<path d="%s" stroke="#15803d" fill="none" stroke-width="1.6"/>' % " ".join(pts))
        y += rh
    o.append("</svg>")
    return "\n".join(o)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("trace")
    ap.add_argument("out")
    ap.add_argument("--cycles", type=int, default=16)
    ap.add_argument("--title")
    a = ap.parse_args()
    rows = parse_trace(a.trace)[:a.cycles]
    title = a.title or "Single-cycle MIPS - %s" % os.path.basename(a.trace).replace("_trace.txt", "")
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w") as f:
        f.write(render(rows, title))
    print("wrote", a.out)


if __name__ == "__main__":
    main()
