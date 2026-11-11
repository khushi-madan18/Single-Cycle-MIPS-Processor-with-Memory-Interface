// -----------------------------------------------------------------------------
// Data Memory
// 256 words x 32 bits (1 KB). Asynchronous read, synchronous write.
// The address is a BYTE address; we use bits [9:2] as the word index.
// (Only word-aligned LW/SW are supported.)
// -----------------------------------------------------------------------------
module data_memory (
    input         clk,
    input         mem_read,
    input         mem_write,
    input  [31:0] addr,         // byte address (from the ALU)
    input  [31:0] write_data,   // value to store (SW)
    output [31:0] read_data     // value loaded (LW)
);

    reg [31:0] memory [0:255];
    integer i;

    initial begin
        for (i = 0; i < 256; i = i + 1)
            memory[i] = 32'h0000_0000;
    end

    // Asynchronous read (0 when not reading).
    assign read_data = mem_read ? memory[addr[9:2]] : 32'h0000_0000;

    // Synchronous write.
    always @(posedge clk) begin
        if (mem_write)
            memory[addr[9:2]] <= write_data;
    end

endmodule
