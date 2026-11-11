// -----------------------------------------------------------------------------
// Instruction Memory
// 256 words x 32 bits (1 KB). Asynchronous (combinational) read.
// The PC is a BYTE address, but every instruction is 4 bytes, so we drop the
// two lowest bits (pc[1:0] are always 0) to get the WORD index: pc[9:2].
// The testbench fills this memory using $readmemh.
// -----------------------------------------------------------------------------
module instruction_memory (
    input  [31:0] addr,          // byte address from the PC
    output [31:0] instruction
);

    reg [31:0] memory [0:255];
    integer i;

    // Start with all zeros (0x00000000 = "sll $0,$0,0", a harmless NOP) so
    // unused locations never produce 'x' values. $readmemh overwrites the
    // used part later.
    initial begin
        for (i = 0; i < 256; i = i + 1)
            memory[i] = 32'h0000_0000;
    end

    assign instruction = memory[addr[9:2]];

endmodule
