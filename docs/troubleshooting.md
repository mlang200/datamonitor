# Troubleshooting — Kommentator Socket App

Anleitung für 2nd Level Support. Alle Befehle verwenden das AWS CLI Profil `deployer`.

---

## Schnellreferenz: Wichtige Pfade und Ressourcen

### AWS-Ressourcen

| Ressource | Wert |
|-----------|------|
| Region | `eu-central-1` |
| Account | `364301299051` |
| ECS Cluster | `bbl-kommentator` |
| ECS Service | `bbl-kommentator-svc` |
| Task Definition | `bbl-kommentator` |
| ECR Repository | `bbl-kommentator` |
| CloudWatch Log Group | `/ecs/bbl-kommentator` |
| Security Group | `sg-0dcc1c0b6ecc8dfb8` (Port 3001) |
| AWS CLI Profil | `deployer` |

### Pfade im Container

| Pfad | Beschreibung |
|------|-------------|
| `/app/server/src/index.ts` | Server-Einstiegspunkt |
| `/app/server/src/config.ts` | Konfiguration / Env-Var-Validierung |
| `/app/server/src/auth/` | Auth-System (Login, Sessions, Middleware) |
| `/app/server/src/bbl-socket/` | BBL Live-Daten (Socket.IO Client) |
| `/app/server/src/routes/` | API-Routen (auth, admin, bbl-socket, planning-desk) |
| `/app/data/auth.db` | SQLite-Datenbank (Benutzer + Sessions) |
| `/app/client/dist/` | Frontend (statische Dateien) |

### API-Endpunkte zum Testen

| Endpunkt | Auth | Erwartete Antwort |
|----------|------|-------------------|
| `GET /api/health` | Nein | `{"status":"ok"}` |
| `POST /api/auth/login` | Nein | `{"user":{...}}` oder `{"error":"..."}` |
| `GET /api/auth/me` | Ja | `{"user":{...}}` oder `401` |
| `GET /api/planning-desk/matches` | Ja | `[{...}]` oder `401` |

---

## 1. Ist die App erreichbar?

### Status prüfen

```bash
aws ecs describe-services \
  --cluster bbl-kommentator \
  --services bbl-kommentator-svc \
  --query 'services[0].{running:runningCount,desired:desiredCount,pending:pendingCount}' \
  --profile deployer --region eu-central-1
```

| Ergebnis | Bedeutung | Aktion |
|----------|-----------|--------|
| `running: 1, desired: 1` | App läuft | Weiter mit IP-Check |
| `running: 0, desired: 0` | App gestoppt | → Abschnitt "App starten" |
| `running: 0, desired: 1` | App startet oder crasht | → Abschnitt "Container startet nicht" |
| `running: 0, pending: 1` | Task wird provisioniert | 30–60 Sekunden warten |

### Aktuelle IP herausfinden

Die IP ändert sich bei jedem Neustart/Deployment:

```bash
TASK=$(aws ecs list-tasks --cluster bbl-kommentator \
  --query 'taskArns[0]' --output text \
  --profile deployer --region eu-central-1) && \
ENI=$(aws ecs describe-tasks --cluster bbl-kommentator --tasks $TASK \
  --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value|[0]' \
  --output text --profile deployer --region eu-central-1) && \
aws ec2 describe-network-interfaces --network-interface-ids $ENI \
  --query 'NetworkInterfaces[0].Association.PublicIp' --output text \
  --profile deployer --region eu-central-1
```

### Health Check

```bash
curl -s http://<IP>:3001/api/health
```

Erwartete Antwort: `{"status":"ok"}`

Wenn keine Antwort → Security Group prüfen (Port 3001 offen?) oder Container-Logs checken.

### App starten

```bash
aws ecs update-service \
  --cluster bbl-kommentator \
  --service bbl-kommentator-svc \
  --desired-count 1 \
  --profile deployer --region eu-central-1
```

---

## 2. Logs lesen

### Letzte Logs abrufen

```bash
# Letzte 30 Minuten
aws logs tail /ecs/bbl-kommentator --since 30m --profile deployer --region eu-central-1

# Letzte 2 Stunden
aws logs tail /ecs/bbl-kommentator --since 2h --profile deployer --region eu-central-1

# Live-Stream (Ctrl+C zum Beenden)
aws logs tail /ecs/bbl-kommentator --follow --profile deployer --region eu-central-1
```

### Logs in der AWS Console

CloudWatch → Log Groups → `/ecs/bbl-kommentator` → neuester Log Stream

### Erwartete Startup-Logs (gesunder Start)

```
Auth DB initialized at: /app/data/auth.db
BBL Socket service registered
Planning Desk service registered
Kommentator Socket App running on port 3001
  BBL Socket: ready
  Planning Desk: ready
  Auth: ready
```

Wenn eine dieser Zeilen fehlt, liegt ein Problem vor — siehe die entsprechenden Abschnitte unten.

---

## 3. Problemszenarien

### 3.1 Container startet nicht / crasht sofort

**Log-Meldung:**
```
FATAL: Missing required environment variable(s): SESSION_SECRET, BBL_SOCKET_API_KEY, ...
```

**Ursache:** Pflicht-Umgebungsvariablen fehlen in der Task Definition.

**Lösung:** Task Definition in der AWS Console prüfen:
ECS → Task Definitions → `bbl-kommentator` → letzte Revision → Container → Environment Variables

Pflicht-Variablen:
- `SESSION_SECRET` — Server bricht ab wenn fehlend
- `BBL_SOCKET_API_KEY` — Server startet, aber BBL-Service fehlt
- `PLANNING_DESK_API_KEY` — Server startet, aber Spielliste fehlt

---

### 3.2 Login funktioniert nicht

**Symptom:** Benutzer sieht "Anmeldung fehlgeschlagen" auf der Login-Seite.

**Diagnose-Schritte:**

1. Prüfen ob überhaupt Benutzer existieren (erster Start):
   ```bash
   # In den Logs nach der Seed-Warnung suchen:
   aws logs tail /ecs/bbl-kommentator --since 1h --profile deployer --region eu-central-1 \
     | grep -i "WARNUNG\|INITIAL_ADMIN"
   ```
   Wenn `WARNUNG: Keine INITIAL_ADMIN_*-Umgebungsvariablen gesetzt` → beim ersten Start wurden keine Admin-Credentials konfiguriert. Lösung: `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` in der Task Definition setzen, dann `auth.db` löschen (Container neu starten) damit der Seed erneut läuft.

2. Login direkt testen:
   ```bash
   curl -s -X POST http://<IP>:3001/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"identity":"admin","password":"admin1234"}'
   ```

   | Antwort | Bedeutung |
   |---------|-----------|
   | `{"user":{...}}` | Login OK — Problem liegt im Frontend/Cookie |
   | `{"error":"Ungültige Anmeldedaten"}` | Falscher Benutzername oder Passwort |
   | `{"error":"Konto ist deaktiviert"}` | Benutzer wurde von einem Admin deaktiviert |
   | `{"error":"Zu viele Anmeldeversuche","retryAfterMs":...}` | Rate Limit erreicht (10 Versuche / 15 Min) |

3. Rate Limit: Löst sich nach 15 Minuten von selbst. Bei einem Container-Neustart wird der In-Memory-Zähler zurückgesetzt.

---

### 3.3 Session geht bei Page Refresh verloren

**Symptom:** Nach F5 / Browser-Refresh wird der Benutzer zur Login-Seite weitergeleitet.

**Mögliche Ursachen:**

1. **Cookie `secure: true` bei HTTP**: Wenn die App über HTTP (nicht HTTPS) läuft, darf das Session-Cookie nicht als `Secure` markiert sein. Prüfen in `server/src/index.ts`:
   ```typescript
   cookie: {
     secure: false, // Muss false sein ohne HTTPS!
   }
   ```

2. **`auth.db` nicht persistent**: Ohne Volume-Mount geht die Datenbank bei Container-Neustart verloren. Prüfen ob `/app/data` als Volume gemountet ist.

3. **Session abgelaufen**: Sessions laufen nach 24 Stunden ab. Das ist normal.

---

### 3.4 Spielauswahl-Dropdown ist leer

**Symptom:** Nach dem Login zeigt das Dashboard kein Dropdown mit Spielen.

**Diagnose:**

1. Planning Desk API direkt testen:
   ```bash
   curl -s -c cookies.txt -X POST http://<IP>:3001/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"identity":"admin","password":"admin1234"}'

   curl -s -b cookies.txt http://<IP>:3001/api/planning-desk/matches
   ```

   | Antwort | Bedeutung |
   |---------|-----------|
   | `[{...}]` (Array mit Spielen) | API funktioniert — Problem im Frontend |
   | `[]` (leeres Array) | Keine BBL-Spiele heute geplant — das ist normal |
   | `{"error":"Nicht authentifiziert"}` | Session-Cookie wird nicht gesendet → siehe 3.3 |
   | Timeout / Fehler | Planning Desk API nicht erreichbar |

2. Prüfen ob der Planning Desk Service registriert ist:
   ```bash
   aws logs tail /ecs/bbl-kommentator --since 1h --profile deployer --region eu-central-1 \
     | grep -i "planning"
   ```
   - `Planning Desk service registered` → OK
   - `PLANNING_DESK_API_KEY not set` → Key fehlt in der Task Definition

---

### 3.5 WebSocket-Verbindung schlägt fehl

**Symptom:** Dashboard zeigt "OFFLINE" oder WebSocket verbindet nicht.

**Diagnose:**

1. WebSocket-Upgrade testen:
   ```bash
   # Erst Login-Cookie holen
   curl -s -c cookies.txt -X POST http://<IP>:3001/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"identity":"admin","password":"admin1234"}'

   # Cookie-Wert auslesen
   cat cookies.txt | grep connect.sid
   ```

2. Prüfen ob BBL Socket Service registriert ist:
   ```bash
   aws logs tail /ecs/bbl-kommentator --since 1h --profile deployer --region eu-central-1 \
     | grep -i "bbl socket"
   ```
   - `BBL Socket service registered` → OK
   - `BBL_SOCKET_API_KEY not set` → Key fehlt

3. WebSocket-Auth: Ohne gültiges Session-Cookie wird die WebSocket-Verbindung mit `401 Unauthorized` abgelehnt. Das ist Absicht — erst einloggen.

---

### 3.6 Admin-Panel nicht erreichbar

**Symptom:** Benutzer sieht keinen "Admin"-Link in der Navigation.

**Ursache:** Der eingeloggte Benutzer hat die Rolle `user`, nicht `admin`.

**Prüfen:**
```bash
curl -s -c cookies.txt -X POST http://<IP>:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identity":"admin","password":"admin1234"}'

curl -s -b cookies.txt http://<IP>:3001/api/auth/me
```

Antwort enthält `"role":"admin"` oder `"role":"user"`. Nur Admins sehen das Admin-Panel.

**Wenn ein Benutzer mit Rolle `user` versucht, Admin-Endpunkte direkt aufzurufen:**
```bash
curl -s -b cookies.txt http://<IP>:3001/api/admin/users
# → {"error":"Keine Berechtigung"} (HTTP 403)
```

---

### 3.7 Benutzer kann nicht erstellt werden (Admin-Panel)

**Mögliche Fehlermeldungen im Admin-Panel:**

| Fehlermeldung | Ursache | Lösung |
|---------------|---------|--------|
| "Benutzername existiert bereits" | Username ist vergeben | Anderen Username wählen |
| "E-Mail existiert bereits" | E-Mail ist vergeben | Andere E-Mail wählen |
| "Passwort muss mindestens 8 Zeichen lang sein" | Passwort zu kurz | Mindestens 8 Zeichen |
| "Letzter Admin kann nicht gelöscht werden" | Nur noch 1 Admin übrig | Erst einen zweiten Admin erstellen |
| "Eigenes Konto kann nicht deaktiviert werden" | Self-Modification-Schutz | Anderer Admin muss das tun |

---

### 3.8 Datenbank-Probleme

**Symptom:** Diverse Fehler nach Container-Neustart, Benutzer verschwunden.

**Ursache:** Die SQLite-Datenbank (`/app/data/auth.db`) liegt im Container-Dateisystem. Ohne Volume-Mount geht sie bei jedem Neustart verloren.

**Prüfen ob Volume konfiguriert ist:**
Die Task Definition sollte ein Volume für `/app/data` haben. Ohne Volume:
- Benutzerkonten gehen bei Neustart verloren
- Sessions werden ungültig
- Der Admin-Seed läuft erneut (erstellt den initialen Admin neu)

**Hinweis:** Im aktuellen Fargate-Setup ohne EFS-Volume ist das erwartetes Verhalten. Die `INITIAL_ADMIN_*`-Variablen sorgen dafür, dass beim Start immer ein Admin existiert.

---

## 4. Häufige Fehler-Codes

### HTTP-Status-Codes der API

| Code | Endpunkt | Bedeutung |
|------|----------|-----------|
| 200 | alle | Erfolg |
| 201 | `POST /api/admin/users` | Benutzer erstellt |
| 400 | diverse | Ungültige Eingabe (fehlende Felder, Passwort zu kurz, Self-Modification) |
| 401 | geschützte Endpunkte | Nicht authentifiziert (kein/ungültiges Session-Cookie) |
| 403 | `/api/admin/*` | Keine Berechtigung (Rolle `user` statt `admin`) |
| 404 | `/api/admin/users/:id/*` | Benutzer nicht gefunden |
| 409 | `POST /api/admin/users` | Duplikat (Username oder E-Mail existiert bereits) |
| 429 | `POST /api/auth/login` | Rate Limit erreicht (10 Versuche / 15 Min pro IP) |
| 500 | alle | Interner Serverfehler (Logs prüfen!) |

---

## 5. Neustart und Re-Deployment

### Container neu starten (gleiche Version)

```bash
aws ecs update-service \
  --cluster bbl-kommentator \
  --service bbl-kommentator-svc \
  --force-new-deployment \
  --profile deployer --region eu-central-1
```

Achtung: Neue IP nach Neustart! (siehe Abschnitt 1)

### Neues Image deployen

```bash
# Aus dem kommentator-app/ Verzeichnis:
docker build --platform linux/amd64 -t kommentator-app:latest .

aws ecr get-login-password --profile deployer --region eu-central-1 | \
  docker login --username AWS --password-stdin \
  364301299051.dkr.ecr.eu-central-1.amazonaws.com

docker tag kommentator-app:latest \
  364301299051.dkr.ecr.eu-central-1.amazonaws.com/bbl-kommentator:latest

docker push \
  364301299051.dkr.ecr.eu-central-1.amazonaws.com/bbl-kommentator:latest

aws ecs update-service \
  --cluster bbl-kommentator \
  --service bbl-kommentator-svc \
  --force-new-deployment \
  --profile deployer --region eu-central-1
```

### App stoppen (Kosten sparen)

```bash
aws ecs update-service \
  --cluster bbl-kommentator \
  --service bbl-kommentator-svc \
  --desired-count 0 \
  --profile deployer --region eu-central-1
```

---

## 6. Eskalation

Wenn keiner der obigen Schritte hilft:

1. **Logs sichern**: `aws logs tail /ecs/bbl-kommentator --since 2h --profile deployer --region eu-central-1 > logs.txt`
2. **Task-Details**: `aws ecs describe-tasks --cluster bbl-kommentator --tasks $(aws ecs list-tasks --cluster bbl-kommentator --query 'taskArns[0]' --output text --profile deployer --region eu-central-1) --profile deployer --region eu-central-1`
3. **Quellcode**: Repository unter https://github.com/mlang200/datamonitor.git
4. **Architektur-Doku**: `docs/README.md` im Repository
