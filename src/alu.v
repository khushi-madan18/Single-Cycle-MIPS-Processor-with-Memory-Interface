// -----------------------------------------------------------------------------
// ALU
// Performs ADD, SUB, AND, OR and SLT on two 32-bit operands.
// "zero" is 1 when the result is 0 (used by BEQ: a - b == 0  ->  a == b).
//
//  alu_control  operation
//  0000         AND
//  0001         OR
//  0010         ADD
//  0110         SUB
//  0111         SLT (signed: result = 1 if a < b, else 0)
// -----------------------------------------------------------------------------
`timescale 1ns/1ps

module alu (
    input      [31:0] a,
    input      [31:0] b,
    input      [3:0]  alu_control,
    output reg [31:0] result,
    output            zero
);

    always @(*) begin
        case (alu_control)
            4'b0000: result = a & b;
            4'b0001: result = a | b;
            4'b0010: result = a + b;
            4'b0110: result = a - b;
            4'b0111: result = ($signed(a) < $signed(b)) ? 32'd1 : 32'd0;
            default: result = 32'h0000_0000;
        endcase
    end

    assign zero = (result == 32'h0000_0000);

endmodule
