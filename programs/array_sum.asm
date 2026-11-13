# array_sum.asm - adds up N signed words stored in data memory.
#
#   sum = 0
#   for (i = 0; i < n; i++) sum += array[i];
#   result = sum
#
# Registers: $t0 = pointer, $t1 = elements left, $t2 = current element, $s0 = sum
#
# EXPECT $s0 = 110
# EXPECT mem[result] = 110
# EXPECT $t1 = 0

.data
array:  .word 12, 7, -3, 25, 40, 8, 15, 6
n:      .word 8
result: .word 0

.text
main:   addi $t0, $zero, array    # $t0 = &array[0]
        lw   $t1, n($zero)        # $t1 = n
        add  $s0, $zero, $zero    # sum = 0
loop:   beq  $t1, $zero, done     # no elements left -> done
        lw   $t2, 0($t0)          # $t2 = *pointer
        add  $s0, $s0, $t2        # sum += element
        addi $t0, $t0, 4          # pointer += 4 bytes (next word)
        addi $t1, $t1, -1         # one fewer element left
        j    loop
done:   sw   $s0, result($zero)   # store the sum in memory
halt:   j    halt
