<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/3794cb7d-dc50-4741-ad8d-d5036386f64a

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy (Render, free tier)

- Build command: `npm install && npm run build`
- Start command: `NODE_ENV=production npm start`
- Environment variables: `GEMINI_API_KEY`, `CARTESIA_API_KEY`

Never commit `.env`. Copy `.env.example` to `.env` for local use.
