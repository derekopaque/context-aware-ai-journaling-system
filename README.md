# Context-Aware AI Journaling System

A context-aware AI journaling system with a React Native Expo frontend and a Python FastAPI backend.

## Project Structure

```text
context-aware-ai-journaling-system/
├── rn-app/          # React Native app built with Expo
├── backend/         # Python FastAPI backend
├── README.md
└── .gitignore
```

## Frontend

```bash
cd rn-app
npm install
npm start
```

The frontend API endpoint is configured in:

```text
rn-app/constants/Config.ts
```

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn api.index:app --reload
```

Create a `.env` file or configure deployment environment variables based on:

```text
backend/.env.example
```

Required environment variables:

```text
DEEPSEEK_API_KEY=
QWEN_API_KEY=
AMAP_KEY=
```

## Deployment Notes

- Do not commit real API keys.
- Do not commit `node_modules`, `.venv`, Expo cache, native build folders, or IDE files.
- For Vercel deployment, set the backend environment variables in the Vercel project settings.
