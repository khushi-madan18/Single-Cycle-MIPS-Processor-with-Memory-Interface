# Synthesis Report

Tool: **Yosys 0.71** (open-source). Both runs are scripted and reproducible:

```bash
yosys -s synthesis/synth_core.ys    # generic gate-level synthesis of the core
yosys -s synthesis/synth_fpga.ys    # full system mapped to a Xilinx 7-series FPGA
```

Raw tool output is in `core_hierarchy_stats.txt`, `core_flat_stats.txt`, `core_logic_depth.txt` and `fpga_xc7_stats.txt`.

## 1. Core only (`mips_core`, technology-independent)

The core contains the datapath and control but no memories, so these numbers do not depend on which program is loaded.

| Module | Cells | Flip-flops | Notes |
|---|---:|---:|---|
| `register_file` | 4553 | 1024 | 32 × 32-bit registers + two 32:1 read multiplexers |
| `alu` | 619 | – | adder/subtractor, AND, OR, signed SLT, zero detect |
| `branch_jump_logic` | 274 | – | PC+4 adder, branch-target adder, next-PC mux |
| `mips_core` (glue) | 69 | – | RegDst, ALUSrc and MemtoReg multiplexers |
| `pc` | 32 | 32 | 32-bit register with synchronous reset |
| `control_unit` | 21 | – | opcode decoder |
| `alu_control` | 16 | – | ALUOp/funct decoder |
| `sign_extension` | 0 | – | wiring only |
| **Total (hierarchical)** | **5584** | **1056** | |
| **Total (flattened and optimised)** | **4795** | **1056** | 1024 DFFE + 32 SDFF |

**Critical path (logic depth): 87 gate levels**, from the instruction input through the register-file read mux, ALU and branch adder to the next-PC and write-back logic (`core_logic_depth.txt`). This is the classic single-cycle weakness: the clock period has to cover the slowest instruction, which here is LW (fetch → register read → ALU address → memory read → write-back). Pipelining would split this path into stages.

## 2. Full system on an FPGA (`mips_cpu`, Xilinx 7-series / Artix-7)

The instruction memory is pre-loaded with `programs/array_sum.mem` and the data memory with `programs/array_sum_data.mem`.

| Resource | Used | Implements |
|---|---:|---|
| LUTs (LUT2–LUT6) | 369 | control, ALU, muxes, program ROM |
| CARRY4 | 35 | adders (ALU, PC+4, branch target) |
| Flip-flops (FDRE) | 48 | PC and memory-port registers |
| RAM32M (LUT-RAM) | 12 | register file (2 read ports, 1 write port) |
| RAM256X1S (LUT-RAM) | 32 | 256 × 32-bit data memory |
| MUXF7 | 1 | |
| BUFG / IBUF / OBUF | 1 / 2 / 129 | clock buffer, `clk`/`reset` inputs, debug outputs |

The design easily fits the smallest Artix-7 (XC7A35T: 20,800 LUTs and 41,600 flip-flops), so it is under **2 %** of that device's LUTs. For the optional FPGA demo, the `dbg_*` output ports of `mips_cpu` can drive LEDs or a 7-segment display. Use a slow or push-button clock so the instructions can be watched one at a time.

## 3. Notes

* Before this report, the top level had **no output ports**, so synthesis removed the whole CPU (0 cells). The core now exposes its memory interface and the top level exposes `dbg_*` ports, which keeps all the logic observable.
* `$readmemh` must not be mixed with a clear-loop in the same memory. Yosys applies the loop after the file and wipes the program. The memories therefore load only the file when one is given, and the assembler pads every `.mem` file to 256 words.
* Yosys gives no timing in nanoseconds. For a real Fmax figure, run the same RTL through Vivado (Artix-7) or `nextpnr` and quote that number in the final report.
