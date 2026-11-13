// -----------------------------------------------------------------------------
// Data Memory
// 256 words x 32 bits (1 KB). Asynchronous read, synchronous write.
// The address is a BYTE address; we use bits [9:2] as the word index.
// (Only word-aligned LW/SW are supported.)
//
// MEM_FILE: optional hex file with initial data (e.g. the array for the
// array-sum program). Cleared first, then loaded, in one initial block.
// -----------------------------------------------------------------------------
`timescale 1ns/1ps

module data_memory #(
    parameter MEM_FILE = ""
) (
    input         clk,
    input         mem_read,
    input         mem_write,
    input  [31:0] addr,         // byte address (from the ALU)
    input  [31:0] write_data,   // value to store (SW)
    output [31:0] read_data     // value loaded (LW)
);

    reg [31:0] memory [0:255];
    integer i;

    // The choice is made at elaboration time (generate), so simulators AND
    // synthesis tools (Yosys/Vivado) both pick up the initial contents.
    // With a file, ONLY the file is loaded (synthesis tools may apply a
    // clear-loop after $readmemh and wipe the program), so the file should
    // hold all 256 words - tools/mips_asm.py always pads its output to 256.
    generate
        if (MEM_FILE != "") begin : g_load
            initial $readmemh(MEM_FILE, memory);
        end else begin : g_clear
            initial begin
                for (i = 0; i < 256; i = i + 1)
                    memory[i] = 32'h0000_0000;
            end
        end
    endgenerate

    // Asynchronous read (0 when not reading).
    assign read_data = mem_read ? memory[addr[9:2]] : 32'h0000_0000;

    // Synchronous write.
    always @(posedge clk) begin
        if (mem_write)
            memory[addr[9:2]] <= write_data;
    end

endmodule
