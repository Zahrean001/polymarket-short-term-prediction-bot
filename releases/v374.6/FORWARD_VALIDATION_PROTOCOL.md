# Forward Validation Protocol V374.6

## Tujuan

Menguji apakah V374.5 frozen control tetap fastgrow dan profitable, sambil mengumpulkan bukti forward untuk challenger anti-drawdown tanpa mengubah execution main.

## Data yang sah

Hanya settlement dengan seluruh kondisi berikut dihitung:

- `botRole=main_test`;
- `sourceType=real_market`;
- `executionStatus=filled` atau valid partial fill dengan stake positif;
- `realParityEligible=true`;
- official final Polymarket settlement;
- unique signal ID;
- strategi frozen V374.5 / release V374.6.

Unfilled, rejected, proxy, synthetic, fallback, duplicate, observer checkpoint, dan settlement non-final tidak masuk WR/PnL evidence.

## Checkpoint operasional

- 1 jam: dua proses sehat, feed pulih dari reconnect, tidak ada state alias, tidak ada observer execution.
- 12 jam: throughput, no-fill reason, fee, slippage, drawdown, dan log growth diperiksa; jangan mengubah config di tengah epoch.
- 24 jam: arsip lengkap dikumpulkan.
- 200 official fills: gate pertama untuk menilai challenger.

## Gate main frozen control

Main dinyatakan tidak downgrade hanya bila run forward baru menunjukkan:

- WR keseluruhan `>=70%`;
- ROI dan realized PnL positif;
- tidak ada duplicate slug, overspend, synthetic entry, proxy headline, atau observer execution;
- tidak ada stuck karena fixed USD minimum/cap atau ATH lock;
- throughput tidak turun karena fitur V374.6 (fitur performa baru tidak berada pada jalur execution).

## Gate challenger 80%

Challenger tetap shadow sampai seluruh kondisi berikut benar pada data forward:

- baseline samples `>=200`;
- challenger coverage `>=90%`;
- WR challenger `>=80%`;
- Wilson 95% lower bound `>=70%`;
- rolling-50 WR `>=78%`;
- ROI positif dan profit factor `>=1.30`;
- maximum drawdown `<=30%` dan tidak lebih buruk dari baseline;
- PnL challenger tidak di bawah baseline;
- sedikitnya 3 epoch lengkap (50 baseline trade/epoch) profitable;
- tidak ada epoch lengkap dengan WR challenger di bawah 70%.

Walaupun semua gate terpenuhi, `automaticPromotion=false`: hasil wajib direview dan dibuat sebagai versi terpisah. V374.6 tidak pernah mengubah main secara otomatis.

## Kegagalan langsung

Stop test dan arsipkan data bila ditemukan overspend terhadap current equity, shared main/observer trading state, observer signal, non-official headline settlement, duplicate committed slug, synthetic entry, atau runtime config/hash berubah tanpa sengaja.
