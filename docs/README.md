# Kommentator Socket App — Projektdokumentation

## 1. Executive Summary

Die Kommentator Socket App ist ein Echtzeit-Dashboard für Basketball-Kommentatoren der BBL (Basketball Bundesliga). Sie zeigt während eines laufenden Spiels alle relevanten Informationen auf einen Blick: den aktuellen Spielstand, detaillierte Spieler-Statistiken (Boxscore), und einen Live-Ticker aller Spielaktionen (Play-by-Play).

**Was macht die App?**
Sie empfängt Live-Daten direkt von der offiziellen BBL-Datenquelle und bereitet sie übersichtlich im Browser auf — in Echtzeit, ohne Verzögerung, ohne manuelles Aktualisieren.

**Für wen ist sie gebaut?**
Für Kommentatoren, die während einer Live-Übertragung schnell und zuverlässig auf Spielinformationen zugreifen müssen. Statt zwischen mehreren Quellen zu wechseln, haben sie alles in einem einzigen Browser-Tab.

**Welchen Nutzen hat sie?**
- Spielstand, Statistiken und Spielverlauf auf einen Blick
- Daten kommen automatisch — kein Neuladen nötig
- Automatische Verbindung im Produktionsfenster — 15 Minuten vor Spielbeginn bis 15 Minuten nach Spielende wird die Verbindung durchgehend offen gehalten
- Schutz vor Fehlinformationen: Quarter, Boxscore und Team Leaders werden nur angezeigt, wenn die Daten verlässlich sind
- Funktioniert auch bei kurzen Verbindungsunterbrechungen zuverlässig weiter
- Einfache Spielauswahl über ein Dropdown-Menü

Die App ist eine eigenständige Anwendung, die unabhängig vom bestehenden „Spieltag-Projekt" (dem größeren Produktionssystem) betrieben werden kann.

---

## 2. Problem & Lösung

### Das Problem

Die Kommentator-Funktionalität war bisher Teil eines großen, monolithischen Systems — dem „Spieltag-Projekt". Dieses System enthält viele weitere Features (Overlay-Grafiken, Spieltag-Vorschauen, Head-to-Head-Vergleiche, PDF-Analysen, Template-Management und mehr), die für Kommentatoren irrelevant sind.

Das führte zu mehreren Problemen:
- **Abhängigkeit**: Änderungen am Kommentator-Feature konnten andere Teile des Systems beeinflussen (und umgekehrt)
- **Komplexität**: Das Gesamtsystem war schwer zu warten und zu deployen
- **Ressourcen**: Der monolithische Server brauchte eine Datenbank und viele Abhängigkeiten, die für die Kommentator-Funktion gar nicht nötig sind

### Die Lösung

Die Kommentator-Funktionalität wurde als eigenständige App extrahiert — mit eigenem Server, eigenem Frontend und eigener Deployment-Pipeline. Die neue App enthält ausschließlich das, was Kommentatoren brauchen, und nichts darüber hinaus.

**Vorteile der neuen Architektur:**
- **Unabhängigkeit**: Die App kann separat entwickelt, getestet und deployed werden
- **Einfachheit**: Leichtgewichtige SQLite-Datenbank nur für Benutzer und Sessions — kein externer Datenbankserver nötig
- **Zuverlässigkeit**: Weniger Code = weniger potenzielle Fehlerquellen
- **Schnelleres Deployment**: Kleineres Docker-Image, schnellerer Start
- **Geringere Kosten**: Weniger Ressourcen nötig (512 MB RAM reichen aus)
- **Sicherheit**: Rollenbasiertes Login-System schützt die App vor unautorisiertem Zugriff

---

## 3. Systemüberblick

Die App besteht aus drei Hauptteilen, die zusammenarbeiten:

### Das Dashboard (Frontend)
Das ist die Benutzeroberfläche — eine Webseite, die im Browser des Kommentators läuft. Sie zeigt:
- Eine Spielauswahl (Dropdown mit heutigen BBL-Spielen)
- Den Live-Spielstand mit Teamkürzel und Quarter (Quarter wird nur angezeigt, wenn verlässlich bestimmt)
- Boxscore-Tabellen für beide Teams (werden erst angezeigt, wenn Spieler-Statistiken vollständig synchronisiert sind)
- Ein Team-Leaders-Panel (beste Spieler in jeder Kategorie — gleiche Sync-Logik wie Boxscore)
- Einen Live-Ticker mit allen Spielaktionen
- Ein Diagnose-Terminal mit Verbindungsstatus, Produktionsfenster-Anzeige und Logs

### Der Server (Backend)
Der Server ist das „Gehirn" der App. Er:
- Authentifiziert Benutzer über ein Login-System mit serverseitigen Sessions
- Verwaltet Benutzerkonten und Rollen (`admin`, `user`) in einer SQLite-Datenbank
- Verbindet sich mit der BBL-Datenquelle und empfängt Live-Events
- Wandelt die Rohdaten in lesbare Informationen um
- Leitet die Daten in Echtzeit an alle verbundenen Browser weiter
- Stellt die Spielliste aus der Planning Desk API bereit
- Schützt die API-Schlüssel (die nie an den Browser weitergegeben werden)

### Externe Datenquellen
- **BBL Scoreboard API**: Liefert die Live-Spieldaten (Scores, Aktionen, Spieler-Statistiken) über eine permanente Verbindung
- **Planning Desk API**: Liefert die kuratierte Spielliste mit Teamnamen, Wettbewerben und Spielzeiten

### Wie arbeiten die Teile zusammen?

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  BBL Scoreboard  │────▶│     Server       │────▶│    Dashboard     │
│  (Datenquelle)   │     │  (Verarbeitung)  │     │   (Browser)      │
└──────────────────┘     └──────────────────┘     └──────────────────┘
                               ▲    │                    │
┌──────────────────┐           │    │                    │
│  Planning Desk   │───────────┘    │                    │
│  (Spielliste)    │     Spielauswahl ◀──────────────────┘
└──────────────────┘                │
                          ┌─────────▼────────┐
                          │  SQLite (auth.db) │
                          │  Benutzer +       │
                          │  Sessions         │
                          └──────────────────┘
```

**Vereinfacht:** Die BBL-Datenquelle schickt Live-Daten an den Server. Der Server bereitet sie auf und schickt sie sofort an den Browser des Kommentators weiter. Die Planning Desk API liefert die Spielliste, damit der Kommentator das richtige Spiel auswählen kann. Eine SQLite-Datenbank speichert Benutzerkonten und Login-Sessions.

---

## 4. Architektur

### Architekturform

Die App folgt einer **Event-driven Realtime Architecture** (ereignisgesteuerte Echtzeit-Architektur) mit **Client-Server-Modell**.

**Was bedeutet das in einfachen Worten?**

Statt dass der Browser regelmäßig beim Server nachfragt „Gibt es etwas Neues?" (das wäre Polling), funktioniert es andersherum: Sobald ein neues Spielereignis passiert, wird es automatisch vom Server an den Browser „gepusht" — wie eine Benachrichtigung auf dem Handy. Das ist schneller und effizienter.

### Der Datenfluss — Schritt für Schritt

**Phase 1: Spielauswahl**
1. Der Kommentator öffnet die App im Browser
2. Das Dashboard fragt den Server nach der heutigen Spielliste
3. Der Server holt die Spielliste von der Planning Desk API (mit Teamnamen und Uhrzeiten)
4. Der Kommentator wählt ein Spiel aus dem Dropdown und klickt „Verbinden"

**Phase 2: Verbindungsaufbau**
5. Der Server baut eine Verbindung zur BBL-Datenquelle auf
6. Die BBL API liefert die Spielinformationen (Teams, Spielerkader, Spielort)
7. Die BBL API liefert die bisherige Spielhistorie (alle Events seit Spielbeginn)
8. Der Server gleicht den Spielstand über einen separaten Kanal ab (Gamecenter-Sync)
9. Alle Daten werden an den Browser weitergeleitet

**Phase 3: Live-Betrieb**
10. Jedes neue Spielereignis (Korb, Foul, Timeout, Einwechslung...) wird von der BBL API an den Server geschickt
11. Der Server wandelt das Rohdaten-Array in ein lesbares Objekt um
12. Das Objekt wird sofort an alle verbundenen Browser weitergeleitet
13. Das Dashboard aktualisiert Spielstand, Statistiken und Live-Ticker automatisch

```
Spielfeld → BBL API → Server → Browser → Kommentator sieht es
   🏀         📡        🖥️       🌐          👀

Zeitverzögerung: typischerweise unter 1 Sekunde
```

### Warum diese Architektur?

- **Kein Polling**: Events fließen automatisch — keine unnötigen Anfragen
- **Kein Datenverlust**: Der Server buffert alle Events im Arbeitsspeicher
- **Leichtgewichtige Persistenz**: Nur Benutzerkonten und Sessions werden in SQLite gespeichert — Spieldaten bleiben im Arbeitsspeicher (ein Spiel hat typischerweise 500–2000 Events, ~1–5 MB)
- **Sofortige Updates**: Neue Events erscheinen im Browser innerhalb von Millisekunden

---

## 5. Technische Details

### Verwendete Technologien

| Komponente | Technologie | Warum? |
|------------|-------------|--------|
| Backend-Server | **Node.js / Express** | Leichtgewichtiger HTTP-Server, ideal für Echtzeit-Anwendungen |
| Frontend | **React / Vite** | Modernes UI-Framework mit schnellem Build-Tool |
| Datenbank | **SQLite / better-sqlite3** | Leichtgewichtig, kein externer Server nötig, synchrone API |
| Passwort-Hashing | **Argon2id** | OWASP-empfohlener Algorithmus, Gewinner der Password Hashing Competition |
| Session-Management | **express-session + SQLite-Store** | Serverseitige Sessions mit Cookie-basierter Authentifizierung |
| Datenempfang (BBL API) | **Socket.IO Client** | Die BBL API spricht Socket.IO — wir nutzen den passenden Client |
| Datenversand (→ Browser) | **Native WebSockets** | Leichtgewichtiger als Socket.IO, ausreichend für den einfachen Push-Kanal |
| Laufzeitumgebung | **tsx** | Führt TypeScript direkt aus, ohne separaten Build-Schritt |
| Tests | **Vitest + fast-check** | Schneller Test-Runner mit Property-Based Testing für formale Korrektheit |

### Wichtige Module

#### BBL Socket Service (`server/src/bbl-socket/index.ts`)
Das Herzstück des Backends. Dieser Service:
- Hält eine permanente Verbindung zur BBL API
- Empfängt und buffert alle Spielereignisse
- Führt den Gamecenter-Sync durch (Spielstand-Abgleich nach dem Laden der Historie)
- Erkennt, ob die Spielhistorie unvollständig ist (z.B. bei später Verbindung)
- Reconnectet automatisch bei Verbindungsabbrüchen

#### Event Mapping (`server/src/bbl-socket/mappings.ts`)
Die BBL API liefert Daten als kompakte Zahlen-Arrays (z.B. `[1, 42, 2, 1, 305, 0, 480, 7, 0, 3, ...]`). Das Event Mapping wandelt diese Arrays in lesbare Objekte um:

```
Vorher:  [1, 42, 2, 1, 305, 0, 480, 7, 0, 3, ...]
Nachher: { type: "action", quarter: "Q2", teamCode: "A", action: "P2", result: "+", ... }
```

Es übersetzt dabei numerische Codes in verständliche Bezeichnungen:
- Quarter-Codes: 1→Q1, 2→Q2, ..., 5→OT1
- Team-Codes: 1→A (Heim), 2→B (Gast)
- Action-Codes: 3→P2 (Zweier), 4→P3 (Dreier), 2→FT (Freiwurf), 5→FOUL, ...
- Ergebnis-Codes: 0→miss, 1→made, 2→blocked

#### WebSocket Handler (`server/src/bbl-socket/ws-handler.ts`)
Verwaltet die Verbindungen zu den Browser-Clients:
- Akzeptiert WebSocket-Verbindungen auf `/ws/bbl-live`
- Sendet bei neuer Verbindung sofort den kompletten aktuellen Spielstand
- Leitet jedes neue Event an alle verbundenen Browser weiter
- Prüft alle 30 Sekunden, ob Clients noch erreichbar sind (Ping/Pong)

#### Planning Desk Client (`server/src/planning-desk-client.ts`)
Holt die Spielliste für das Dropdown:
- Lädt Spiele, Clubs und Wettbewerbe von der Planning Desk API
- Löst Club-IDs zu lesbaren Teamnamen auf (mit Caching)
- Filtert auf BBL-Spiele ab heute, sortiert nach Spielzeit

### Authentifizierung & Benutzerverwaltung

Die App verfügt über ein vollständiges rollenbasiertes Authentifizierungssystem. Alle Bereiche — REST API, WebSocket-Verbindungen und Frontend — sind vor unautorisiertem Zugriff geschützt.

#### Architektur-Überblick

```
Browser                          Server                           Datenbank
┌─────────────┐                  ┌─────────────────────┐          ┌──────────┐
│ LoginPage   │──POST /login───▶│ Rate Limiter        │          │          │
│             │◀─Set-Cookie─────│ Auth Routes         │          │ auth.db  │
│             │                  │   ↓                  │          │          │
│ Dashboard   │──Cookie──────▶  │ Session Middleware   │──────▶  │ sessions │
│ AdminPanel  │                  │   ↓                  │          │ users    │
│             │                  │ requireAuth()        │          │          │
│             │                  │ requireAdmin()       │          └──────────┘
│             │                  │   ↓                  │
│             │◀─────────────── │ Geschützte Routen    │
└─────────────┘                  └─────────────────────┘
```

#### Wie funktioniert der Login?

1. Der Benutzer gibt E-Mail/Benutzername und Passwort auf der Login-Seite ein
2. Der Rate Limiter prüft, ob die IP-Adresse zu viele Fehlversuche hatte (max. 10 in 15 Minuten)
3. Der Auth Service sucht den Benutzer in der Datenbank und verifiziert das Passwort mit Argon2id
4. Bei Erfolg erstellt `express-session` eine serverseitige Session und setzt ein signiertes HTTP-Only Cookie
5. Alle weiteren Requests senden das Cookie automatisch mit — der Server prüft die Session bei jedem Request

#### Rollen und Berechtigungen

| Rolle | Dashboard | Admin-Panel | Benutzerverwaltung |
|-------|-----------|-------------|---------------------|
| `user` | ✓ | ✗ | ✗ |
| `admin` | ✓ | ✓ | ✓ |

Die Rollenprüfung erfolgt serverseitig bei jedem Request über die `requireAdmin()`-Middleware. Die Frontend-seitige Ausblendung des Admin-Links dient nur der UX — die eigentliche Sicherheit liegt im Backend.

#### Datenbank (SQLite)

Die App verwendet eine einzelne SQLite-Datei (`data/auth.db`) für zwei Zwecke:

**`users`-Tabelle** — Benutzerkonten:
- `id`, `username` (unique), `email` (unique), `password_hash` (Argon2id), `role`, `is_active`, Zeitstempel
- Passwörter werden nie im Klartext gespeichert — nur der Argon2id-Hash

**`sessions`-Tabelle** — Login-Sessions:
- Wird automatisch von `better-sqlite3-session-store` verwaltet
- Enthält die Session-ID, Session-Daten (Benutzer-ID, Name, Rolle) und Ablaufzeit
- Abgelaufene Sessions werden automatisch bereinigt

Die Datenbank wird im WAL-Modus betrieben (Write-Ahead Logging) für bessere Performance bei gleichzeitigen Lesezugriffen. Die Datei liegt im `data/`-Verzeichnis und muss bei Docker-Deployments als Volume gemountet werden, damit Benutzerkonten Container-Neustarts überleben.

#### Sicherheitsmaßnahmen

| Maßnahme | Beschreibung |
|----------|-------------|
| **Argon2id** | Passwort-Hashing nach OWASP-Empfehlung (64 MB Memory, 3 Iterationen) |
| **HTTP-Only Cookies** | Session-Token ist nicht per JavaScript auslesbar |
| **Rate Limiting** | Max. 10 Fehlversuche pro IP in 15 Minuten |
| **Generische Fehlermeldungen** | Login-Fehler verraten nicht, ob Benutzername oder Passwort falsch war |
| **Session-Invalidierung** | Bei Deaktivierung, Rollenänderung oder Passwort-Reset werden alle Sessions sofort ungültig |
| **Letzter-Admin-Schutz** | Der letzte Admin kann nicht gelöscht oder degradiert werden |
| **Selbstmodifikations-Schutz** | Admins können sich nicht selbst deaktivieren, löschen oder die eigene Rolle ändern |

#### Initialer Admin-Benutzer

Beim ersten Start (leere `users`-Tabelle) erstellt die App automatisch einen Admin-Benutzer aus Umgebungsvariablen:

```
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=sicheres-passwort
```

Wenn diese Variablen nicht gesetzt sind, gibt der Server eine Warnung aus — die App startet, aber niemand kann sich anmelden. Weitere Benutzer werden über das Admin-Panel im Browser erstellt.

#### Auth-Module im Überblick

| Modul | Pfad | Aufgabe |
|-------|------|---------|
| Auth DB | `server/src/db/auth-db.ts` | SQLite-Datenbank initialisieren (users-Tabelle) |
| Password Service | `server/src/auth/password.ts` | Argon2id Hash/Verify/Validate |
| User Service | `server/src/auth/user-service.ts` | CRUD-Operationen auf Benutzerkonten |
| Auth Service | `server/src/auth/auth-service.ts` | Login-Logik (Benutzer suchen, Passwort prüfen) |
| Rate Limiter | `server/src/auth/rate-limiter.ts` | Brute-Force-Schutz (In-Memory, pro IP) |
| Middleware | `server/src/auth/middleware.ts` | `requireAuth()` und `requireAdmin()` |
| Seed | `server/src/auth/seed.ts` | Initialen Admin aus Env-Vars erstellen |
| Auth Routes | `server/src/routes/auth.ts` | `/api/auth/login`, `/logout`, `/me` |
| Admin Routes | `server/src/routes/admin.ts` | `/api/admin/users/*` (CRUD) |

### API-Endpunkte

| Endpunkt | Methode | Auth | Beschreibung |
|----------|---------|------|-------------|
| `/api/health` | GET | — | Statuscheck — gibt `{ status: "ok" }` zurück |
| `/api/auth/login` | POST | — | Login mit `{identity, password}` |
| `/api/auth/logout` | POST | ✓ | Session invalidieren |
| `/api/auth/me` | GET | ✓ | Aktuellen Benutzer zurückgeben |
| `/api/admin/users` | GET | Admin | Alle Benutzer auflisten |
| `/api/admin/users` | POST | Admin | Neuen Benutzer erstellen |
| `/api/admin/users/:id` | DELETE | Admin | Benutzer löschen |
| `/api/admin/users/:id/deactivate` | POST | Admin | Benutzer deaktivieren |
| `/api/admin/users/:id/activate` | POST | Admin | Benutzer aktivieren |
| `/api/admin/users/:id/role` | PUT | Admin | Rolle ändern |
| `/api/admin/users/:id/password` | PUT | Admin | Passwort zurücksetzen |
| `/api/planning-desk/matches` | GET | ✓ | Spielliste (gefiltert auf BBL, ab heute) |
| `/api/bbl-socket/connect` | POST | ✓ | Verbindung zu einem Spiel herstellen |
| `/api/bbl-socket/disconnect` | POST | ✓ | Verbindung trennen |
| `/api/bbl-socket/session` | GET | ✓ | Aktueller Session-Status |
| `/api/bbl-socket/events?from=N` | GET | ✓ | Events ab Index N |
| `/ws/bbl-live` | WebSocket | ✓ | Echtzeit-Kanal für Events und Logs |

Auth-Legende: — = öffentlich, ✓ = Login erforderlich, Admin = Login + Rolle `admin` erforderlich

---

## 6. Realtime-Logik

### Produktionsfenster — automatische Verbindungshaltung

Die App berechnet für jedes ausgewählte Spiel ein Produktionsfenster, in dem die Live-Verbindung automatisch offen gehalten wird:

- **Fenster-Start**: Anwurfzeit minus 15 Minuten
- **Fenster-Ende**: Anwurfzeit plus 2 Stunden 45 Minuten (2,5h Spieldauer + 15min Puffer)

Beispiel: Anwurf um 15:00 → Fenster von 14:45 bis 17:45.

**Verhalten innerhalb des Fensters:**
- Die Verbindung wird automatisch aufgebaut, sobald das Fenster aktiv wird
- Bei kurzen Netzunterbrechungen wird automatisch reconnectet — die Session bleibt logisch aktiv
- Die Verbindung wird nicht durch Inaktivität oder UI-Wechsel getrennt
- Nur ein expliziter manueller Disconnect durch den Kommentator beendet die Session vorzeitig

**Verhalten außerhalb des Fensters:**
- Keine automatische Verbindung — der Kommentator kann sich aber manuell verbinden
- Nach Fenster-Ende wird eine automatisch aufgebaute Verbindung sauber beendet

**Status-Anzeige im Terminal:**

| Anzeige | Bedeutung |
|---------|-----------|
| „Live-Fenster startet in X Min" | Das Fenster ist noch nicht aktiv, Countdown läuft |
| „🟢 Live-Fenster aktiv — Verbindung wird gehalten" | Innerhalb des Fensters, Verbindung steht |
| „🟠 Live-Fenster aktiv — Reconnect läuft" | Innerhalb des Fensters, Verbindung kurz unterbrochen, Reconnect läuft |
| „Live-Fenster beendet" | Das Fenster ist abgelaufen |

**Warum dieses Feature?**
Reconnects während eines laufenden Spiels können zu vorübergehend inkonsistenten Daten führen (Score stimmt, aber Boxscore noch nicht). Das Produktionsfenster minimiert dieses Risiko, indem die Verbindung von Anfang an stabil gehalten wird, statt sie erst bei Bedarf aufzubauen.

**Technische Umsetzung:**
Die Logik liegt im Frontend-Hook `useProductionWindow`. Er prüft alle 10 Sekunden, ob die aktuelle Zeit innerhalb des Fensters liegt, und steuert Auto-Connect/Disconnect. Die Berechnung des Fensters (`getProductionWindow`, `getWindowStatus`) sind reine Funktionen, die unabhängig von React getestet werden können.

### Zwei getrennte Verbindungen

Die App nutzt zwei unabhängige Verbindungen, die man nicht verwechseln sollte:

**Verbindung 1: Browser ↔ eigener Server (WebSocket)**
- Wird automatisch beim Laden der Seite aufgebaut
- Dient als Kommunikationskanal zwischen Browser und Backend
- Ist Voraussetzung dafür, dass der „Verbinden"-Button und das Produktionsfenster funktionieren
- Hat nichts mit der BBL API zu tun
- Erkennung: Der Browser merkt sofort, wenn diese Verbindung abbricht — WebSockets feuern automatisch ein `onclose`-Event, kein Polling nötig

**Verbindung 2: Server ↔ BBL API (Socket.IO)**
- Wird hergestellt, wenn der Kommentator auf „Verbinden" klickt oder das Produktionsfenster sie automatisch aufbaut
- Überträgt die eigentlichen Live-Spieldaten
- Vor dem Verbinden hat der Browser null Kontakt zur BBL API — alles läuft über den eigenen Server als Vermittler

### Session-Lifecycle: logisch vs. physisch

Die App unterscheidet zwischen zwei Ebenen:

- **Logisch aktive Session**: Das Produktionsfenster ist aktiv und die App „will" verbunden sein. Auch wenn die physische Verbindung kurz unterbrochen ist, bleibt die Session logisch aktiv und Reconnect-Versuche laufen weiter.
- **Physisch verbundener Socket**: Die tatsächliche WebSocket-/Socket.IO-Verbindung steht. Kann kurzzeitig unterbrochen sein, ohne dass die logische Session endet.

Diese Trennung verhindert, dass ein kurzer Netzausfall die gesamte Session beendet und der Kommentator manuell neu verbinden muss.

### Verbindungsstatus im Terminal

Das Diagnose-Terminal zeigt drei Zustände:

| Anzeige | Bedeutung |
|---------|-----------|
| 🟠 **BEREIT** | Server erreichbar, aber noch kein Spiel verbunden. Der Browser hat eine WebSocket-Verbindung zum eigenen Server. Die BBL API wird noch nicht kontaktiert. |
| 🟢 **LIVE** | Mit einem BBL-Spiel verbunden. Live-Daten fließen. |
| 🔴 **OFFLINE** | Keine Verbindung zum eigenen Server. Mögliche Ursachen: Server nicht gestartet, Netzwerk unterbrochen. |

Der Wechsel zwischen diesen Zuständen passiert automatisch — ohne Polling oder regelmäßiges Pingen vom Browser aus. WebSockets sind bidirektionale, permanente Verbindungen: Beide Seiten merken sofort, wenn die Gegenseite nicht mehr erreichbar ist.

Der einzige Ping/Pong-Mechanismus läuft auf der Server-Seite (alle 30 Sekunden). Dabei prüft der Server, ob die verbundenen Browser-Clients noch erreichbar sind, und räumt tote Verbindungen auf. Das ist die umgekehrte Richtung — der Server prüft den Browser, nicht umgekehrt.

### Wie kommen Live-Daten ins System?

Die BBL betreibt einen Scoreboard-Server (`api.bbl.scb.world`), der während eines Spiels kontinuierlich Events sendet — jeder Korb, jedes Foul, jede Einwechslung wird als Datensatz übertragen.

Unser Server verbindet sich über das Socket.IO-Protokoll mit diesem Scoreboard-Server. Das funktioniert ähnlich wie ein Chat: Sobald die Verbindung steht, werden neue Nachrichten (Events) automatisch zugestellt, ohne dass man danach fragen muss.

Der Ablauf im Detail:
1. Server verbindet sich und tritt dem „Kanal" des gewählten Spiels bei
2. Server fordert die Spielinformationen an (Teams, Kader)
3. Server fordert die bisherige Spielhistorie an (alle Events seit Spielbeginn)
4. Nach dem Ende der Historie (`history_end`-Signal) gleicht der Server den Spielstand über den Gamecenter-Endpunkt ab
5. Ab jetzt kommen neue Events automatisch in Echtzeit

### Was passiert bei Verbindungsabbruch?

Die App ist auf Verbindungsprobleme vorbereitet — sowohl zwischen Server und BBL API als auch zwischen Browser und Server:

**Server ↔ BBL API:**
- Bei Verbindungsverlust versucht der Server automatisch, sich wieder zu verbinden
- Die Wartezeit zwischen Versuchen steigt schrittweise an (1s → 2s → 4s → max 10s), um die API nicht zu überlasten
- Nach dem Reconnect werden nur die fehlenden Events nachgeladen (basierend auf den zuletzt bekannten Event-IDs)
- Der Spielstand wird erneut über den Gamecenter-Sync abgeglichen

**Browser ↔ Server:**
- Bei Verbindungsverlust versucht der Browser automatisch, sich wieder zu verbinden (gleiche Backoff-Strategie: 1s → 2s → 4s → max 10s)
- Die Erkennung ist sofort — kein Polling nötig, der WebSocket-`onclose`-Event feuert automatisch
- Nach dem Reconnect bekommt der Browser sofort den kompletten aktuellen Spielstand (`init`-Nachricht)
- Neue Events werden nahtlos angehängt

### Wie wird sichergestellt, dass Daten korrekt sind?

Mehrere Mechanismen sorgen für Datenintegrität:

1. **Produktionsfenster**: Die Verbindung wird während des gesamten Spiels offen gehalten, um Reconnects und die damit verbundenen Inkonsistenzen zu vermeiden.

2. **Gamecenter-Sync**: Nach dem Laden der Historie wird der Spielstand über einen separaten Endpunkt abgeglichen. Das korrigiert mögliche Lücken in der Historie.

3. **Score nur aus Scorelist-Events**: Der Spielstand wird ausschließlich aus Scorelist-Events (Typ 0) berechnet — nie aus Team-Statistik-Events, auch wenn diese abweichende Werte enthalten.

4. **Quarter nur aus echten Events**: Das angezeigte Quarter (Q1, Q2, etc.) wird nur aus echten Spiel-Events bestimmt — nie aus synthetischen Gamecenter-Sync-Daten (die negative IDs haben). Wenn kein verlässlicher Quarter-Wert vorliegt (z.B. vor Spielbeginn), wird nichts angezeigt statt eines falschen Werts. Das verhindert, dass ein Kommentator z.B. „Q4" sieht, obwohl das Spiel noch gar nicht begonnen hat.

5. **Stats-Readiness**: Boxscore-Tabellen und Team Leaders werden erst angezeigt, wenn die Spieler-Statistiken tatsächlich vorhanden und konsistent sind. Der Indikator dafür ist, ob mindestens ein Spieler Spielzeit (`sp > 0`) hat. Solange die Stats noch nicht bereit sind (z.B. direkt nach einem Reconnect), zeigt das Dashboard stattdessen den Hinweis „Statistiken werden synchronisiert...". Das verhindert, dass ein Kommentator veraltete oder leere Statistiken sieht.

6. **Delete-Events**: Die BBL API kann Korrekturen senden (z.B. „Score #42 wurde gelöscht"). Die App verarbeitet diese korrekt und schließt gelöschte Events aus der Berechnung aus.

7. **HistoryIncomplete-Flag**: Wenn die App erkennt, dass die Spielhistorie Lücken haben könnte (z.B. bei Verbindung nach der Halbzeit), wird ein Warnhinweis im Live-Ticker angezeigt. Spielstand und Statistiken sind trotzdem korrekt (dank Gamecenter-Sync), aber der Play-by-Play Feed könnte unvollständig sein.

8. **Property-Based Tests**: 16+ formale Korrektheitseigenschaften werden mit automatisierten Tests überprüft — nicht nur mit einzelnen Beispielen, sondern mit Hunderten zufällig generierter Testfälle. Zusätzliche Tests decken die Quarter-Schutzlogik, Stats-Readiness und das Produktionsfenster ab.

---

## 7. Deployment & Betrieb

### Wie wird die App deployed?

Die App wird als Docker-Container auf AWS ECS Fargate betrieben — einem Service, der Container in der Cloud ausführt, ohne dass man eigene Server verwalten muss.

**Der Deployment-Prozess:**
1. Ein Docker-Image wird gebaut (enthält Server + fertig gebautes Frontend)
2. Das Image wird in die AWS Container Registry (ECR) hochgeladen
3. Der ECS Service startet einen neuen Container mit dem aktuellen Image

```bash
# Kurzversion des Deployment-Prozesses:
docker build --platform linux/amd64 -t kommentator-app:latest .
# → Image in ECR pushen → ECS Service neu deployen
```

Die vollständige Anleitung mit allen Befehlen findet sich in `kommentator-app/docs/deployment.md`.

### Umgebungsvariablen

| Variable | Pflicht | Standard | Beschreibung |
|----------|---------|----------|-------------|
| `SESSION_SECRET` | Ja | — | Secret für die Signierung der Session-Cookies |
| `BBL_SOCKET_API_KEY` | Ja | — | Schlüssel für die BBL Scoreboard API |
| `PLANNING_DESK_API_KEY` | Ja | — | Schlüssel für die Planning Desk API |
| `INITIAL_ADMIN_USERNAME` | Nein* | — | Benutzername des initialen Admins |
| `INITIAL_ADMIN_EMAIL` | Nein* | — | E-Mail des initialen Admins |
| `INITIAL_ADMIN_PASSWORD` | Nein* | — | Passwort des initialen Admins |
| `PORT` | Nein | `3001` | Port, auf dem der Server lauscht |
| `BBL_SOCKET_URL` | Nein | `https://api.bbl.scb.world` | URL der BBL API |
| `PLANNING_DESK_API_URL` | Nein | `https://api.desk.dyn.sport/planning/api` | URL der Planning Desk API |

\* Erforderlich beim allerersten Start, wenn noch keine Benutzer existieren. Bei nachfolgenden Starts werden diese Variablen ignoriert.

Wenn `SESSION_SECRET` fehlt, bricht der Server beim Start mit einer Fehlermeldung ab. Wenn `BBL_SOCKET_API_KEY` oder `PLANNING_DESK_API_KEY` fehlen, startet der Server trotzdem — aber der betroffene Service wird nicht registriert.

### Ports

| Umgebung | Server | Frontend (Dev) |
|----------|--------|----------------|
| Produktion (Docker) | 3001 | — (wird vom Server ausgeliefert) |
| Lokale Entwicklung | 3002 | 5174 |
| Spieltag-Projekt (zum Vergleich) | 3001 | 5173 |

In der Produktion liefert der Server sowohl die API als auch das Frontend über einen einzigen Port aus. In der Entwicklung laufen Server und Frontend separat, wobei der Vite-Dev-Server API-Anfragen an den Backend-Server weiterleitet (Proxy).

### Wie arbeiten Frontend und Backend zusammen?

**In der Entwicklung:**
- Der Vite-Dev-Server läuft auf Port 5174 und liefert das React-Frontend mit Hot-Reload
- API-Anfragen (`/api/*`) und WebSocket-Verbindungen (`/ws/*`) werden automatisch an den Backend-Server (Port 3002) weitergeleitet

**In der Produktion:**
- Der Express-Server liefert das fertig gebaute Frontend als statische Dateien aus
- API und WebSocket laufen auf demselben Port (3001)
- Alles läuft in einem einzigen Docker-Container

### AWS-Ressourcen

| Ressource | Wert |
|-----------|------|
| ECS Cluster | `bbl-kommentator` |
| ECS Service | `bbl-kommentator-svc` |
| Container-Größe | 512 CPU / 1024 MB RAM |
| Region | `eu-central-1` (Frankfurt) |
| Kosten (laufend) | ~$0.03/h (~$22/Monat) |
| Kosten (gestoppt) | $0 |

---

## 8. Sicherheit

### Authentifizierung und Zugriffskontrolle

Die App verfügt über ein vollständiges Login-System. Ohne Anmeldung ist kein Zugriff auf das Dashboard, die API oder WebSocket-Verbindungen möglich.

**Wie funktioniert es?**
- Benutzer melden sich mit E-Mail/Benutzername und Passwort an
- Der Server erstellt eine serverseitige Session und setzt ein signiertes HTTP-Only Cookie
- Jeder weitere Request wird automatisch über das Cookie authentifiziert
- Admins können über ein Admin-Panel weitere Benutzer anlegen, deaktivieren oder löschen

**Zwei Rollen:**
- `user`: Zugriff auf das Dashboard und die Live-Daten
- `admin`: Zusätzlich Zugriff auf das Admin-Panel zur Benutzerverwaltung

### Passwort-Sicherheit

Passwörter werden mit **Argon2id** gehasht — dem von OWASP empfohlenen Algorithmus. Die Parameter (64 MB Memory, 3 Iterationen, 4 Threads) machen Brute-Force-Angriffe auf gestohlene Hashes extrem aufwändig. Klartextpasswörter werden zu keinem Zeitpunkt gespeichert, geloggt oder in API-Responses ausgegeben.

### Brute-Force-Schutz

Der Login-Endpunkt ist durch einen Rate Limiter geschützt: Nach 10 fehlgeschlagenen Versuchen von derselben IP-Adresse innerhalb von 15 Minuten werden weitere Versuche blockiert. Ein erfolgreicher Login setzt den Zähler zurück.

### API-Keys nur im Backend

Die App kommuniziert mit zwei externen APIs, die jeweils einen geheimen Schlüssel (API Key) erfordern. Diese Schlüssel liegen ausschließlich auf dem Server — sie werden nie an den Browser übertragen.

**Warum ist das wichtig?**
Alles, was im Browser läuft, ist prinzipiell einsehbar (über die Browser-Entwicklertools). Wenn ein API-Key im Browser landen würde, könnte jeder ihn auslesen und missbrauchen. Deshalb fungiert der Server als „Vermittler": Das Frontend fragt den Server, und der Server fragt die externe API — mit dem Key, den nur er kennt.

### Zusammenfassung der Sicherheitsmaßnahmen

1. **Login-Pflicht**: Kein Zugriff ohne Authentifizierung — weder auf REST API noch auf WebSocket
2. **Argon2id-Hashing**: Passwörter nach OWASP Best Practice gespeichert
3. **HTTP-Only Cookies**: Session-Token nicht per JavaScript auslesbar (XSS-Schutz)
4. **Rate Limiting**: Brute-Force-Schutz auf dem Login-Endpunkt
5. **Generische Fehlermeldungen**: Login-Fehler verraten nicht, ob Benutzername oder Passwort falsch war
6. **Serverseitige Rollenprüfung**: Admin-Endpunkte werden im Backend geschützt, nicht nur im Frontend
7. **Session-Invalidierung**: Bei Deaktivierung, Rollenänderung oder Passwort-Reset werden Sessions sofort ungültig
8. **Keine Keys im Quellcode**: Alle Secrets über Umgebungsvariablen
9. **`.env`-Datei in `.gitignore`**: Lokale Konfiguration wird nicht ins Repository eingecheckt
10. **WebSocket-Auth**: Auch WebSocket-Verbindungen werden über das Session-Cookie authentifiziert

---

## 9. Grenzen & Non-Scope

### Was die App bewusst NICHT macht

Die Kommentator Socket App ist ein fokussiertes Werkzeug für einen einzigen Zweck: Live-Kommentierung von BBL-Basketballspielen. Folgende Features sind bewusst nicht enthalten:

- **Keine Aufzeichnung**: Spiele werden nicht gespeichert oder archiviert. Spieldaten leben im Arbeitsspeicher — bei einem Neustart verbindet sich der Kommentator einfach neu.
- **Keine anderen Sportarten**: Die App ist auf BBL-Basketball zugeschnitten. Andere Sportarten (Handball, Hockey, Volleyball) werden vom Spieltag-Projekt abgedeckt.
- **Kein HTTPS**: Im aktuellen Setup läuft die App ohne SSL-Verschlüsselung (kein Load Balancer). Für eine produktive Nutzung mit sensiblen Daten wäre ein ALB mit SSL-Zertifikat nötig.
- **Kein Self-Service-Passwort-Reset**: Benutzer können ihr Passwort nicht selbst zurücksetzen — das muss ein Admin über das Admin-Panel erledigen.

### Features aus dem Spieltag-Projekt, die NICHT übernommen wurden

| Feature | Beschreibung | Warum nicht? |
|---------|-------------|-------------|
| Overlay-Engine | Grafik-Overlays für TV-Produktion | Anderer Anwendungsfall |
| Grafikkatalog | Verwaltung von Grafik-Templates | Nicht relevant für Kommentatoren |
| Spieltag-Service | Spieltag-Vorschauen generieren | Separates Feature |
| H2H / Player-H2H | Head-to-Head-Vergleiche | Separates Feature |
| Gameday Realtime Boxscore | Boxscores für andere Sportarten | Nur BBL relevant |
| PDF-Analyzer | PDF-Dokumente analysieren | Nicht relevant |
| Template-Management | Grafik-Templates verwalten | Nicht relevant |
| Layout-Manager | Layouts für Overlays | Nicht relevant |

---

## 10. Fazit

### Warum diese Architektur sinnvoll ist

Die Extraktion der Kommentator-Funktionalität in eine eigenständige App war der richtige Schritt aus mehreren Gründen:

**Wartbarkeit**: Eine App mit ~15 Dateien und klarem Zweck ist deutlich einfacher zu verstehen und zu warten als ein Modul in einem Monolithen mit Dutzenden von Features. Neue Entwickler können sich in Minuten statt Stunden einarbeiten.

**Performance**: Mit einer leichtgewichtigen SQLite-Datenbank nur für Auth, ohne unnötige Middleware und mit nur den nötigen Abhängigkeiten startet die App in Sekunden und braucht minimal Ressourcen (512 MB RAM).

**Zuverlässigkeit**: Die Push-basierte Architektur (Event-driven) sorgt dafür, dass Daten sofort beim Kommentator ankommen. Das Produktionsfenster hält die Verbindung während des gesamten Spiels stabil offen, um Reconnects und die damit verbundenen Inkonsistenzen zu vermeiden. Mehrere Schutzmechanismen (Quarter-Schutz, Stats-Readiness, HistoryIncomplete-Flag) stellen sicher, dass nur verlässliche Daten angezeigt werden.

**Unabhängigkeit**: Änderungen an der Kommentator-App beeinflussen das Spieltag-Projekt nicht — und umgekehrt. Beide können unabhängig deployed werden.

**Korrektheit**: 16+ formale Korrektheitseigenschaften für die Echtzeit-Datenverarbeitung plus 17 weitere Properties für das Auth-System, überprüft durch Property-Based Tests mit Hunderten von Testfällen, geben Vertrauen, dass die Datenverarbeitung korrekt funktioniert — vom Event-Mapping über die Score-Berechnung bis zur Passwort-Sicherheit und Zugriffskontrolle.

**Kosten**: Die App läuft auf der kleinsten ECS-Fargate-Konfiguration (~$22/Monat wenn aktiv, $0 wenn gestoppt). Kein Load Balancer, keine Datenbank, keine versteckten Kosten.
