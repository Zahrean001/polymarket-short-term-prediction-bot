# Instalasi V374.6 Full Paper

## 1. Syarat

- Linux VPS, Node.js `^20.19.0` atau `>=22.12.0`, npm, dan PM2.
- Port lokal 8799 untuk main dan 8800 untuk observer.
- Folder deploy baru dan kosong. Jangan merge source atau runtime state versi lama.

## 2. Verifikasi paket

Verifikasi checksum ZIP menggunakan file `.sha256` yang dikirim bersama paket. Setelah extract:

```bash
npm ci
npm run verify:v3746:all
```

Deploy hanya bila seluruh config, frozen-core, syntax, 108 unit/regression test, import, UI build, main smoke, observer smoke, manifest, dan clean-package check lulus.

## 3. Hindari dua executor bersamaan

Jika V374.6 menggantikan test utama, hentikan proses main lama sebelum start. Arsipkan dahulu data lama; jangan salin `btc-paper-state.json` ke V374.6.

```bash
pm2 delete polymarket-main-v3745 polymarket-settlement-observer-v3745 || true
pm2 delete polymarket-main-v3746 polymarket-settlement-observer-v3746 || true
npm run backend:pm2
pm2 save
```

`ecosystem.config.cjs` harus menghasilkan tepat dua proses. Observer bukan executor.

## 4. Cross-check setelah start

```bash
pm2 status
curl -fsS http://127.0.0.1:8799/health
curl -fsS http://127.0.0.1:8800/health
curl -fsS http://127.0.0.1:8799/api/v3/effective-config
```

Pastikan:

- main: `botRole=main_test`, release `v374.6-anti-downgrade-evidence-full-paper`;
- observer: `botRole=checkpoint_observer`;
- main `paperState.persistenceEnabled=true`;
- observer `paperState.persistenceEnabled=false` dan `observerTradingStatePersistenceForbidden=true`;
- `mainBehaviorPolicyId=v3745-frozen-control`;
- `antiDowngradeShadowExecutionEnabled=false` dan `antiDowngradeAutomaticPromotion=false`;
- tidak ada file signal maupun `btc-paper-state.json` yang dibuat observer.

## 5. Data hasil run

Main menulis ke `server/data-main-v3746`; observer menulis ke `server/data-observer-v3746`. Laporan shadow terbaru berada di:

`server/data-observer-v3746/reports/anti-downgrade-evidence-latest.json`

Setelah minimal 24 jam, kumpulkan seluruh data:

```bash
bash tools/collect-v3746-results.sh "$HOME"
```

Kirim `.tar.gz` dan `.sha256` hasil collector. Jangan hanya mengirim screenshot WR/equity karena audit membutuhkan signals, decisions, settlements, state terakhir, observer report, effective config, dan PM2 logs.

## 6. Batas tegas

Paket ini paper-only. Jangan memasukkan private key, API signing key, seed phrase, atau mengubah `REAL_EXECUTION_MODE`. Jangan aktifkan shadow execution/auto-promotion secara manual; runtime validator sengaja menggagalkan startup bila flag tersebut diubah.
