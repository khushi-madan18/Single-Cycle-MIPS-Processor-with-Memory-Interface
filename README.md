# Single-Cycle MIPS Processor with Memory Interface

A 32-bit single-cycle MIPS processor written in Verilog-2001 (Icarus Verilog compatible). Every instruction is fetched, decoded, executed and written back in one clock cycle.

## Supported instructions

| Instruction | Type | Operation |
|---|---|---|
| ADD, SUB, AND, OR, SLT | R-type | `rd = rs op rt` |
| LW | I-type | `rt = mem[rs + imm]` |
| SW | I-type | `mem[rs + imm] = rt` |
| BEQ | I-type | `if (rs == rt) PC = PC + 4 + (imm << 2)` |
| ADDI | I-type | `rt = rs + imm` |
| J | J-type | `PC = {PC+4[31:28], addr, 2'b00}` |

## Folder structure

```
MIPS-Processor/
├── src/            Verilog design modules (one per file)
├── programs/       program.mem – machine code loaded into instruction memory
├── testbench/      tb_mips_cpu.v – self-checking testbench
├── simulation/     generated .vvp and .vcd files (git-ignored)
├── docs/           architecture.md – datapath, control table, encodings
└── README.md
```

## Modules

| File | Module | Role |
|---|---|---|
| `pc.v` | `pc` | Program counter register |
| `instruction_memory.v` | `instruction_memory` | 256-word ROM-style memory, async read |
| `control_unit.v` | `control_unit` | Opcode → control signals |
| `register_file.v` | `register_file` | 32×32 registers, 2 async reads, 1 sync write, `$zero` hard-wired |
| `sign_extension.v` | `sign_extension` | 16 → 32 bit sign extension |
| `alu.v` | `alu` | ADD, SUB, AND, OR, SLT + zero flag |
| `alu_control.v` | `alu_control` | ALUOp + funct → ALU operation |
| `data_memory.v` | `data_memory` | 256-word RAM, async read, sync write |
| `branch_jump_logic.v` | `branch_jump_logic` | PC+4, branch target, jump target, next-PC mux |
| `mips_cpu.v` | `mips_cpu` | Top level, connects everything |

## How to run

You need [Icarus Verilog](https://steveicarus.github.io/iverilog/) (`brew install icarus-verilog` on macOS, `sudo apt install iverilog` on Ubuntu) and optionally GTKWave.

Run these from inside the `MIPS-Processor/` folder, because the testbench uses relative paths:

```bash
iverilog -g2001 -o simulation/mips_cpu.vvp src/*.v testbench/tb_mips_cpu.v
vvp simulation/mips_cpu.vvp
gtkwave simulation/mips_cpu.vcd      # optional: view waveforms
```

Useful signals to add in GTKWave: `dut.pc_current`, `dut.instruction`, `dut.alu_result`, `dut.next_pc`, and the control signals under `dut`.

## Test program

`programs/program.mem` (word addresses; PC = 4 × address):

| Addr | Machine code | Assembly | Effect |
|---|---|---|---|
| 0 | `20080005` | `ADDI $t0,$zero,5` | $t0 = 5 |
| 1 | `2009000A` | `ADDI $t1,$zero,10` | $t1 = 10 |
| 2 | `01095020` | `ADD $t2,$t0,$t1` | $t2 = 15 |
| 3 | `AC0A0000` | `SW $t2,0($zero)` | mem[0] = 15 |
| 4 | `8C0B0000` | `LW $t3,0($zero)` | $t3 = 15 |
| 5 | `114B0001` | `BEQ $t2,$t3,1` | taken → skips addr 6 |
| 6 | `200C0063` | `ADDI $t4,$zero,99` | skipped ($t4 stays 0) |
| 7 | `200D0007` | `ADDI $t5,$zero,7` | $t5 = 7 |
| 8 | `0800000A` | `J 10` | jumps to addr 10, skipping 9 |
| 9 | `200E0058` | `ADDI $t6,$zero,88` | skipped ($t6 stays 0) |
| 10 | `200F004D` | `ADDI $t7,$zero,77` | $t7 = 77 |
| 11 | `0800000B` | `J 11` | infinite loop (acts as halt) |

Expected final state: `$t0=5, $t1=10, $t2=15, $t3=15, $t4=0, $t5=7, $t6=0, $t7=77, mem[0]=15`.

The testbench checks these automatically and prints `ALL TESTS PASSED` on success.

> The `$readmemh` warning "Not enough words in the file for the requested range" is expected: the program has 12 words but the memory has 256.

## Notes and limitations

- Memory accesses must be word-aligned (the low two address bits are ignored).
- Memories hold 256 words; larger addresses wrap around.
- Unsupported opcodes behave like a NOP. No exceptions, overflow detection or delay slots.
- Reset is synchronous and active-high; it only resets the PC. Registers and memories are zeroed at simulation start.

