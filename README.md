# SkillSprint LMS

A full-stack Learning Management System built for the Auspify Technologies
Full Stack Development internship track. Instructors create courses with
lessons and quizzes; students enroll, read lessons, mark them complete, take
quizzes with instant scoring, and track progress on a personal dashboard.

## Features

- **Authentication with roles**: student and instructor accounts. Passwords are
  hashed with salted scrypt (`node:crypto`), sessions use random Bearer tokens.
  Protected endpoints return 401 without a token, 403 for the wrong role.
- **Course catalog**: public listing with text search (`?q=`) and category
  filter (`?category=`); course detail pages show the lesson list and quiz info.
- **Course management**: instructors create courses (title, description,
  category, level), edit them, delete them, and manage only their own courses.
- **Lessons**: instructors add lessons with real text content and a position;
  students read lessons and mark them complete for per-student progress.
- **Quizzes**: instructors build quizzes with 4-option multiple-choice
  questions; students fetch questions with correct answers stripped, submit
  answers, and get instant scoring with per-question correctness. Every attempt
  is stored and the best score per quiz is shown on the dashboard.
- **Enrollment**: students enroll in courses (409 on duplicates); the student
  dashboard shows each enrolled course with a progress bar
  (completed lessons / total lessons) and quiz best scores.
- **Instructor dashboard**: totals (courses, lessons, quizzes, enrollments,
  students), a course table, and in-browser builders for courses, lessons, and
  quizzes with a dynamic question editor.
- **Polished SPA frontend**: catalog, course detail, lesson reader, quiz taker,
  student dashboard, instructor dashboard, login, and register views. Fully
  responsive down to 375px mobile width, works offline after `npm install`
  (no CDN, no web fonts).

## Tech stack

- Backend: Node.js + Express 5, serving the REST API and the static frontend
  from `public/`
- Persistence: SQLite via better-sqlite3 (single file `skillsprint.db`,
  created and seeded automatically on first run)
- Frontend: vanilla HTML/CSS/JS, custom CSS only, system fonts only
- Auth: salted scrypt password hashing, random 256-bit Bearer session tokens

## Setup

```bash
npm install
npm start
```

The server listens on `process.env.PORT || 3005`, so open
http://localhost:3005 in a browser. On first run the database is created and
seeded with 5 courses, 24 lessons of real instructional content, 5 quizzes,
and the demo accounts below.

## Demo credentials

- Instructor: `instructor@example.com` / `teach123`
- Student: `demo@example.com` / `demo123` (enrolled in 2 courses, partial
  lesson progress, one recorded quiz attempt)

## API endpoints

| Method | Path | Description | Auth / role |
| ------ | ---- | ----------- | ----------- |
| POST | /api/auth/register | Register `{name, email, password, role}`; returns token + user | public |
| POST | /api/auth/login | Login `{email, password}`; returns token + user | public |
| POST | /api/auth/logout | Invalidate the current session | auth |
| GET | /api/auth/me | Current user profile | auth |
| GET | /api/courses | List courses; `?q=` search, `?category=` filter | public |
| GET | /api/courses/categories | Distinct course categories | public |
| GET | /api/courses/:id | Course detail with lessons list and quiz info | public |
| POST | /api/courses | Create course `{title, description, category, level}` | instructor |
| PUT | /api/courses/:id | Update own course | instructor (owner) |
| DELETE | /api/courses/:id | Delete own course | instructor (owner) |
| POST | /api/courses/:id/lessons | Add lesson `{title, content, position?}` | instructor (owner) |
| GET | /api/lessons/:id | Read lesson content; reports completion state | auth (enrolled student or owner) |
| POST | /api/lessons/:id/complete | Mark lesson complete; returns progress counts | student (enrolled) |
| DELETE | /api/lessons/:id | Delete lesson | instructor (owner) |
| POST | /api/courses/:id/enroll | Enroll in a course; 409 if already enrolled | student |
| POST | /api/courses/:id/quizzes | Create quiz `{title, questions: [{text, options[4], correctIndex}]}` | instructor (owner) |
| GET | /api/quizzes/:id | Quiz questions without correct answers (owners see answers) | auth (enrolled student or owner) |
| POST | /api/quizzes/:id/submit | Submit `{answers: [indexes]}`; returns `{score, total, correct[], attemptId}` | student (enrolled) |
| DELETE | /api/quizzes/:id | Delete quiz | instructor (owner) |
| GET | /api/dashboard/me | Enrolled courses with progressPct and quiz best scores | student |
| GET | /api/instructor/me | Own courses with counts plus totals | instructor |

Levels are limited to `Beginner`, `Intermediate`, `Advanced`. Quiz questions
require exactly 4 non-empty options and a `correctIndex` of 0-3.

## Project structure

```
learning-management-system/
  server.js        Express app: routes, auth middleware, static file serving
  db.js            SQLite schema, data-access layer, seed data
  auth.js          scrypt hashing, Bearer token parsing, public user shaping
  package.json     {"scripts": {"start": "node server.js"}}
  .gitignore       excludes node_modules and *.db / *.sqlite files
  public/
    index.html     SPA shell: top bar, nav, footer
    styles.css     custom stylesheet (no frameworks)
    app.js         hash-routed frontend: catalog, detail, reader, quiz,
                   dashboards, login, register
```

## Seed data

Five courses (Python for Beginners, Web Development Bootcamp, Data Science
Essentials, Cybersecurity Fundamentals, Linux Command Line Basics), each with
4-5 lessons of genuine instructional text and one quiz of 4-5 questions with
correct answers. The demo student is enrolled in Python for Beginners and Web
Development Bootcamp with partial progress and one quiz attempt (4/5).
