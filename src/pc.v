// -----------------------------------------------------------------------------
// Program Counter (PC)
// Holds the address of the current instruction. On every rising clock edge it
// loads next_pc. On reset it goes back to address 0.
// -----------------------------------------------------------------------------
module pc (
    input             clk,
    input             reset,     // synchronous, active-high
    input      [31:0] next_pc,   // address of the next instruction
    output reg [31:0] pc_out     // address of the current instruction
);

    always @(posedge clk) begin
        if (reset)
            pc_out <= 32'h0000_0000;
        else
            pc_out <= next_pc;
    end

endmodule
