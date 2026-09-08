# PRD — Self-Hosted SMS Gateway (Android Phone as Cellular Modem)

**Status:** Draft for review
**Owner:** Platform / Backend
**Date:** 2026-09-07
**Version:** 1.0

---

## 1. Problem Statement

We need to send and receive SMS (primarily OTP / verification codes, but also
transactional notifications) from a self-hosted service without paying a
third-party SMS aggregator (Twilio, Vonage, etc.) and without buying a
dedicated GSM/LTE modem upfront.

The cheapest, fastest path to a working prototype is to reuse an **Android
phone we already own** as the cellular radio. The phone holds a SIM, is
connected to our network, and exposes a small HTTP API that our backend calls
to send messages.

This document specifies that service: the gateway, the phone-side component,
the backend API, and the OTP flow it enables.

---

## 2. Goals

- Send an SMS from our backend to any recipient number via a real SIM.
- Receive inbound SMS (for two-way flows, delivery receipts, and "reply STOP"
  handling) and surface them to the backend.
- Expose a single, stable HTTP API to the rest of the platform so the
  transport (Android phone today, dedicated modem later) is swappable.
- Keep the phone-side footprint minimal and reliable (no manual tapping).
- Support OTP generation, hashing, and verification as a first-class flow.

## 3. Non-Goals

- **Not** a full two-way messaging product (no threads, no media, no MMS).
- **Not** a replacement for a production aggregator at scale — carrier rate
  limits and a single SIM cap throughput.
- **Not** iOS support (iOS forbids programmatic SMS; see §11).
- **Not** a public multi-tenant SMS API.

---

## 4. Architecture

### 4.1 High-level flow

```
+-------------+      +----------------+      +----------------+
|  Your App   | ---> |  Backend (API) | ---> |  SMS Gateway   |
|  (client)   |      |  FastAPI/Node  |      |  (this service)|
+-------------+      +----------------+      +-------+--------+
                                                     |
                                                     | HTTP (LAN)
                                                     v
                                            +----------------+
                                            |  Android Phone  |
                                            |  (gateway app)  |
                                            +-------+--------+
                                                    | SIM
                                                    v
                                            +----------------+
                                            | Cellular Network|
                                            +-------+--------+
                                                    v
                                            +----------------+
                                            |  Recipient     |
                                            +----------------+
```

### 4.2 Component responsibilities

| Component | Responsibility |
|---|---|
| **Backend API** | OTP generation + hashing, rate limiting, verification, persistence, and the outbound "send" call to the gateway. |
| **SMS Gateway service** | Thin adapter that normalizes the phone's HTTP API into a stable internal interface (`send`, `receive`, `status`). |
| **Android phone** | Runs a gateway app that owns the SIM and exposes `POST /send` + a webhook/queue for inbound SMS. |
| **SIM / carrier** | The actual radio + number. |

---

## 5. Transport Options (and the recommendation)

There are three ways to drive the phone. We recommend **Option A** for the
prototype and **Option C** for production.

### Option A — HTTP gateway app (RECOMMENDED, "faster method")

Install an SMS-gateway app on the phone (e.g. **SMS Gateway for Android** by
Capcom, or **SMS Gateway** by Medha). The app exposes a local HTTP server:

```
POST http://<phone-ip>:8080/send
  { "to": "+1347...", "message": "Your code is 483921" }
```

- No USB cable, no ADB, no tethering.
- Works over Wi-Fi/Ethernet; the phone can sit anywhere on the LAN.
- Simple REST contract; the backend just does an HTTP POST.
- **Downside:** depends on a third-party app's reliability and its API quirks.

### Option B — USB debugging (ADB)

Connect the phone via USB and drive it with `adb`:

```
adb shell am start -a android.intent.action.SENDTO \
  -d sms:<number> --es sms_body "<message>"
```

- No extra app install (uses the stock messaging intent).
- **Downsides:** requires USB cable + `adb` on the host; the stock SMS app may
  pop a confirmation dialog (breaks automation); fragile across Android
  versions; slow per-message. **Not recommended** for anything beyond a
  one-off smoke test.

### Option C — Dedicated USB GSM/LTE modem (production)

A USB 4G/LTE modem (e.g. SIMCom / Quectel) driven by **Gammu** or **JasminSMS**
on the Linux host.

- Cleanest, most reliable, no phone to babysit.
- **Downside:** costs money and needs a separate SIM/data plan.

### Decision

| Phase | Transport |
|---|---|
| Prototype / dev | **Option A** (HTTP gateway app on Android) |
| Production | **Option C** (dedicated modem + Gammu) |

The gateway service is written against a **transport interface** so switching
A → C is a config change, not a rewrite.

---

## 6. Functional Requirements

### 6.1 Gateway service (backend)

- **FR-1** Expose `POST /v1/sms/send` accepting `{ to, message, sender? }`.
- **FR-2** Normalize phone numbers to E.164 (`+1...`) before sending.
- **FR-3** Route the send to the configured transport (Android HTTP app now,
  Gammu later) behind a `Transport` interface.
- **FR-4** Return a stable result: `{ id, status, providerMessageId? }`.
- **FR-5** Accept inbound SMS via a webhook from the phone app and store them.
- **FR-6** Persist every message (outbound + inbound) with status and timestamps.
- **FR-7** Retry transient failures with exponential backoff (max 3 attempts).
- **FR-8** Enforce per-number and global rate limits (see §8).

### 6.2 OTP flow

- **FR-9** `POST /v1/otp/request` → generate a 6-digit code, hash it, store with
  TTL, and send it via the gateway.
- **FR-10** `POST /v1/otp/verify` → compare against the stored hash, enforce
  attempt limits and expiry, return success/failure.
- **FR-11** Codes are single-use and expire after N minutes (default 5).
- **FR-12** Store only the **hash** of the code (never plaintext) — see §9.

### 6.3 Phone-side app

- **FR-13** Expose `POST /send` on the LAN (configurable port, default 8080).
- **FR-14** Forward inbound SMS to a configurable webhook URL on the backend.
- **FR-15** Survive app restarts; auto-start on boot (Android "boot completed"
  receiver) so the gateway is always up.
- **FR-16** Keep the screen awake / exempt from battery optimization so the
  process isn't killed.

---

## 7. API Contract (draft)

### Send

```
POST /v1/sms/send
Content-Type: application/json

{
  "to": "+13475550123",
  "message": "Your verification code is 483921",
  "sender": "+15165550123"        // optional; defaults to the SIM number
}

200 OK
{
  "id": "msg_01H...",
  "status": "queued",
  "providerMessageId": "12345"
}
```

### OTP request / verify

```
POST /v1/otp/request   { "to": "+13475550123" }
POST /v1/otp/verify    { "to": "+13475550123", "code": "483921" }
```

### Inbound webhook (phone → backend)

```
POST /v1/sms/inbound
{ "from": "+13475550123", "message": "STOP", "receivedAt": "..." }
```

---

## 8. Non-Functional Requirements

| Area | Requirement |
|---|---|
| **Reliability** | Gateway must be reachable; phone app auto-restarts on boot. |
| **Rate limits** | Default 1 msg/sec, 60 msg/min per number; configurable. Carriers throttle aggressively — respect it. |
| **Latency** | OTP send → delivery target < 10s on a healthy carrier. |
| **Security** | OTP codes hashed at rest; gateway API bound to LAN only (no public exposure); optional shared-secret auth between backend and phone app. |
| **Observability** | Log every send/receive with status; expose a `/health` endpoint. |
| **Portability** | Transport is an interface; Android app and Gammu are interchangeable. |

---

## 9. Security Considerations

1. **Never expose the phone's HTTP API to the internet.** Bind to LAN only;
   if remote access is needed, tunnel via the backend (never port-forward the
   phone directly).
2. **Hash OTPs at rest** (e.g. HMAC-SHA256 with a server secret, or bcrypt).
   A DB leak must not reveal live codes.
3. **Rate-limit OTP requests** per number to prevent SMS-bombing / cost abuse.
4. **Authenticate the phone↔backend link** with a shared secret or token so a
   rogue device on the LAN can't inject inbound messages.
5. **SIM security:** the SIM is a real phone number. Treat it like a credential;
   monitor for carrier abuse flags.

---

## 10. Data Model (draft)

```
sms_message
  id            uuid pk
  direction     enum('outbound','inbound')
  to_number     text          -- E.164
  from_number   text          -- E.164
  body          text
  status        enum('queued','sent','delivered','failed','received')
  provider_id   text          -- phone app / gammu message id
  created_at    timestamptz
  updated_at    timestamptz

otp_code
  id            uuid pk
  to_number     text
  code_hash     text          -- never plaintext
  expires_at    timestamptz
  attempts      int
  consumed      bool
  created_at    timestamptz
```

---

## 11. Why Not iPhone

iOS does not allow third-party apps to send arbitrary SMS programmatically.
An iPhone can only send via the user manually tapping the Messages app, or via
Apple's own (paid, restricted) APIs. **Android is required** for a self-hosted
gateway. If the only available device is an iPhone, the practical options are
a dedicated GSM modem or a paid aggregator.

---

## 12. Milestones

| # | Milestone | Deliverable |
|---|---|---|
| M1 | Phone gateway up | Android app installed, `POST /send` works from a laptop on the LAN. |
| M2 | Backend adapter | `Transport` interface + Android HTTP transport; `POST /v1/sms/send` end-to-end. |
| M3 | OTP flow | Request/verify endpoints, hashing, TTL, rate limits. |
| M4 | Inbound + receipts | Webhook for inbound SMS; delivery status tracking. |
| M5 | Hardening | Auto-start, battery exemption, auth, observability, docs. |
| M6 | (Optional) Modem swap | Gammu transport behind the same interface. |

---

## 13. Open Questions

1. Which Android device + Android version will be the gateway? (Determines
   which gateway app is compatible.)
2. Is the phone on the same LAN as the backend, or remote? (Determines whether
   we need a tunnel.)
3. Expected volume — dozens, hundreds, or thousands of SMS/day? (Determines
   whether a single SIM is sufficient or we need the modem path sooner.)
4. Do we need inbound SMS at all, or is this outbound-only OTP?

---

## 14. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Carrier rate-limits / flags the SIM as spam | OTPs delayed or blocked | Respect rate limits; warm up the number; monitor delivery. |
| Phone app killed by Android battery optimization | Gateway goes dark | Auto-start + battery exemption + keep-awake. |
| Phone app API changes / abandoned | Breakage | Pin a known-good app version; keep the transport swappable. |
| Single SIM = single point of failure | Outage | Document the modem upgrade path (Option C). |
| LAN exposure of the phone API | Injection / abuse | Bind LAN-only + shared-secret auth. |
