# BuildSphere Mobile Project

## Mobile App Setup (Frontend)
1. Navigate to `Frontend` directory.
2. Install dependencies: `npm install`.
3. Check `.env` and ensure `EXPO_PUBLIC_API_URL` is set to your laptop's LAN IP, for example `http://192.168.0.199:3001`.
4. Gemini panel counting is handled by the backend. Do not put Gemini keys in `Frontend/.env`.
5. Run: `npx expo start -c`.
6. Push notifications:
   - Remote push notifications do not fully work in Expo Go on Android SDK 53+.
   - For real testing, run `npx eas project:init` and then use a Development Build with `npx expo run:android`.

## Backend Setup (Server)
1. Navigate to `Server` directory.
2. Install dependencies: `npm install`.
3. Set `GEMINI_API_KEY`, `GEMINI_MODEL`, and `AI_ANALYSIS_MODE` in `Server/.env`.
4. Run: `npm start`.
5. The server listens on `0.0.0.0:3001` so it is accessible over the network.

## AI Panel Counting
The mobile app uses Gemini directly for glass panel counting. No separate Python detection service is required for this flow.

## Network Troubleshooting
- Same WiFi: your phone and laptop must be on the same WiFi network.
- Firewall: allow incoming connections on port `3001` for the backend.
- IP address: use your laptop's LAN IP from `ipconfig`, not `localhost` or `127.0.0.1`.
