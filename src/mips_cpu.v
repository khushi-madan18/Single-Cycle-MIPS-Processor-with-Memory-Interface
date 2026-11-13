// -----------------------------------------------------------------------------
// Top-Level Single-Cycle MIPS System
// mips_core (datapath + control) connected to an instruction memory and a
// data memory through the core's memory interface.
//
//            +-----------------------------+
//            |          mips_core          |
//   clk ---->|                             |
//   reset -->|  imem_addr  ---> +------+   |
//            |  imem_rdata <--- | IMEM |   |
//            |                  +------+   |
//            |  dmem_addr/wdata/we/re --->  +------+
//            |  dmem_rdata <--------------- | DMEM |
//            +-----------------------------+------+
//
// Parameters:
//   IMEM_FILE - hex file loaded into instruction memory ("" = leave empty)
//   DMEM_FILE - hex file loaded into data memory        ("" = all zeros)
//
// The debug outputs make the important internal values visible on the
// top-level ports (useful for an FPGA demo: connect them to LEDs / 7-segment
// displays, and they stop synthesis from optimising the design away).
// -----------------------------------------------------------------------------
`timescale 1ns/1ps

module mips_cpu #(
    parameter IMEM_FILE = "",
    parameter DMEM_FILE = ""
) (
    input         clk,
    input         reset,

    // Debug / observation ports
    output [31:0] dbg_pc,          // current PC
    output [31:0] dbg_instruction, // current instruction
    output [31:0] dbg_alu_result,  // ALU result (also the data-memory address)
    output        dbg_mem_write,   // a store is happening this cycle
    output [31:0] dbg_mem_wdata    // value being stored
);

    // Memory-interface wires
    wire [31:0] imem_addr, imem_rdata;
    wire [31:0] dmem_addr, dmem_wdata, dmem_rdata;
    wire        dmem_we, dmem_re;

    mips_core core (
        .clk       (clk),
        .reset     (reset),
        .imem_addr (imem_addr),
        .imem_rdata(imem_rdata),
        .dmem_addr (dmem_addr),
        .dmem_wdata(dmem_wdata),
        .dmem_we   (dmem_we),
        .dmem_re   (dmem_re),
        .dmem_rdata(dmem_rdata)
    );

    instruction_memory #(.MEM_FILE(IMEM_FILE)) imem (
        .addr       (imem_addr),
        .instruction(imem_rdata)
    );

    data_memory #(.MEM_FILE(DMEM_FILE)) dmem (
        .clk       (clk),
        .mem_read  (dmem_re),
        .mem_write (dmem_we),
        .addr      (dmem_addr),
        .write_data(dmem_wdata),
        .read_data (dmem_rdata)
    );

    assign dbg_pc          = imem_addr;
    assign dbg_instruction = imem_rdata;
    assign dbg_alu_result  = dmem_addr;
    assign dbg_mem_write   = dmem_we;
    assign dbg_mem_wdata   = dmem_wdata;

endmodule
