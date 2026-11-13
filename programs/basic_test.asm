# basic_test.asm - exercises every supported instruction once.
# Same program as the team's original hand-assembled test (program.mem).
#
# EXPECT $t0 = 5
# EXPECT $t1 = 10
# EXPECT $t2 = 15
# EXPECT $t3 = 15
# EXPECT $t4 = 0
# EXPECT $t5 = 7
# EXPECT $t6 = 0
# EXPECT $t7 = 77
# EXPECT mem[0] = 15

.text
        addi $t0, $zero, 5        # $t0 = 5
        addi $t1, $zero, 10       # $t1 = 10
        add  $t2, $t0, $t1        # $t2 = 15
        sw   $t2, 0($zero)        # mem[0] = 15
        lw   $t3, 0($zero)        # $t3 = 15
        beq  $t2, $t3, skip1      # equal -> taken
        addi $t4, $zero, 99       # SKIPPED by the branch
skip1:  addi $t5, $zero, 7        # $t5 = 7
        j    skip2                # jump over the next instruction
        addi $t6, $zero, 88       # SKIPPED by the jump
skip2:  addi $t7, $zero, 77       # $t7 = 77
halt:   j    halt                 # infinite loop = halt
