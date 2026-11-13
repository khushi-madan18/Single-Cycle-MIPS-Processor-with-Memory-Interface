// -----------------------------------------------------------------------------
// Instruction Memory
// 256 words x 32 bits (1 KB). Asynchronous (combinational) read.
// The PC is a BYTE address, but every instruction is 4 bytes, so we drop the
// two lowest bits (pc[1:0] are always 0) to get the WORD index: pc[9:2].
//
// MEM_FILE: hex file loaded with $readmemh at start-up (one 32-bit word per
// line, "//" comments allowed). The memory is cleared first and loaded in the
// SAME initial block, so the program can never be overwritten by the clear.
// -----------------------------------------------------------------------------
`timescale 1ns/1ps

module instruction_memory #(
    parameter MEM_FILE = ""
) (
    input  [31:0] addr,          // byte address from the PC
    output [31:0] instruction
);

    reg [31:0] memory [0:255];
    integer i;

    // Unused locations hold 0x00000000 = "sll $0,$0,0", a harmless NOP.
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

    assign instruction = memory[addr[9:2]];

endmodule
