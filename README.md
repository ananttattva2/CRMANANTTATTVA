# Green CRM

MERN CRM with admin-created users, role assignment, and OTP email login.

## Run Locally

1. Start MongoDB locally.
2. Install dependencies:

```bash
npm run install:all
```

3. Seed the superadmin:

```bash
npm run seed:admin
```

4. Start backend and frontend together:

```bash
npm run dev
```

Or start them in separate terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

Frontend: `http://localhost:4173`
Backend: `http://localhost:4000`

## Login Flow

- No public registration page.
- Admin/superadmin creates users and assigns roles.
- User enters email on login.
- CRM sends OTP to that email.
- User verifies OTP and enters the dashboard.

## Roles

`operation`, `admin`, `superadmin`, `manager`, `compliance`, `sales`

## Internal CRM calls

Incoming Internal Ticket calls are monitored across every authenticated CRM page. STUN is enabled by default. For reliable calls across office firewalls, mobile networks and restrictive NAT, configure a TURN relay in the backend environment:

```text
WEBRTC_TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
WEBRTC_TURN_USERNAME=crm-user
WEBRTC_TURN_CREDENTIAL=replace-with-a-strong-secret
```

The TURN server must allow UDP and TCP relay traffic. Without these variables calls retain STUN fallback, but peer-to-peer media may not connect on restrictive networks.
