# Timmy Happiness Index Dashboard

Interactive web dashboard untuk Timmy Happiness Index Survey — IDN Media People & Culture.

## 📁 Struktur File

```
thi-dashboard/
├── index.html        ← Main dashboard UI
├── styles.css        ← All styles
├── data-loader.js    ← Fetches & parses Google Sheets data
├── script.js         ← Charts, filters, render logic
├── netlify.toml      ← Netlify deployment config
└── README.md
```

## 🚀 Deploy ke Netlify via GitHub

### Step 1 — Push ke GitHub
```bash
cd thi-dashboard
git init
git add .
git commit -m "Initial THI dashboard"
git remote add origin https://github.com/YOUR_USERNAME/thi-dashboard.git
git push -u origin main
```

### Step 2 — Connect ke Netlify
1. Login ke [netlify.com](https://netlify.com)
2. Click **"Add new site" → "Import an existing project"**
3. Pilih **GitHub**, authorize, pilih repo `thi-dashboard`
4. Settings:
   - **Build command:** *(kosongkan)*
   - **Publish directory:** `.`
5. Click **Deploy site**

### Step 3 — Buka di Browser
Netlify akan memberi URL seperti `https://thi-dashboard.netlify.app`

---

## ⚙️ Setting Google Sheets

Agar dashboard bisa membaca data langsung dari Google Sheets:

### Sheet "Data Source" (registry)
`https://docs.google.com/spreadsheets/d/16o2IieEb1g41BvG18EJyF8jfmVWxl73Dlu8BXmjgsJs`

Buka → Share → **"Anyone with the link" → Viewer**

### Sheet Response Q1
`https://docs.google.com/spreadsheets/d/156ZNZbkyEEU6aq2t-d1dMkJ2vgJBFnKf`

Buka → Share → **"Anyone with the link" → Viewer**

---

## 📊 Menambah Quarter Baru (Q2, Q3, Q4)

1. Buka **Data Source sheet**: `16o2IieEb1g41BvG18EJyF8jfmVWxl73Dlu8BXmjgsJs`
2. Isi kolom B di baris Quarter 2 dengan **link Google Sheet response Q2**
3. Pastikan sheet Q2 sudah di-set **"Anyone with the link can view"**
4. Refresh dashboard — Quarter 2 otomatis muncul di selector!

### Format sheet response yang diharapkan:
| Timestamp | Email | (blank) | Office Location | Team | Tenure | Q1 | Q2 | … | Q44 | Q45 (did well) | Q46 (improve) |
|---|---|---|---|---|---|---|---|---|---|---|---|

Kolom harus sama persis dengan Q1 agar kalkulasi berjalan otomatis.

---

## 🎛️ Fitur Dashboard

| Fitur | Keterangan |
|---|---|
| Quarter Selector | Toggle antar Q1, Q2, Q3, Q4 |
| Scoring Method | Avg Score / Fav 5·6·7 / Fav 6·7 |
| Filter Dept & Tenure | Semua grafik & tabel ikut filter |
| Score Table (3 methods) | QoQ comparison semua area |
| Area Bar Chart | Visual skor + comparison Q4 |
| Top & Bottom Items | Q-level dengan detail pertanyaan |
| Heatmap by Dept | Color-coded per area × department |
| Heatmap by Tenure | Color-coded per area × tenure |
| NPS | Gauge + breakdown + by department |
| Participation Rate | By dept & tenure, QoQ |
| Driver Priority Matrix | Scatter plot quadrant |
| Open-Ended Feedback | Search, filter type & dept, paginated |

---

## 🖥️ Lokal Testing

Karena fetch CSV dari Google Sheets membutuhkan HTTPS, gunakan server lokal:

```bash
# Python 3
cd thi-dashboard
python -m http.server 8080
# Buka: http://localhost:8080
```

Atau gunakan VS Code **Live Server** extension.

> ⚠️ Jangan buka `index.html` langsung via `file://` — browser akan block fetch request.
