// -----------------------------------------------------------------------------
// Unit testbench: main control unit
// Applies every supported opcode and compares all 9 control outputs with the
// control-signal table in docs/architecture.md. Also checks that an unknown
// opcode produces no writes (acts as a NOP).
//   iverilog -g2001 -o simulation/tb_control_unit.vvp src/control_unit.v testbench/tb_control_unit.v
//   vvp simulation/tb_control_unit.vvp
// -----------------------------------------------------------------------------
`timescale 1ns/1ps

module tb_control_unit;

    reg  [5:0] opcode;
    wire reg_dst, alu_src, mem_to_reg, reg_write, mem_read, mem_write, branch, jump;
    wire [1:0] alu_op;

    integer errors = 0;

    control_unit dut (
        .opcode(opcode), .reg_dst(reg_dst), .alu_src(alu_src), .mem_to_reg(mem_to_reg),
        .reg_write(reg_write), .mem_read(mem_read), .mem_write(mem_write),
        .branch(branch), .jump(jump), .alu_op(alu_op)
    );

    // expected = {RegDst, ALUSrc, MemtoReg, RegWrite, MemRead, MemWrite, Branch, Jump, ALUOp[1:0]}
    task check;
        input [5:0]   op;
        input [9:0]   expected;
        input [8*6:1] name;
        reg   [9:0]   got;
        begin
            opcode = op; #1;
            got = {reg_dst, alu_src, mem_to_reg, reg_write, mem_read, mem_write, branch, jump, alu_op};
            if (got === expected)
                $display("  PASS  %-6s opcode=%b  signals=%b", name, op, got);
            else begin
                $display("  FAIL  %-6s opcode=%b  signals=%b expected=%b", name, op, got, expected);
                errors = errors + 1;
            end
        end
    endtask

    initial begin
        $display("Control unit test  (RegDst ALUSrc MemtoReg RegWrite MemRead MemWrite Branch Jump ALUOp)");
        check(6'b000000, 10'b1_0_0_1_0_0_0_0_10, "R-type");
        check(6'b100011, 10'b0_1_1_1_1_0_0_0_00, "LW");
        check(6'b101011, 10'b0_1_0_0_0_1_0_0_00, "SW");
        check(6'b000100, 10'b0_0_0_0_0_0_1_0_01, "BEQ");
        check(6'b001000, 10'b0_1_0_1_0_0_0_0_00, "ADDI");
        check(6'b000010, 10'b0_0_0_0_0_0_0_1_00, "J");
        check(6'b111111, 10'b0_0_0_0_0_0_0_0_00, "unknwn");

        if (errors == 0) $display("ALL CONTROL UNIT TESTS PASSED");
        else             $display("%0d CONTROL UNIT TEST(S) FAILED", errors);
        $finish;
    end

endmodule
