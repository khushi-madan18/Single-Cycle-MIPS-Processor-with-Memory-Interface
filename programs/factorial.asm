# factorial.asm - computes n! for the n stored in data memory.
#
# The CPU has no multiply instruction, so multiplication is done by
# repeated addition (product = result added i times).
#
#   result = 1
#   for (i = 2; i <= n; i++) result = result * i;
#
# Registers: $a0 = n, $v0 = result, $t0 = i, $t1 = (n < i),
#            $t2 = product being built, $t3 = additions left
#
# EXPECT $v0 = 720
# EXPECT mem[result] = 720

.data
n:      .word 6
result: .word 0

.text
main:     lw   $a0, n($zero)        # $a0 = n
          addi $v0, $zero, 1        # result = 1
          addi $t0, $zero, 2        # i = 2
outer:    slt  $t1, $a0, $t0        # $t1 = 1 if n < i (loop finished)
          beq  $t1, $zero, multiply # i <= n -> multiply
          j    done
multiply: add  $t2, $zero, $zero    # product = 0
          add  $t3, $t0, $zero      # additions left = i
mul_loop: beq  $t3, $zero, mul_done
          add  $t2, $t2, $v0        # product += result
          addi $t3, $t3, -1
          j    mul_loop
mul_done: add  $v0, $t2, $zero      # result = result * i
          addi $t0, $t0, 1          # i++
          j    outer
done:     sw   $v0, result($zero)
halt:     j    halt
