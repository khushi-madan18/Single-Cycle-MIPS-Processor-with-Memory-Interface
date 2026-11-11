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

`testbench/tb_mips_cpu.v` generates a 10 ns clock, applies reset, loads `programs/program.mem` with `$readmemh`, runs 20 cycles, prints a per-cycle trace and the final registers/memory, checks the expected values, and writes `simulation/mips_cpu.vcd`.
