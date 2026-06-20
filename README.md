# BuildSphere Mobile Project

BuildSphere uses Gemini-only image analysis through the Express backend. The mobile app sends images to the backend, and the backend owns all AI provider calls.

## Mobile App Setup (Frontend)
1. Navigate to `Frontend` directory.
2. Install dependencies: `npm install`.
3. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL`.
   - Default backend: `https://buildsphere-mobile-server.onrender.com`.
   - Public APKs must use the deployed HTTPS backend URL.
4. Keep `Frontend/.env` public-only. Do not put Gemini keys or Supabase service-role keys in the mobile app.
5. Run: `npm run start:go`.
6. Push notifications:
   - Remote push notifications can be limited in Expo Go depending on platform and SDK behavior.
   - For full native push testing, use a production/preview native build after the Expo Go flow is working.

## iOS Expo Testing
For iPhone development with Expo Go:

1. From `Frontend`, run `npm run start:go`.
2. Open the Expo Go app on the iPhone and use Expo Go's scanner. If the iPhone Camera says `No usable data found`, open Expo Go first and scan from there.
3. If LAN mode does not load, run `npm run start:tunnel`.
4. For LAN mode, keep the iPhone and laptop on the same WiFi and allow Node/Metro through the firewall.
5. Keep `EXPO_PUBLIC_API_URL=https://buildsphere-mobile-server.onrender.com` unless you are intentionally testing a different deployed HTTPS backend.

This project is configured for Expo Go during normal development. If Expo ever shows a development-build QR, stop the server and run `npm run start:go`.

For an iOS development build on a physical iPhone:

```sh
npx expo install expo-dev-client
npx eas build --profile development --platform ios
```

Installing an iOS development build on a physical iPhone requires an Apple Developer account/team. On Windows, use EAS Build for physical iPhones; `npx expo run:ios` requires macOS with Xcode.

## Backend Setup (Server)
1. Navigate to `Server` directory.
2. Install dependencies: `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3-flash-preview`, and `AI_ANALYSIS_MODE=gemini_only` in `Server/.env`.
5. Keep `SUPABASE_SERVICE_ROLE_KEY` backend-only in `Server/.env`.
6. Apply the SQL files in `Server/migrations` to the database before starting the app.
7. Run: `npm start`.
8. The server listens on `0.0.0.0:5000` by default, or `process.env.PORT` when deployed.

## Backend Deployment
The deployed architecture is:

Mobile APK -> Public HTTPS Express Backend -> Supabase

Current Render backend URL: `https://buildsphere-mobile-server.onrender.com`

Required backend environment variables:

- `NODE_ENV=production`
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` if used
- `GEMINI_API_KEY`
- `GEMINI_MODEL=gemini-3-flash-preview`
- `AI_ANALYSIS_MODE=gemini_only`
- `JWT_SECRET`
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `EMAIL_FROM`
- `CORS_ORIGINS` for deployed browser clients, comma-separated

Never put `SUPABASE_SERVICE_ROLE_KEY` or `GEMINI_API_KEY` in the mobile app. The mobile app should only use public `EXPO_PUBLIC_*` values.

Render settings:

- Root Directory: `Server`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Add the backend environment variables in Render.

Railway settings:

- Deploy from GitHub.
- Service root: `Server`
- Start command: `npm start`
- Add the backend environment variables in the Variables tab.

After deployment, open `https://buildsphere-mobile-server.onrender.com/health` on a phone browser and confirm it returns `{"status":"ok","service":"BuildSphere API",...}`.

## Public APK Setup
An APK can only be used from anywhere if the backend is also available from anywhere. Do not build a public APK with a local or temporary tunnel API URL.

1. Deploy `Server` to a public host such as Render, Railway, Fly.io, or a VPS.
2. Set the backend environment variables from `Server/.env.example` on the host. Keep `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, and `GEMINI_API_KEY` on the backend only.
3. Confirm the public backend is live by opening its root URL in a browser. It should show `BuildSphere API is running`.
4. In `Frontend/.env.production`, set `EXPO_PUBLIC_API_URL=https://buildsphere-mobile-server.onrender.com`, `EXPO_PUBLIC_SUPABASE_URL=https://gadhovevmzmzesiqgubb.supabase.co`, and `EXPO_PUBLIC_SUPABASE_ANON_KEY` to the public Supabase anon key.
5. Rebuild the APK after every mobile env change with `eas build -p android --profile preview` or a local release build.
6. Upload the new APK to Google Drive or another public file host and share that APK link.

APK verification checklist:

- Open deployed backend `/health` on a phone browser.
- Install the rebuilt APK.
- Log in and confirm the profile loads through `/users/by-email/:email`.
- Confirm Home, tasks, inventory, notifications, forgot password OTP, site progress upload, and Gemini image analysis work.

This repository includes `render.yaml` and `Server/Dockerfile` to make the backend easier to deploy.

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
- Confirm the Render backend health check opens on the phone: `https://buildsphere-mobile-server.onrender.com/health`.
- Rebuild the APK after changing any `EXPO_PUBLIC_*` variable.
- Keep Gemini and Supabase service-role keys backend-only.
