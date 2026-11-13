# Logisim model of the single-cycle MIPS processor

`mips_single_cycle.circ` is a **working** Logisim-evolution (4.x) circuit of the same processor as the Verilog in `src/`. It is built only from standard Logisim parts (gates, comparators, adders, multiplexers, a decoder, registers, ROM and RAM). It runs the same programs and produces the same result on every clock cycle as the Verilog RTL.

| Circuit | Matches | What is inside |
|---|---|---|
| `main` | `mips_cpu.v` / `mips_core.v` | PC register, PC+4 adder, instruction ROM, field splitters, RegDst / ALUSrc / MemtoReg / PCSrc / Jump muxes, sign extender, branch shifter and adder, jump-target splitter, data RAM, halt detector |
| `control_unit` | `control_unit.v` | one comparator per opcode (R, LW, SW, BEQ, ADDI, J) and OR gates for the shared signals |
| `alu_control` | `alu_control.v` | funct comparators, gate logic for the 4-bit operation, mux on ALUOp |
| `alu` | `alu.v` | 32-bit AND, OR, adder, subtractor, signed comparator for SLT, 8:1 result mux, zero detector |
| `register_file` | `register_file.v` | 5→32 write decoder gated by `we`, 31 × 32-bit registers, `$zero` as a constant, two 32:1 read muxes |

Diagrams of every circuit are in [`docs/logisim/`](../docs/logisim/): `main.png`, `control_unit.png`, `alu_control.png`, `alu.png`, `register_file.png`.

**How `main` is drawn.** It is laid out like the textbook single-cycle datapath, left to right: PC → instruction memory → instruction fields → register file → ALUSrc mux → ALU → data memory → MemtoReg mux, with write-back looping along the bottom. The PC+4 / branch / jump logic runs along the top, and the next-PC wire loops back to the PC. **All data paths are real wires.** Control signals reach each mux and memory as short labelled tags (`reg_dst`, `alu_src`, `mem_write`, …) coming from the `control_unit` box, the same convention as Patterson & Hennessy. Small labels hanging off wires (`pc`, `rd1`, `alu_res`, `wb`, …) name the main buses. The **test harness** below the datapath (clock, reset and output pins) is not part of the CPU; it lets the automated check read the processor's state.

## Using it in the Logisim GUI

1. Open Logisim-evolution → **File → Open** → `logisim/mips_single_cycle.circ`. (If an older copy is already open, close it **without saving**, otherwise the old version overwrites the new file.)
2. Zoom so the datapath fills the window. It fits at about 0.8–1× on a laptop; the harness below can stay off-screen.
3. The instruction ROM already holds `basic_test`. Press **Ctrl+T** (Simulate → Tick Once) to advance the clock. One full instruction takes a rising edge, so press it twice per instruction. **Ctrl+K** ticks continuously. Wires turn bright green for 1, dark green for 0, and blue for multi-bit values. Hover a wire, or use the Poke tool on it, to see its value.
4. Double-click a subcircuit (`control_unit`, `alu`, `alu_control`, `register_file`) to look inside it while it runs.
5. To run another program, right-click the ROM → **Load Image…** → `logisim/images/<name>_imem.img`. Right-click the RAM → **Load Image…** → `logisim/images/<name>_dmem.img`. Then use **Simulate → Reset Simulation**.
6. The output pins in the harness (`o_pc`, `o_instr`, `o_ctrl`, …) show the state in hex. `halt` turns 1 when the program reaches its `halt` loop.

**Suggested viva walk-through:** start at the PC and follow one instruction (for example `lw`) left to right: fetch, split into fields, read registers, sign-extend, ALU adds the address, data memory read, MemtoReg picks the memory data, write back. Then show `beq` (Branch AND Zero selects the branch target in the PCSrc mux) and `j` (the Jump mux).

## How it was built and verified

```bash
make logisim          # = the two commands below
python3 tools/logisim/generate_circuit.py --render   # build the .circ, memory images, docs/logisim/*.png
python3 tools/logisim/verify_logisim.py              # run every program in Logisim, compare with Verilog
```

* `generate_circuit.py` places the components, then asks Logisim itself where every port is (`tools/logisim/LogisimProbe.java`, which uses Logisim's own Java API). It then draws the wires at those exact coordinates, so nothing about the pin geometry is guessed.
* A built-in wiring checker rejects any layout where wires of two different signals touch, overlap, or run over a component pin (in Logisim each of those is an electrical connection). Wires are split at every T-junction, because Logisim's file loader only joins wires at shared end points.
* `verify_logisim.py` runs Logisim headless (`-tty table,halt`, data RAM loaded with `-l`) for each of the 4 sample programs. It compares **every clock cycle** with the Verilog simulation trace: PC, instruction, the 8 control signals, ALUOp, ALU control, ALU result, Zero, write register, write-back data, MemWrite and next PC. It also compares the final data memory. All 265 cycles match.
* The checker was tested by deliberately breaking the SLT decode in the ALU control. Every program that uses SLT failed at the first SLT cycle.
* `python3 tools/run_tests.py` includes this check automatically when Java and Logisim-evolution are installed. Set `LOGISIM_JAR` if Logisim is not in `/Applications`.

Requirements: Java 17+ and Logisim-evolution 4.x (only for regenerating or verifying; opening the `.circ` needs just Logisim).
