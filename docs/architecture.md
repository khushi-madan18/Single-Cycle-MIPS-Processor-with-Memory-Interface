# Architecture

## 1. Datapath overview

```
                 +-----------------------------+ jump_target
                 |        +-------------------+|
                 v        |                   ||
   +----+  pc  +------+ instr           +-----------+
   | PC |----->| IMEM |-------+-------->| Control   |-> RegDst, ALUSrc, MemtoReg,
   +----+      +------+       |         | Unit      |   RegWrite, MemRead, MemWrite,
     ^  ^                     |         +-----------+   Branch, Jump, ALUOp
     |  |                     |
     |  |   [25:21] rs   +----v-----+  data1      +-----+
     |  |   [20:16] rt   | Register |------------>|     |  result  +------+  rdata
     |  |   [15:11] rd   |   File   |  data2 --+  | ALU |--------->| DMEM |----+
     |  |   (RegDst mux  |          |          |  |     |          +------+    |
     |  |    picks rt/rd)|          |<-----+   |  +-----+              ^        |
     |  |                +----------+      |   |     ^ zero            |wdata   |
     |  |   [15:0] --> Sign Extend -> imm--+---+-ALUSrc mux            +-data2  |
     |  |                                  |                                    |
     |  |                    write-back <--+---- MemtoReg mux <-----------------+
     |  |
     |  +-- branch_jump_logic: PC+4, PC+4+(imm<<2), {PC+4[31:28], addr, 00}
     +----- next_pc
```

All logic between the PC register and the register-file / data-memory write ports is combinational. State is only updated on the rising clock edge: PC, register file and data memory.

### Core and memory interface

The datapath and control live in `mips_core`; the two memories sit outside it in `mips_cpu`:

| Core port | Direction | Meaning |
|---|---|---|
| `imem_addr[31:0]` | out | byte address of the instruction (= PC) |
| `imem_rdata[31:0]` | in | instruction word |
| `dmem_addr[31:0]` | out | byte address for LW/SW (= ALU result) |
| `dmem_wdata[31:0]` | out | store data (= register `rt`) |
| `dmem_we` | out | write enable (MemWrite) |
| `dmem_re` | out | read enable (MemRead) |
| `dmem_rdata[31:0]` | in | load data |

Because of this split the same core could be attached to FPGA block RAM or to a bus without changing it, and synthesising the core alone gives numbers that don't depend on the program.

## 2. Instruction formats (MIPS32)

```
R-type: | opcode 6 | rs 5 | rt 5 | rd 5 | shamt 5 | funct 6 |
I-type: | opcode 6 | rs 5 | rt 5 |        immediate 16        |
J-type: | opcode 6 |              address 26                  |
```

| Instruction | Opcode | funct |
|---|---|---|
| ADD | 000000 | 100000 |
| SUB | 000000 | 100010 |
| AND | 000000 | 100100 |
| OR  | 000000 | 100101 |
| SLT | 000000 | 101010 |
| LW  | 100011 | – |
| SW  | 101011 | – |
| BEQ | 000100 | – |
| ADDI | 001000 | – |
| J   | 000010 | – |

## 3. Control signals

| Instr | RegDst | ALUSrc | MemtoReg | RegWrite | MemRead | MemWrite | Branch | Jump | ALUOp |
|---|---|---|---|---|---|---|---|---|---|
| R-type | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 10 |
| LW   | 0 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 00 |
| SW   | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 00 |
| BEQ  | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 01 |
| ADDI | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 00 |
| J    | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 00 |

(Don't-care values from the textbook table are driven to 0 in the implementation.)

## 4. ALU control

| ALUOp | funct | ALU control | Operation |
|---|---|---|---|
| 00 | – | 0010 | ADD (LW, SW, ADDI) |
| 01 | – | 0110 | SUB (BEQ) |
| 10 | 100000 | 0010 | ADD |
| 10 | 100010 | 0110 | SUB |
| 10 | 100100 | 0000 | AND |
| 10 | 100101 | 0001 | OR |
| 10 | 101010 | 0111 | SLT (signed) |

## 5. Next-PC calculation

```
pc_plus4      = pc + 4
branch_target = pc_plus4 + (sign_ext(imm16) << 2)
jump_target   = { pc_plus4[31:28], instr[25:0], 2'b00 }
next_pc       = Jump ? jump_target : (Branch & zero) ? branch_target : pc_plus4
```

Worked example from the test program:

- `BEQ $t2,$t3,1` at byte address 0x14: pc_plus4 = 0x18, target = 0x18 + (1<<2) = **0x1C** (word 7). Word 6 is skipped.
- `J 10` at byte address 0x20: pc_plus4 = 0x24, target = {0x0, 10<<2} = **0x28** (word 10). Word 9 is skipped.

## 6. Memory model

- Instruction memory and data memory are both 256 × 32-bit arrays.
- The PC and ALU produce byte addresses; bits [9:2] select the word.
- Instruction memory: combinational read. Data memory: combinational read (gated by MemRead), clocked write (gated by MemWrite).
- Register file: combinational reads, clocked write. Register 0 returns 0 on read and ignores writes.

## 7. Verification

| Level | File | What is checked |
|---|---|---|
| Unit | `testbench/tb_alu.v` | every ALU operation, signed SLT, wrap-around, zero flag, ALU-control decoding |
| Unit | `testbench/tb_control_unit.v` | all 9 control outputs for every opcode and for an unknown opcode |
| System | `testbench/tb_mips_cpu.v` | `programs/basic_test.mem`, final registers and memory |
| Program | `testbench/tb_program.v` + `tools/run_tests.py` | each `programs/*.asm` compared cycle by cycle with the Python golden model (`tools/mips_asm.py`) |

`tb_program.v` runs a program until it reaches the `halt` loop (an instruction whose next PC equals its own PC). It writes a per-cycle trace of the datapath and control signals, the final register and memory state, and a VCD waveform. `run_tests.py` checks each traced cycle against the golden model **and** against the control table in section 3, so both the datapath results and the control signals are verified on every instruction executed.
