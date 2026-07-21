#!/usr/bin/env bash
# Compiles the Mac-side Foundation Models probe (dev tooling — never ships).
# Requires macOS 26 + Apple Intelligence on. See evals/README.md "Wiring the
# FM Swift probe" for how the resulting binary plugs into the eval harness.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

swiftc -O -parse-as-library -o probe probe.swift

chmod +x probe
echo "built evals/fm/probe"
