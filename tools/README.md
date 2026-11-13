# tools/

Helper scripts. None of them are part of the processor; they build its inputs and check its outputs. Python 3 standard library only.

| Script | What it does | Used for |
|---|---|---|
| `mips_asm.py` | **Assembler**: turns `programs/*.asm` into the `.mem` machine-code files the Verilog loads, plus a `.lst` listing showing each instruction's conversion to binary/hex. Also contains a **reference model** of the CPU in Python. | Writing sample programs |
| `run_tests.py` | **Test runner** (`make test`): runs every Verilog testbench and every program, and compares each clock cycle with the reference model and the expected results. | Verification |
| `trace_to_svg.py` | Draws the timing diagrams in `docs/waveforms/` from the Verilog simulation trace. | Waveform results |
| `export_ui_data.py` | Copies the sample programs and the Verilog traces into `ui/data/` for the web UI. | Web UI |
| `check_ui_model.js` | Checks that the web UI's JavaScript model behaves exactly like the Verilog. | Web UI |
| `logisim/generate_circuit.py` | Builds `logisim/mips_single_cycle.circ` and the diagrams in `docs/logisim/`. | Logisim circuit |
| `logisim/verify_logisim.py` | Runs every program in Logisim and compares each cycle with the Verilog. | Logisim circuit |
| `logisim/LogisimProbe.java` | Small helper that asks Logisim where each component's pins are, and draws the diagrams. | Logisim circuit |
