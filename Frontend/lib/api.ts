// Replace this IP with your PC's local WiFi IP address
// Find it by running: ipconfig  (look for IPv4 Address under WiFi)
// Example: 192.168.1.5
// Use the environment variable for the API URL. 
// For physical devices, this MUST be your laptop's LAN IP (e.g., http://192.168.1.5:3001)
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://192.168.0.69:3001';

