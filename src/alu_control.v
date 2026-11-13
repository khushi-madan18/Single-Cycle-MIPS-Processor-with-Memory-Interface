// -----------------------------------------------------------------------------
// ALU Control Unit
// Combines ALUOp (from the main control unit) with the funct field (bits 5:0
// of an R-type instruction) to choose the ALU operation.
//
//  alu_op  meaning                     -> alu_control
//  00      LW / SW / ADDI (add)        -> 0010 (ADD)
//  01      BEQ (subtract to compare)   -> 0110 (SUB)
//  10      R-type: look at funct       -> see below
//
//  funct    instr  -> alu_control
//  100000   ADD       0010
//  100010   SUB       0110
//  100100   AND       0000
//  100101   OR        0001
//  101010   SLT       0111
// -----------------------------------------------------------------------------
`timescale 1ns/1ps

module alu_control (
    input      [1:0] alu_op,
    input      [5:0] funct,
    output reg [3:0] alu_control
);

    always @(*) begin
        case (alu_op)
            2'b00:   alu_control = 4'b0010;          // add
            2'b01:   alu_control = 4'b0110;          // subtract
            2'b10: begin                             // R-type
                case (funct)
                    6'b100000: alu_control = 4'b0010; // ADD
                    6'b100010: alu_control = 4'b0110; // SUB
                    6'b100100: alu_control = 4'b0000; // AND
                    6'b100101: alu_control = 4'b0001; // OR
                    6'b101010: alu_control = 4'b0111; // SLT
                    default:   alu_control = 4'b0010; // unsupported: harmless add
                endcase
            end
            default: alu_control = 4'b0010;
        endcase
    end

endmodule
