// -----------------------------------------------------------------------------
// Register File
// 32 registers x 32 bits. Two asynchronous read ports, one synchronous write
// port. Register $zero (register 0) always reads 0 and can never be written.
// -----------------------------------------------------------------------------
`timescale 1ns/1ps

module register_file (
    input         clk,
    input         reg_write,        // write enable
    input  [4:0]  read_reg1,        // rs
    input  [4:0]  read_reg2,        // rt
    input  [4:0]  write_reg,        // destination register number
    input  [31:0] write_data,
    output [31:0] read_data1,
    output [31:0] read_data2
);

    reg [31:0] regs [0:31];
    integer i;

    // Clear all registers at the start of simulation.
    initial begin
        for (i = 0; i < 32; i = i + 1)
            regs[i] = 32'h0000_0000;
    end

    // Asynchronous reads. Reading register 0 always gives 0.
    assign read_data1 = (read_reg1 == 5'd0) ? 32'h0000_0000 : regs[read_reg1];
    assign read_data2 = (read_reg2 == 5'd0) ? 32'h0000_0000 : regs[read_reg2];

    // Synchronous write. Writes to register 0 are ignored.
    always @(posedge clk) begin
        if (reg_write && (write_reg != 5'd0))
            regs[write_reg] <= write_data;
    end

endmodule
