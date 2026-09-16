# V374.7 — Direction-Only Forward Shadow Fastgrow Full Paper

V374.7 adalah paket **paper-only** dengan tepat dua proses:

1. `polymarket-main-v3747` — satu-satunya proses yang dapat membuat paper execution.
2. `polymarket-direction-observer-v3747` — membaca signal entry live dan settlement resmi untuk menilai arah alternatif; proses ini tidak dapat mengeksekusi, memblokir, mengubah stake, mengurangi jumlah entry, atau memperlambat scan main.

## Ringkasan konteks bot

Bot ini adalah mesin riset dan simulasi perdagangan jangka pendek untuk market kripto 5 menit di Polymarket. Bot menggunakan data order book WebSocket, feed harga Chainlink RTDS resmi, dan settlement resmi Polymarket. Semua eksekusi pada release ini adalah **paper execution**; paket ini tidak menyediakan executor order riil dan tidak boleh dianggap sebagai jaminan profit.

Arsitektur utamanya:

- `server/index.js` menjalankan HTTP API, scanner, paper ledger, settlement reconciliation, dan lifecycle proses.
- `server/prediction/` menghitung probabilitas, edge, eligibility episode, dan lane akurasi.
- `server/execution/` menerapkan market minimum, observed depth, fee reserve, FAK fill, dan paper commit.
- `server/research/` mengisolasi observer arah agar hanya menghasilkan telemetry dan evidence.
- `src/` berisi dashboard Vite/React.
- `tests/` dan `tools/` berisi regression test, semantic checks, runtime smoke test, serta pemeriksaan paket bersih.

Main dan observer sengaja memakai directory data yang berbeda. Jangan menyalin state, signal, decision, atau settlement dari release lama karena akan mencemari forward validation.

## Persyaratan

- Node.js `^20.19.0` atau `>=22.12.0`
- npm
- PM2 hanya diperlukan untuk deployment multi-proses
- Akses jaringan ke Polymarket Gamma/CLOB/WebSocket dan Polymarket RTDS Chainlink

## Instalasi lokal

Di Windows PowerShell, gunakan `npm.cmd` bila execution policy memblokir `npm.ps1`:

```powershell
cd "D:\bot learn\best1\On progrees\374.7\polymarket-short-term-prediction-bot"
npm.cmd ci
npm.cmd run verify:v3747:all
npm.cmd run backend
```

Dashboard dapat dibangun dan dijalankan terpisah:

```powershell
npm.cmd run build
npm.cmd run dev
```

API main berjalan pada `http://127.0.0.1:8799`; observer pada `http://127.0.0.1:8800` saat dijalankan melalui PM2.

## Deployment PM2

```bash
npm ci
npm run verify:v3747:all
npm run backend:pm2
pm2 save
```

Periksa health endpoint setelah start:

```bash
curl -fsS http://127.0.0.1:8799/health
curl -fsS http://127.0.0.1:8800/health
```

Di Windows, PM2 dapat dijalankan dari PowerShell dengan `npm.cmd run backend:pm2` setelah PM2 tersedia di PATH. Detail operasi dan pengumpulan evidence ada di `INSTALL_V3747_PAPER.md` serta `FORWARD_VALIDATION_PROTOCOL_V3747.md`.

## Batasan keselamatan

Jangan mengaktifkan real order, synthetic/fallback data, atau automatic promotion. Variable yang harus tetap `0` tercantum di `.env.example` dan divalidasi saat startup. Hasil baseline dan target forward adalah evidence penelitian, bukan klaim performa masa depan.

## Keputusan berdasarkan bukti terbaru

Run V374.6 terbaru memiliki 19 settlement resmi: 16 win / 3 loss, WR 84.210526%, PnL `+$5.31949913`, ROI 4.777461%, profit factor 1.227238, dan maximum drawdown 32.387787%. Masalah utamanya bukan jumlah win, melainkan asimetri loss: rata-rata win `+$1.79555661`, rata-rata loss `-$7.80313554`; satu loss menghapus sekitar 4.35 rata-rata win. Semua tiga loss berada di Lane S, tetapi probabilitas rata-rata win (0.919743) dan loss (0.922020) hampir sama, sehingga cap/filter berdasarkan confidence yang sama belum mempunyai daya diskriminasi.

Replay filter lama terlihat lebih baik pada 16 trade, tetapi coverage hanya 84.210526% dan sampelnya terlalu kecil. Menerapkannya sekarang akan melanggar aturan tidak mengurangi entry dan berisiko mengulang downgrade V374.4. Fakta lengkap ada di `V3747_BASELINE_EVIDENCE.json`.

## Yang diterapkan

- Main tetap `v3745-frozen-control`; 23 file execution core diverifikasi dengan hash frozen V374.5.
- Jalur probabilitas main di-hard-isolate: saat shadow execution dimatikan, reader observer sama sekali tidak dipanggil dan probabilitas asset dikembalikan persis tanpa cap.
- Setiap signal main yang benar-benar filled membawa snapshot dual-side live pada saat entry. Snapshot synthetic/fallback tidak eligible.
- Observer membuat satu keputusan arah immutable maksimal 10 detik setelah signal, sebelum window berakhir. Late backfill dicatat tetapi tidak dihitung sebagai bukti forward.
- Arah hanya boleh di-flip di observer oleh kontradiksi minimal tiga keluarga independen yang mencakup asset probability dan price distance, atau oleh kegagalan cohort forward minimal 50 sampel dengan Wilson upper di bawah 50%.
- Settlement outcome baru dibaca setelah keputusan, hanya dari final settlement Polymarket resmi.
- Risk flags, Lane S, korelasi, dan stake/equity hanya menjadi telemetry; tidak memiliki fungsi block/resize di main.
- Tidak ada promosi otomatis. Bahkan ketika gate bukti lulus, paket ini hanya menghasilkan kandidat review manual.

## Rules fastgrow yang tetap identik

- Scan 500 ms, hot 200 ms, ultra-hot 100 ms.
- Maksimum 8 entry per tick dan 144 posisi aktif.
- Lane A 8–10% dan Lane S 12–15% current realized equity.
- Tidak ada fixed USD cap, fixed `$3` minimum, ATH lock, recovery multiplier, martingale, global cooldown, atau quality veto baru.
- Current cash + fee reserve, actual market minimum, observed depth, FAK fill, 30% unresolved reserve, dan one-position-per-slug tetap menjadi hard constraint realistis.
- Unfilled/rejected/proxy/observer record tidak masuk WR execution.

## Verifikasi dan deploy

```bash
npm ci
npm run verify:v3747:all
npm run backend:pm2
```

Baca `INSTALL_V3747_PAPER.md`, `FORWARD_VALIDATION_PROTOCOL_V3747.md`, dan `V3747_VERIFICATION_REPORT.md`. Konteks implementasi untuk AI/developer dipisahkan di `docs/ai-context/`. Jangan menyalin state runtime versi lama ke directory V374.7.

Tidak ada software yang dapat menjamin profit atau WR 90–100% pada data forward. V374.7 sengaja mengumpulkan bukti arah tanpa mempertaruhkan performa main yang sudah terbukti sementara.
