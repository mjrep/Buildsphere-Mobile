# BuildSphere Mobile Project

BuildSphere uses Gemini-only image analysis through the Express backend. The mobile app sends images to the backend, and the backend owns all AI provider calls.

## Mobile App Setup (Frontend)
1. Navigate to `Frontend` directory.
2. Install dependencies: `npm install`.
3. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to your laptop's LAN IP, for example `http://192.168.0.199:3001`.
4. Keep `Frontend/.env` public-only. Do not put Gemini keys or Supabase service-role keys in the mobile app.
5. Run: `npx expo start -c`.
6. Push notifications:
   - Remote push notifications do not fully work in Expo Go on Android SDK 53+.
   - For real testing, run `npx eas project:init` and then use a Development Build with `npx expo run:android`.

## Backend Setup (Server)
1. Navigate to `Server` directory.
2. Install dependencies: `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3-flash-preview`, and `AI_ANALYSIS_MODE=gemini_only` in `Server/.env`.
5. Keep `SUPABASE_SERVICE_ROLE_KEY` backend-only in `Server/.env`.
6. Apply the SQL files in `Server/migrations` to the database before starting the app.
7. Run: `npm start`.
8. The server listens on `0.0.0.0:3001` so it is accessible over the network.

## AI Panel Counting
The active flow is:

Mobile uploads image -> Express backend receives image -> backend calls Gemini -> backend normalizes JSON -> mobile shows AI Summary and Verified Panel Count.

The mobile app does not call Gemini directly. The Gemini API key belongs only in `Server/.env`.

The AI count is a suggestion. Verified Panel Count is the final saved value used in progress history.

## Password Recovery
Forgot Password uses a 6-digit OTP sent by the Express backend through Gmail SMTP. The user enters the OTP in the app, then creates a new password without opening an email link.

Set these in `Server/.env`:

- `GMAIL_USER`: the Gmail address that sends OTP emails.
- `GMAIL_APP_PASSWORD`: a Gmail app password, not the normal Gmail account password.
- `EMAIL_FROM`: optional sender address; defaults to `GMAIL_USER`.
- `SUPABASE_SERVICE_ROLE_KEY`: backend-only key used to update the Supabase Auth password after OTP verification.

Keep `SUPABASE_SERVICE_ROLE_KEY` out of the frontend. The mobile app should only use the public Supabase anon key.

## Network Troubleshooting
- Same WiFi: your phone and laptop must be on the same WiFi network.
- Firewall: allow incoming connections on port `3001` for the backend.
- IP address: use your laptop's LAN IP from `ipconfig`, not `localhost` or `127.0.0.1`.
