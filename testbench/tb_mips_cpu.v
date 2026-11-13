// -----------------------------------------------------------------------------
// Testbench for the single-cycle MIPS CPU
// Runs programs/basic_test.mem (every instruction once) and checks the final
// register/memory values.
// Run from the repository root so the relative paths below resolve:
//   iverilog -g2001 -o simulation/mips_cpu.vvp src/*.v testbench/tb_mips_cpu.v
//   vvp simulation/mips_cpu.vvp
// -----------------------------------------------------------------------------
`timescale 1ns/1ps

module tb_mips_cpu;

    reg clk;
    reg reset;

    integer errors;
    integer cycle;

    // Device under test
    // The program is loaded by the instruction memory itself (IMEM_FILE).
    mips_cpu #(.IMEM_FILE("programs/basic_test.mem")) dut (
        .clk            (clk),
        .reset          (reset),
        .dbg_pc         (),
        .dbg_instruction(),
        .dbg_alu_result (),
        .dbg_mem_write  (),
        .dbg_mem_wdata  ()
    );

    // 10 ns clock period
    initial clk = 1'b0;
    always #5 clk = ~clk;

    // Print one line per clock cycle (shortly before the rising edge, when
    // the current instruction has settled).
    always @(negedge clk) begin
        if (!reset) begin
            $display("cycle %0d | PC=0x%08h | instr=0x%08h | ALU=0x%08h | next PC=0x%08h",
                     cycle, dut.core.pc_current, dut.core.instruction, dut.core.alu_result, dut.core.next_pc);
            cycle = cycle + 1;
        end
    end

    // Compare a register / memory word against its expected value.
    task check_reg;
        input [4:0]   num;
        input [31:0]  expected;
        input [8*6:1] name;
        begin
            if (dut.core.rf.regs[num] === expected)
                $display("  PASS  %0s = %0d", name, dut.core.rf.regs[num]);
            else begin
                $display("  FAIL  %0s = %0d (expected %0d)", name, dut.core.rf.regs[num], expected);
                errors = errors + 1;
            end
        end
    endtask

    initial begin
        errors = 0;
        cycle  = 0;

        // Waveform dump (open with GTKWave)
        $dumpfile("simulation/mips_cpu.vcd");
        $dumpvars(0, tb_mips_cpu);

        // Apply reset for two clock edges, then release it
        reset = 1'b1;
        repeat (2) @(posedge clk);
        #1 reset = 1'b0;

        // Run long enough for all instructions (the last J loops forever)
        repeat (20) @(posedge clk);
        #1;

        $display("");
        $display("=============== Final Register Values ===============");
        $display("$zero = %0d", dut.core.rf.regs[0]);
        $display("$t0   = %0d", dut.core.rf.regs[8]);
        $display("$t1   = %0d", dut.core.rf.regs[9]);
        $display("$t2   = %0d", dut.core.rf.regs[10]);
        $display("$t3   = %0d", dut.core.rf.regs[11]);
        $display("$t4   = %0d", dut.core.rf.regs[12]);
        $display("$t5   = %0d", dut.core.rf.regs[13]);
        $display("$t6   = %0d", dut.core.rf.regs[14]);
        $display("$t7   = %0d", dut.core.rf.regs[15]);

        $display("");
        $display("=============== Data Memory ===============");
        $display("mem[0] (byte addr 0) = %0d", dut.dmem.memory[0]);
        $display("mem[1] (byte addr 4) = %0d", dut.dmem.memory[1]);

        $display("");
        $display("=============== Self-Check ===============");
        check_reg(0,  0,  "$zero");
        check_reg(8,  5,  "$t0");
        check_reg(9,  10, "$t1");
        check_reg(10, 15, "$t2");
        check_reg(11, 15, "$t3");
        check_reg(12, 0,  "$t4");   // skipped by BEQ
        check_reg(13, 7,  "$t5");
        check_reg(14, 0,  "$t6");   // skipped by J
        check_reg(15, 77, "$t7");

        if (dut.dmem.memory[0] === 32'd15)
            $display("  PASS  mem[0] = 15");
        else begin
            $display("  FAIL  mem[0] = %0d (expected 15)", dut.dmem.memory[0]);
            errors = errors + 1;
        end

        $display("");
        if (errors == 0)
            $display("ALL TESTS PASSED");
        else
            $display("%0d TEST(S) FAILED", errors);

        $finish;
    end

endmodule
