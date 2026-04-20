# Deployment — Kommentator Socket App

Eigenständige Deployment-Anleitung für die Kommentator Socket App auf AWS ECS Fargate.

Die App nutzt dieselbe AWS-Infrastruktur wie das Spieltag-Projekt (siehe `docs/aws-deployment.md` im Root).

## Live-URL

**http://\<PUBLIC_IP\>:3001** (IP ändert sich bei jedem Neustart, siehe "IP herausfinden")

---

## 1. Voraussetzungen

- Docker Desktop installiert
- AWS CLI konfiguriert mit Profil `deployer` (IAM User `kirodeploy`)
- Zugriff auf AWS Account `364301299051` (Region `eu-central-1`)

---

## 2. Umgebungsvariablen

| Variable | Required | Default | Beschreibung |
|----------|----------|---------|-------------|
| `BBL_SOCKET_API_KEY` | **ja** | — | BBL Scoreboard API Key |
| `PLANNING_DESK_API_KEY` | **ja** | — | Planning Desk API Key |
| `PORT` | nein | `3001` | Server-Port |
| `BBL_SOCKET_URL` | nein | `https://api.bbl.scb.world` | BBL Socket.IO API URL |
| `PLANNING_DESK_API_URL` | nein | `https://api.desk.dyn.sport/planning/api` | Planning Desk REST API URL |

Umgebungsvariablen werden in der ECS Task Definition konfiguriert. Änderungen erfordern eine neue Task Definition Revision und ein Re-Deployment.

---

## 3. Docker Image bauen und deployen

Alle Befehle aus dem `kommentator-app/`-Verzeichnis ausführen:

```bash
# 1. Docker Image bauen (für AWS Linux/amd64)
docker build --platform linux/amd64 -t kommentator-app:latest .

# 2. Bei ECR einloggen
aws ecr get-login-password --profile deployer | \
  docker login --username AWS --password-stdin \
  364301299051.dkr.ecr.eu-central-1.amazonaws.com

# 3. Image taggen und pushen
docker tag kommentator-app:latest \
  364301299051.dkr.ecr.eu-central-1.amazonaws.com/bbl-kommentator:latest

docker push \
  364301299051.dkr.ecr.eu-central-1.amazonaws.com/bbl-kommentator:latest

# 4. ECS Service neu deployen (startet neuen Container mit neuem Image)
aws ecs update-service \
  --cluster bbl-kommentator \
  --service bbl-kommentator-svc \
  --force-new-deployment \
  --profile deployer
```

Nach dem Deployment bekommt der neue Task eine neue IP (siehe "IP herausfinden").

---

## 4. App starten und stoppen

### App starten

```bash
aws ecs update-service \
  --cluster bbl-kommentator \
  --service bbl-kommentator-svc \
  --desired-count 1 \
  --profile deployer
```

Nach ca. 30–60 Sekunden ist die App erreichbar.

### App stoppen (Kosten sparen)

```bash
aws ecs update-service \
  --cluster bbl-kommentator \
  --service bbl-kommentator-svc \
  --desired-count 0 \
  --profile deployer
```

### Status prüfen

```bash
aws ecs describe-services \
  --cluster bbl-kommentator \
  --services bbl-kommentator-svc \
  --query 'services[0].{running:runningCount,desired:desiredCount}' \
  --profile deployer
```

`running: 1, desired: 1` = App läuft. `running: 0, desired: 0` = App gestoppt.

---

## 5. IP herausfinden (nach jedem Start)

Die öffentliche IP ändert sich bei jedem Neustart:

```bash
TASK=$(aws ecs list-tasks --cluster bbl-kommentator --query 'taskArns[0]' --output text --profile deployer) && \
ENI=$(aws ecs describe-tasks --cluster bbl-kommentator --tasks $TASK --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value|[0]' --output text --profile deployer) && \
aws ec2 describe-network-interfaces --network-interface-ids $ENI --query 'NetworkInterfaces[0].Association.PublicIp' --output text --profile deployer
```

Die App ist dann erreichbar unter: `http://<IP>:3001`

---

## 6. Logs anschauen

```bash
# Letzte Logs der letzten Stunde
aws logs tail /ecs/bbl-kommentator --since 1h --profile deployer

# Live-Logs streamen
aws logs tail /ecs/bbl-kommentator --follow --profile deployer
```

Oder in der AWS Console: CloudWatch → Log Groups → `/ecs/bbl-kommentator`.

---

## 7. AWS-Ressourcen-Referenz

| Ressource | Name / ID |
|-----------|-----------|
| ECR Repository | `bbl-kommentator` |
| ECS Cluster | `bbl-kommentator` |
| ECS Service | `bbl-kommentator-svc` |
| Task Definition | `bbl-kommentator` (512 CPU / 1024 MB) |
| Security Group | `sg-0dcc1c0b6ecc8dfb8` (Port 3001 offen) |
| CloudWatch Log Group | `/ecs/bbl-kommentator` |
| IAM Execution Role | `ecsTaskExecutionRole` |
| IAM Deploy User | `kirodeploy` (Profil: `deployer`) |
| AWS Region | `eu-central-1` (Frankfurt) |
| AWS Account | `364301299051` |
| Container Port | `3001` |

Vollständige Infrastruktur-Dokumentation: `docs/aws-deployment.md` im Projekt-Root.
