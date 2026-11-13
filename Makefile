# Convenience targets. Run from the repository root.
#   make test               - full regression (unit tests + all programs vs golden model)
#   make sim PROG=factorial - simulate one program, write VCD + trace + final state
#   make wave PROG=factorial- also draw docs/waveforms/<PROG>.svg
#   make asm PROG=factorial - assemble programs/<PROG>.asm -> .mem + .lst
#   make synth              - Yosys synthesis (core + FPGA), see synthesis/synthesis_report.md
#   make logisim            - regenerate logisim/mips_single_cycle.circ + docs/logisim/*.png, verify vs RTL
#   make clean

PROG ?= basic_test
SRC  := $(wildcard src/*.v)

.PHONY: test sim wave asm synth logisim clean

test:
	python3 tools/run_tests.py

asm:
	python3 tools/mips_asm.py programs/$(PROG).asm --run

sim: asm
	iverilog -g2001 -o simulation/$(PROG).vvp \
	  -Ptb_program.IMEM_FILE=\"programs/$(PROG).mem\" \
	  $(if $(wildcard programs/$(PROG)_data.mem),-Ptb_program.DMEM_FILE=\"programs/$(PROG)_data.mem\") \
	  -Ptb_program.OUT_PREFIX=\"simulation/$(PROG)\" \
	  $(SRC) testbench/tb_program.v
	vvp -n simulation/$(PROG).vvp

wave: sim
	python3 tools/trace_to_svg.py simulation/$(PROG)_trace.txt docs/waveforms/$(PROG).svg

synth:
	yosys -q -l synthesis/synth_core.log -s synthesis/synth_core.ys
	yosys -q -l synthesis/synth_fpga.log -s synthesis/synth_fpga.ys
	@cat synthesis/core_flat_stats.txt synthesis/fpga_xc7_stats.txt

logisim:
	python3 tools/logisim/generate_circuit.py --render
	python3 tools/logisim/verify_logisim.py

clean:
	rm -f simulation/*.vvp simulation/*.vcd simulation/*.txt synthesis/*.log
