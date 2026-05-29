# Foldit — Telemetry Worker (Cloudflare)

Worker gratuito che riceve i report anonimi di Foldit e aggiorna il file
`database.json` crowdsourced su una repo GitHub pubblica. Il token GitHub vive
**solo** come secret del Worker: non è mai incluso nell'app.

## Cosa fa
- `POST /` → riceve un report (`gameName`, `algorithm`, `ratio`, dimensioni…),
  calcola la media incrementale per algoritmo e fa commit su `database.json`.
- `GET /` → restituisce il `database.json` corrente (utile come endpoint live).

---

## Guida passo-passo

### 1. Crea la repo dei dati su GitHub
1. Crea una repo **pubblica**, es. `foldit-data`.
2. Aggiungi un file `database.json` con contenuto iniziale:
   ```json
   []
   ```
3. Annota owner, nome repo e branch (di solito `main`).

### 2. Crea il token GitHub (fine-grained, minimo privilegio)
1. Vai su **GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. **Repository access**: *Only select repositories* → scegli `foldit-data`.
3. **Permissions → Repository permissions → Contents**: imposta **Read and write**.
   (Nessun altro permesso serve.)
4. Genera e **copia il token** (lo vedrai una sola volta). Questo è il valore che
   andrà in `GITHUB_TOKEN`.

### 3. Installa gli strumenti
```bash
npm install -g wrangler
wrangler login          # apre il browser per autenticare l'account Cloudflare
```

### 4. Configura il Worker
1. In `wrangler.toml`, modifica `[vars]` con i tuoi `GH_OWNER`, `GH_REPO`,
   `GH_BRANCH`, `DB_PATH`.
2. Salva il token come **secret** (NON in `wrangler.toml`):
   ```bash
   cd cloudflare-worker
   wrangler secret put GITHUB_TOKEN
   # incolla qui il token copiato al passo 2
   ```

### 5. Pubblica
```bash
wrangler deploy
```
Wrangler stampa l'URL pubblico, es.
`https://foldit-telemetry.<tuo-subdominio>.workers.dev`.

### 6. Collega Foldit
Apri `src-tauri/src/telemetry.rs` e imposta le due costanti:
```rust
const DATABASE_URL: &str =
    "https://raw.githubusercontent.com/<owner>/<repo>/<branch>/database.json";
const TELEMETRY_URL: &str = "https://foldit-telemetry.<tuo-subdominio>.workers.dev";
```
Poi ricompila l'app. Fatto: ogni compressione andata a buon fine invierà un
report e la pagina **Database** mostrerà le stime aggregate.

---

## Test rapido
```bash
# invio di un report di prova
curl -X POST https://foldit-telemetry.<sub>.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"appVersion":"0.1.0","gameName":"Test Game","algorithm":"XPRESS8K","originalSize":1000,"compressedSize":600,"ratio":0.6,"fileCount":10,"clientHash":"test"}'

# lettura del database aggiornato
curl https://foldit-telemetry.<sub>.workers.dev
```

## Note
- **Costi**: rientra ampiamente nel piano gratuito di Cloudflare Workers.
- **Sicurezza**: il token sta solo nel secret del Worker; l'app non lo conosce.
  I dati inviati sono anonimi (nome cartella + ratio + un id casuale locale).
- **Cache**: `raw.githubusercontent.com` ha una cache CDN (~5 min). Per dati
  sempre live, puoi puntare `DATABASE_URL` all'endpoint `GET` del Worker.
- **Concorrenza**: in caso di commit simultanei il Worker rilegge lo `sha` e
  riprova automaticamente (fino a 4 tentativi).
