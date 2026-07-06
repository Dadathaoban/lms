# Home Lesson Tutorials LMS

A Learning Management System for managing students, curriculum, and computer-based testing (CBT) exams.

## Tech Stack

- **Runtime:** Node.js + Express 5
- **Database:** PostgreSQL (Neon)
- **Templating:** EJS
- **Auth:** bcryptjs + express-session
- **File uploads:** Multer
- **CSRF:** @dr.pogodin/csurf

## Prerequisites

- Node.js 18+
- A PostgreSQL database (e.g. Neon)

## Setup

1. Clone the repo and install dependencies:

```bash
git clone <repo-url>
cd LMSforThaoban
npm install
```

2. Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your database URL and a strong session secret.

3. Start the server:

```bash
npm start
```

The app runs at `http://localhost:3000`.

## Project Structure

```
app.js                  # Express server entry point
src/
  db/pool.js            # PostgreSQL connection pool
  middleware/
    auth.js             # Route guards (protectRoute, redirectIfLoggedIn)
    upload.js           # Multer file upload config
  routes/
    auth.js             # Login, logout, landing page
    admin.js            # Admin dashboard, students, curriculum, exams, results
    student.js          # Student dashboard, exam room, results
views/                  # EJS templates
public/                 # Static assets
```

## Default Access

The first admin account must be created directly in the database:

```sql
INSERT INTO users (username, full_name, password_hash, role, account_status)
VALUES ('admin', 'Administrator', '<bcrypt-hash>', 'admin', 'active');
```

Students are created by admins through the dashboard. Each student gets a generated ID (e.g. `HLT26001`) and a temporary password.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start with nodemon (auto-reload) |
