# PaaniGo V7 — Production Setup

V7 moves orders from local JSON/localStorage to Supabase Postgres and is deployable as a Node web service. Online payments are optional and use Razorpay when its environment variables are configured.

## 1. Database
Create a Supabase project, open SQL Editor, and run `supabase/schema.sql`.

Supabase provides a managed Postgres database and its server/client libraries. Keep the service-role key only on the server.

## 2. Local run
Copy `.env.example` to `.env`, fill the required values, then:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## 3. Production hosting
Push this folder to a private Git repository and create a Render Web Service. Use build command `npm install` and start command `npm start`, then add the environment variables from `.env.example` in Render.

## 4. Payments
If you configure Razorpay keys, the API can create a Razorpay order and verify its signature. Do not put the Razorpay secret in browser code.

## 5. Before accepting real orders
- Add your real business phone/email/address.
- Confirm product prices and delivery zones.
- Configure HTTPS/custom domain.
- Configure payment account and webhook handling.
- Configure a real transactional WhatsApp/SMS provider if needed.
- Test COD and online-payment flows end-to-end.
- Set a strong admin password and session secret.
