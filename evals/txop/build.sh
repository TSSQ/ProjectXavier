#!/usr/bin/env bash
# Compiles both Foundation Models transaction-op probes (dev tooling — never
# ships). Requires macOS 26 + Apple Intelligence on.
#
#   ./build.sh && node run-fm-min.mjs 5      # op-only contract
#   ./build.sh && node run-fm-full.mjs 5     # op + selector contract
#   node byok.mjs 3 both both                # cloud tiers (needs keys in .env)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

swiftc -O -parse-as-library -o fm-min fm-min.swift
swiftc -O -parse-as-library -o fm-full fm-full.swift
chmod +x fm-min fm-full
echo "built evals/txop/fm-min and evals/txop/fm-full"
