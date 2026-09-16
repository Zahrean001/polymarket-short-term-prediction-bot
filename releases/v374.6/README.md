# V374.6 — Anti-Downgrade Evidence Fastgrow Full Paper

> Release sebelumnya yang dipertahankan untuk reproduksi dan perbandingan. V374.7 di root repository adalah versi aktif/default.

Source V374.6 sengaja ditempatkan di folder terisolasi agar tidak menimpa source V374.7. Data runtime, log, dependency terpasang, hasil build, dan arsip hasil eksperimen tidak dipublikasikan; jalankan `npm ci` dari folder ini jika ingin memverifikasi atau menjalankan release V374.6.

V374.6 adalah paket **paper-only** dengan tepat dua proses:

1. `polymarket-main-v3746` — satu-satunya proses yang membuat paper execution.
2. `polymarket-settlement-observer-v3746` — membaca settlement resmi, membuat laporan baseline–challenger, dan tidak pernah mengeksekusi posisi.

Main memakai `v3745-frozen-control`. Sebanyak 23 modul inti pemilihan arah, eligibility, sizing, market minimum, FAK fill, risk, dan settlement mempunyai hash identik dengan V374.5. Dua adapter klasifikasi signal hanya diperluas agar release V374.6 tetap dikenali sebagai strategi frozen V374.5; perilaku ini memiliki regression test khusus. V374.6 tidak menerapkan filter performa baru ke main.

## Fakta run yang menjadi dasar

Arsip `v374.5-run-data.zip` dengan SHA-256 `03eb5101f498b37acd937b229600b0e3b4304585d1abb53b06035e3fff8fe819` berisi 19 settlement resmi, real-market, filled, unique:

- 15 win / 4 loss, WR 78.947368%.
- Equity `$40 → $49.72575364`; PnL `+$9.72575364`; ROI 8.692012%.
- Profit factor 1.363059; maximum drawdown 34.653197%.
- Throughput teramati 8.95 trade/jam.

Jadi performa overall **good dan profitable**, tetapi belum cukup untuk menyatakan WR stabil 80%: Wilson lower 95% masih 56.665722% karena sampel baru 19, dan satu loss cluster menyebabkan drawdown 34.65%.

Replay shadow causal terhadap settlement yang sama menghasilkan 17 trade, WR 88.235294%, PnL `+$20.66119210`, dan max drawdown 23.531384%. Hasil ini tidak dipromosikan karena masih same-run, hanya 19 baseline sample, coverage 89.473684%, dan belum memenuhi gate 200 sample. Angka lengkap ada di `V3746_RETROSPECTIVE_EVIDENCE.json`.

## Perubahan aman V374.6

- State trading main dan observer memiliki path eksplisit terpisah. Observer dilarang membaca atau menulis `btc-paper-state` sebagai trading ledger.
- State main ditulis segera saat ledger berubah; scan identik sebelum heartbeat 60 detik tidak menulis ulang file besar.
- Snapshot/decision/strategy/gate identik dideduplikasi selama 1 detik. Signal, settlement, dan checkpoint tetap lossless.
- Observer mengevaluasi tiga hipotesis secara causal, memakai hanya settlement yang sudah tersedia pada saat entry: Lane S→A setelah dua loss terbaru, cap correlated reserve 20% equity, dan weak-book high-price veto.
- Semua hipotesis tersebut `observerOnly=true`, `executionEligible=false`, dan `automaticPromotion=false`.
- Runtime menolak synthetic book/price, simulated latency, non-official settlement, real execution, shared role-state path, shadow execution, atau auto-promotion.

Tidak ada software yang dapat menjamin profit atau WR 80% pada data forward. Paket ini mencegah downgrade yang belum terbukti dan mengumpulkan bukti yang cukup sebelum perubahan performa diizinkan.

## Verifikasi dan deploy

```bash
npm ci
npm run verify:v3746:all
npm run backend:pm2
```

Baca `INSTALL_V3746_PAPER.md`, `FORWARD_VALIDATION_PROTOCOL.md`, dan `V3746_VERIFICATION_REPORT.md` sebelum deploy. Jangan menyalin state dari versi lama ke data directory V374.6.
