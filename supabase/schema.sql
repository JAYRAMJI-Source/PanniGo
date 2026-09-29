create extension if not exists pgcrypto;

create table if not exists public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price_inr integer not null check (price_inr > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  customer_name text not null,
  phone text not null,
  address text not null,
  payment_method text not null default 'Cash on Delivery',
  payment_status text not null default 'pending',
  status text not null default 'New',
  total_inr integer not null check (total_inr > 0),
  items jsonb not null,
  razorpay_order_id text,
  razorpay_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.products(name,price_inr) values
('500 ml Bottle',10),('1 L Bottle',15),('2 L Bottle',20),('20 L Jar',50),('Family Pack',120)
on conflict (name) do update set price_inr=excluded.price_inr, active=true;

insert into public.delivery_zones(name) values
('Patna Central'),('Kankarbagh'),('Rajendra Nagar')
on conflict (name) do nothing;

alter table public.products enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.orders enable row level security;

-- The browser does not access these tables directly. The Node server uses the service-role key.
-- Therefore no public/anon table policies are created.
