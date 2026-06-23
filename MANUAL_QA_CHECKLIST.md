# BuildSphere Real Environment Manual QA Checklist

Use this checklist only on a real emulator/device or installed development build pointed at the live backend.

Backend URL: `https://buildsphere-mobile-server.onrender.com`

Status values: `PASS`, `FAIL`, `PARTIAL`, `NOT TESTED`, `BLOCKED`.

Do not mark `PASS` unless the behavior was actually tested with the listed account.

## Role Test Accounts Needed

| Role | Account used | Required setup | Status | Notes |
| --- | --- | --- | --- | --- |
| CEO/COO |  | Can see multiple/all active projects | NOT TESTED |  |
| Project Engineer |  | Assigned to at least one project with phases/milestones | NOT TESTED |  |
| Project Coordinator |  | Assigned to at least one project with phases/milestones | NOT TESTED |  |
| Foreman / Project Supervisor |  | Assigned to at least one project and one task | NOT TESTED |  |
| Accounting |  | Has view/audit access data | NOT TESTED |  |
| Procurement |  | Has inventory-enabled project data | NOT TESTED |  |
| Sales |  | Has restricted mobile permissions | NOT TESTED |  |
| Human Resource |  | Can open own profile and HR-allowed views | NOT TESTED |  |
| Staff |  | Assigned to at least one task | NOT TESTED |  |

## Role Matrix

For each row, verify: login account used, Home loads, visible projects correct, Project Details opens, progress displays correctly, tasks visible, Add Task visible/hidden correctly, Task Details works, Inventory access correct, Site Progress/AI access correct, Notifications work, Profile/More works, unauthorized actions hidden or blocked.

| Role | Account used | Result | Notes / bug found |
| --- | --- | --- | --- |
| CEO/COO |  | NOT TESTED |  |
| Project Engineer |  | NOT TESTED |  |
| Project Coordinator |  | NOT TESTED |  |
| Foreman / Project Supervisor |  | NOT TESTED |  |
| Accounting |  | NOT TESTED |  |
| Procurement |  | NOT TESTED |  |
| Sales |  | NOT TESTED |  |
| Human Resource |  | NOT TESTED |  |
| Staff |  | NOT TESTED |  |

## Module QA

| Area | What to test | Expected result | Status | Notes |
| --- | --- | --- | --- | --- |
| Live backend | Open `/health` from device browser | Returns BuildSphere API `ok` response | NOT TESTED |  |
| Auth headers | Load protected modules after login | Requests succeed only with logged-in session | NOT TESTED |  |
| Role/RBAC | Try unauthorized screens/actions per role | Hidden in UI or blocked by backend 401/403 | NOT TESTED |  |
| Push permissions | First login on physical/development build | Permission prompt appears and token generation logs yes/no | NOT TESTED |  |
| Push token save | Login and logout | `user_push_tokens` belongs to logged-in user; unregister path works | NOT TESTED |  |
| Foreground notification | Trigger notification while app open | Notification received and list/badge can refresh | NOT TESTED |  |
| Background/tap routing | Trigger notification while backgrounded | Tap routes to task/project/inventory/site progress safely | NOT TESTED |  |
| Invalid push token | Use existing flow with invalid/expired token if available | Backend deactivates invalid token without failing notification save | NOT TESTED |  |
| Gemini analysis | Upload supported image from Site Progress | Mobile calls backend only; backend calls Gemini; stable result shape | NOT TESTED |  |
| Gemini fallback | Configure/simulate failed key in non-production | Fallback logs show triggered; no API key logged | NOT TESTED |  |
| Gemini failure UX | Force unsupported image/network/API failure | User-safe error and manual count path remain available | NOT TESTED |  |
| Profile photo upload | Upload/change/remove photo | Type/size validation; no broken image; clean error on failure | NOT TESTED |  |
| Site progress upload | Upload 1-5 images and save | Supabase Storage upload succeeds; public URL renders; progress saved | NOT TESTED |  |
| Attachments | Upload task attachments if supported by current screen | Type/size validation and link works | NOT TESTED |  |
| Inventory view | Open inventory by allowed and restricted roles | Allowed roles load items/logs; restricted roles blocked | NOT TESTED |  |
| Inventory consumption | Foreman logs consumption linked to assigned task | Stock changes and log records actor/task; unauthorized users blocked | NOT TESTED |  |
| Task assignment | Create/update assigned task | Notification saved; assignee sees task; unauthorized edit blocked | NOT TESTED |  |
| Add Task phases | Project Engineer creates task | Project -> phase -> milestone -> assignee loads; IDs save correctly | NOT TESTED |  |
| Add Task phases | Project Coordinator creates task | Project -> phase -> milestone -> assignee loads; IDs save correctly | NOT TESTED |  |
| Notifications privacy | Try opening another user's notification | Not visible or blocked by authenticated user filter | NOT TESTED |  |

## Phone Push Notification QA

Expo Go is not enough for final push QA. Use a physical Android phone or a supported installed development/preview build.

| Step | Action | Expected result | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | Install/open development or preview build on physical phone | App opens with backend URL `https://buildsphere-mobile-server.onrender.com` | NOT TESTED |  |
| 2 | Login as test user | Dev log shows logged-in role; no token values printed | NOT TESTED |  |
| 3 | Allow notification permission | Dev log shows permission status/request result | NOT TESTED |  |
| 4 | Confirm ExpoPushToken generation | Dev log says generated yes; no token value printed | NOT TESTED |  |
| 5 | Confirm backend token save | `user_push_tokens` row exists for logged-in user; duplicate old device token is inactive | NOT TESTED |  |
| 6 | Call authenticated `POST /notifications/test` | Clean JSON response; notification record saved | NOT TESTED |  |
| 7 | Keep app foregrounded and trigger test notification | Banner/list behavior appears per OS; dev log shows foreground notification received | NOT TESTED |  |
| 8 | Move app to background and trigger test notification | Phone notification appears in notification tray | NOT TESTED |  |
| 9 | Fully close/kill app and trigger test notification | Phone notification appears if OS/push credentials allow it | NOT TESTED |  |
| 10 | Tap test notification | App opens safely to Notifications screen/fallback; route payload parsed log appears | NOT TESTED |  |
| 11 | Assign task to Foreman | Foreman receives phone push and Notifications tab record | NOT TESTED |  |
| 12 | Tap task assignment push | Opens Task Details or safe fallback if missing/unauthorized | NOT TESTED |  |
| 13 | Update task status | Relevant user receives phone push and task notification record | NOT TESTED |  |
| 14 | Upload site progress | Intended project users receive push; uploader self-notification rules respected | NOT TESTED |  |
| 15 | Trigger low/critical stock | Allowed inventory user receives push; restricted users cannot open Inventory | NOT TESTED |  |
| 16 | Logout and login as a different user on same phone | Token is not assigned to wrong user; old device/user token inactive as expected | NOT TESTED |  |
| 17 | Insert/use invalid Expo token if available | Backend deactivates invalid token and does not log token value | NOT TESTED |  |

### Push Payload Routing Expectations

| Type | Expected payload fields | Expected route | Status |
| --- | --- | --- | --- |
| `task_assigned` | `reference_type=task`, `reference_id`, `project_id`, `task_id` | Task Details | NOT TESTED |
| `task_updated` / task status updated | `reference_type=task`, `reference_id`, `project_id`, `task_id`, `status` | Task Details | NOT TESTED |
| `site_progress_uploaded` | `reference_type=site_progress`, `reference_id`, `project_id`, `site_progress_id`, `task_id` | Task Details progress section / safe fallback | NOT TESTED |
| `glass_analysis_completed` | `reference_type=site_progress`, `reference_id`, `project_id`, `site_progress_id`, `task_id` | Task Details progress section / safe fallback | NOT TESTED |
| `inventory_low_stock` | `reference_type=inventory`, `reference_id`, `project_id`, `inventory_item_id` | Inventory if role allowed | NOT TESTED |
| `project_delay_warning` / `milestone_updated` | `reference_type=project`, `reference_id`, `project_id` | Project Details | NOT TESTED |
| `test_notification` | `reference_type=notifications`, `screen=Notifications` | Notifications screen / safe fallback | NOT TESTED |

### Build Credential Readiness

| Item | Current repo state | Status | Notes |
| --- | --- | --- | --- |
| Android package name | `com.icecandyyy.buildsphere` in `Frontend/app.json` | STATIC CHECKED | Verify it matches EAS/FCM credentials before building |
| EAS projectId | `1c2ed9d9-6d4c-4b8a-9052-af1100d2cf29` in `Frontend/app.json` | STATIC CHECKED | Required by `getExpoPushTokenAsync` |
| `expo-notifications` plugin | Present in `Frontend/app.json` | STATIC CHECKED |  |
| Android notification channel | Created in mobile notification helper | STATIC CHECKED | Uses default channel with high importance |
| FCM/EAS credentials | Must be checked in EAS credentials dashboard/CLI | BLOCKED | Not verifiable from repo without EAS account/device access |
| Frontend credentials | No private push credentials should be committed | STATIC CHECKED | Keep FCM/server credentials out of frontend files |

## Safe QA Debug Logs

Development logs intentionally include only:

- Logged-in user role
- API endpoint, method, response status, and whether auth was attached
- Fallback triggered yes/no
- Project, task, inventory item/log counts
- Inventory permission result
- Push token generated yes/no and saved yes/no
- Notification saved yes/no
- Push token counts, Expo ticket success/error counts, invalid token removal count
- Notification route payload parsed
- Gemini analysis success/fail without keys
- Supabase Storage upload success/fail

Forbidden values that must not appear in logs:

- Supabase access token
- Gemini API keys
- Authorization header
- User passwords
- Private environment values

## QA Report Template

| Field | Value |
| --- | --- |
| Test environment |  |
| Device/emulator used |  |
| Backend URL | `https://buildsphere-mobile-server.onrender.com` |
| Supabase project connected |  |
| Date/time tested |  |
| Role tested |  |
| Account used |  |
| Module tested |  |
| Expected result |  |
| Actual result |  |
| Status | NOT TESTED |
| Bug notes |  |
| Screenshot/video needed | Yes / No |
| Fix owner/status |  |

## Existing Push Test Trigger

The backend already has an authenticated `POST /notifications/test` route. Use it only while logged in with a valid bearer token for the account being tested. It sends a test notification to the authenticated user and does not accept an arbitrary target user.
