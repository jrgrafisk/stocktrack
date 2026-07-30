# Stocktrack

Et undervisningsspil hvor man kan øve sig i at handle amerikanske aktier med
legetøjspenge på rigtige kurser. Bygget oven på Alpacas gratis Paper Trading-API,
som leverer både live kursdata og en virtuel konto (håndterer saldo, ordrer og P/L).

## Opsætning

1. Opret en gratis konto på https://alpaca.markets og gå til **Paper Trading**-dashboardet.
2. Generér et API Key ID + Secret Key.
3. Kopiér `backend/.env.example` til `backend/.env` og indsæt nøglerne.
4. Installér afhængigheder og start serveren:

   ```
   cd backend
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8000
   ```

5. Åbn http://localhost:8000 i browseren.

## Struktur

- `backend/` – FastAPI-app der wrapper Alpacas Paper Trading API (konto, kurser, ordrer)
  og server frontend-filerne.
- `frontend/` – Simpel HTML/CSS/JS-side: søg ticker, se live kurs, køb/sælg, se
  beholdning og handelshistorik.
