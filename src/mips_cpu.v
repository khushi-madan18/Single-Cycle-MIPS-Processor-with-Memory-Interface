// -----------------------------------------------------------------------------
// Top-Level Single-Cycle MIPS CPU
// Wires together all modules. Every instruction finishes in one clock cycle.
//
// Instruction fields (MIPS32):
//   [31:26] opcode | [25:21] rs | [20:16] rt | [15:11] rd | [10:6] shamt | [5:0] funct
//   [15:0]  immediate (I-type)  | [25:0] jump address (J-type)
// -----------------------------------------------------------------------------
module mips_cpu (
    input clk,
    input reset
);

    // ---------------- Wires ----------------
    wire [31:0] pc_current, pc_plus4, next_pc;
    wire [31:0] instruction;

    // Instruction fields
    wire [5:0]  opcode = instruction[31:26];
    wire [4:0]  rs     = instruction[25:21];
    wire [4:0]  rt     = instruction[20:16];
    wire [4:0]  rd     = instruction[15:11];
    wire [5:0]  funct  = instruction[5:0];
    wire [15:0] imm16  = instruction[15:0];
    wire [25:0] jaddr  = instruction[25:0];

    // Control signals
    wire        reg_dst, alu_src, mem_to_reg, reg_write;
    wire        mem_read, mem_write, branch, jump;
    wire [1:0]  alu_op;
    wire [3:0]  alu_ctrl;

    // Datapath values
    wire [4:0]  write_reg;
    wire [31:0] read_data1, read_data2;
    wire [31:0] imm_ext;
    wire [31:0] alu_b;
    wire [31:0] alu_result;
    wire        zero;
    wire [31:0] mem_data;
    wire [31:0] write_back;

    // ---------------- Fetch ----------------
    pc pc_reg (
        .clk    (clk),
        .reset  (reset),
        .next_pc(next_pc),
        .pc_out (pc_current)
    );

    instruction_memory imem (
        .addr       (pc_current),
        .instruction(instruction)
    );

    // ---------------- Decode ----------------
    control_unit ctrl (
        .opcode    (opcode),
        .reg_dst   (reg_dst),
        .alu_src   (alu_src),
        .mem_to_reg(mem_to_reg),
        .reg_write (reg_write),
        .mem_read  (mem_read),
        .mem_write (mem_write),
        .branch    (branch),
        .jump      (jump),
        .alu_op    (alu_op)
    );

    // Destination register: rd for R-type, rt for I-type
    assign write_reg = reg_dst ? rd : rt;

    register_file rf (
        .clk       (clk),
        .reg_write (reg_write),
        .read_reg1 (rs),
        .read_reg2 (rt),
        .write_reg (write_reg),
        .write_data(write_back),
        .read_data1(read_data1),
        .read_data2(read_data2)
    );

    sign_extension sext (
        .imm_in (imm16),
        .imm_out(imm_ext)
    );

    // ---------------- Execute ----------------
    alu_control actrl (
        .alu_op     (alu_op),
        .funct      (funct),
        .alu_control(alu_ctrl)
    );

    // ALU 2nd operand: register (R-type, BEQ) or immediate (LW, SW, ADDI)
    assign alu_b = alu_src ? imm_ext : read_data2;

    alu alu_unit (
        .a          (read_data1),
        .b          (alu_b),
        .alu_control(alu_ctrl),
        .result     (alu_result),
        .zero       (zero)
    );

    // ---------------- Memory ----------------
    data_memory dmem (
        .clk       (clk),
        .mem_read  (mem_read),
        .mem_write (mem_write),
        .addr      (alu_result),
        .write_data(read_data2),
        .read_data (mem_data)
    );

    // ---------------- Write-back ----------------
    assign write_back = mem_to_reg ? mem_data : alu_result;

    // ---------------- Next PC ----------------
    branch_jump_logic bj (
        .pc       (pc_current),
        .imm_ext  (imm_ext),
        .jump_addr(jaddr),
        .branch   (branch),
        .zero     (zero),
        .jump     (jump),
        .pc_plus4 (pc_plus4),
        .next_pc  (next_pc)
    );

endmodule
