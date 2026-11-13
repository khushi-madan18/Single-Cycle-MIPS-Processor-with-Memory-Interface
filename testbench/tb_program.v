// -----------------------------------------------------------------------------
// Generic program testbench
//
// Runs ANY assembled program on the CPU until it halts (an instruction that
// jumps to itself), then dumps the final register file and data memory.
// Every cycle it also logs the datapath + control signals to a trace file.
//
// tools/run_tests.py uses this testbench to compare the Verilog CPU,
// cycle by cycle, against the Python golden model. Run it by hand like this
// (from the repository root):
//
//   iverilog -g2001 -o simulation/array_sum.vvp \
//       -Ptb_program.IMEM_FILE=\"programs/array_sum.mem\" \
//       -Ptb_program.DMEM_FILE=\"programs/array_sum_data.mem\" \
//       -Ptb_program.OUT_PREFIX=\"simulation/array_sum\" \
//       src/*.v testbench/tb_program.v
//   vvp simulation/array_sum.vvp
//
// Outputs:  <OUT_PREFIX>.vcd        waveform (open with GTKWave)
//           <OUT_PREFIX>_trace.txt  one line per clock cycle
//           <OUT_PREFIX>_state.txt  final registers and data memory
// -----------------------------------------------------------------------------
`timescale 1ns/1ps

module tb_program;

    parameter IMEM_FILE  = "programs/basic_test.mem";
    parameter DMEM_FILE  = "";
    parameter OUT_PREFIX = "simulation/basic_test";
    parameter MAX_CYCLES = 5000;

    reg clk;
    reg reset;
    integer cycle;
    integer trace_fd, state_fd;
    integer i;
    reg halted;

    mips_cpu #(.IMEM_FILE(IMEM_FILE), .DMEM_FILE(DMEM_FILE)) dut (
        .clk            (clk),
        .reset          (reset),
        .dbg_pc         (),
        .dbg_instruction(),
        .dbg_alu_result (),
        .dbg_mem_write  (),
        .dbg_mem_wdata  ()
    );

    initial clk = 1'b0;
    always #5 clk = ~clk;

    // Log one line per cycle at the falling edge, when the combinational
    // logic for the current instruction has settled (state updates on the
    // following rising edge).
    always @(negedge clk) begin
        if (!reset && !halted) begin
            $fdisplay(trace_fd,
                "%0d %08h %08h  %b %b %b %b %b %b %b %b %b%b %b%b%b%b  %08h %b %0d %08h %b %08h %08h  %08h",
                cycle, dut.core.pc_current, dut.core.instruction,
                dut.core.reg_dst, dut.core.alu_src, dut.core.mem_to_reg, dut.core.reg_write,
                dut.core.mem_read, dut.core.mem_write, dut.core.branch, dut.core.jump,
                dut.core.alu_op[1], dut.core.alu_op[0],
                dut.core.alu_ctrl[3], dut.core.alu_ctrl[2], dut.core.alu_ctrl[1], dut.core.alu_ctrl[0],
                dut.core.alu_result, dut.core.zero, dut.core.write_reg, dut.core.write_back,
                dut.core.dmem_we, dut.core.dmem_addr, dut.core.dmem_wdata,
                dut.core.next_pc);
            if (dut.core.next_pc == dut.core.pc_current)
                halted = 1'b1;
            cycle = cycle + 1;
        end
    end

    initial begin
        cycle  = 0;
        halted = 1'b0;

        $dumpfile({OUT_PREFIX, ".vcd"});
        $dumpvars(0, tb_program);

        trace_fd = $fopen({OUT_PREFIX, "_trace.txt"}, "w");
        $fdisplay(trace_fd, "# cycle pc instr  RegDst ALUSrc MemtoReg RegWrite MemRead MemWrite Branch Jump ALUOp ALUctl  alu_result zero write_reg write_back mem_we mem_addr mem_wdata  next_pc");

        reset = 1'b1;
        repeat (2) @(posedge clk);
        #1 reset = 1'b0;

        // Run until the halt loop is reached (plus one edge so the last
        // write-back has happened), or give up after MAX_CYCLES.
        while (!halted && cycle < MAX_CYCLES)
            @(posedge clk);
        @(posedge clk);
        #1;

        state_fd = $fopen({OUT_PREFIX, "_state.txt"}, "w");
        $fdisplay(state_fd, "halted %0d", halted);
        $fdisplay(state_fd, "cycles %0d", cycle);
        for (i = 0; i < 32; i = i + 1)
            $fdisplay(state_fd, "reg %0d %08h", i, (i == 0) ? 32'h0 : dut.core.rf.regs[i]);
        for (i = 0; i < 256; i = i + 1)
            $fdisplay(state_fd, "mem %0d %08h", i, dut.dmem.memory[i]);
        $fclose(state_fd);
        $fclose(trace_fd);

        if (halted)
            $display("%s: halted after %0d cycles", IMEM_FILE, cycle);
        else
            $display("%s: did NOT halt within %0d cycles", IMEM_FILE, MAX_CYCLES);
        $finish;
    end

endmodule
