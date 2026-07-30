# Sådan kommer du i gang med Stocktrack

En guide til dig der skal hjælpe med at udvikle videre på projektet.

## 1. Opret en Codeberg-konto

Gå til https://codeberg.org og opret en gratis konto, hvis du ikke har en.

## 2. Generér en SSH-nøgle

SSH-nøglen bruges til at bevise overfor Codeberg (og evt. serveren), at det er dig.

**Windows (PowerShell):**
```
ssh-keygen -t ed25519 -C "din-email@example.com"
```
Tryk Enter til alle spørgsmål (standardplacering, ingen adgangskode er fint til at starte med).

**Mac/Linux:** samme kommando i Terminal.

## 3. Læg nøglen ind på Codeberg

Vis din offentlige nøgle:
```
cat ~/.ssh/id_ed25519.pub
```
Kopiér hele linjen. Gå til Codeberg → **Settings → SSH/GPG Keys → Add Key**, og indsæt den.

## 4. Bed om adgang til repoet

Send dit Codeberg-brugernavn videre, så du kan blive tilføjet som collaborator på
`jrsolutions/stocktrack`.

## 5. Klon projektet

```
git clone ssh://git@codeberg.org/jrsolutions/stocktrack.git
cd stocktrack
```

## 6. Installer Python

Du skal bruge Python 3.12 eller nyere: https://python.org/downloads

## 7. Sæt projektet op lokalt

```
cd backend
python -m venv .venv
```
Aktivér virtuelt miljø:
- Windows: `.venv\Scripts\activate`
- Mac/Linux: `source .venv/bin/activate`

Installér afhængigheder:
```
pip install -r requirements.txt
```

## 8. Alpaca API-nøgler

Kopiér `backend/.env.example` til `backend/.env`. Du skal bruge et **Alpaca Paper Trading**
API-nøglepar. Enten:
- opret din egen gratis konto på https://alpaca.markets og lav dine egne paper-nøgler
  (anbefalet til lokal udvikling), eller
- få de delte nøgler tilsendt et sikkert sted (ikke via Codeberg eller chat i klartekst).

## 9. Start serveren

```
uvicorn main:app --reload --port 8000
```
Åbn http://localhost:8000 i browseren.

## 10. Arbejd videre med Claude Code

Har du ikke Claude Code installeret: https://claude.com/claude-code

Åbn en terminal i `stocktrack`-mappen og kør:
```
claude
```

## Normal arbejdsgang

```
git pull            # hent seneste ændringer før du starter
# ... lav ændringer ...
git add <filer>
git commit -m "besked der forklarer hvorfor"
git push
```
