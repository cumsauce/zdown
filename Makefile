# Build helpers with the fast loop baked in.
#
# Measured on this machine (4 cores, warm ~/.cache/crystal unless noted):
#   make check   1.8s   typecheck only, no codegen
#   make spec    3.4s   compile + run specs
#   make build   2.8s   -O2 --no-debug, multi-module  (dev binary)
#   make build   12.5s  same, cold cache
#   make release 3.9s   --release (-O3 --single-module) (shipping binary)
#   make release 27.2s  same, cold cache
#
# --release implies --single-module, which serializes the LLVM optimizer;
# that is why release is slower than debug on a COLD cache. For day-to-day
# dev use `make build`. Runtime difference is negligible for this server.
#
# crystal/shards live in /opt/homebrew/bin and are NOT on PATH in
# non-interactive shells. The shards-version macro in src/md_editor.cr shells
# out to `shards` at compile time — without it on PATH the build dies with a
# cryptic "exit status 127". Hence the PATH export below.

export PATH := /opt/homebrew/bin:$(HOME)/.local/bin:$(PATH)

BIN := bin/md_editor

.PHONY: all check spec build release clean clean-cache

all: build

# Fastest edit→check loop: typecheck only (~1.8s warm).
check:
	crystal build --no-codegen src/server.cr

spec:
	crystal spec

# Dev binary: optimized enough to be fast at runtime, ~2.8s warm / 12.5s cold.
build:
	crystal build -O2 --no-debug src/server.cr -o $(BIN)

# Shipping binary: full -O3 + single module + debug info.
release:
	crystal build --release src/server.cr -o $(BIN)

clean:
	rm -f $(BIN) $(BIN).dbg

# Only if builds go weird. Cold rebuild costs ~27s (release).
clean-cache:
	rm -rf ~/.cache/crystal
