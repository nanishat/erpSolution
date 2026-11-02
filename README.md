# ERP Solution

ERP Solution is a web-based accounting system for managing a company's ledger, sales, purchases, and cash movement in one place. It brings double-entry journal workflows, invoices and vendor bills, tax calculations, bank reconciliation, and financial reporting together in a PostgreSQL-backed application.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-149eca?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169e1?logo=postgresql)

## 🛠️ Tech Stack

- **Language:** TypeScript
- **Web framework:** Next.js 16 (App Router), React 19
- **Database and ORM:** PostgreSQL 15, Prisma 7 with the `pg` driver and Prisma PostgreSQL adapter
- **Styling and UI:** Tailwind CSS 4, Radix UI, shadcn, Lucide React
- **Forms and validation:** React Hook Form, Zod, `@hookform/resolvers`
- **Data and charts:** TanStack Table, Recharts, Zustand
- **Document and report output:** ExcelJS, PDFKit
- **Runtime and package manager:** Node.js 20+, npm
- **Containerization:** Docker and Docker Compose

## ✨ Features

- **General ledger:** Shared chart of accounts, branch-aware journal entries, debit/credit and cash vouchers, posting, and reversals.
- **Sales and purchasing:** Customer invoices and vendor bills, printable invoices, payment recording, allocations, and partner credits.
- **Tax:** Configurable tax rates and VAT/TDS/VDS applications associated with journal entries.
- **Bank reconciliation:** Import bank statements from CSV, view reconciliation summaries and matching suggestions, and match, unmatch, ignore, or restore statement lines.
- **Financial reports:** Trial balance, general ledger, balance sheet, profit and loss, cash flow, and VAT reports, with XLSX and PDF exports.
- **Reference data:** Manage customers and vendors, products and services, branches, tax rates, and chart-of-account entries.
- **Accounting dashboard:** A central entry point for accounting workflows and reports.

## 📦 Installation & Setup

### Prerequisites

- Node.js 20 or newer and npm
- Docker with Docker Compose, or an available PostgreSQL database

### 1. Clone the repository and install dependencies

```bash
git clone https://github.com/nanishat/erpSolution.git
cd erpSolution
npm ci
```

### 2. Start PostgreSQL

The included Compose file starts PostgreSQL 15 on `localhost:5432` with a persistent Docker volume:

```bash
docker compose up -d postgres
```

### 3. Configure the environment

There is no committed `.env.example`. Create a `.env` file in the project root and set the database connection string:

```dotenv
DATABASE_URL="postgresql://dev_user:dev_password@localhost:5432/dev_db"
```

These credentials match the development defaults in `docker-compose.yml`. If you use another PostgreSQL instance, set `DATABASE_URL` to its connection string instead.

Environment variables referenced by the project configuration:

| Variable | Required for | Description |
| --- | --- | --- |
| `DATABASE_URL` | Local app and Prisma commands | PostgreSQL connection string. |
| `AUTH_SECRET` | Staging Compose configuration | Secret passed to the staging app container. |
| `AUTH_URL` | Staging Compose configuration | Application URL passed to the staging app container. |
| `DEV_SERVER_URL` | Optional manual tests | Base URL for manual HTTP tests; defaults to `http://localhost:3000`. |
| `POSTGRES_USER` | Local PostgreSQL container | Database user configured in `docker-compose.yml`. |
| `POSTGRES_PASSWORD` | Local PostgreSQL container | Database password configured in `docker-compose.yml`. |
| `POSTGRES_DB` | Local PostgreSQL container | Database name configured in `docker-compose.yml`. |
| `NODE_ENV` | Next.js runtime | Runtime mode; Next.js sets this for development and production commands. |

`AUTH_SECRET` and `AUTH_URL` are referenced by `docker-compose.staging.yml`; they are not needed for the local setup described here. The `POSTGRES_*` values are set to development defaults directly in `docker-compose.yml`.

### 4. Apply migrations and generate the Prisma client

```bash
npx prisma migrate deploy
npx prisma generate
```

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The root page redirects to the accounting dashboard.

### Other useful commands

```bash
npm run lint       # Run ESLint
npm run build      # Create a production build
npm run start      # Serve the production build
```

The repository's HTTP/database integration checks are manual scripts, not a standard unit-test suite. See [`tests/README.md`](./tests/README.md) for prerequisites and commands; the scripts require a running app and a development database.

## 🚀 Usage

Use the dashboard at `/accounting` to create or manage journal entries, invoices, vendor bills, payments, partners, and reports. The app also exposes JSON API routes for integrations and manual testing.

For example, list chart-of-account entries:

```bash
curl http://localhost:3000/api/accounts
```

Fetch the trial balance as JSON:

```bash
curl "http://localhost:3000/api/reports/trial-balance?from=2026-01-01&to=2026-12-31"
```

The trial balance accepts optional `from`, `to`, `branchId`, and `includeZeroBalances` query parameters. For example, add `&includeZeroBalances=true` to include zero-balance accounts. Report endpoints that support exports accept `format=xlsx` or `format=pdf`; the trial balance also accepts `view=flat` or `view=grouped`.

Other useful endpoints include:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/journal-entries` | List journal entries |
| `POST` | `/api/journal-entries` | Create a journal entry |
| `POST` | `/api/journal-entries/{id}/post` | Post a draft journal entry |
| `GET` | `/api/invoices` | List invoices |
| `GET` | `/api/bank-reconciliation/statements` | List imported bank statements |

## 🤝 Contributing

Contributions are welcome. Before opening a pull request:

1. Create a focused branch for your change.
2. Keep changes consistent with the existing TypeScript, Next.js, and Prisma patterns.
3. Run `npm run lint` and `npm run build`.
4. For changes to accounting workflows, run the relevant manual integration checks described in [`tests/README.md`](./tests/README.md).
5. Open a pull request with a concise description, the motivation, and any relevant test results.

## 📄 License

No license file is currently included in this repository. All rights are reserved unless the project maintainers specify otherwise; contact them before redistributing or reusing the code.
