// -----------------------------------------------------------------------------
// Sign Extension Unit
// Turns a 16-bit immediate into a 32-bit value by copying the sign bit
// (bit 15) into the upper 16 bits. Example: 0xFFFF (-1) -> 0xFFFFFFFF.
// -----------------------------------------------------------------------------
module sign_extension (
    input  [15:0] imm_in,
    output [31:0] imm_out
);

    assign imm_out = {{16{imm_in[15]}}, imm_in};

endmodule
