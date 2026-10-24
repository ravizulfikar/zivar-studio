<div align="center">

<img src="resources/icon.png" alt="Zivar Studio" width="120" />

# Zivar Studio

**Aplikasi desktop untuk mengelola database PostgreSQL, MySQL / MariaDB, SQL Server, dan SQLite.**

Jelajahi, query, edit, rancang, pindahkan, dan gambarkan database dari satu jendela.

[Unduh](https://github.com/ravizulfikar/zivar-studio/releases/latest) · [Website](https://zivar.my.id) · [English](README.md)

<img src="src/renderer/src/docs/img/overview.png" alt="Jendela utama Zivar Studio" width="860" />

</div>

## Fitur

- **Koneksi**: PostgreSQL, MySQL / MariaDB, SQL Server, dan SQLite. Bisa dikelompokkan dalam folder, diberi warna (tandai server produksi), memakai SSL/TLS, dan SSH tunnel (password atau private key). Password disimpan terenkripsi dengan penyimpanan aman sistem operasi.
- **Pohon objek**: database / schema → tabel, view, materialized view, fungsi, dan query tersimpan. Ada kotak cari, menu klik kanan, dan panel detail.
- **Grid data**: paging, pengurutan, filter `WHERE`, dan pengeditan yang aman. Perubahan ditampung dulu, lalu ditulis dalam satu transaksi lewat **Apply**. Ada cari & ganti antar sel dan penampil sel (teks, JSON, hex, gambar).
- **Editor SQL**: autocomplete yang mengenal skema, jalankan bagian terpilih (`Ctrl+Enter`), stop, explain, beautify / minify, snippets (bawaan dan milik Anda), riwayat query, dan query tersimpan per database.
- **Editor JSON**: teks dan pohon berdampingan. Bisa cari, edit di pohon, format, minify, dan urutkan key. Angka besar dan urutan key tetap persis.
- **Desain tabel**: kolom, indeks, dan foreign key dengan **pratinjau DDL**. Diterapkan dalam transaksi di database yang mendukung DDL transaksional.
- **Impor / ekspor**: impor CSV, TSV, Excel, dan JSON / NDJSON dengan pemetaan kolom. Ekspor ke Excel, CSV, JSON, atau SQL `INSERT`.
- **Migrasi**: jalankan berkas `.sql`, dump ke SQL, **transfer data antar koneksi (bahkan antar jenis database)**, dan sinkronisasi struktur tabel.
- **ER diagram**: diagram tabel dan relasi yang bisa digeser dan di-zoom, dengan ekspor SVG / PNG.
- **Lainnya**: tema terang dan gelap, dokumentasi bawaan yang bisa dicari (`F1`, berbahasa Indonesia), dan versi portable yang tidak perlu instalasi.

## Unduh

Ambil versi terbaru di halaman [**Releases**](https://github.com/ravizulfikar/zivar-studio/releases/latest):

- **`ZivarStudio-Setup-<versi>.exe`**: installer.
- **`ZivarStudio-Portable-<versi>.exe`**: satu berkas, langsung jalan.
- **`SHA256SUMS.txt`**: checksum untuk memeriksa keaslian unduhan.

Saat ini ditujukan untuk **Windows 10 / 11 (x64)**. Installer belum ditandatangani (code signing), jadi Windows SmartScreen mungkin menampilkan peringatan pada pembukaan pertama. Pilih *More info → Run anyway* jika Anda mempercayai sumbernya.

## Membangun dari kode sumber

Syarat: [Node.js](https://nodejs.org) 22 atau lebih baru, dan Git.

```bash
git clone https://github.com/ravizulfikar/zivar-studio.git
cd zivar-studio
npm ci

npm run dev          # jalankan untuk pengembangan
npm run typecheck    # pemeriksaan TypeScript
npm test             # tes unit dan integrasi
npm run dist         # buat installer dan exe portable di ./release
```

Detail tes, skrip lain, struktur proyek, dan batasan yang diketahui ada di [README berbahasa Inggris](README.md).

## Merilis versi baru

Rilis dibuat otomatis oleh GitHub Actions ([`release.yml`](.github/workflows/release.yml)):

1. Ubah `version` di `package.json` (dan `package-lock.json`, misalnya `npm version <x.y.z> --no-git-tag-version`), lalu commit.
2. Beri tag dan push: `git tag v1.0.0 && git push origin v1.0.0`.
3. Workflow menjalankan typecheck dan tes, membangun installer dan exe portable, membuat GitHub Release dengan catatan otomatis, lalu melampirkan berkas beserta checksum-nya.

Workflow menolak menerbitkan jika tag tidak sama dengan versi di `package.json`. Tag bersufiks (`v1.1.0-beta.1`) diterbitkan sebagai pra-rilis.

## Lisensi

[MIT](LICENSE) © 2026 Zivar. Komponen pihak ketiga memakai lisensinya masing-masing.
