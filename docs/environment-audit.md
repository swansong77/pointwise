# Phase 1 — Environment Audit

Host: macOS (Darwin 27.2.0, Apple Silicon). Audit date: 2026-11-20.
All tooling lives on the external `SamsungT7` volume where possible (internal disk has ~13 GB free).

## 1. Required tools

| Tool | Status | Version / Path | Notes & recommended settings |
|---|---|---|---|
| `strings` | ✅ Installed | `/opt/local/bin/strings` (MacPorts cctools) | Use `strings -a` to scan all segments (Swift `__cstring`, `__oslogstring`). |
| `nm` | ✅ Installed | `/opt/local/bin/nm` | Always pass `-arch arm64` on universal binaries. Main binary is stripped (234 defined symbols). |
| `otool` | ✅ Installed | `/opt/local/bin/otool` | `otool -arch arm64 -L/-l` for dylibs and load commands. |
| `class-dump` | ❌ Missing | — | Not needed: the app is ~95 % Swift. Swift metadata was parsed directly (see `docs/swift-analysis.md`). Install: `brew install class-dump` (ObjC only). |
| Hopper | ✅ Installed | `~/Applications/Hopper Disassembler.app` | Demo/license prompt on first launch. Used via REA provider. |
| Ghidra | ✅ Installed | 12.2 at `/Volumes/SamsungT7/Applications/re-tools/ghidra_12.2_PUBLIC` | Requires JDK 25 (`re-tools/jdk-25.0.5.1+2`). macOS arm64 decompiler built locally. For the 56 MB main binary raise `ghidra.startup_timeout_ms` ≥ 900000 and import the thinned arm64 slice only. |
| Frida | ❌ Missing | — | Optional for this project. App is hardened-runtime + App Store signed (`get-task-allow=false`); attaching requires SIP changes or re-signing — **not recommended** on a daily-driver Mac. Install: `pip install frida-tools`. |
| Objection | ❌ Missing | — | iOS/Android-oriented; low value for a Catalyst app. `pip install objection`. |
| Radare2 | ❌ Missing | — | Optional; REA + Ghidra cover disassembly. `brew install radare2`. |
| `lldb` | ✅ Installed | lldb-2103.0.34.407 | Cannot attach to the App Store build (no `get-task-allow`). |
| `codesign` | ✅ Installed | `/usr/bin/codesign` | `codesign -d --entitlements :- <bin>` |
| `plutil` | ✅ Installed | `/usr/bin/plutil` | `plutil -p` |
| `jq` | ✅ Installed | jq-1.7.1-apple | |
| `sqlite3` | ✅ Installed | 3.48.0 | Used on `cp_seed.sqlite` (Core Data store). |

## 2. Optional tools

| Tool | Status | Notes |
|---|---|---|
| IDA Pro | ❌ Not installed | Must be user-supplied (licensed). REA supports `provider_id: "ida"`. |
| `swift-demangle` | ✅ Via Xcode | `DEVELOPER_DIR=/Volumes/SamsungT7/Applications/Xcode.app/Contents/Developer xcrun swift-demangle` |
| `swift-reflection-dump` | ❌ Not shipped in Xcode 27.2 | Replaced by a custom Python parser for `__swift5_types` / `__swift5_fieldmd` (`scratchpad/swifttypes.py`, `swiftfields.py`; logic documented in swift-analysis.md). |
| Binary Ninja | ❌ Not installed | Not required. |
| `dyld_info` | ✅ Via Xcode | Fixups / exports listing. |
| `assetutil` | ✅ Via Xcode | `xcrun --sdk macosx assetutil --info Assets.car` |

## 3. Supporting toolchains

| Tool | Version | Purpose |
|---|---|---|
| Xcode | 27.2 at `/Volumes/SamsungT7/Applications/Xcode.app` | Swift scripts (Core Data model dump), assetutil. **Always export `DEVELOPER_DIR`** — `/Library/Developer/CommandLineTools` is broken (Swift 6.2.3 vs 6.2 SDK mismatch). |
| REA (MCP) | 6.10.1 | Release-exposure audit, Swift/ObjC analysis, IB decoding, Ghidra/Hopper orchestration. |
| Node.js | v26.13.1 | Web app tooling (containers use Node 22 LTS). |
| Python | 3.13.1 | Mach-O metadata parsers (run with `-I`). |
| Docker | 29.1.2 / Compose v2.40.3 | Phase 23–24. |

## 4. Claude Code configuration used

- MCP server `rea` registered in `~/.claude.json` with `GHIDRA_INSTALL_DIR`, `JAVA_HOME`, `HOPPER_LAUNCHER_PATH`, `DEVELOPER_DIR`.
- Skill `reverse-engineer-anything` loaded for the investigation.
- Workflow: shell tools for inventory → custom Swift-metadata parsers → REA for audits → Markdown deliverables in `project-analysis/`.

## 5. Constraints discovered

1. **Runtime analysis blocked by signing:** App Store/hardened runtime, `get-task-allow=false`. Frida/lldb attach would require disabling SIP. All findings are therefore **static**.
2. **Network capture not performed:** capturing live traffic would require logging into a real CardPointers account and a TLS-intercepting proxy; out of scope without account-owner consent. API schemas are recovered from Swift Codable metadata instead.
3. **Obfuscated JavaScript:** bank automation scripts are obfuscator.io output; documented at the behavioral level only.
