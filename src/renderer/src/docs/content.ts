import type { Group } from './blocks'

// Dokumentasi Zivar Database Studio. Nama tombol dan menu ditulis persis seperti yang tampil di aplikasi (berbahasa Inggris).
// Gambar ada di ./img dan dibuat ulang dengan `npm run docs:shots`.

export const GROUPS: Group[] = [
  {
    title: 'Memulai',
    sections: [
            {
        id: 'pengenalan',
        title: 'Mengenal Zivar Database Studio',
        summary: 'Satu aplikasi desktop untuk PostgreSQL, MySQL/MariaDB, SQL Server, dan SQLite.',
        blocks: [
          { t: 'p', text: 'Zivar Database Studio adalah klien database untuk mengelola beberapa jenis database dari satu jendela: menjelajah tabel, mengedit data, menulis SQL, merancang tabel, memindahkan data antar database, dan melihat relasi antar tabel.' },
          { t: 'img', file: 'overview', caption: 'Jendela utama: daftar koneksi di kiri, tab kerja di kanan, panel Details di kiri bawah.' },
          { t: 'table', head: ['Bagian', 'Fungsi'], rows: [
            ['**Menu bar** (File, View, Tools, Help)', 'Semua perintah juga ada di sini. Help → Documentation (F1) membuka halaman ini.'],
            ['**Toolbar**', 'Jalan pintas: Connection, New Query, Objects, Diagram, New Table, Open Table, Design, Refresh, Import, Export, JSON, tema, dan panel Details.'],
            ['**Sidebar**', 'Pohon koneksi → database/schema → Tables, Views, Materialized Views, Functions, Queries. Kotak cari di atasnya menyaring koneksi dan objek.'],
            ['**Details**', 'Panel di kiri bawah yang menampilkan informasi objek yang sedang dipilih (kolom, tipe, kunci). Tampil/sembunyikan dengan tombol Details.'],
            ['**Tab**', 'Setiap tabel, query, desain tabel, diagram, atau editor JSON dibuka di tab sendiri. Tab yang tidak aktif tetap hidup, jadi isi editor dan hasil query tidak hilang.']
          ] },
          { t: 'ul', items: [
            'Menjalankan pertama kali: klik **Connection** di toolbar untuk membuat koneksi.',
            'Lebar sidebar bisa diseret lewat garis pemisah di antara sidebar dan tab.',
            'Aplikasi mengikuti tema terang/gelap sistem operasi saat pertama kali dibuka. Ubah kapan saja dengan tombol **Dark/Light**.'
          ] },
          { t: 'tip', text: 'Tekan **F1** kapan saja untuk membuka dokumentasi ini.' }
        ]
      },
            {
        id: 'koneksi',
        title: 'Membuat dan mengelola koneksi',
        summary: 'Hubungkan ke database lokal atau server, langsung maupun lewat SSH tunnel.',
        blocks: [
          { t: 'p', text: 'Klik **Connection** di toolbar (atau File → New connection…). Pilih **Type** terlebih dulu karena isian yang tampil menyesuaikan jenis database.' },
          { t: 'img', file: 'connection-dialog', caption: 'Dialog koneksi baru untuk PostgreSQL.' },
          { t: 'table', head: ['Isian', 'Keterangan'], rows: [
            ['**Type**', 'PostgreSQL, MySQL / MariaDB, SQL Server, atau SQLite. Port bawaan terisi otomatis sesuai jenisnya.'],
            ['**Name**', 'Nama yang tampil di sidebar.'],
            ['**Group (folder)**', 'Mengelompokkan koneksi dalam satu folder di sidebar, misalnya “Perusahaan” atau “Pribadi”. Ketik nama baru atau pilih yang sudah ada.'],
            ['**Warna**', 'Memberi warna pada baris koneksi. Berguna untuk menandai server produksi supaya tidak tertukar dengan server percobaan.'],
            ['**Host / Port / User / Password**', 'Alamat dan akun server. Untuk SQLite, isian ini diganti satu kolom **File** (tombol Browse… untuk memilih berkas database).'],
            ['**Database (optional)**', 'Database awal. Kosongkan untuk melihat semua database di server.'],
            ['**Use SSL/TLS**', 'Mengaktifkan koneksi terenkripsi ke server.']
          ] },
          { t: 'p', text: 'Tombol **Test** mencoba menyambung tanpa menyimpan. Jika berhasil, klik **Save**.' },
          { t: 'p', text: '**SSH tunnel** dipakai jika server database tidak bisa dijangkau langsung dan hanya bisa diakses lewat server perantara (bastion). Centang **Connect through an SSH tunnel**, lalu isi SSH host, port, dan user.' },
          { t: 'img', file: 'connection-ssh', caption: 'Koneksi PostgreSQL lewat SSH tunnel dengan private key.' },
          { t: 'ul', items: [
            '**Authentication**: pilih Password atau Private key (berkas kunci + passphrase bila ada).',
            '**Host dan port database** di bagian atas dibaca dari sisi server SSH. Jika database berjalan di server SSH itu sendiri, isi `localhost`.',
            'Pada sambungan pertama, sidik jari (fingerprint) server SSH disimpan. Jika kelak berubah, koneksi **ditolak** supaya Anda tidak tersambung ke server palsu.'
          ] },
          { t: 'p', text: '**Mengelola koneksi:** klik kanan sebuah koneksi untuk **Open connection / Close connection**, **New query**, **Run SQL file…**, **Edit connection…**, atau **Delete connection**. Klik dua kali pada koneksi untuk membukanya. Titik hijau di sebelah nama menandakan koneksi sedang terbuka.' },
          { t: 'tip', text: 'Password (termasuk password SSH) disimpan terenkripsi memakai penyimpanan aman milik sistem operasi (Windows, atau keyring seperti gnome-keyring / KWallet di Linux), bukan sebagai teks biasa. Di Linux, keyring harus terpasang dan terbuka agar password bisa disimpan.' }
        ]
      },
            {
        id: 'menjelajah',
        title: 'Menjelajah database',
        summary: 'Pohon objek, menu klik kanan, daftar objek, dan query tersimpan.',
        blocks: [
          { t: 'p', text: 'Buka koneksi dengan klik dua kali, lalu klik database (atau schema pada PostgreSQL) untuk membuka isinya. Objek dikelompokkan dalam folder:' },
          { t: 'ul', items: [
            '**Tables** — tabel. Klik dua kali untuk melihat datanya.',
            '**Views** dan **Materialized Views** — tampilan. Hanya baca.',
            '**Functions** — fungsi dan prosedur. Klik dua kali untuk melihat definisinya sebagai SQL.',
            '**Queries** — query yang Anda simpan untuk database ini (lihat bagian *Query tersimpan, riwayat*). Klik dua kali untuk membukanya lagi.'
          ] },
          { t: 'p', text: 'Angka di sebelah nama folder adalah jumlah objeknya.' },
          { t: 'p', text: '**Mencari.** Ketik di kotak **Search connections / objects** di atas pohon untuk mencari **koneksi, tabel, view, materialized view, fungsi, dan query tersimpan** sekaligus. Hasilnya dikelompokkan per koneksi dan database, dengan bagian yang cocok diberi sorotan.' },
          { t: 'img', file: 'sidebar-search', caption: 'Mencari “kota”: satu view dan satu query tersimpan ditemukan lewat namanya. Bagian yang cocok disorot.' },
          { t: 'ul', items: [
            'Beberapa kata harus cocok **semuanya**, urutannya bebas, dan huruf besar/kecil diabaikan: “report signup” menemukan query bernama “Monthly signup report”.',
            'Query tersimpan dicari lewat **nama dan isi SQL-nya**. Tabel, view, dan fungsi dicari lewat namanya (untuk PostgreSQL termasuk nama schema, misalnya `old.legacy`).',
            'Klik sebuah hasil untuk memilihnya; klik dua kali untuk membukanya (data untuk tabel dan view, definisi untuk fungsi, editor untuk query). Klik kanan menampilkan menu yang sama seperti di pohon.',
            'Yang bisa dicari hanyalah database yang **sudah dimuat** oleh pohon, karena pencarian tidak diam-diam menghubungi server Anda. Jika ada koneksi yang belum terbuka, di bawah hasil muncul keterangannya beserta tombol **Search all connections** yang membuka koneksi itu dan membaca isinya. Tombol Refresh memperbarui isi yang sudah diingat.',
            'Klik dua kali sebuah *koneksi* di hasil untuk menutup pencarian dan membukanya di pohon. **Esc** (atau tombol ×) mengosongkan kotak cari.'
          ] },
          { t: 'img', file: 'tree-menu', caption: 'Menu klik kanan pada database.' },
          { t: 'table', head: ['Menu klik kanan database', 'Fungsi'], rows: [
            ['**Open objects list**', 'Membuka daftar semua objek dalam satu tab.'],
            ['**ER diagram**', 'Menggambar relasi antar tabel.'],
            ['**New table…**', 'Membuka desainer untuk tabel baru.'],
            ['**New query here**', 'Editor SQL yang sudah terarah ke database ini.'],
            ['**Run SQL file…**', 'Menjalankan berkas .sql.'],
            ['**Dump SQL file…**', 'Mengekspor struktur dan/atau data menjadi berkas .sql.'],
            ['**Transfer data to…**', 'Menyalin tabel ke database lain, bahkan beda jenis.'],
            ['**Synchronize structure…**', 'Menyamakan struktur tabel dengan database lain.']
          ] },
          { t: 'p', text: 'Klik kanan sebuah tabel: **Open data**, **Design table**, **Import data…**, **New query here**. Untuk view dan fungsi tersedia **Definition (SQL)**.' },
          { t: 'p', text: '**Objects list** menampilkan seluruh objek dalam bentuk tabel. Satu baris selalu terpilih; tombol **Open** membuka data atau definisi, **Structure** membuka desainer tabel (atau struktur read-only untuk view).' },
          { t: 'img', file: 'objects-tab', caption: 'Daftar objek dengan tombol Open dan Structure.' }
        ]
      }
    ]
  },
  {
    title: 'Bekerja dengan data',
    sections: [
            {
        id: 'data-tabel',
        title: 'Melihat dan mengedit data tabel',
        summary: 'Grid data dengan penyaringan, pengurutan, paging, dan pengeditan yang aman.',
        blocks: [
          { t: 'p', text: 'Klik dua kali sebuah tabel di sidebar, atau pilih tabel lalu klik **Open Table**.' },
          { t: 'img', file: 'table-data', caption: 'Data tabel dengan filter WHERE, satu sel yang diubah (kuning), dan satu baris baru yang belum disimpan.' },
          { t: 'ul', items: [
            '**Mengurutkan:** klik judul kolom. Klik lagi untuk membalik arah.',
            '**Menyaring:** ketik kondisi SQL di kotak **WHERE …** lalu tekan Enter, misalnya `stock < 40 AND category = \'Biji kopi\'`. Kosongkan untuk menampilkan semua.',
            '**Paging:** tombol ◀ ▶ di bawah, dan pilihan 100 / 500 / 1000 baris per halaman.',
            '**Memuat ulang:** tombol berikon panah melingkar di kiri toolbar.',
            'Arahkan kursor ke judul kolom untuk melihat tipe data dan apakah kolom NOT NULL.'
          ] },
          { t: 'p', text: '**Mengedit.** Perubahan tidak langsung ditulis ke database. Semuanya ditampung sebagai *perubahan tertunda* sampai Anda menekan **Apply**, lalu ditulis dalam satu transaksi.' },
          { t: 'table', head: ['Tindakan', 'Cara'], rows: [
            ['Ubah isi sel', 'Klik dua kali sel, ketik, tekan Enter. Tekan Esc untuk membatalkan.'],
            ['Isi sel dengan NULL', 'Saat mengedit sel, tekan **Ctrl+0**.'],
            ['Tambah baris', 'Tombol **Row**. Kolom yang dibiarkan kosong memakai nilai default tabel.'],
            ['Hapus baris', 'Pilih baris (klik nomor barisnya) lalu **Delete**. Klik sekali lagi untuk membatalkan penandaan.'],
            ['Simpan semua perubahan', '**Apply (n)** — n adalah jumlah perubahan tertunda.'],
            ['Batalkan semua perubahan', '**Discard**']
          ] },
          { t: 'warn', text: 'Tabel tanpa primary key, view, dan materialized view bersifat **read-only**, karena aplikasi tidak bisa menentukan baris mana yang dimaksud. Alasannya ditampilkan di tab.' },
          { t: 'p', text: 'Jika sebuah perubahan ditolak database (misalnya melanggar constraint), seluruh perubahan dibatalkan dan pesan error ditampilkan, sehingga data tidak pernah setengah tertulis.' }
        ]
      },
            {
        id: 'filter-urut',
        title: 'Filter terstruktur, urutan, dan kolom',
        summary: 'Menyaring dan mengurutkan data tanpa menulis SQL, dan memilih kolom yang tampil.',
        blocks: [
          { t: 'p', text: 'Di bawah toolbar tab data ada baris tombol **Text**, **Filter**, **Sort**, dan **Columns**. Yang pertama dijelaskan di bagian *Panel Text*.' },
          { t: 'p', text: '**Filter.** Klik **Filter** untuk menyusun kondisi tanpa menulis SQL. Setiap baris adalah satu kondisi: kotak centang (dipakai atau tidak), kolom, operator, dan nilai. Klik **+ Condition** untuk menambah baris; pilihan **and** / **or** di ujung sebuah baris menyambungkannya ke baris berikutnya. Tekan **Apply** (atau Enter di kotak nilai) untuk menjalankannya.' },
          { t: 'img', file: 'grid-filter', caption: 'Dua kondisi digabung dengan “and”: stock < 40 dan category mengandung “Biji”. Empat baris cocok.' },
          { t: 'table', head: ['Operator', 'Arti'], rows: [
            ['`=` `!=` `<` `<=` `>` `>=`', 'Perbandingan. Angka dibandingkan sebagai angka (tanpa pembulatan), teks sebagai teks.'],
            ['**contains**, **contains (case insensitive)**', 'Mengandung teks. Yang pertama membedakan huruf besar/kecil, yang kedua tidak. Berlaku juga untuk kolom angka atau tanggal.'],
            ['**does not contain** (dan versi case insensitive)', 'Tidak mengandung teks itu. Baris yang nilainya NULL ikut disertakan.'],
            ['**begins with**, **ends with**', 'Diawali / diakhiri teks. Ada juga versi “does not …”.'],
            ['**is null**, **is not null**', 'Nilainya NULL / bukan NULL.'],
            ['**is empty**, **is not empty**', 'Teks sepanjang nol / bukan. Teks yang hanya berisi spasi *bukan* kosong.'],
            ['**is between**, **is not between**', 'Dua nilai, batas bawah dan atas (keduanya ikut).'],
            ['**is in list**, **is not in list**', 'Daftar nilai: satu per baris, atau dipisah koma.'],
            ['**[Custom]**', 'Kondisi SQL Anda sendiri untuk baris itu, misalnya `qty > 5 OR note IS NULL`.']
          ] },
          { t: 'ul', items: [
            'Kondisi digabung dari atas ke bawah: “a and b or c” berarti ((a and b) or c).',
            'Baris yang belum lengkap (nilainya masih `<?>`) dan yang tidak dicentang diabaikan.',
            'Teks yang Anda ketik selalu ditulis dengan benar untuk jenis database-nya. Karakter yang punya arti khusus (`%` `_` kutip, garis miring terbalik) diperlakukan sebagai teks biasa, bukan sebagai pola.',
            'Perbandingan teks mengikuti *collation* kolom: di MySQL dan SQL Server biasanya huruf besar/kecil tidak dibedakan (“Alpha” sama dengan “alpha”). Perbandingan `=`, `!=`, `<`, `>` mengikuti aturan SQL, jadi baris NULL tidak ikut.',
            'SQL yang dihasilkan tampil di kotak **WHERE** pada toolbar. Mengetik sendiri di kotak itu lalu menekan Enter menggantikan hasil panel. **Clear** menghapus semua kondisi.'
          ] },
          { t: 'p', text: '**Sort.** Klik **Sort** untuk mengurutkan menurut beberapa kolom: pilih kolom dan arahnya, **+ Sort column** menambah kolom berikutnya, dan panah ↑ ↓ mengubah prioritas (yang paling atas paling menentukan).' },
          { t: 'img', file: 'grid-sort', caption: 'Diurutkan menurut category (naik), lalu price (turun). Angka di judul kolom menunjukkan prioritasnya.' },
          { t: 'ul', items: [
            'Klik judul kolom mengurutkan menurut kolom itu saja: klik lagi untuk menurun, sekali lagi untuk menghapus urutan.',
            '**Shift+klik** judul kolom menambahkannya sebagai urutan tambahan.'
          ] },
          { t: 'p', text: '**Columns.** Daftar kolom dengan kotak centang untuk menyembunyikan kolom yang tidak diperlukan. Ini hanya mengubah tampilan: data, pengeditan, dan ekspor tidak berubah. **All** menampilkan semuanya; setidaknya satu kolom selalu tampil.' }
        ]
      },
      {
        id: 'panel-text',
        title: 'Panel Text',
        summary: 'Isi sel yang terpilih, ditampilkan besar di bawah grid.',
        blocks: [
          { t: 'p', text: 'Klik **Text** di baris tombol tab data (atau di toolbar tab query). Setelah itu, klik sel mana pun dan isinya tampil di panel di bawah grid, lengkap dengan nama kolom, tipe, dan ukurannya. Seret garis pemisahnya untuk mengubah tinggi panel.' },
          { t: 'img', file: 'grid-text', caption: 'Sel berisi JSON dibuka di panel Text, dengan tampilan pohon.' },
          { t: 'ul', items: [
            '**Tampilan:** pilih **Text**, **JSON** (pohon yang bisa dicari, seperti di *Editor JSON*), atau **Hex** lewat kotak pilihan di panel. Data biner otomatis tampil sebagai Hex.',
            '**Mengedit:** pada tabel yang bisa diedit, teks di panel bisa diubah. **Apply to cell** menyiapkan perubahan itu seperti pengeditan biasa (baru tertulis ke database saat Anda menekan **Apply** di toolbar), dan **Set NULL** mengosongkan sel.',
            'Pada hasil query panel hanya untuk dibaca.',
            '**Copy** menyalin isi sel ke clipboard.'
          ] }
        ]
      },
      {
        id: 'cari-ganti',
        title: 'Cari dan ganti di grid',
        summary: 'Mengganti teks di banyak sel sekaligus, dengan peninjauan sebelum disimpan.',
        blocks: [
          { t: 'p', text: 'Klik **Find** di toolbar tab data untuk membuka baris pencarian. Pencarian berlaku pada halaman data yang sedang tampil.' },
          { t: 'img', file: 'find-replace', caption: 'Mencari “Arabika” — 4 sel cocok, sel aktif diberi bingkai hijau.' },
          { t: 'ul', items: [
            'Ketik teks di kolom **Find**; jumlah kecocokan tampil sebagai `1 / 4`. Sel yang cocok diberi bingkai.',
            '**↑ ↓** (atau Enter / Shift+Enter) berpindah antar kecocokan. Centang **Match case** untuk membedakan huruf besar/kecil.',
            '**Replace** mengganti kecocokan yang aktif, **Replace all (n)** mengganti semuanya.'
          ] },
          { t: 'tip', text: 'Mengganti hanya *menyiapkan* perubahan di sel (berwarna kuning). Tidak ada yang tertulis ke database sebelum Anda menekan **Apply**; gunakan **Discard** untuk membatalkan.' }
        ]
      },
            {
        id: 'penampil-sel',
        title: 'Penampil sel (teks, JSON, hex, gambar)',
        summary: 'Periksa isi sel yang panjang atau berformat khusus.',
        blocks: [
          { t: 'p', text: 'Klik kanan sel mana pun, baik di grid tabel maupun di hasil query, untuk membukanya di penampil.' },
          { t: 'img', file: 'cell-viewer', caption: 'Sel berisi JSON dibuka langsung pada tab JSON dengan tampilan pohon.' },
          { t: 'table', head: ['Tab', 'Kegunaan'], rows: [
            ['**Text**', 'Isi sel sebagai teks. Bisa diedit pada tabel yang dapat diedit.'],
            ['**JSON**', 'Editor JSON dengan tampilan pohon (lihat bagian *Editor JSON*). Terbuka otomatis jika isi sel adalah JSON yang valid.'],
            ['**Hex**', 'Isi sel sebagai dump heksadesimal, untuk data biner.'],
            ['**Image**', 'Pratinjau gambar (PNG, JPEG, GIF, WebP, BMP, SVG). Muncul otomatis jika isi sel berupa gambar.']
          ] },
          { t: 'p', text: 'Tombol di bawah: **Copy** menyalin isi, **Set NULL** mengosongkan sel, **Apply to cell** menyiapkan perubahan pada sel (tetap harus di-**Apply** di grid), **Close** menutup.' }
        ]
      },
            {
        id: 'editor-json',
        title: 'Editor JSON',
        summary: 'Teks dan pohon berdampingan: lihat, cari, edit, rapikan, dan simpan JSON.',
        blocks: [
          { t: 'p', text: 'Editor JSON tersedia di dua tempat: tab **JSON** pada penampil sel, dan sebagai tab tersendiri lewat tombol **JSON** di toolbar (Tools → JSON editor). Tab tersendiri tidak butuh koneksi database, jadi cocok untuk memeriksa JSON apa pun.' },
          { t: 'img', file: 'json-editor', caption: 'Editor JSON: teks di kiri, pohon di kanan, hasil pencarian “kota” disorot.' },
          { t: 'ul', items: [
            '**Split / Text / Tree** — pilih tampilan: teks dan pohon berdampingan, teks saja, atau pohon saja.',
            '**Pohon:** klik panah untuk membuka atau menutup. Tipe nilai diberi warna berbeda (teks, angka, boolean, null). Node yang tertutup menampilkan pratinjau isinya.',
            '**Expand all / Collapse all** membuka atau menutup seluruh pohon. Pohon dengan ribuan anak ditampilkan bertahap lewat tombol *Show more*.',
            '**Cari:** kotak “Search keys and values” mencari di nama key dan nilai. Hasil dibuka otomatis; gunakan ↑ ↓ atau Enter untuk berpindah.',
            '**Format**, **Minify**, dan **Sort keys** (urut A→Z, rekursif) mengubah teks sekaligus.'
          ] },
          { t: 'p', text: '**Mengedit di pohon.** Arahkan kursor ke sebuah baris untuk menampilkan tombol kecil di ujung kanan:' },
          { t: 'table', head: ['Tombol', 'Fungsi'], rows: [
            ['⧉', 'Salin nilai node.'],
            ['$', 'Salin path node, misalnya `$.cabang[1].kota`.'],
            ['+', 'Tambah item (array) atau properti (objek).'],
            ['✕', 'Hapus node.']
          ] },
          { t: 'p', text: 'Klik dua kali sebuah nilai untuk mengeditnya, atau klik dua kali nama key untuk menggantinya. Nilai bertipe teks tetap teks; nilai lain dapat berubah tipe (mengetik `true` menjadi boolean, `42` menjadi angka).' },
          { t: 'p', text: '**Error sintaks** ditampilkan lengkap dengan nomor baris dan kolom, serta tautan **show** yang melompat ke posisinya. Selama teks belum valid, pohon tetap menampilkan versi valid terakhir (agak pudar).' },
          { t: 'tip', text: 'Angka besar seperti `9007199254740993`, urutan key, dan key ganda dipertahankan persis seperti aslinya, bahkan setelah diedit lewat pohon. Banyak editor JSON mengubah angka sebesar ini secara diam-diam.' },
          { t: 'p', text: 'Pada tab JSON tersendiri tersedia juga **Open file…**, **Save as …**, **Paste** (tempel dari clipboard), dan **Clear**.' }
        ]
      },
            {
        id: 'import',
        title: 'Mengimpor data',
        summary: 'Masukkan baris dari CSV, TSV, Excel, atau JSON ke dalam tabel.',
        blocks: [
          { t: 'p', text: 'Pilih tabel di sidebar lalu klik **Import** di toolbar (atau klik kanan tabel → **Import data…**; juga ada tombol **Import…** di tab data).' },
          { t: 'img', file: 'import-dialog', caption: 'Impor CSV: kolom dicocokkan otomatis berdasarkan nama, lengkap dengan pratinjau.' },
          { t: 'ol', items: [
            'Klik **Choose File** dan pilih berkas: `.csv`, `.tsv`, `.txt`, `.xlsx`, `.json`, atau `.ndjson`.',
            'Atur **Encoding** dan **Delimiter** bila perlu. Pemisah (koma, titik koma, tab) dikenali otomatis. Untuk Excel, pilih lembar kerjanya.',
            'Atur opsi: **First row is a header**, **Empty values → NULL**, **Trim spaces**.',
            'Periksa tabel pemetaan: tiap kolom tabel mengambil nilainya dari kolom berkas. Kolom dicocokkan otomatis berdasarkan nama (huruf besar/kecil diabaikan). Pilih “— don’t import —” untuk melewati sebuah kolom.',
            'Lihat **Preview** untuk memastikan hasilnya benar, lalu klik **Import n rows**.'
          ] },
          { t: 'ul', items: [
            'Kolom yang wajib diisi (NOT NULL tanpa default) ditandai bintang merah. Impor ditahan sampai kolom itu dipetakan.',
            'Impor berjalan dalam **satu transaksi**: jika satu baris ditolak, tidak ada baris yang masuk dan pesan error menyebut baris yang bermasalah.',
            'Untuk JSON, berkas dapat berupa array objek, satu objek yang membungkus array tersebut, atau satu objek per baris (NDJSON).'
          ] }
        ]
      },
            {
        id: 'ekspor',
        title: 'Mengekspor data',
        summary: 'Simpan hasil tabel atau query sebagai Excel, CSV, JSON, atau SQL INSERT.',
        blocks: [
          { t: 'p', text: 'Buka sebuah tab data atau jalankan query, lalu klik **Export** (toolbar atau pojok kanan tab). Hasil yang sedang tampil, lengkap dengan penyaringan, itulah yang diekspor.' },
          { t: 'img', file: 'export-menu', caption: 'Menu Export.' },
          { t: 'table', head: ['Format', 'Keterangan'], rows: [
            ['**Excel (.xlsx)**', 'Lembar kerja dengan baris judul. Angka tetap angka.'],
            ['**CSV (.csv)**', 'Teks dipisah koma, bisa dibuka di Excel dan aplikasi lain.'],
            ['**JSON (.json)**', 'Array objek, satu objek per baris data.'],
            ['**SQL INSERT (.sql)**', 'Pernyataan `INSERT` dengan penulisan nilai sesuai jenis database sumber, siap dijalankan di tempat lain.']
          ] },
          { t: 'tip', text: 'Menu yang sama juga tersedia di Tools → Export result as …' }
        ]
      }
    ]
  },
  {
    title: 'Menulis SQL',
    sections: [
            {
        id: 'editor-sql',
        title: 'Editor SQL',
        summary: 'Tulis dan jalankan query dengan penyorotan sintaks dan autocomplete yang mengenal skema.',
        blocks: [
          { t: 'p', text: 'Klik **New Query** di toolbar, atau klik kanan database → **New query here**. Pilihan di sebelah kanan toolbar editor menentukan *database/schema* tempat query dijalankan.' },
          { t: 'img', file: 'query-editor', caption: 'Query dirapikan dengan Beautify, dijalankan dengan Run, hasilnya tampil di bawah.' },
          { t: 'table', head: ['Tombol', 'Fungsi'], rows: [
            ['**Run** (Ctrl+Enter)', 'Menjalankan teks yang diblok. Jika tidak ada yang diblok, seluruh isi editor dijalankan.'],
            ['**Stop**', 'Membatalkan query yang sedang berjalan di server. Tidak tersedia untuk SQLite karena SQLite tidak bisa membatalkan query.'],
            ['**Explain**', 'Menampilkan rencana eksekusi query (tidak didukung untuk SQL Server).'],
            ['Ikon panah melingkar', 'Menjalankan ulang query terakhir.'],
            ['**Beautify**', 'Merapikan SQL dengan baris baru dan indentasi (seluruh teks, atau bagian yang diblok).'],
            ['**Minify**', 'Menyatukan SQL jadi satu baris dan membuang komentar.'],
            ['**Snippets**', 'Potongan SQL siap pakai (lihat bagian berikutnya).'],
            ['**Save** / **History**', 'Menyimpan query, dan melihat riwayat serta query tersimpan.'],
            ['**Filter rows**', 'Menyaring baris pada hasil yang sudah tampil.'],
            ['**Export**', 'Mengekspor hasil query.']
          ] },
          { t: 'p', text: 'Bilah di bawah hasil menampilkan SQL yang dijalankan, jumlah baris, dan lamanya. Klik kanan sel hasil untuk membukanya di penampil sel.' },
          { t: 'p', text: '**Autocomplete** mengenal skema database yang sedang dipakai: nama tabel, kolom, dan kata kunci SQL. Daftar saran muncul saat Anda mengetik, atau tekan **Ctrl+Spasi** untuk memunculkannya sendiri.' },
          { t: 'img', file: 'query-autocomplete', caption: 'Mengetik “cus” menyarankan tabel customers di urutan pertama.' },
          { t: 'p', text: '**Explain** menampilkan rencana eksekusi sehingga Anda bisa melihat apakah query memakai indeks atau memindai seluruh tabel.' },
          { t: 'img', file: 'query-explain', caption: 'Rencana eksekusi pada SQLite: SCAN berarti seluruh tabel dibaca, SEARCH berarti indeks dipakai.' },
          { t: 'p', text: '**Ctrl+F** membuka pencarian dan penggantian di dalam editor.' }
        ]
      },
            {
        id: 'snippets',
        title: 'Snippets',
        summary: 'Potongan SQL siap pakai, ditambah koleksi milik Anda sendiri.',
        blocks: [
          { t: 'p', text: 'Klik **Snippets** pada toolbar editor. Bagian **BUILT-IN** berisi kerangka yang sering dipakai: SELECT, SELECT … JOIN, INSERT, UPDATE, DELETE, CREATE TABLE, WITH (CTE), CASE, EXISTS subquery, Window: ROW_NUMBER, dan Pagination. Isinya menyesuaikan jenis database yang sedang dipakai.' },
          { t: 'img', file: 'query-snippets', caption: 'Menu Snippets.' },
          { t: 'ul', items: [
            'Memilih sebuah snippet menyisipkannya di posisi kursor.',
            'Untuk menyimpan potongan sendiri: blok SQL di editor → **Snippets** → **Save selection as snippet…** → beri nama. Snippet Anda muncul di bagian tersendiri dan bisa dihapus dari menu yang sama.'
          ] }
        ]
      },
            {
        id: 'riwayat',
        title: 'Query tersimpan dan riwayat',
        summary: 'Simpan query per database, dan temukan kembali query yang pernah dijalankan.',
        blocks: [
          { t: 'ul', items: [
            '**Save** menyimpan query untuk database yang sedang aktif. Query yang sudah tersimpan muncul di folder **Queries** di sidebar; klik dua kali untuk membukanya lagi. Menekan **Save** pada query yang sudah tersimpan memperbarui isinya.',
            '**History** membuka daftar semua query yang pernah dijalankan (waktu, koneksi, database, lamanya, berhasil atau gagal).',
            'Pada dialog History ada dua tab: **History** dan **Saved**. Kotak **Search** menyaring keduanya. Pilih sebuah entri untuk membukanya kembali di editor.'
          ] },
          { t: 'img', file: 'query-library', caption: 'Riwayat query. Tab Saved berisi query yang disimpan.' },
          { t: 'tip', text: 'Query tersimpan disimpan di komputer Anda, terpisah untuk tiap database. Query yang disimpan tanpa memilih database berlaku untuk semua database pada koneksi itu.' }
        ]
      }
    ]
  },
  {
    title: 'Struktur database',
    sections: [
            {
        id: 'desain-tabel',
        title: 'Desain tabel',
        summary: 'Ubah kolom, indeks, dan foreign key, dengan pratinjau DDL sebelum diterapkan.',
        blocks: [
          { t: 'p', text: 'Pilih tabel lalu klik **Design** (atau klik kanan → **Design table**). Untuk membuat tabel baru, klik **New Table** — isi nama tabel di bagian atas. Desainer punya empat tab.' },
          { t: 'p', text: '**Columns** — nama, tipe, boleh NULL, primary key, auto-increment/identity, dan nilai default.' },
          { t: 'img', file: 'designer-columns', caption: 'Tab Columns.' },
          { t: 'ul', items: [
            '**+ Column** menambah kolom; **Delete column** menghapus kolom terpilih; tombol panah menggeser urutan kolom.',
            'Kolom **Null** = boleh NULL, **PK** = primary key (centang beberapa kolom untuk primary key gabungan), **Auto** = nomor otomatis.',
            '**Default** diisi sebagai ekspresi SQL, misalnya `0`, `\'teks\'`, atau `now()`.'
          ] },
          { t: 'p', text: '**Indexes** — daftar indeks, kolom yang dicakup, dan apakah unik.' },
          { t: 'img', file: 'designer-indexes', caption: 'Tab Indexes.' },
          { t: 'p', text: '**Foreign keys** — relasi ke tabel lain: kolom, tabel dan kolom rujukan, serta tindakan **On delete** dan **On update** (NO ACTION, CASCADE, SET NULL, dan seterusnya).' },
          { t: 'img', file: 'designer-fk', caption: 'Tab Foreign keys.' },
          { t: 'p', text: '**DDL preview** — SQL persis yang akan dijalankan. Tab ini tidak mengubah apa pun sampai Anda menekan **Apply changes**.' },
          { t: 'img', file: 'designer-ddl', caption: 'Mengganti nama kolom dan menambah kolom baru: dua pernyataan ALTER TABLE menunggu diterapkan.' },
          { t: 'ul', items: [
            '**Apply changes** (atau **Create table** untuk tabel baru) menjalankan DDL. **Reset** mengembalikan semuanya seperti semula.',
            'Jika ada isian yang salah (misalnya nama kolom kosong), banner merah menjelaskan masalahnya dan Apply dinonaktifkan.',
            'Pada PostgreSQL, SQL Server, dan SQLite, seluruh perubahan dijalankan dalam satu transaksi: gagal berarti tidak ada yang berubah. **MySQL tidak mendukung DDL transaksional**, jadi jika terjadi kegagalan di tengah jalan, sebagian perubahan mungkin sudah berlaku.'
          ] },
          { t: 'warn', text: 'SQLite hanya bisa menambah, mengganti nama, dan menghapus kolom pada tabel yang sudah ada. Mengubah tipe, nullability, default, primary key, atau foreign key memerlukan pembuatan ulang tabel, sehingga bagian tersebut dikunci dan diberi keterangan di layar.' }
        ]
      },
            {
        id: 'er-diagram',
        title: 'ER diagram',
        summary: 'Lihat relasi antar tabel sebagai gambar yang bisa digeser, diperbesar, dan diekspor.',
        blocks: [
          { t: 'p', text: 'Klik **Diagram** di toolbar, atau klik kanan database → **ER diagram**. Setiap tabel digambar sebagai kotak berisi kolomnya (**PK** = primary key, **FK** = foreign key), dan garis menghubungkan tabel yang berelasi dengan penanda **1** dan **N**.' },
          { t: 'img', file: 'er-diagram', caption: 'Diagram empat tabel toko kopi dan tiga relasinya.' },
          { t: 'ul', items: [
            '**Geser tabel:** seret judul kotaknya. Posisi diingat untuk pembukaan berikutnya.',
            '**Geser kanvas:** seret latar belakang. **Zoom:** roda mouse, atau tombol − / +.',
            '**Fit** menyesuaikan zoom agar semua tabel terlihat. **Auto layout** menata ulang tabel dan membuang posisi buatan sendiri.',
            '**Keys only** hanya menampilkan kolom primary key dan foreign key, untuk skema yang besar.',
            '**Find table** menyorot tabel berdasarkan nama.',
            'Klik dua kali judul tabel untuk membuka datanya.',
            '**SVG** dan **PNG** menyimpan seluruh diagram sebagai gambar, apa pun zoom dan posisi layar saat ini.'
          ] },
          { t: 'p', text: 'Klik sebuah tabel untuk menyorotnya beserta tabel yang berelasi; tabel lain dipudarkan.' },
          { t: 'img', file: 'er-focus', caption: 'Tabel products dipilih: hanya relasinya yang menonjol.' }
        ]
      }
    ]
  },
  {
    title: 'Migrasi dan cadangan',
    sections: [
            {
        id: 'run-sql',
        title: 'Menjalankan berkas SQL',
        summary: 'Jalankan skrip .sql, termasuk hasil dump dari alat lain.',
        blocks: [
          { t: 'p', text: 'Klik kanan koneksi atau database → **Run SQL file…**. Pilih berkas lewat **Choose File**; skrip langsung dipecah menjadi pernyataan dan ditampilkan beserta nomor barisnya.' },
          { t: 'img', file: 'run-script', caption: 'Skrip dengan 4 pernyataan siap dijalankan.' },
          { t: 'ul', items: [
            'Pemecah pernyataan memahami tanda kutip dan komentar, blok `$$ … $$` PostgreSQL, `DELIMITER` MySQL, dan `GO` SQL Server. Titik koma di dalam teks tidak memecah pernyataan.',
            '**Stop at the first error** menghentikan skrip pada kesalahan pertama. Jika dimatikan, skrip berlanjut dan semua kegagalan dilaporkan di akhir.',
            '**Run in a single transaction** membungkus semuanya: jika ada yang gagal, seluruh skrip dibatalkan (pada MySQL, DDL tidak bisa dibatalkan).',
            'Selama berjalan ada bilah kemajuan dan tombol **■ Stop**. Hasil akhir menyebut berapa pernyataan yang berhasil dan daftar kegagalan beserta barisnya.'
          ] }
        ]
      },
            {
        id: 'dump',
        title: 'Dump SQL (cadangan)',
        summary: 'Ekspor struktur dan data tabel menjadi satu berkas .sql.',
        blocks: [
          { t: 'p', text: 'Klik kanan database → **Dump SQL file…**, pilih tabel yang disertakan (**All** / **None** / kotak filter), lalu atur opsi.' },
          { t: 'img', file: 'dump-dialog', caption: 'Dialog Dump SQL.' },
          { t: 'table', head: ['Opsi', 'Keterangan'], rows: [
            ['**Structure**', 'Menyertakan CREATE TABLE beserta indeks dan foreign key.'],
            ['**Data**', 'Menyertakan baris data sebagai INSERT.'],
            ['**Drop tables first**', 'Menambahkan DROP TABLE IF EXISTS sebelum tiap CREATE TABLE, sehingga dump bisa dipulihkan di atas database yang sudah ada isinya.'],
            ['**Qualify names with …**', 'Menulis nama tabel lengkap dengan nama database/schema. Jika dimatikan, berkas dimuat ke database mana pun yang Anda pilih saat memulihkan.']
          ] },
          { t: 'p', text: 'Klik **Choose file & dump…** lalu tentukan lokasi berkas. Tabel diurutkan mengikuti ketergantungan foreign key (tabel induk lebih dulu, dihapus belakangan), indeks dan foreign key dibuat setelah data masuk, dan pada PostgreSQL urutan sequence disesuaikan, sehingga berkas dapat dipulihkan dengan **Run SQL file…** tanpa pelanggaran constraint.' },
          { t: 'warn', text: 'Dump hanya mencakup **tabel**. View, fungsi, dan trigger tidak ikut.' }
        ]
      },
            {
        id: 'transfer',
        title: 'Transfer data antar database',
        summary: 'Salin tabel beserta isinya ke database lain, termasuk antar jenis database.',
        blocks: [
          { t: 'p', text: 'Klik kanan database sumber → **Transfer data to…**. Pilih koneksi dan database tujuan di sisi **To**, centang tabel yang akan disalin, lalu klik **Start**.' },
          { t: 'img', file: 'transfer', caption: 'Menyalin empat tabel dari Toko Kopi ke Arsip. Kolom Result dan Rows terisi setelah selesai.' },
          { t: 'table', head: ['Opsi', 'Keterangan'], rows: [
            ['**Copy data**', 'Menyalin isi tabel. Jika dimatikan, hanya strukturnya.'],
            ['**Create missing tables**', 'Membuat tabel yang belum ada di tujuan.'],
            ['**If a table already exists**', '**Add the rows to it** (tambahkan), **Empty it first (deletes rows)** (kosongkan lebih dulu), atau **Leave it alone** (lewati).']
          ] },
          { t: 'ul', items: [
            '**Lintas jenis database** didukung, misalnya SQLite ke PostgreSQL atau MySQL ke SQL Server. Tipe kolom, nilai default, auto-increment, indeks, dan foreign key diterjemahkan otomatis; setiap penyesuaian dicatat di kolom **Notes**.',
            'Tiap tabel disalin dalam **satu transaksi**. Tabel yang gagal dikembalikan seperti semula, tanpa baris setengah jadi, dan tabel lain tetap berjalan.',
            'Indeks dan foreign key dibuat setelah data masuk, dan tabel diurutkan mengikuti ketergantungannya.',
            'Selama transfer berlangsung, tab lain pada kedua koneksi itu menunggu agar transaksi tidak tercampur. Tombol **■ Stop** membatalkan proses.'
          ] },
          { t: 'warn', text: 'Opsi **Empty it first** menghapus semua baris di tabel tujuan yang namanya sama. Dialog meminta konfirmasi sebelum mulai.' }
        ]
      },
            {
        id: 'sinkron',
        title: 'Sinkronisasi struktur',
        summary: 'Samakan struktur tabel database target dengan database sumber.',
        blocks: [
          { t: 'p', text: 'Klik kanan database → **Synchronize structure…**. Database di kiri adalah *model* (sumber); database di kanan akan *diubah* agar sama dengannya. Kedua sisi harus berjenis sama. Klik **Compare**.' },
          { t: 'img', file: 'sync', caption: 'Perbandingan: customers dan products berbeda, order_items dan orders belum ada di target. SQL perubahan tampil di kanan.' },
          { t: 'ul', items: [
            'Setiap tabel diberi label: **new** (belum ada di target), **differs** (ada perbedaan), atau **identical** (sama).',
            'Klik sebuah tabel untuk melihat SQL perubahannya. Hilangkan centang untuk tabel yang tidak ingin disentuh.',
            '**Apply to target** menjalankan perubahan yang dicentang. Setelah selesai, perbandingan diulang sehingga Anda bisa memastikan semuanya **identical**.',
            'Secara bawaan sinkronisasi hanya *menambah dan mengubah*. Dua kotak centang tambahan, **Drop columns / indexes missing in the source** dan **Drop tables missing in the source**, juga menghapus apa yang hanya ada di target. Keduanya mati secara bawaan karena **menghapus data**.'
          ] },
          { t: 'warn', text: 'Mengganti nama kolom terlihat sebagai “hapus kolom lama + tambah kolom baru”, sehingga data kolom itu hilang jika opsi hapus dinyalakan. Selalu baca pratinjau SQL sebelum menekan Apply to target.' }
        ]
      }
    ]
  },
  {
    title: 'Lainnya',
    sections: [
            {
        id: 'pembaruan',
        title: 'Memeriksa pembaruan',
        summary: 'Cari tahu apakah ada versi yang lebih baru di GitHub.',
        blocks: [
          { t: 'p', text: 'Pilih **Help → Check for updates…** untuk melihat apakah ada rilis yang lebih baru di halaman Releases di GitHub.' },
          { t: 'img', file: 'update-dialog', caption: 'Dialog pembaruan. Versi 2.0.0 di gambar ini hanya contoh.' },
          { t: 'ul', items: [
            'Dialog menampilkan versi terpasang, versi terbaru, tanggal, dan catatan rilisnya.',
            '**Download** membuka berkas yang cocok dengan sistem Anda di browser: installer (atau versi portable bila Anda memakainya) di Windows; `.deb`, `.rpm`, atau AppImage di Linux sesuai distribusi Anda. Di bawahnya ada petunjuk pemasangan. Aplikasi tidak memasang apa pun sendiri.',
            '**Release page** membuka halaman rilisnya. Tautan hanya diterima jika mengarah ke repositori resmi aplikasi ini.',
            'Jika pemeriksaan gagal (tidak ada koneksi, atau GitHub membatasi permintaan), dialog menjelaskan alasannya.'
          ] },
          { t: 'p', text: '**Pemeriksaan otomatis.** Beberapa detik setelah aplikasi dibuka, paling sering sekali sehari, aplikasi memeriksa diam-diam. Jika ada versi baru, muncul tombol “⬆ Version … is available” di bilah status; klik untuk membuka dialognya. Matikan lewat **Help → Check for updates automatically** (tanda ✓ berarti menyala).' },
          { t: 'tip', text: 'Yang dikirim hanyalah permintaan biasa untuk halaman rilis publik ke api.github.com. Tidak ada data koneksi, isi database, atau data pribadi yang ikut; GitHub hanya melihat alamat IP Anda serta nama program dan versinya.' }
        ]
      },
      {
        id: 'tema',
        title: 'Tema terang dan gelap',
        summary: 'Mengikuti sistem operasi, dan bisa diganti kapan saja.',
        blocks: [
          { t: 'p', text: 'Klik **Dark** (atau **Light**) di toolbar, atau View → Switch to dark/light mode. Pilihan Anda diingat untuk pembukaan berikutnya. Saat pertama kali dibuka, tema mengikuti pengaturan sistem operasi.' },
          { t: 'img', file: 'dark-mode', caption: 'Tema gelap.' }
        ]
      },
            {
        id: 'pintasan',
        title: 'Pintasan keyboard',
        summary: 'Ringkasan tombol yang sering dipakai.',
        blocks: [
          { t: 'table', head: ['Tombol', 'Fungsi'], rows: [
            ['**F1**', 'Membuka dokumentasi ini.'],
            ['**Ctrl+Enter**', 'Menjalankan query (bagian yang diblok, atau seluruh isi editor).'],
            ['**Ctrl+Spasi**', 'Memunculkan saran autocomplete di editor SQL.'],
            ['**Ctrl+F**', 'Cari dan ganti di dalam editor SQL.'],
            ['**Enter** (kotak WHERE, atau kotak nilai di panel Filter)', 'Menerapkan filter pada tabel.'],
            ['**Shift+klik** judul kolom', 'Menambahkan kolom itu sebagai urutan tambahan.'],
            ['**Enter / Esc** (saat mengedit sel)', 'Menyelesaikan / membatalkan pengeditan.'],
            ['**Ctrl+0** (saat mengedit sel)', 'Mengisi sel dengan NULL.'],
            ['**Enter / Shift+Enter** (di kotak Find)', 'Kecocokan berikutnya / sebelumnya.'],
            ['**Esc**', 'Menutup menu, popup, dan gambar yang diperbesar di dokumentasi.']
          ] }
        ]
      },
            {
        id: 'keamanan',
        title: 'Keamanan dan privasi',
        summary: 'Bagaimana kredensial dan data Anda diperlakukan.',
        blocks: [
          { t: 'ul', items: [
            '**Password** koneksi dan SSH disimpan terenkripsi dengan penyimpanan aman milik sistem operasi, tidak pernah sebagai teks biasa.',
            '**Host key SSH** dicatat pada sambungan pertama; jika berubah, koneksi ditolak.',
            'Aplikasi hanya menghubungi database yang Anda atur sendiri, dan GitHub untuk **memeriksa pembaruan** (permintaan biasa untuk halaman rilis publik; tidak membawa data koneksi, isi database, maupun data pribadi; bisa dimatikan di menu Help). Tautan lain (website di jendela About, unduhan) dibuka di browser Anda.',
            'Perubahan data dan struktur selalu dijalankan sebagai transaksi bila database mendukungnya, sehingga kegagalan tidak meninggalkan data setengah jadi.'
          ] },
          { t: 'tip', text: 'Gunakan **warna koneksi** untuk menandai server produksi, dan akun database dengan hak akses secukupnya untuk pekerjaan sehari-hari.' }
        ]
      },
            {
        id: 'batasan',
        title: 'Batasan yang perlu diketahui',
        summary: 'Hal-hal yang belum ada atau berperilaku berbeda antar jenis database.',
        blocks: [
          { t: 'ul', items: [
            '**SQL Server** didukung, tetapi belum diuji pada server sungguhan selama pengembangan. Jika menemukan masalah, laporkan.',
            '**SQLite** tidak bisa membatalkan query yang sedang berjalan, dan tidak bisa mengubah tipe kolom, primary key, atau foreign key tabel yang sudah ada.',
            '**MySQL** tidak mendukung DDL transaksional: perubahan struktur yang gagal di tengah jalan bisa meninggalkan sebagian perubahan.',
            '**Explain** belum tersedia untuk SQL Server.',
            '**Dump SQL** hanya mencakup tabel (tanpa view, fungsi, trigger).',
            '**Sinkronisasi struktur** hanya antar database berjenis sama.',
            'Belum tersedia: penjadwalan tugas, backup otomatis, grafik/BI, dan manajemen pengguna database.'
          ] }
        ]
      }
    ]
  }
]
