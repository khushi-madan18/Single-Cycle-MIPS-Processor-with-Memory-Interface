// -----------------------------------------------------------------------------
// Main Control Unit
// Looks at the 6-bit opcode and produces the control signals for the datapath.
//
//  opcode   instr     RegDst ALUSrc MemtoReg RegWrite MemRead MemWrite Branch Jump ALUOp
//  000000   R-type      1      0      0        1        0        0       0     0    10
//  100011   LW          0      1      1        1        1        0       0     0    00
//  101011   SW          x      1      x        0        0        1       0     0    00
//  000100   BEQ         x      0      x        0        0        0       1     0    01
//  001000   ADDI        0      1      0        1        0        0       0     0    00
//  000010   J           x      x      x        0        0        0       0     1    xx
//
// ("x" entries are set to 0 here to keep things simple.)
// ALUOp: 00 = add, 01 = subtract, 10 = look at the funct field.
// -----------------------------------------------------------------------------
`timescale 1ns/1ps

module control_unit (
    input      [5:0] opcode,
    output reg       reg_dst,     // 1: dest reg = rd (R-type), 0: dest reg = rt
    output reg       alu_src,     // 1: ALU 2nd operand = immediate, 0: = register
    output reg       mem_to_reg,  // 1: write-back data from memory, 0: from ALU
    output reg       reg_write,   // 1: write the register file
    output reg       mem_read,    // 1: read data memory
    output reg       mem_write,   // 1: write data memory
    output reg       branch,      // 1: instruction is BEQ
    output reg       jump,        // 1: instruction is J
    output reg [1:0] alu_op
);

    // Opcode constants
    localparam OP_RTYPE = 6'b000000;
    localparam OP_LW    = 6'b100011;
    localparam OP_SW    = 6'b101011;
    localparam OP_BEQ   = 6'b000100;
    localparam OP_ADDI  = 6'b001000;
    localparam OP_J     = 6'b000010;

    always @(*) begin
        // Defaults: do nothing. Unknown opcodes therefore act like a NOP.
        reg_dst    = 1'b0;
        alu_src    = 1'b0;
        mem_to_reg = 1'b0;
        reg_write  = 1'b0;
        mem_read   = 1'b0;
        mem_write  = 1'b0;
        branch     = 1'b0;
        jump       = 1'b0;
        alu_op     = 2'b00;

        case (opcode)
            OP_RTYPE: begin
                reg_dst   = 1'b1;
                reg_write = 1'b1;
                alu_op    = 2'b10;
            end
            OP_LW: begin
                alu_src    = 1'b1;
                mem_to_reg = 1'b1;
                reg_write  = 1'b1;
                mem_read   = 1'b1;
                alu_op     = 2'b00;
            end
            OP_SW: begin
                alu_src   = 1'b1;
                mem_write = 1'b1;
                alu_op    = 2'b00;
            end
            OP_BEQ: begin
                branch = 1'b1;
                alu_op = 2'b01;
            end
            OP_ADDI: begin
                alu_src   = 1'b1;
                reg_write = 1'b1;
                alu_op    = 2'b00;
            end
            OP_J: begin
                jump = 1'b1;
            end
            default: ; // keep defaults
        endcase
    end

endmodule
