# TEDx Bedayia

> Welcome to the main documentation for TEDx at Bedayia School!

**Author**: Aly Mobarak.

---

# Table of Contents

1. [General Notes](#1-general-notes)
2. [Tech Stack](#2-tech-stack)
3. [Architecture Overview](#3-architecture-overview)
4. [eTicket System](#4-eticket-system)
5. [Admin Portal](#5-admin-portal)
6. [Marketing System](#6-marketing-system)
7. [Email System](#7-email-system)
8. [Security](#8-security)
9. [Things to Maintain](#9-things-to-maintain)
10. [For the Future](#10-for-the-future)

---

# 1. General Notes

> You are generally supposed to keep the HTML structure relatively the same, with only changing the styles in the different CSS files scattered around the project and the text to be related to the new theme and event.

> If you'd like to add functionality, you can do so using the [Next.js Documentation](https://nextjs.org/docs/getting-started), adding TypeScript files, etc.

## Quick Start a New Event

1. Edit `app/metadata.tsx` and provide event data — ticket window dates, event date, pricing, contact numbers, early bird deadline, year, etc.
2. Edit `app/payment-methods.tsx` to update payment receiver contacts (Telda username, InstaPay number, VF Cash number, card redirect links, etc.). Payment methods have a structured schema: `displayName`, `identifier`, `to`, `instructions`, `field`, `icon`, and optional `redirectLinks` and `hidden` flag.
3. In the admin dashboard, there will be a shield ✕ button when the event is concluded. Press it to reset the data (after downloading if you would like to keep it for next year's marketing).
4. Create a Design on Figma (for the non-admin areas) with the team that relates to the theme and is aesthetically appealing.
5. After creating a compelling design, update the CSS files found in `app/styles/` and `app/book/` without changing the class names to avoid errors. For adding elements, make sure you correctly set their `className` field to `styles.{yourNewClassName}`.
6. Have fun!!

---

# 2. Tech Stack

| Component      | Technology                                        |
| -------------- | ------------------------------------------------- |
| Framework      | **Next.js 16** (App Router)                       |
| Language       | **TypeScript**                                    |
| Database       | **Neon Postgres** (`@neondatabase/serverless`)    |
| Primary Email  | **Resend** (React Email components, rate-limited) |
| Fallback Email | **Nodemailer** (Gmail OAuth2)                     |
| Payments       | **Manual** (card payments via school website)     |
| Auth           | **JWT** (jsonwebtoken)                            |
| Charts         | **Recharts**                                      |
| Styling        | **Tailwind CSS** + CSS Modules                    |
| Hosting        | **Vercel**                                        |
| QR Codes       | **qrcode** (Node library)                         |
| Webhooks       | **Svix** (Resend webhook verification)            |
| Animations     | **Framer Motion**, **Swiper**                     |

---

# 3. Architecture Overview

## Central Configuration (`app/metadata.tsx`)

All event-specific configuration is centralized here:

- **Pricing**: `INDIVIDUAL_TICKET_PRICE`, `GROUP_TICKET_PRICE`, `TEACHER_TICKET_PRICE`, `DISCOUNTED_TICKET_PRICE`, `INDIVIDUAL_EARLY_PRICE`, `GROUP_EARLY_PRICE`
- **Dates**: `TICKET_WINDOW` (booking open/close), `EARLY_BIRD_UNTIL`, `EVENT_DATE`
- **Contact**: `PHONE`, `VFCASH`, `TELDA`, `IPN`
- **Other**: `YEAR`, `HOST`, `EVENT_DESC`, `SPEAKER_FREE_TICKETS`, `support`, `paymentProcessor`

## Ticket Types (`app/ticket-types.tsx`)

Eight ticket types are supported:

| Type                   | Enum Value              | Notes                                                     |
| ---------------------- | ----------------------- | --------------------------------------------------------- |
| Individual             | `individual`            | Standard single ticket                                    |
| Group                  | `group`                 | 4-person group, linked via `groups` table                 |
| Speaker                | `speaker`               | Free, admin-generated invitations                         |
| Giveaway               | `giveaway`              | Free promotional tickets, generated through the dashboard |
| Discounted (Rush Hour) | `discounted`            | Marketing rush hour codes                                 |
| Teacher                | `teacher`               | Fixed price for teachers                                  |
| Individual Early Bird  | `individual_early_bird` | Early bird pricing                                        |
| Group Early Bird       | `group_early_bird`      | Early bird group pricing                                  |

## Payment Methods (`app/payment-methods.tsx`)

Five payment methods with structured definitions:

| Key      | Display Name         | Notes                                                          |
| -------- | -------------------- | -------------------------------------------------------------- |
| `TLDA`   | Telda                | Requires Telda username                                        |
| `IPN`    | InstaPay             | Requires InstaPay address (IPA)                                |
| `VFCASH` | eWallet              | Requires phone number                                          |
| `CASH`   | School Office (Cash) | No additional field                                            |
| `CARD`   | Credit/Debit Card    | Redirects to Bedayia's Custom Portal (or PayMob in the future) |

Payment method strings are stored as `METHOD@identifier` (e.g., `TLDA@username`, `CASH@email@domain.com`, `CARD@orderId`).

## Price Calculation (`app/api/tickets/prices.tsx`)

The `getPrice(type, receivedAt, method)` function calculates the correct price considering:

- Ticket type
- Early bird deadline (if `receivedAt < EARLY_BIRD_UNTIL`)
- Speaker and giveaway tickets are always free (return `0`)

## Database Tables

| Table        | Purpose                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `attendees`  | Main ticket records (email, name, phone, type, payment_method, paid, uuid, sent, admitted_at, admitted_by, created_at) |
| `groups`     | Links 4 attendees (id1–id4) for group tickets                                                                          |
| `pay_backup` | Payment audit log (stream, incurred, received, received_at)                                                            |
| `rush_hour`  | Marketing rush hour codes (code, attendee_id, processed)                                                               |

P.S. If you ever need to edit the database schema, mention me (@AlyMobarak) on the pull request that uses it or contact me on WhatsApp if you have my number.

---

# 4. eTicket System

## 4.1 Booking a Ticket

1. Attendees fill in their name, email address, phone number, and choose a payment method.
2. **For cash**: An email is sent guiding them to pay at the school office with their Attendee ID.
3. **For Telda/InstaPay/eWallet**: The attendee provides their payment identifier. They are instructed to send the payment and a screenshot to the WhatsApp number.
4. **For card**: The attendee is redirected to Paymob's unified checkout. Payment is processed automatically via webhook callback.
5. **For rush hour codes**: If a valid code is provided and already processed, an eTicket is immediately sent. Otherwise, the ticket waits for payment confirmation.

### Routes

| Route                     | Method | Description                                      |
| ------------------------- | ------ | ------------------------------------------------ |
| `/book/`                  | Page   | Book an individual ticket                        |
| `/book/group/`            | Page   | Book a group ticket (4 people)                   |
| `/book/success/`          | Page   | Post-payment success page                        |
| `/book/failure/`          | Page   | Post-payment failure page                        |
| `/api/tickets/`           | `POST` | Submit an individual ticket booking              |
| `/api/tickets/`           | `GET`  | Get ticket counts (total, paid, actual)          |
| `/api/tickets/group/`     | `POST` | Submit a group ticket booking                    |
| `/api/tickets/prices.tsx` | –      | Price calculation module (imported, not a route) |

### Key Files

| File                                   | Purpose                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `app/book/page.tsx`                    | Individual booking form                                                       |
| `app/book/group/page.tsx`              | Group booking form                                                            |
| `app/payment-methods.tsx`              | Payment method definitions, instructions UI, and field schemas                |
| `app/ticket-types.tsx`                 | Ticket type enum and helper functions                                         |
| `app/api/tickets/route.tsx`            | Individual ticket submission + rush hour code handling                        |
| `app/api/tickets/group/route.tsx`      | Group ticket submission                                                       |
| `app/api/tickets/prices.tsx`           | Centralized price calculation                                                 |
| `app/api/utils/input-sanitization.tsx` | Email verification, misspelling correction, payment method & phone validation |
| `app/api/utils/card-payment.tsx`       | Paymob card payment initiation                                                |
| `public/booked.html`                   | Booking confirmation email template                                           |

### Styling Files

| File                              | Covers                                   |
| --------------------------------- | ---------------------------------------- |
| `app/book/book.module.css`        | Booking form styles (individual & group) |
| `app/book/booking_nav.module.css` | Booking navigation bar                   |

---

## 4.2 Accepting Payments

1. **School Office** has a portal to accept cash payments by entering an attendee's email and the amount received.
2. **Payment handlers** (admins or assigned users with specific payment method access) accept payments from their dashboard. They search by the sender's username/identifier. If multiple unpaid tickets match, the system returns an ambiguity response (HTTP 431) with a list of candidates for the admin to choose from.
3. Upon successful payment acceptance, the system generates a unique UUID, assigns it to the ticket, records the payment in `pay_backup`, and sends an eTicket email with a QR code.
4. **Card payments** are processed automatically via Paymob webhook — no manual acceptance needed.

### Routes

| Route                                      | Method | Description                                                                                 |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------- |
| `/admin/payments/`                         | Page   | Payment acceptance form                                                                     |
| `/api/admin/payment-reciever/{method_id}/` | `GET`  | Accept payment (params: `from`, `amount`, `date`, `email_id`)                               |
| `/api/admin/payment-reciever/cash/`        | –      | Cash-specific payment route                                                                 |
| `/api/admin/payment-reciever/tlda/`        | –      | Telda payment route                                                                         |
| `/api/admin/payment-reciever/ipn/`         | –      | InstaPay payment route                                                                      |
| `/api/admin/payment-reciever/vfcash/`      | –      | eWallet payment route                                                                       |
| `/api/payment_processed/`                  | `POST` | Paymob webhook callback (HMAC SHA-512 verified)                                             |
| `/api/payment_processed/`                  | `GET`  | Client redirect after Paymob payment (success → `/book/success`, failure → `/book/failure`) |
| `/api/qr/?uuid={uuid}`                     | `GET`  | QR code image generator                                                                     |

> **⚠️ SECURITY NOTE**: The `/api/qr/` route is public — do NOT introduce any SQL checks verifying UUID validity, as that would enable brute-force attacks.

### Key Files

| File                                              | Purpose                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `app/api/admin/payment-reciever/main.tsx`         | Core payment processing logic (row-level locking, batch UUID generation, group expansion, ambiguity resolution, email sending) |
| `app/api/admin/payment-reciever/eTicketEmail.tsx` | eTicket email sender (Resend primary + Gmail fallback, rate-limited, background scheduling via `after()`)                      |
| `app/api/utils/card-payment.tsx`                  | Paymob API integration for card payment initiation                                                                             |
| `app/api/payment_processed/route.tsx`             | Paymob webhook handler with HMAC verification                                                                                  |
| `public/eTicket-template.html`                    | Gmail fallback eTicket email template                                                                                          |
| `app/components/TicketEmail.tsx`                  | Primary eTicket as a React Email component (used with Resend)                                                                  |

### Styling Files

| File                                     | Covers                         |
| ---------------------------------------- | ------------------------------ |
| `app/admin/payments/payments.module.css` | Payment acceptance form styles |

---

## 4.3 Admitting into the Event

1. People come in with their unique QR codes in print or on phone.
2. Gate Ushers have access to a separate **Ushers App** (PWA) that scans QR codes and calls the admit API with an `APP_KEY`.
3. The system supports both **full UUID** (36 chars) and **partial UUID** (minimum 8 chars, prefix match) for admission.
4. If the QR code has been already used, isn't paid for, or doesn't exist, the usher receives an error message. The head usher has access to the full admin dashboard for manual investigation.
5. On success, the attendee's name is shown and the usher admits them.
6. **Row-level locking** (`SELECT ... FOR UPDATE`) prevents race conditions from concurrent scans.
7. A **2.5-second grace window** allows the same device to re-scan without triggering a duplicate admission error (prevents iPhone double-scan glitches).
8. The API enforces a **36-hour time window** around the event date — admission is only possible within 36 hours of the event.

### Routes

| Route                        | Method | Description                                 |
| ---------------------------- | ------ | ------------------------------------------- |
| `/api/tickets/admit/{uuid}/` | `GET`  | Admit an attendee (params: `key`, `device`) |

> **Security**: This API can only admit — it cannot de-admit, since ushers shouldn't have that authority.

---

## 4.4 On-Door Ticket Sales

Walk-in attendees can be registered and immediately admitted during the event. This is used by ushers via the Ushers App.

1. **GET**: Returns current ticket price and available payment methods (filtered to exclude CASH, CARD, and VFCASH from the list).
2. **POST**: Creates a new attendee record that is immediately marked as **paid**, **sent**, and **admitted**. Records the payment in `pay_backup`. Uses database transactions for atomicity.
3. The endpoint is only available within a **36-hour window** around the event date.
4. CORS headers are set for the Ushers App.

### Routes

| Route                   | Method | Description                                                                                                                |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `/api/tickets/on-door/` | `GET`  | Get ticket price and payment methods                                                                                       |
| `/api/tickets/on-door/` | `POST` | Register and admit a walk-in attendee (body: `name`, `email`, `phone`, `key`, `device`, `paymentMethod`, `senderUsername`) |

---

# 5. Admin Portal

## 5.1 Authentication & Roles

The admin portal uses **JWT-based authentication** with role-based access control (RBAC).

### User Roles

| Role              | Description                             |
| ----------------- | --------------------------------------- |
| `admin`           | Full access to everything               |
| `marketing_head`  | Analytics + Marketing Dashboard         |
| `payment_handler` | Payment acceptance for assigned methods |
| `school_office`   | Cash payments + ticket querying         |

### Protected Resources

| Resource                 | Accessible By                         |
| ------------------------ | ------------------------------------- |
| `super_admin`            | Admin only                            |
| `ticket_dashboard`       | Admin only                            |
| `analytics`              | Admin, Marketing Head                 |
| `marketing_dashboard`    | Admin, Marketing Head                 |
| `payment_dashboard`      | Admin, Payment Handler, School Office |
| `payment_logs`           | Admin only                            |
| `query_tickets`          | Admin, School Office                  |
| `invitations`            | Admin only                            |
| `manage_account_holders` | Admin only                            |

### Auth Files

| File                     | Purpose                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `app/api/utils/auth.tsx` | JWT signing/verification, RBAC logic (`canUserAccess`), marketing member password generation |
| `app/api/admin/auth/`    | Login/auth API routes                                                                        |

### Auth Routes

| Route            | Description |
| ---------------- | ----------- |
| `/admin/login/`  | Login page  |
| `/admin/logout/` | Logout page |

---

## 5.2 Ticket Dashboard (`/admin/`)

The main admin dashboard displays all tickets with search, filtering, and management capabilities.

### Features

- View all tickets with pagination
- Search by partial UUID or attendee first name
- Copy attendee email
- **Add Ticket** button — manually create tickets (individual or group) with any ticket type, payment method, and optional immediate payment marking
- **Export CSV** — download all tickets as JSON for CSV export
- **Reset Data** — destructive action to clear the database after the event

### Routes

| Route                             | Method | Description                                |
| --------------------------------- | ------ | ------------------------------------------ |
| `/admin/`                         | Page   | Main dashboard                             |
| `/api/admin/tickets/`             | `GET`  | Fetch unpaid ticket emails (for marketing) |
| `/api/admin/tickets/add/`         | `POST` | Create tickets programmatically            |
| `/api/admin/tickets/export/`      | `GET`  | Export all tickets                         |
| `/api/admin/tickets/[index]/`     | –      | Individual ticket operations               |
| `/api/admin/tickets/admit/`       | –      | Admin-side admission                       |
| `/api/admin/tickets/update-type/` | –      | Update ticket type                         |
| `/api/admin/destructive/`         | –      | Destructive database operations (reset)    |
| `/api/admin/query-ticket/`        | –      | Query individual tickets                   |
| `/api/admin/send-ticket/`         | –      | Manually send/resend eTicket               |
| `/api/admin/update-email/`        | –      | Update attendee email                      |
| `/api/admin/check-unsent/`        | –      | Check for unsent tickets                   |

---

## 5.3 Analytics Dashboard (`/admin/analytics/`)

A real-time analytics dashboard for admins and marketing heads.

### Data Provided

- **Sales over time** (daily counts for last 30 days)
- **Revenue by ticket type** (with price mapping)
- **Overall stats** (total bookings, paid, sent, admitted, conversion rate)
- **Payment method distribution**
- **Recent activity** (hourly counts for last 7 days)
- Includes rush hour discounted code counts in all metrics

### Routes

| Route                   | Method | Description                                      |
| ----------------------- | ------ | ------------------------------------------------ |
| `/admin/analytics/`     | Page   | Analytics dashboard with Recharts visualizations |
| `/api/admin/analytics/` | `GET`  | Server-side data aggregation                     |

---

## 5.4 Speaker Tickets (`/admin/speaker-tickets/`)

Generate free invitation tickets for speakers/vendors/etc.

- Creates `N` tickets (default: `SPEAKER_FREE_TICKETS` from metadata) per speaker
- Uses rotating email addresses (`speaker+invitation1@domain.com`, etc.)
- Sends eTickets directly to the speaker's email using the `public/speaker-eticket.html` template

### Routes

| Route                         | Method     | Description                                                                   |
| ----------------------------- | ---------- | ----------------------------------------------------------------------------- |
| `/admin/speaker-tickets/`     | Page       | Speaker ticket generation form                                                |
| `/api/admin/speaker-tickets/` | `GET/POST` | Create and email speaker/vendor tickets (params: `speaker`, `name`, `number`) |

---

## 5.5 Other Admin Features

| Page                               | Description                           |
| ---------------------------------- | ------------------------------------- |
| `/admin/payments/`                 | Payment acceptance form               |
| `/admin/pay-history/`              | Payment history log                   |
| `/admin/manage-account-holders/`   | Manage admin/payment handler accounts |
| `/admin/manage-marketing-members/` | Manage marketing member accounts      |

### Related API Routes

| Route                                  | Description                |
| -------------------------------------- | -------------------------- |
| `/api/admin/payments-history/`         | Fetch payment history      |
| `/api/admin/payments-total/`           | Fetch payment totals       |
| `/api/admin/manage-account-holders/`   | CRUD for account holders   |
| `/api/admin/manage-marketing-members/` | CRUD for marketing members |

---

# 6. Marketing System

The marketing system simplifies rush hour ticket sales. Marketing members can generate discount codes and submit rush hour tickets for people — even if they don't have an email memorized (via random code generation).

### Routes

| Route                      | Description                          |
| -------------------------- | ------------------------------------ |
| `/marketing/`              | Marketing dashboard                  |
| `/marketing/login/`        | Marketing member login               |
| `/marketing/logout/`       | Marketing member logout              |
| `/api/marketing/auth/`     | Marketing authentication             |
| `/api/marketing/gen-code/` | Generate rush hour codes             |
| `/api/marketing/submit/`   | Submit rush hour tickets             |
| `/tutorials/`              | Tutorials page for marketing members |

### Styling

| File                                           | Covers                     |
| ---------------------------------------------- | -------------------------- |
| `app/marketing/marketing-dashboard.module.css` | Marketing dashboard styles |

---

# 7. Email System

The system uses a **dual-provider email architecture**:

### Primary: Resend

- Uses React Email components (`app/components/TicketEmail.tsx`) for eTickets
- Rate-limited at 600ms between sends (~1.67 req/s, safely under Resend's 2 req/s limit)
- Inline QR code attachments via CID for Gmail client compatibility
- Background sending via Vercel's `after()` API (fluid compute)
- Webhook listener at `/api/webhooks/resend/` to handle bounced/failed emails (marks `sent = false`)

### Fallback: Gmail (Nodemailer + OAuth2)

- Automatically used if any Resend emails fail
- Uses HTML templates from `public/` directory
- Uses Gmail OAuth2 authentication

### Booking Confirmations

- Sent via Gmail (Nodemailer) for cash payment tickets, done to save on Resend usage
- Uses `public/booked.html` template
- Handled by `app/api/utils/email-helper.tsx`

### Email Templates

| File                             | Purpose                                                   |
| -------------------------------- | --------------------------------------------------------- |
| `app/components/TicketEmail.tsx` | React Email eTicket component (primary, used with Resend) |
| `public/booked.html`             | Booking confirmation email                                |
| `public/eTicket-template.html`   | Gmail fallback eTicket template                           |
| `public/speaker-eticket.html`    | Speaker invitation eTicket template                       |

---

# 8. Security

### CSRF Protection (`app/api/utils/csrf.tsx`)

- **Strict mode** (`validateCsrf`): Requires valid `Origin` or `Referer` header matching allowed origins. Used on admin endpoints.
- **Lenient mode** (`validateCsrfLenient`): Allows requests without headers (for mobile app compatibility). Used on public-facing booking endpoints.
- Allowed origins: production hostname + www variant, Vercel preview URL, localhost (dev only), plus any `ALLOWED_ORIGINS` env variable.

### Authentication

- JWT tokens with 7-day expiry stored in cookies
- Role-based access control with method-scoped permissions
- Marketing member passwords generated via HMAC-SHA256 deterministic hashing

### Input Sanitization (`app/api/utils/input-sanitization.tsx`)

- Email format validation and common misspelling auto-correction (e.g., `@gamil` → `@gmail`, `@bedaya` → `@bedayia`, `.xom` → `.com`)
- Payment method validation with method-specific rules (Telda: alphanumeric, InstaPay: alphanumeric + `.` `-` `_`, eWallet: phone format)
- Name safety check (alphanumeric + Arabic characters + symbols)
- Phone number validation (minimum 10 digits)

### Database Security

- Row-level locking (`SELECT ... FOR UPDATE`) on admission and payment processing to prevent race conditions
- Database transactions (`sql.transaction()`) for atomicity
- Parameterized SQL queries throughout

### Payment Security

- Paymob HMAC SHA-512 verification on webhook callbacks
- APP_KEY validation on usher endpoints
- 36-hour event time window enforcement on admission and on-door endpoints

---

# 9. Things to Maintain

- **Domain Name**: [tedxbedayia.com](https://tedxbedayia.com) — renew around 31st of December.
- **Database**: Clear after last year's event from admin dashboard.
- **Resend Account**: Ensure the API key and webhook secret are configured.
- **Gmail Account**: OAuth2 credentials must be valid (used as email fallback + booking confirmations + speaker invitations).
- **Paymob Account**: Keep API keys, HMAC secret, and integration IDs updated for card payments (if used).

### Environment Variables

The following are required in `.env` (or Vercel environment configuration, which are already fully configured):

| Variable                                                       | Purpose                                           |
| -------------------------------------------------------------- | ------------------------------------------------- |
| `DATABASE_URL`                                                 | Database connection (managed by Neon)             |
| `JWT_SECRET`                                                   | JWT token signing                                 |
| `APP_KEY`                                                      | Usher app authentication                          |
| `RESEND_API_KEY`                                               | Resend email service                              |
| `RESEND_WEBHOOK_SECRET`                                        | Resend webhook verification (Svix)                |
| `EMAIL`                                                        | Gmail sender address                              |
| `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`                  | Gmail OAuth2                                      |
| `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_HMAC_SECRET` | Paymob card payments                              |
| `PAYMOB_CARD_INT_ID`, `PAYMOB_VFCASH_INT_ID`                   | Paymob integration IDs                            |
| `PAYMOB_BASE_API_URL`, `PAYMOB_BASE_URL`                       | Paymob API endpoints                              |
| `PAYMOB_TEST_MODE`                                             | Set to `"true"` only if PayMob keys are test keys |
| `MARKETING_MEMBER_PASSWORD_GEN`                                | Secret for generating marketing member passwords  |
| `ALLOWED_ORIGINS`                                              | Additional CSRF-allowed origins (comma-separated) |

P.S. If you ever need to add another environment variable or edit the database schema, mention me (@AlyMobarak) on the pull request that uses it or contact me on WhatsApp if you have my number.

---

# 10. For the Future

- [x] ~~Classify Portal into different roles~~ (Implemented: Admin, Marketing Head, Payment Handler, School Office)
- [x] ~~Always use `sql.transaction()` for multiple SQL queries~~ (Implemented on critical paths with row-level locking)
- [ ] Upgrade Account Holders Portal to include Marketing Heads and School Office for easy password regeneration.
- [ ] Add a settings tab to set ticket window, event date, and other important things for the head.
- [ ] Add a way to refresh the Usher App Key each year.
- [ ] Implement JWT Refresh Tokens for All Accounts for better security.
- [ ] Fix spelling error in `payment-reciever` (should be `payment-receiver`).
- [ ] Add audit logging for admin actions.

---

# Appendix: Styling Files

| File                                           | Covers                                          |
| ---------------------------------------------- | ----------------------------------------------- |
| `app/styles/globals.css`                       | Global styles, design tokens                    |
| `app/styles/theme.css`                         | Theme-specific styles                           |
| `app/styles/hero.css`                          | Hero section                                    |
| `app/styles/info.css`                          | Info section                                    |
| `app/styles/navigation.css`                    | Navigation                                      |
| `app/styles/Policy.module.css`                 | Policy pages (privacy, refund, terms, delivery) |
| `app/globals.css`                              | Root CSS                                        |
| `app/book/book.module.css`                     | Booking form                                    |
| `app/book/booking_nav.module.css`              | Booking navigation                              |
| `app/admin/admin.module.css`                   | Admin layout                                    |
| `app/admin/dashboard.module.css`               | Admin dashboard                                 |
| `app/marketing/marketing-dashboard.module.css` | Marketing dashboard                             |

---

# Appendix: Public Routes

| Route                    | Description               |
| ------------------------ | ------------------------- |
| `/`                      | Landing page              |
| `/book/`                 | Individual ticket booking |
| `/book/group/`           | Group ticket booking      |
| `/book/success/`         | Payment success page      |
| `/book/failure/`         | Payment failure page      |
| `/pay-online/`           | Online payment info       |
| `/counter/`              | Live ticket counter       |
| `/tutorials/`            | Marketing tutorials       |
| `/privacy-policy/`       | Privacy policy            |
| `/refund-policy/`        | Refund policy             |
| `/terms-and-conditions/` | Terms and conditions      |
| `/delivery-policy/`      | Delivery policy           |

---

# Appendix: Ushers App

The Ushers App is a separate **EXPO** project at `TEDx-Bedayia/usher-app`. It communicates with:

- `GET /api/tickets/admit/{uuid}/` — scan and admit attendees
- `GET /api/tickets/on-door/` — fetch pricing and payment methods
- `POST /api/tickets/on-door/` — register walk-in attendees
