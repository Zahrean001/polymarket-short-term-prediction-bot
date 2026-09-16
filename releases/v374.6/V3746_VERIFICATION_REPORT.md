# Verification Report — V374.6

## Provenance

- Source control: `v374.5-regime-core-fastgrow-full-paper.zip`.
- Source SHA-256: `131ab10a62114540aa4a0904b0917127c22003a322d252e268b3a354caf8f21e`.
- Latest run evidence: `v374.5-run-data.zip`.
- Evidence SHA-256: `03eb5101f498b37acd937b229600b0e3b4304585d1abb53b06035e3fff8fe819`.
- Sebelum modifikasi, source control lulus 102/102 unit test, syntax, import, UI build, main runtime smoke, observer runtime smoke, manifest, dan clean-package verifier.

## Fakta latest run

| Metric | V374.5 control |
|---|---:|
| Official filled unique | 19 |
| Win / loss | 15 / 4 |
| Win rate | 78.947368% |
| Wilson lower 95% | 56.665722% |
| Realized PnL | +$9.72575364 |
| Equity | $40 → $49.72575364 |
| ROI on filled stake | 8.692012% |
| Profit factor | 1.363059 |
| Maximum drawdown | 34.653197% |
| Throughput observed | 8.95 trade/hour |

Loss terbesar muncul sebagai cluster same-direction/same-window setelah periode awal yang baik. Correlation telemetry mendeteksi second correlated entry, tetapi cluster/exposure governor memang disabled pada frozen main. Satu BTC UP high-price loss pada 0.82 memiliki book-confirmation score sangat lemah sementara legacy calibrated net edge negatif. Ini diagnosis berbasis row settlement aktual, bukan klaim causal yang sudah terbukti forward.

## Replay observer-only

Evaluator V374.6 memakai hanya official-real-filled-unique rows dan hanya settlement yang waktunya sudah tersedia sebelum entry berikutnya. Tidak ada synthetic outcome atau future-label look-ahead.

| Metric | Frozen control | Shadow challenger |
|---|---:|---:|
| Counted trades | 19 | 17 |
| Win rate | 78.947368% | 88.235294% |
| PnL | +$9.72575364 | +$20.66119210 |
| ROI | 8.692012% | 22.036361% |
| Profit factor | 1.363059 | 2.498383 |
| Max drawdown | 34.653197% | 23.531384% |

Replay ini gagal promotion gate karena baseline baru 19, coverage 89.473684%, Wilson lower challenger 65.663649%, belum ada rolling-50, dan belum ada 3 epoch lengkap. Karena itu hasil tidak menyentuh main.

## Perubahan kode yang diizinkan

1. Release identity, data directory, dan PM2 process identity V374.6.
2. Explicit role-local paths untuk trading/session/reference/advisor state.
3. Observer tidak memuat atau menyimpan trading prediction state.
4. Content-aware state persistence dengan heartbeat 60 detik.
5. Bounded audit dedupe untuk scan-spam; signal/settlement/checkpoint lossless.
6. Observer-only anti-downgrade evidence report dan hard promotion gates.
7. Runtime fail-fast untuk path alias, shadow execution, auto-promotion, dan perubahan frozen control ID.

## Bukti main tidak diubah diam-diam

`V3745_FROZEN_CORE.sha256` mengunci 23 modul performa utama. Verifier membandingkan hash setiap modul saat `npm run verify:v3746:all`; satu byte perubahan akan menggagalkan build. Dua adapter signal (`paperCommitPolicy` dan `primaryPaperSignal`) hanya diperluas agar release V374.6 dengan `strategyVersion=v374.5-regime-core-fastgrow-paper` tetap memakai Regime-Core, bukan jatuh ke jalur legacy calibration. Perilaku kompatibilitas ini diuji langsung. Perubahan lain terbatas pada `server/index.js`, runtime validation, audit logger, dan observer research path, dengan regression/smoke test khusus.

## Status

Paket layak menjadi **test utama paper** untuk menggantikan proses V374.5, bukan untuk live. Target 80% belum dinyatakan terbukti; yang terbukti adalah control latest-run 78.95% dengan profit positif dan bahwa challenger belum memenuhi sample gate. Keputusan lanjut harus memakai forward archive baru tanpa perubahan config selama epoch.

## Hasil verification suite final

- Config semantics dan unsafe-override rejection: PASS.
- Frozen V374.5 execution core: 23/23 file PASS.
- Syntax/JSON: 78 source files dan 3 JSON PASS.
- Unit/regression: 108/108 pada 21 test files PASS.
- Relative import resolution: 108 imports PASS.
- Vite production build: PASS.
- Main runtime smoke (termasuk feed watchdog recovery dan frozen-control identity): PASS.
- Observer runtime smoke (termasuk official ingest, no execution, no trading-state write, dan evidence report): PASS.
- Source-only manifest dan clean-package audit: 92 files, payload di bawah 5 MB, PASS.
