// -----------------------------------------------------------------------------
// Branch and Jump Logic (next-PC calculation)
//
//   pc_plus4      = pc + 4
//   branch_target = pc_plus4 + (sign_extended_imm << 2)
//   jump_target   = { pc_plus4[31:28], jump_addr[25:0], 2'b00 }
//
//   next_pc = jump_target    if jump
//           = branch_target  if branch AND zero   (BEQ taken)
//           = pc_plus4       otherwise
// -----------------------------------------------------------------------------
module branch_jump_logic (
    input  [31:0] pc,            // current PC
    input  [31:0] imm_ext,       // sign-extended 16-bit immediate
    input  [25:0] jump_addr,     // instruction[25:0]
    input         branch,        // from control unit (instruction is BEQ)
    input         zero,          // from ALU (the two registers are equal)
    input         jump,          // from control unit (instruction is J)
    output [31:0] pc_plus4,
    output [31:0] next_pc
);

    wire [31:0] branch_target;
    wire [31:0] jump_target;
    wire        take_branch;

    assign pc_plus4      = pc + 32'd4;
    assign branch_target = pc_plus4 + (imm_ext << 2);
    assign jump_target   = {pc_plus4[31:28], jump_addr, 2'b00};
    assign take_branch   = branch & zero;

    assign next_pc = jump        ? jump_target   :
                     take_branch ? branch_target :
                                   pc_plus4;

endmodule
