# Context-Aware AI Journaling System

This repository contains the implementation of the Final Year Project **“Context-Aware AI Journaling and Reflection”**.

The system is a context-aware AI journaling prototype designed to support personal reflection while preserving users’ sense of control, ownership, and authorship. It uses a three-layer workflow: events are first captured from contextual data, then transformed into editable memory clips, and finally combined into a diary draft that users can review and revise.

The project includes a React Native Expo frontend and a Python FastAPI backend.

## Project Structure

```text
context-aware-ai-journaling/
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

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn api.index:app --reload
```

## Required Environment Variables

Create a `.env` file or configure deployment environment variables with the following keys:

```text
DEEPSEEK_API_KEY=
QWEN_API_KEY=
AMAP_KEY=
```

## Notes

- API credentials are not included.


## Thesis Context

This project was developed as part of a Final Year Project in Human-Computer Interaction (HCI), focusing on AI-assisted journaling, reflection, and human-AI co-creation.
