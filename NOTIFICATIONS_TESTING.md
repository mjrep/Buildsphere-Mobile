# BuildSphere Push Notifications Testing

This checklist verifies the Expo mobile push flow and backend delivery/history flow.

## Prerequisites

- Physical Android or iOS device (Expo push token is not available on emulator/simulator).
- Backend running from `Server`:
  - `SUPABASE_URL` is set
  - `SUPABASE_SERVICE_ROLE_KEY` is set
- Mobile app running from `Frontend` with reachable backend `API_URL`.

## 1) Verify device permission + Expo token

1. Log in on a physical device.
2. Confirm system notification permission prompt appears.
3. Allow notifications.
4. In backend logs, confirm a successful call to:
   - `POST /api/notifications/register-token`

Expected:
- Frontend calls `registerForPushNotificationsAsync()`.
- Token is generated (format like `ExponentPushToken[...]`).
- `device_type` is sent as:
  - `"android"` on Android
  - `"ios"` on iOS

## 2) Verify token registration endpoint

Request:

```http
POST /api/notifications/register-token
Content-Type: application/json

{
  "user_id": 1,
  "expo_push_token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "device_type": "android"
}
```

Expected:
- `200` with `{ "success": true }`
- Row inserted or upserted in `user_push_tokens`
- Duplicate token for same user does not create duplicate rows

## 3) Verify test push endpoint

Request:

```http
POST /api/notifications/test
Content-Type: application/json

{
  "user_id": 1
}
```

Expected:
- `200` with `{ success: true, result: { sent, invalid } }`
- Push notification appears on device
- A record is inserted into `notifications`

## 4) Verify Supabase tables

Run:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('user_push_tokens', 'notifications');
```

Expected:
- Both tables exist.

Optional column check:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('user_push_tokens', 'notifications')
ORDER BY table_name, ordinal_position;
```

## 5) Verify notification history persistence

Run:

```sql
SELECT id, user_id, title, COALESCE(body, message) AS message_text, type, created_at
FROM notifications
ORDER BY created_at DESC
LIMIT 20;
```

Expected:
- New rows appear for test and real triggers.

## 6) Verify trigger scenarios

Use real app actions and confirm push + DB history for affected users:

1. Task assigned -> "New Task Assigned"
2. Task status updated -> "Task Status Updated"
3. Site progress uploaded -> "New Site Progress Update"
4. Glass AI completed -> "Glass Panel Analysis Complete"
5. Project delay/risk update -> "Project Delay Warning"

Expected anti-spam behavior:
- Actor is skipped where implemented (e.g., uploader/assignee self-notify avoidance).
- Only users related to project/task receive pushes.

## 7) Verify notification tap handling

Send payloads that include routing data:

```json
{
  "type": "task_assigned",
  "screen": "TaskDetails",
  "task_id": "123",
  "project_id": "456"
}
```

Expected:
- Tap opens corresponding in-app context when route data is available.
- Unknown/missing route data safely falls back to Notifications tab.

## Known practical limits

- Full end-to-end push delivery cannot be validated on emulators/simulators.
- Requires live backend, valid Expo project config, and internet connectivity.
