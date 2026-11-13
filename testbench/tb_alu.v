// -----------------------------------------------------------------------------
// Unit testbench: ALU + ALU control
// Checks every operation (including signed SLT, wrap-around and the zero
// flag) and the ALUOp/funct -> alu_control decoding.
//   iverilog -g2001 -o simulation/tb_alu.vvp src/alu.v src/alu_control.v testbench/tb_alu.v
//   vvp simulation/tb_alu.vvp
// -----------------------------------------------------------------------------
`timescale 1ns/1ps

module tb_alu;

    reg  [31:0] a, b;
    reg  [3:0]  ctl;
    wire [31:0] result;
    wire        zero;

    reg  [1:0]  alu_op;
    reg  [5:0]  funct;
    wire [3:0]  alu_control_out;

    integer errors = 0;
    integer tests  = 0;

    alu dut_alu (.a(a), .b(b), .alu_control(ctl), .result(result), .zero(zero));
    alu_control dut_ac (.alu_op(alu_op), .funct(funct), .alu_control(alu_control_out));

    task check_alu;
        input [3:0]  c;
        input [31:0] x, y, expected;
        input        exp_zero;
        begin
            ctl = c; a = x; b = y; #1;
            tests = tests + 1;
            if (result !== expected || zero !== exp_zero) begin
                $display("  FAIL alu ctl=%b a=%h b=%h -> %h z=%b (expected %h z=%b)",
                         c, x, y, result, zero, expected, exp_zero);
                errors = errors + 1;
            end
        end
    endtask

    task check_ac;
        input [1:0] op;
        input [5:0] f;
        input [3:0] expected;
        begin
            alu_op = op; funct = f; #1;
            tests = tests + 1;
            if (alu_control_out !== expected) begin
                $display("  FAIL alu_control op=%b funct=%b -> %b (expected %b)",
                         op, f, alu_control_out, expected);
                errors = errors + 1;
            end
        end
    endtask

    initial begin
        $display("ALU unit test");
        // AND / OR
        check_alu(4'b0000, 32'hF0F0_F0F0, 32'hFF00_FF00, 32'hF000_F000, 0);
        check_alu(4'b0000, 32'h0F0F_0F0F, 32'hF0F0_F0F0, 32'h0000_0000, 1);
        check_alu(4'b0001, 32'hF0F0_0000, 32'h0000_0F0F, 32'hF0F0_0F0F, 0);
        // ADD (incl. wrap-around and negative numbers)
        check_alu(4'b0010, 32'd5,         32'd10,        32'd15,        0);
        check_alu(4'b0010, 32'hFFFF_FFFF, 32'd1,         32'h0000_0000, 1);
        check_alu(4'b0010, 32'd7,         32'hFFFF_FFFD, 32'd4,         0); // 7 + (-3)
        // SUB (BEQ uses zero flag)
        check_alu(4'b0110, 32'd15,        32'd15,        32'd0,         1);
        check_alu(4'b0110, 32'd3,         32'd5,         32'hFFFF_FFFE, 0); // 3 - 5 = -2
        // SLT (signed)
        check_alu(4'b0111, 32'd3,         32'd5,         32'd1,         0);
        check_alu(4'b0111, 32'd5,         32'd3,         32'd0,         1);
        check_alu(4'b0111, 32'hFFFF_FFFF, 32'd1,         32'd1,         0); // -1 < 1
        check_alu(4'b0111, 32'd1,         32'hFFFF_FFFF, 32'd0,         1); // 1 < -1 ? no
        check_alu(4'b0111, 32'h8000_0000, 32'h7FFF_FFFF, 32'd1,         0); // most negative < most positive
        // Unused code -> 0
        check_alu(4'b1111, 32'd9,         32'd9,         32'd0,         1);

        $display("ALU control unit test");
        check_ac(2'b00, 6'bxxxxxx, 4'b0010);  // LW/SW/ADDI -> add
        check_ac(2'b01, 6'bxxxxxx, 4'b0110);  // BEQ -> sub
        check_ac(2'b10, 6'b100000, 4'b0010);  // ADD
        check_ac(2'b10, 6'b100010, 4'b0110);  // SUB
        check_ac(2'b10, 6'b100100, 4'b0000);  // AND
        check_ac(2'b10, 6'b100101, 4'b0001);  // OR
        check_ac(2'b10, 6'b101010, 4'b0111);  // SLT

        if (errors == 0) $display("ALL %0d ALU TESTS PASSED", tests);
        else             $display("%0d of %0d ALU TESTS FAILED", errors, tests);
        $finish;
    end

endmodule
