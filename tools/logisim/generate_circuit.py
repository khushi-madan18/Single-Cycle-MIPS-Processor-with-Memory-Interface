#!/usr/bin/env python3
"""
generate_circuit.py - builds logisim/mips_single_cycle.circ, a working
Logisim-evolution model of the single-cycle MIPS processor.

The circuit mirrors the Verilog modules:
    main           PC, instruction ROM, field splitters, muxes, adders, data RAM
    control_unit   opcode decoder (comparators + OR gates)       = control_unit.v
    alu_control    ALUOp/funct -> ALU operation                   = alu_control.v
    alu            AND / OR / ADD / SUB / SLT + zero              = alu.v
    register_file  32 x 32-bit registers, decoder, two 32:1 muxes = register_file.v

`main` is drawn like the textbook datapath with real wires for every data
path; control signals and the subcircuits' internals use labelled tunnels.
Exact port coordinates are not guessed: the script places the components, asks
Logisim itself where each port is (LogisimProbe.java, next to this script), then draws the
wires. A wiring checker rejects layouts where different nets would touch.

    python3 tools/logisim/generate_circuit.py                 # program = basic_test
    python3 tools/logisim/generate_circuit.py --program factorial

Needs Java and Logisim-evolution 4.x (set LOGISIM_JAR if it is not in /Applications).
"""
import argparse
import os
import subprocess
import sys
import tempfile
from xml.sax.saxutils import escape, quoteattr

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))           # repository root
OUT_DIR = os.path.join(ROOT, "logisim")                  # what you open in Logisim
JAR = os.environ.get("LOGISIM_JAR", "/Applications/Logisim-evolution.app/Contents/app/logisim-evolution-4.0.0-all.jar")
PROBE_SRC = os.path.join(HERE, "LogisimProbe.java")
PROBE_DIR = os.path.join(tempfile.gettempdir(), "logisim_probe_classes")

LIB = {"wiring": "0", "gates": "1", "plexers": "2", "arith": "3", "memory": "4", "base": "8"}


# --------------------------------------------------------------------------
# small model of a circuit
# --------------------------------------------------------------------------
class Comp:
    def __init__(self, lib, name, x, y, attrs=None, nets=None, stub=20):
        self.lib, self.name, self.x, self.y = lib, name, x, y
        self.attrs = attrs or {}
        self.nets = nets or {}      # port index -> net name
        self.stub = stub            # stub length, int or function(port index) -> int


class Tun:
    """Port connected through a short stub + tunnel (net label)."""
    def __init__(self, net, small=False, L=None, side=None):
        self.net, self.small, self.L, self.side = net, small, L, side


class Circuit:
    def __init__(self, name):
        self.name = name
        self.comps = []
        self.texts = []
        self.routes = []    # (net, [items]) drawn as real wires
        self.taps = []      # (net, x, y, direction, L): wire label hanging off a wire
        self.tunnels = []   # (net, x, y, facing): tunnel at the end of a route

    def add(self, lib, name, x, y, attrs=None, nets=None, stub=20):
        c = Comp(lib, name, x, y, attrs, nets, stub)
        self.comps.append(c)
        return c

    def text(self, x, y, s, size=16, bold=True):
        self.texts.append((x, y, s, size, bold))

    # real wires -----------------------------------------------------------
    def route(self, net, *items):
        """items: ("P", comp, port) | ("XY", x, y) | ("H", x) | ("V", y)"""
        self.routes.append((net, list(items)))

    def tap(self, net, x, y, direction, L=20):
        self.taps.append((net, x, y, direction, L))

    def tunnel(self, net, x, y, facing):
        self.tunnels.append((net, x, y, facing))

    def shift(self, dx, dy):
        for c in self.comps:
            c.x += dx
            c.y += dy
        self.texts = [(x + dx, y + dy, s, z, b) for x, y, s, z, b in self.texts]
        for _, items in self.routes:
            for k, it in enumerate(items):
                if it[0] == "XY":
                    items[k] = ("XY", it[1] + dx, it[2] + dy)
                elif it[0] == "H":
                    items[k] = ("H", it[1] + dx)
                elif it[0] == "V":
                    items[k] = ("V", it[1] + dy)
        self.taps = [(n, x + dx, y + dy, d, L) for n, x, y, d, L in self.taps]
        self.tunnels = [(n, x + dx, y + dy, f) for n, x, y, f in self.tunnels]

    # convenience builders -------------------------------------------------
    def pin_in(self, x, y, label, width, net):
        return self.add("wiring", "Pin", x, y, {"label": label, "width": width}, {0: net})

    def pin_out(self, x, y, label, width, net):
        return self.add("wiring", "Pin", x, y, {"label": label, "width": width, "type": "output", "facing": "west"}, {0: net})

    def const(self, x, y, width, value, net):
        return self.add("wiring", "Constant", x, y, {"width": width, "value": hex(value)}, {0: net})

    def mux(self, x, y, sel, width, inputs, sel_net, out_net, label=None, stub=20):
        n = 1 << sel
        nets = {i: v for i, v in enumerate(inputs) if v}
        nets[n] = sel_net
        nets[n + 1] = out_net
        a = {"select": sel, "width": width}
        if label:
            a["label"] = label
        return self.add("plexers", "Multiplexer", x, y, a, nets, stub)

    def splitter(self, x, y, incoming, mapping, combined, outs, stub=20):
        """mapping: list of (lo, hi, out_index); outs: list of nets for outputs 0.."""
        a = {"incoming": incoming, "fanout": len(outs), "spacing": 2 if len(outs) > 1 else 1, "appear": "left"}
        for b in range(incoming):
            a["bit%d" % b] = "none"
        for lo, hi, k in mapping:
            for b in range(lo, hi + 1):
                a["bit%d" % b] = k
        nets = {0: combined}
        for k, n in enumerate(outs):
            if n:
                nets[k + 1] = n
        return self.add("wiring", "Splitter", x, y, a, nets, stub)


def K(value):
    """A constant connected directly to a port (no tunnel)."""
    return ("const", value)


def attr_xml(attrs):
    out = []
    for k, v in attrs.items():
        if k == "contents":
            out.append('<a name="contents">%s</a>' % escape(v))
        else:
            out.append("<a name=%s val=%s/>" % (quoteattr(k), quoteattr(str(v))))
    return "".join(out)


def comp_xml(c):
    lib = ' lib="%s"' % LIB[c.lib] if c.lib else ""
    return '  <comp%s loc="(%d,%d)" name=%s>%s</comp>\n' % (lib, c.x, c.y, quoteattr(c.name), attr_xml(c.attrs))


def project_xml(circuits, extra=None):
    s = ['<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<project source="4.0.0" version="1.0">\n']
    s.append("  This file is generated by tools/logisim/generate_circuit.py - single-cycle MIPS processor.\n")
    for k, v in [("0", "#Wiring"), ("1", "#Gates"), ("2", "#Plexers"), ("3", "#Arithmetic"), ("4", "#Memory"), ("5", "#I/O"), ("8", "#Base")]:
        s.append('  <lib desc="%s" name="%s"/>\n' % (v, k))
    s.append('  <main name="main"/>\n')
    s.append('  <options><a name="showgrid" val="true"/><a name="simlimit" val="1000"/><a name="simrand" val="0"/></options>\n')
    for c in circuits:
        s.append('  <circuit name=%s>\n' % quoteattr(c.name))
        s.append('  <a name="circuit" val=%s/>\n' % quoteattr(c.name))
        s.append('  <a name="appearance" val="logisim_evolution"/>\n')
        for x, y, t, size, bold in c.texts:
            s.append('  <comp lib="8" loc="(%d,%d)" name="Text"><a name="text" val=%s/><a name="font" val="SansSerif %s %d"/></comp>\n'
                     % (x, y, quoteattr(t), "bold" if bold else "plain", size))
        for comp in c.comps:
            s.append(comp_xml(comp))
        for line in (extra or {}).get(c.name, []):
            s.append(line)
        s.append("  </circuit>\n")
    s.append("</project>\n")
    return "".join(s)


# --------------------------------------------------------------------------
# Logisim probe (exact port positions)
# --------------------------------------------------------------------------
def ensure_probe():
    os.makedirs(PROBE_DIR, exist_ok=True)
    cls = os.path.join(PROBE_DIR, "LogisimProbe.class")
    if not os.path.exists(cls) or os.path.getmtime(cls) < os.path.getmtime(PROBE_SRC):
        subprocess.run(["javac", "-cp", JAR, "-d", PROBE_DIR, PROBE_SRC], check=True)


def probe_ports(path):
    ensure_probe()
    r = subprocess.run(["java", "-cp", JAR + os.pathsep + PROBE_DIR, "LogisimProbe", "ports", path],
                       capture_output=True, text=True, timeout=300)
    ports = {}
    for line in r.stdout.splitlines():
        t = line.split("\t")
        if len(t) < 13:
            continue
        circ, _, fac, label, x, y, i, px, py, w, d, tip, bounds = t[:13]
        key = (circ, int(x), int(y), fac)
        ports.setdefault(key, {})[int(i)] = dict(x=int(px), y=int(py), w=int(w), dir=d, tip=tip,
                                                 bounds=tuple(int(v) for v in bounds.split(",")))
    if not ports:
        sys.exit("Logisim probe returned nothing:\n" + r.stdout[-2000:] + r.stderr[-2000:])
    return ports


def side_of(p):
    bx, by, bw, bh = p["bounds"]
    d = {"left": abs(p["x"] - bx), "right": abs(p["x"] - (bx + bw)), "top": abs(p["y"] - by), "bottom": abs(p["y"] - (by + bh))}
    return min(d, key=d.get)


def connections(circuits, ports):
    """Stub wires + tunnels for every (component, port, net)."""
    extra = {}
    for c in circuits:
        lines = []
        chk = WireCheck()
        for comp in c.comps:
            if not comp.nets:
                pp = ports.get((c.name, comp.x, comp.y, comp.name), {})
                wired = {it[2] for _, items in c.routes for it in items if it[0] == "P" and it[1] is comp}
                for idx, p in pp.items():
                    if idx not in wired:
                        chk.port(None, p["x"], p["y"], "%s.%d" % (comp.name, idx))
                continue
            fac = comp.name
            key = (c.name, comp.x, comp.y, fac)
            pp = ports.get(key)
            if pp is None:
                sys.exit("no ports found for %s %s at (%d,%d)" % (c.name, fac, comp.x, comp.y))
            for idx in comp.nets:
                if idx not in pp:
                    sys.exit("%s %s has no port %d (has %s)" % (c.name, fac, idx, sorted(pp)))
            # automatic staggering: when connected ports on one side are closer than
            # 20 px, cycle their stub lengths so the net labels do not overlap
            auto = {}
            if not callable(comp.stub):
                by_side = {}
                for idx in comp.nets:
                    by_side.setdefault(side_of(pp[idx]), []).append(idx)
                for side, idxs in by_side.items():
                    horiz = side in ("left", "right")
                    idxs.sort(key=lambda i: pp[i]["y"] if horiz else pp[i]["x"])
                    coords = [pp[i]["y"] if horiz else pp[i]["x"] for i in idxs]
                    if len(coords) > 1 and min(b - a for a, b in zip(coords, coords[1:])) < 20:
                        steps = [20, 120, 220] if horiz else [20, 50, 80]
                        for k, i in enumerate(idxs):
                            auto[i] = steps[k % 3]
            for idx, net in comp.nets.items():
                p = pp[idx]
                small = isinstance(net, Tun) and net.small
                side = (net.side if isinstance(net, Tun) and net.side else side_of(p))
                L = (net.L if isinstance(net, Tun) and net.L else None) or auto.get(idx) or \
                    (comp.stub(idx) if callable(comp.stub) else comp.stub)
                name = net.net if isinstance(net, Tun) else net
                dx, dy, facing = {"left": (-L, 0, "east"), "right": (L, 0, "west"),
                                  "top": (0, -L, "south"), "bottom": (0, L, "north")}[side]
                ex, ey = p["x"] + dx, p["y"] + dy
                lines.append('  <wire from="(%d,%d)" to="(%d,%d)"/>\n' % (p["x"], p["y"], ex, ey))
                if isinstance(name, tuple):     # K(value): a constant wired straight to this port
                    knet = "const@%d,%d" % (ex, ey)
                    chk.wire(knet, (p["x"], p["y"]), (ex, ey))
                    chk.port(knet, p["x"], p["y"], "%s.%d" % (fac, idx))
                    chk.port(knet, ex, ey, "constant")
                    lines.append('  <comp lib="0" loc="(%d,%d)" name="Constant"><a name="facing" val="%s"/><a name="width" val="%d"/><a name="value" val="%s"/></comp>\n'
                                 % (ex, ey, facing, p["w"], hex(name[1])))
                    continue
                chk.wire(name, (p["x"], p["y"]), (ex, ey))
                chk.port(name, p["x"], p["y"], "%s.%d" % (fac, idx))
                chk.port(name, ex, ey, "tunnel " + name)
                lines.append(tunnel_xml(name, ex, ey, facing, p["w"], small))
            for idx, p in pp.items():          # unconnected ports must not touch any wire
                if idx not in comp.nets:
                    chk.port(None, p["x"], p["y"], "%s.%d" % (fac, idx))
        # ---- real wires
        widths = {}
        netsegs = []
        for net, items in c.routes:
            pts = []
            for it in items:
                if it[0] == "P":
                    comp, idx = it[1], it[2]
                    p = ports[(c.name, comp.x, comp.y, comp.name)][idx]
                    nxt = (p["x"], p["y"])
                    widths[net] = p["w"]
                    chk.port(net, p["x"], p["y"], "%s.%d" % (comp.name, idx), replace=True)
                elif it[0] == "XY":
                    nxt = (it[1], it[2])
                elif it[0] == "H":
                    nxt = (it[1], pts[-1][1])
                else:
                    nxt = (pts[-1][0], it[1])
                if pts and pts[-1][0] != nxt[0] and pts[-1][1] != nxt[1]:
                    sys.exit("route %s: %s -> %s is not horizontal/vertical" % (net, pts[-1], nxt))
                pts.append(nxt)
            for a, b in zip(pts, pts[1:]):
                if a != b:
                    netsegs.append((net, a, b))
                    chk.wire(net, a, b)
        for net, x, y, d, L in c.taps:
            dx, dy, facing = {"up": (0, -L, "south"), "down": (0, L, "north"), "left": (-L, 0, "east"), "right": (L, 0, "west")}[d]
            chk.wire(net, (x, y), (x + dx, y + dy), must_touch=True)
            chk.port(net, x + dx, y + dy, "tap " + net)
            netsegs.append((net, (x, y), (x + dx, y + dy)))
            lines.append(tunnel_xml(net, x + dx, y + dy, facing, widths.get(net, 32), True))
        # A saved Logisim file only joins wires at shared END points (the editor
        # splits wires for you, the file loader does not), so split every wire
        # at each point where another wire of the same net ends on it.
        ends = {}
        for net, a, b in netsegs:
            ends.setdefault(net, set()).update([a, b])
        for net, a, b in netsegs:
            cuts = sorted({p for p in ends[net] if p not in (a, b) and WireCheck.on(p, a, b)} | {a, b},
                          key=lambda p: (p[0], p[1]) if a <= b else (-p[0], -p[1]))
            for u, v in zip(cuts, cuts[1:]):
                lines.append('  <wire from="(%d,%d)" to="(%d,%d)"/>\n' % (u + v))
        for net, x, y, facing in c.tunnels:
            chk.port(net, x, y, "tunnel " + net)
            lines.append(tunnel_xml(net, x, y, facing, widths.get(net, 1), True))
        problems = chk.check()
        if problems:
            sys.exit("wiring problems in circuit '%s':\n  " % c.name + "\n  ".join(problems[:40]))
        extra[c.name] = lines
    return extra


def tunnel_xml(net, x, y, facing, width, small=False):
    font = '<a name="labelfont" val="SansSerif bold 11"/>' if small else ""
    return ('  <comp lib="0" loc="(%d,%d)" name="Tunnel"><a name="facing" val="%s"/><a name="width" val="%d"/><a name="label" val=%s/>%s</comp>\n'
            % (x, y, facing, width, quoteattr(net), font))


class WireCheck:
    """Rejects layouts where wires of different nets touch: in Logisim a wire end
    on another wire, collinear overlapping wires, or a wire running over a
    component pin are all electrical connections."""

    def __init__(self):
        self.segs = []      # (net, (x1,y1), (x2,y2))
        self.pts = {}       # (x,y) -> (net, description)
        self.taps = []

    def wire(self, net, a, b, must_touch=False):
        self.segs.append((net, a, b))
        if must_touch:
            self.taps.append((net, a))

    def port(self, net, x, y, desc, replace=False):
        if (x, y) in self.pts and not replace and self.pts[(x, y)][0] not in (None, net) and net is not None:
            self.pts[(x, y, "dup")] = (net, desc)
        if replace or (x, y) not in self.pts or self.pts[(x, y)][0] is None:
            self.pts[(x, y)] = (net, desc)

    @staticmethod
    def on(p, a, b):
        (x, y), (x1, y1), (x2, y2) = p, a, b
        if x1 == x2 == x:
            return min(y1, y2) <= y <= max(y1, y2)
        if y1 == y2 == y:
            return min(x1, x2) <= x <= max(x1, x2)
        return False

    def check(self):
        bad = []
        S = self.segs
        for i in range(len(S)):
            n1, a1, b1 = S[i]
            for j in range(i + 1, len(S)):
                n2, a2, b2 = S[j]
                if n1 == n2:
                    continue
                for p in (a1, b1):
                    if self.on(p, a2, b2):
                        bad.append("%s end %s touches %s wire %s-%s" % (n1, p, n2, a2, b2))
                for p in (a2, b2):
                    if self.on(p, a1, b1):
                        bad.append("%s end %s touches %s wire %s-%s" % (n2, p, n1, a1, b1))
                h1, h2 = a1[1] == b1[1], a2[1] == b2[1]
                if h1 == h2:
                    if h1 and a1[1] == a2[1]:
                        lo, hi = max(min(a1[0], b1[0]), min(a2[0], b2[0])), min(max(a1[0], b1[0]), max(a2[0], b2[0]))
                        if lo < hi:
                            bad.append("%s and %s overlap on y=%d" % (n1, n2, a1[1]))
                    if not h1 and a1[0] == a2[0]:
                        lo, hi = max(min(a1[1], b1[1]), min(a2[1], b2[1])), min(max(a1[1], b1[1]), max(a2[1], b2[1]))
                        if lo < hi:
                            bad.append("%s and %s overlap on x=%d" % (n1, n2, a1[0]))
        for key, (net, desc) in self.pts.items():
            if len(key) == 3:
                bad.append("two nets meet at port %s (%s)" % (key[:2], desc))
                continue
            for n, a, b in S:
                if n != net and self.on(key, a, b):
                    bad.append("pin %s at %s (%s) lies on %s wire %s-%s" % (desc, key, net, n, a, b))
        for net, p in self.taps:      # a wire label must hang off a wire of its own net
            others = [(a, b) for n, a, b in S if n == net and a != p]
            if not any(self.on(p, a, b) for a, b in others):
                bad.append("tap for %s at %s is not on a %s wire" % (net, p, net))
        return sorted(set(bad))


# --------------------------------------------------------------------------
# the processor
# --------------------------------------------------------------------------
def read_mem(path):
    words = []
    if os.path.exists(path):
        for line in open(path):
            h = line.split("//")[0].strip()
            if h:
                words.append(int(h, 16))
    return words


def rom_contents(words):
    while words and words[-1] == 0:
        words = words[:-1]
    body = ""
    for i in range(0, len(words), 8):
        body += " ".join("%x" % w for w in words[i:i + 8]) + "\n"
    return "addr/data: 8 32\n" + body


def build_control_unit():
    c = Circuit("control_unit")
    c.text(330, 40, "Control unit: opcode -> 9 control signals (control_unit.v)")
    c.pin_in(80, 340, "op", 6, "op")
    decodes = [("is_r", 0, "R-type"), ("is_lw", 35, "LW"), ("is_sw", 43, "SW"), ("is_beq", 4, "BEQ"), ("is_addi", 8, "ADDI"), ("is_j", 2, "J")]
    for k, (net, val, nm) in enumerate(decodes):
        y = 120 + k * 100
        c.add("arith", "Comparator", 380, y, {"width": 6, "mode": "unsigned"}, {0: "op", 1: K(val), 3: net})
        c.text(330, y - 30, "opcode = %d (%s)?" % (val, nm), 12)
    c.add("gates", "OR Gate", 640, 160, {"inputs": 3}, {1: "is_lw", 2: "is_sw", 3: "is_addi", 0: "alusrc_n"})
    c.add("gates", "OR Gate", 640, 320, {"inputs": 3}, {1: "is_r", 2: "is_lw", 3: "is_addi", 0: "regwr_n"})
    c.splitter(600, 520, 2, [(0, 0, 0), (1, 1, 1)], "aluop_n", ["is_beq", "is_r"])
    outs = [("reg_dst", "is_r"), ("alu_src", "alusrc_n"), ("mem_to_reg", "is_lw"), ("reg_write", "regwr_n"),
            ("mem_read", "is_lw"), ("mem_write", "is_sw"), ("branch", "is_beq"), ("jump", "is_j")]
    for k, (lab, net) in enumerate(outs):
        c.pin_out(900, 100 + k * 60, lab, 1, net)
    c.pin_out(900, 100 + 8 * 60, "alu_op", 2, "aluop_n")
    return c


def build_alu_control():
    c = Circuit("alu_control")
    c.text(330, 40, "ALU control: ALUOp + funct -> ALU operation (alu_control.v)")
    c.pin_in(80, 140, "alu_op", 2, "aluop")
    c.pin_in(80, 340, "funct", 6, "funct")
    for k, (net, val, nm) in enumerate([("f_and", 0x24, "AND"), ("f_or", 0x25, "OR"), ("f_sub", 0x22, "SUB"), ("f_slt", 0x2A, "SLT")]):
        y = 260 + k * 90
        c.add("arith", "Comparator", 360, y, {"width": 6, "mode": "unsigned"}, {0: "funct", 1: K(val), 3: net})
        c.text(310, y - 28, "funct = %s ?" % nm, 12)
    c.add("gates", "OR Gate", 580, 250, {"inputs": 2}, {1: "f_or", 2: "f_slt", 0: "b0"})
    c.add("gates", "OR Gate", 580, 360, {"inputs": 2}, {1: "f_and", 2: "f_or", 0: "nb1"})
    c.add("gates", "NOT Gate", 680, 360, {}, {1: "nb1", 0: "b1"})
    c.add("gates", "OR Gate", 580, 470, {"inputs": 2}, {1: "f_sub", 2: "f_slt", 0: "b2"})
    c.splitter(820, 400, 4, [(0, 0, 0), (1, 1, 1), (2, 2, 2), (3, 3, 3)], "fctl", ["b0", "b1", "b2", K(0)])
    c.mux(1080, 200, 2, 4, [K(0b0010), K(0b0110), "fctl", K(0b0010)], "aluop", "ctl_n", stub=lambda i: 20 + (i % 2) * 60 if i < 4 else 20)
    c.text(1020, 110, "00 add | 01 sub | 10 funct | 11 add", 12)
    c.pin_out(1260, 200, "alu_ctl", 4, "ctl_n")
    return c


def build_alu():
    c = Circuit("alu")
    c.text(380, 40, "ALU: AND, OR, ADD, SUB, SLT + zero flag (alu.v)")
    c.pin_in(80, 140, "a", 32, "a")
    c.pin_in(80, 260, "b", 32, "b")
    c.pin_in(80, 620, "ctl", 4, "ctl")
    c.add("gates", "AND Gate", 400, 140, {"width": 32}, {1: "a", 2: "b", 0: "r_and"})
    c.add("gates", "OR Gate", 400, 240, {"width": 32, "inputs": 2}, {1: "a", 2: "b", 0: "r_or"})
    c.add("arith", "Adder", 400, 340, {"width": 32}, {0: "a", 1: "b", 2: "r_add"})
    c.add("arith", "Subtractor", 400, 430, {"width": 32}, {0: "a", 1: "b", 2: "r_sub"})
    c.add("arith", "Comparator", 400, 520, {"width": 32, "mode": "twosComplement"}, {0: "a", 1: "b", 4: "lt"})
    c.add("wiring", "Bit Extender", 560, 520, {"in_width": 1, "out_width": 32, "type": "zero"}, {1: "lt", 0: "r_slt"})
    c.splitter(260, 620, 4, [(0, 2, 0)], "ctl", ["sel3"])
    c.mux(860, 330, 3, 32, ["r_and", "r_or", "r_add", K(0), K(0), K(0), "r_sub", "r_slt"], "sel3", "res",
          stub=lambda i: 20 + (i % 2) * 70 if i < 8 else 20)
    c.text(800, 230, "ctl[2:0]: 000 AND, 001 OR, 010 ADD, 110 SUB, 111 SLT", 12)
    c.add("arith", "Comparator", 1060, 460, {"width": 32, "mode": "unsigned"}, {0: "res", 1: K(0), 3: "zero_n"})
    c.pin_out(1320, 330, "result", 32, "res")
    c.pin_out(1320, 460, "zero", 1, "zero_n")
    return c


def build_register_file():
    c = Circuit("register_file")
    c.text(700, 30, "Register file: 32 x 32-bit, 2 read ports, 1 write port, $zero hard-wired (register_file.v)")
    c.pin_in(80, 100, "clk", 1, "clk")
    c.pin_in(80, 160, "we", 1, "we")
    c.pin_in(80, 220, "ra1", 5, "ra1")
    c.pin_in(80, 280, "ra2", 5, "ra2")
    c.pin_in(80, 340, "wa", 5, "wa")
    c.pin_in(80, 400, "wd", 32, "wd")
    dec = {i: "en%d" % i for i in range(1, 32)}
    dec[32] = "wa"
    dec[33] = "we"
    c.add("plexers", "Decoder", 300, 700, {"select": 5, "enable": "true"}, dec, stub=lambda i: 20 + (i % 2) * 60 if i < 32 else 20)
    c.text(290, 330, "write decoder", 12)
    for i in range(1, 32):
        col, row = divmod(i - 1, 8)
        x, y = 520 + col * 260, 180 + row * 140
        c.add("memory", "Register", x, y, {"width": 32, "label": "R%d" % i},
              {0: "q%d" % i, 1: "wd", 2: "clk", 4: "en%d" % i})
    stub = lambda i: 20 + (i % 3) * 50 if i < 32 else 20
    c.mux(1720, 700, 5, 32, [K(0)] + ["q%d" % i for i in range(1, 32)], "ra1", "rd1_n", label="READ1", stub=stub)
    c.mux(2020, 700, 5, 32, [K(0)] + ["q%d" % i for i in range(1, 32)], "ra2", "rd2_n", label="READ2", stub=stub)
    c.pin_out(2200, 600, "rd1", 32, "rd1_n")
    c.pin_out(2200, 800, "rd2", 32, "rd2_n")
    return c


def build_main(imem_words):
    """Compact, textbook-style datapath. Data paths are real wires; control
    signals arrive as short labelled tags (as in Patterson & Hennessy)."""
    c = Circuit("main")
    P = lambda comp, i: ("P", comp, i)
    XY = lambda x, y: ("XY", x, y)
    H = lambda x: ("H", x)
    V = lambda y: ("V", y)
    small = lambda n, **k: Tun(n, small=True, **k)

    # ---------------- titles ----------------
    c.text(740, -50, "Single-cycle MIPS processor  -  Logisim model of src/mips_cpu.v", 18)
    for x, t in [(230, "IF  (fetch)"), (640, "ID  (decode, read registers)"), (1000, "EX  (execute)"),
                 (1260, "MEM  (data memory)"), (1460, "WB")]:
        c.text(x, -22, t, 13)
    c.text(90, -8, "next PC", 10, bold=False)

    # ---------------- fetch ----------------
    pc = c.add("memory", "Register", 60, 330, {"width": 32, "label": "PC"},
               {2: small("clk"), 3: small("rst"), 4: K(1)})
    s_ia = c.splitter(150, 360, 32, [(2, 9, 0)], None, [None])
    s_ia.nets = {}
    rom = c.add("memory", "ROM", 200, 340, {"addrWidth": 8, "dataWidth": 32, "appearance": "classic", "contents": rom_contents(imem_words)}, {})
    add4 = c.add("arith", "Adder", 260, 60, {"width": 32}, {1: K(4)}, stub=10)
    c.text(240, 30, "PC + 4", 11)
    c.text(175, 345, "[9:2]", 9, bold=False)
    c.text(320, 498, "Instruction memory", 12)

    # ---------------- decode ----------------
    f = c.splitter(480, 400, 32, [(26, 31, 0), (21, 25, 1), (16, 20, 2), (11, 15, 3), (0, 5, 4)], None, [None] * 5)
    f.nets = {}
    s_imm = c.splitter(480, 620, 32, [(0, 15, 0)], None, [None]); s_imm.nets = {}
    s_tg = c.splitter(480, 160, 32, [(0, 25, 0)], None, [None]); s_tg.nets = {}
    for y, t in [(305, "op [31:26]"), (325, "rs [25:21]"), (345, "rt [20:16]"), (365, "rd [15:11]"), (385, "funct [5:0]")]:
        c.text(503 + len(t) * 2.6, y, t, 8, bold=False)
    c.text(530, 605, "imm [15:0]", 8, bold=False)
    c.text(410, 150, "target [25:0]", 8, bold=False)
    cu = c.add(None, "control_unit", 760, 100, {}, {i: small(n) for i, n in enumerate(
        ["reg_dst", "alu_src", "mem_to_reg", "reg_write", "mem_read", "mem_write", "branch", "jump", "alu_op"], 1)})
    rf = c.add(None, "register_file", 830, 360, {}, {0: small("clk"), 1: small("reg_write")})
    m_rd = c.mux(650, 480, 1, 5, [None, None], small("reg_dst"), None, label="RegDst")
    m_rd.nets = {2: small("reg_dst")}
    se = c.add("wiring", "Bit Extender", 600, 610, {"in_width": 16, "out_width": 32, "type": "sign"}, {})
    c.text(580, 645, "Sign extend", 10)

    # ---------------- execute ----------------
    m_as = c.mux(900, 410, 1, 32, [None, None], None, None, label="ALUSrc")
    m_as.nets = {2: small("alu_src", L=10)}
    alu = c.add(None, "alu", 1060, 360, {}, {})
    aluc = c.add(None, "alu_control", 1250, 600, {}, {0: small("alu_op"), 1: small("funct"), 2: small("alu_ctl")})
    sh = c.add("arith", "Shifter", 1000, 200, {"width": 32, "shift": "ll"}, {1: K(2)}, stub=10)
    c.text(980, 170, "Shift left 2", 10)
    badd = c.add("arith", "Adder", 1100, 160, {"width": 32}, {})
    c.text(1150, 140, "Add (branch)", 10)
    andg = c.add("gates", "AND Gate", 1200, 250, {}, {1: small("branch")})
    c.text(1180, 292, "Branch AND Zero", 9, bold=False)

    # ---------------- memory / write-back / next PC ----------------
    s_da = c.splitter(1100, 440, 32, [(2, 9, 0)], None, [None]); s_da.nets = {}
    ram = c.add("memory", "RAM", 1140, 420, {"addrWidth": 8, "dataWidth": 32, "appearance": "classic", "asyncread": "true", "enables": "line"},
                {3: small("mem_write"), 4: small("clk", L=90)})
    m_wb = c.mux(1450, 470, 1, 32, [None, None], None, None, label="MemtoReg")
    m_wb.nets = {2: small("mem_to_reg")}
    m_pc = c.mux(1260, 110, 1, 32, [None, None], None, None, label="PCSrc")
    m_pc.nets = {}
    s_hi = c.splitter(1230, 60, 32, [(28, 31, 0)], None, [None]); s_hi.nets = {}
    jt = c.splitter(1310, 190, 32, [(28, 31, 0), (2, 27, 1), (0, 1, 2)], None, [None] * 3)
    jt.attrs["facing"] = "west"
    jt.nets = {3: K(0)}
    jt.stub = 10
    c.text(1300, 265, "{PC+4[31:28], target, 00}", 9, bold=False)
    c.text(1260, 562, "Data memory", 12)
    for x, y, t in [(635, 452, "RegDst"), (885, 382, "ALUSrc"), (1435, 442, "MemtoReg"), (1245, 82, "PCSrc"), (1345, 92, "Jump")]:
        c.text(x, y, t, 10)
    m_j = c.mux(1360, 120, 1, 32, [None, None], None, None, label="Jump")
    m_j.nets = {2: small("jump")}

    # ---------------- wires ----------------
    r = c.route
    r("pc", P(pc, 0), P(s_ia, 0))
    r("pc", XY(140, 360), V(50), P(add4, 0))
    r("iaddr", P(s_ia, 1), P(rom, 0))
    r("instr", P(rom, 1), H(460))
    r("instr", XY(460, 160), V(620))
    r("instr", XY(460, 160), P(s_tg, 0))
    r("instr", XY(460, 400), P(f, 0))
    r("instr", XY(460, 620), P(s_imm, 0))
    r("op", P(f, 1), H(550), V(100), P(cu, 0))
    r("rs", P(f, 2), H(590), V(400), P(rf, 2))
    r("rt", P(f, 3), H(580), V(420), P(rf, 3))
    r("rt", XY(580, 420), V(470), P(m_rd, 0))
    r("rd", P(f, 4), H(570), V(490), P(m_rd, 1))
    r("funct", P(f, 5), H(530), V(520))
    c.tunnel("funct", 530, 520, "north")
    r("wreg", P(m_rd, 3), H(680), V(440), P(rf, 4))
    r("imm16", P(s_imm, 1), P(se, 1))
    r("immx", P(se, 0), H(860), V(420), P(m_as, 1))
    r("immx", XY(860, 420), V(300), H(900), V(190), P(sh, 0))
    r("rd1", P(rf, 6), P(alu, 0))
    r("rd2", P(rf, 7), H(850), V(400), P(m_as, 0))
    r("rd2", XY(850, 400), V(520), H(1120), V(480), P(ram, 2))
    r("alub", P(m_as, 3), H(920), V(380), P(alu, 1))
    r("alu_ctl", P(alu, 2), H(930), V(440))
    c.tunnel("alu_ctl", 930, 440, "north")
    r("alu_res", P(alu, 3), H(1080), V(440), P(s_da, 0))
    r("alu_res", XY(1080, 360), H(1400), V(460), P(m_wb, 0))
    r("daddr", P(s_da, 1), P(ram, 0))
    r("zero", P(alu, 4), H(1070), V(270), P(andg, 2))
    r("mdata", P(ram, 1), P(m_wb, 1))
    r("wb", P(m_wb, 3), H(1480), V(680), H(690), V(460), P(rf, 5))
    r("pc4", P(add4, 2), H(1210), V(100), P(m_pc, 0))
    r("pc4", XY(1040, 60), V(150), P(badd, 0))
    r("pc4", XY(1210, 60), P(s_hi, 0))
    r("pc4hi", P(s_hi, 1), H(1280), V(200), P(jt, 1))
    r("immsh", P(sh, 2), H(1030), V(170), P(badd, 1))
    r("btarget", P(badd, 2), H(1220), V(120), P(m_pc, 1))
    r("take", P(andg, 0), H(1240), P(m_pc, 2))
    r("target", P(s_tg, 1), H(520), V(20), H(1270), V(220), P(jt, 2))
    r("pcsrc", P(m_pc, 3), P(m_j, 0))
    r("jtarget", P(jt, 0), H(1320), V(130), P(m_j, 1))
    r("npc", P(m_j, 3), H(1390), V(0), H(20), V(360), P(pc, 1))

    # wire labels (also feed the test harness below)
    c.tap("pc", 130, 360, "down")
    c.tap("instr", 460, 520, "left")
    c.tap("wreg", 660, 480, "down")
    c.tap("alu_res", 1300, 360, "up")
    c.tap("zero", 1100, 270, "down")
    c.tap("wb", 1000, 680, "up")
    c.tap("npc", 20, 200, "right")
    c.tap("rd1", 900, 360, "up")
    c.tap("rd2", 1000, 520, "up")
    c.tap("immx", 760, 610, "down")
    c.tap("pc4", 400, 60, "down")
    c.tap("btarget", 1160, 160, "down")

    # ---------------- test harness (not part of the CPU) ----------------
    hy = 790
    c.text(700, hy - 30, "Test harness  -  not part of the CPU: clock, reset and the output pins read by  logisim -tty  to compare with the Verilog simulation", 11)
    c.add("wiring", "Clock", 80, hy + 20, {"label": "clk"}, {0: "clk"})
    c.pin_in(80, hy + 80, "reset", 1, "rst")
    c.splitter(300, hy + 170, 8, [(7, 7, 7), (6, 6, 6), (5, 5, 5), (4, 4, 4), (3, 3, 3), (2, 2, 2), (1, 1, 1), (0, 0, 0)], "ctrl8",
               ["jump", "branch", "mem_write", "mem_read", "reg_write", "mem_to_reg", "alu_src", "reg_dst"])
    c.add("arith", "Comparator", 700, hy + 40, {"width": 32, "mode": "unsigned"}, {0: "npc", 1: "pc", 3: "halt_n"})
    c.text(680, hy + 5, "halt when next PC = PC", 10, bold=False)
    obs = [("o_pc", 32, "pc"), ("o_instr", 32, "instr"), ("o_ctrl", 8, "ctrl8"), ("o_aluop", 2, "alu_op"),
           ("o_aluctl", 4, "alu_ctl"), ("o_alures", 32, "alu_res"), ("o_zero", 1, "zero"), ("o_wreg", 5, "wreg"),
           ("o_wb", 32, "wb"), ("o_memw", 1, "mem_write"), ("o_npc", 32, "npc"), ("halt", 1, "halt_n")]
    for k, (lab, w, net) in enumerate(obs):      # one column: -tty prints pins top to bottom
        pin = c.pin_out(1100, hy + 10 + k * 30, lab, w, net)
        if w > 4:
            pin.attrs["radix"] = "16"

    c.shift(40, 80)
    return c


SUB_NETS = {
    # subcircuit instance pin label -> net in main
    "control_unit": {"op": "op", "reg_dst": "reg_dst", "alu_src": "alu_src", "mem_to_reg": "mem_to_reg", "reg_write": "reg_write",
                     "mem_read": "mem_read", "mem_write": "mem_write", "branch": "branch", "jump": "jump", "alu_op": "alu_op"},
    "register_file": {"clk": "clk", "we": "reg_write", "ra1": "rs", "ra2": "rt", "wa": "wreg", "wd": "wb", "rd1": "rd1", "rd2": "rd2"},
    "alu_control": {"alu_op": "alu_op", "funct": "funct", "alu_ctl": "alu_ctl"},
    "alu": {"a": "rd1", "b": "alub", "ctl": "alu_ctl", "result": "alu_res", "zero": "zero"},
}


def build(imem_words, out_path):
    circuits = [build_main(imem_words), build_control_unit(), build_alu_control(), build_alu(), build_register_file()]
    # pass 1: components only -> ask Logisim for the port positions
    with tempfile.NamedTemporaryFile("w", suffix=".circ", delete=False) as f:
        f.write(project_xml(circuits))
        tmp = f.name
    ports = probe_ports(tmp)
    os.unlink(tmp)
    # subcircuit instances: map ports by their tooltip (= pin label)
    main = circuits[0]
    for comp in main.comps:
        if comp.name in SUB_NETS:
            # sanity check: port order of the subcircuit boxes is what build_main assumes
            pp = ports[("main", comp.x, comp.y, comp.name)]
            names = [pp[i]["tip"].split(":")[0].strip() for i in sorted(pp)]
            if names != list(SUB_NETS[comp.name]):
                sys.exit("%s port order changed: %s" % (comp.name, names))
            continue
        if False:
            pp = ports[("main", comp.x, comp.y, comp.name)]
            for i, p in pp.items():
                lab = p["tip"].split(":")[0].strip()
                if lab not in SUB_NETS[comp.name]:
                    sys.exit("unexpected port '%s' on %s" % (p["tip"], comp.name))
                comp.nets[i] = SUB_NETS[comp.name][lab]
            missing = set(SUB_NETS[comp.name].values()) - set(comp.nets.values())
            if missing:
                sys.exit("%s: ports not found for %s" % (comp.name, missing))
    # pass 2: stubs + tunnels
    xml = project_xml(circuits, connections(circuits, ports))
    with open(out_path, "w") as f:
        f.write(xml)
    return out_path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--program", default="basic_test", help="programs/<name>.mem to put in the instruction ROM")
    ap.add_argument("-o", "--out", default=os.path.join(OUT_DIR, "mips_single_cycle.circ"))
    ap.add_argument("--render", action="store_true", help="also draw every circuit to docs/logisim/<circuit>.png")
    a = ap.parse_args()
    words = read_mem(os.path.join(ROOT, "programs", a.program + ".mem"))
    if not words:
        sys.exit("programs/%s.mem not found (run python3 tools/mips_asm.py programs/%s.asm)" % (a.program, a.program))
    print("wrote", build(words, a.out))
    # Logisim memory images (File > right-click ROM/RAM > Load Image...) for every sample program
    img_dir = os.path.join(OUT_DIR, "images")
    os.makedirs(img_dir, exist_ok=True)
    for asm in sorted(os.listdir(os.path.join(ROOT, "programs"))):
        if not asm.endswith(".asm"):
            continue
        name = asm[:-4]
        for suffix, kind in [("", "imem"), ("_data", "dmem")]:
            ws = read_mem(os.path.join(ROOT, "programs", name + suffix + ".mem"))
            if ws:
                while len(ws) > 1 and ws[-1] == 0:
                    ws = ws[:-1]
                with open(os.path.join(img_dir, "%s_%s.img" % (name, kind)), "w") as f:
                    f.write("v2.0 raw\n" + "\n".join("%x" % w for w in ws) + "\n")
    print("wrote", os.path.relpath(img_dir, ROOT) + "/*.img")
    if a.render:
        out_dir = os.path.join(ROOT, "docs", "logisim")
        os.makedirs(out_dir, exist_ok=True)
        for name in ["main", "control_unit", "alu_control", "alu", "register_file"]:
            png = os.path.join(out_dir, name + ".png")
            subprocess.run(["java", "-cp", JAR + os.pathsep + PROBE_DIR, "LogisimProbe", "render", a.out, name, png, "1"],
                           check=True, capture_output=True, timeout=300)
            print("wrote", os.path.relpath(png, ROOT))


if __name__ == "__main__":
    main()
