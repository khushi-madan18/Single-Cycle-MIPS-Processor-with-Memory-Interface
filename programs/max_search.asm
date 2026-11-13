# max_search.asm - finds the largest signed value in an array.
#
#   max = array[0]
#   for (i = 1; i < n; i++) if (max < array[i]) max = array[i];
#
# Uses SLT to compare and BEQ to skip the update.
# Registers: $t0 = pointer, $t1 = elements left, $t2 = element, $t3 = (max < element), $s0 = max
#
# EXPECT $s0 = 92
# EXPECT mem[max] = 92

.data
array:  .word 14, -5, 33, 7, 92, 18, 61, 0, 45, 27
n:      .word 10
max:    .word 0

.text
main:   addi $t0, $zero, array    # pointer = &array[0]
        lw   $t1, n($zero)        # elements left = n
        lw   $s0, 0($t0)          # max = array[0]
        addi $t0, $t0, 4          # move to array[1]
        addi $t1, $t1, -1
loop:   beq  $t1, $zero, done
        lw   $t2, 0($t0)          # element = array[i]
        slt  $t3, $s0, $t2        # $t3 = 1 if max < element
        beq  $t3, $zero, skip     # not bigger -> keep max
        add  $s0, $t2, $zero      # max = element
skip:   addi $t0, $t0, 4
        addi $t1, $t1, -1
        j    loop
done:   sw   $s0, max($zero)
halt:   j    halt
