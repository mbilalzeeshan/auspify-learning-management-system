// SkillSprint LMS - Express server.
// Serves the REST API and the static single-page frontend from public/.

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const store = require('./db');
const { hashPassword, verifyPassword, bearerToken, publicUser } = require('./auth');

const app = express();
app.use(express.json({ limit: '1mb' }));

// ------------------------------------------------------------ middleware ----
// Attach req.user from the Bearer token when present.
app.use('/api', (req, res, next) => {
  const token = bearerToken(req);
  req.user = token ? store.getUserByToken(token) : null;
  next();
});

// 401 when no valid session.
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required. Include a Bearer token.' });
  next();
}

// 403 unless the user holds one of the given roles.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: this action requires role ' + roles.join(' or ') + '.' });
    }
    next();
  };
}

const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ------------------------------------------------------------------ auth ---
// POST /api/auth/register  {name, email, password, role}
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!emailOk(email)) return res.status(400).json({ error: 'A valid email is required.' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!['student', 'instructor'].includes(role)) return res.status(400).json({ error: 'Role must be student or instructor.' });
  if (store.findUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists.' });

  const salt = crypto.randomBytes(16).toString('hex');
  const user = store.createUser(name.trim(), email, hashPassword(password, salt), salt, role);
  const token = store.createSession(user.id);
  res.status(201).json({ token, user: publicUser(user) });
});

// POST /api/auth/login  {email, password}
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!emailOk(email) || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const user = store.findUserByEmail(email);
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const token = store.createSession(user.id);
  res.json({ token, user: publicUser(user) });
});

// POST /api/auth/logout  (auth)
app.post('/api/auth/logout', requireAuth, (req, res) => {
  store.deleteSession(bearerToken(req));
  res.json({ ok: true });
});

// GET /api/auth/me  (auth)
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ---------------------------------------------------------------- courses ---
// GET /api/courses  public, supports ?q= search and ?category= filter
app.get('/api/courses', (req, res) => {
  res.json({ courses: store.listCourses({ q: req.query.q || '', category: req.query.category || '' }) });
});

// GET /api/courses/categories  public list of categories
app.get('/api/courses/categories', (req, res) => {
  res.json({ categories: store.categories() });
});

// GET /api/courses/:id  public detail with lessons list and quiz info
app.get('/api/courses/:id', (req, res) => {
  const course = store.getCourse(req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  let enrolled = false;
  if (req.user) enrolled = store.isEnrolled(course.id, req.user.id);
  res.json({ course, enrolled });
});

// POST /api/courses  (instructor)
app.post('/api/courses', requireRole('instructor'), (req, res) => {
  const { title, description, category, level } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required.' });
  if (!description || !description.trim()) return res.status(400).json({ error: 'Description is required.' });
  if (!category || !category.trim()) return res.status(400).json({ error: 'Category is required.' });
  if (!store.LEVELS.includes(level)) return res.status(400).json({ error: 'Level must be one of: ' + store.LEVELS.join(', ') });
  const course = store.createCourse({
    title: title.trim(), description: description.trim(), category: category.trim(),
    level, instructorId: req.user.id
  });
  res.status(201).json({ course });
});

// Load a course and enforce that the caller owns it (instructors only).
function ownCourse(req, res, next) {
  const course = store.getCourse(req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  if (course.instructor_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden: you can only modify your own courses.' });
  }
  req.course = course;
  next();
}

// PUT /api/courses/:id  (instructor, own course)
app.put('/api/courses/:id', requireRole('instructor'), ownCourse, (req, res) => {
  const { title, description, category, level } = req.body || {};
  if (level !== undefined && !store.LEVELS.includes(level)) {
    return res.status(400).json({ error: 'Level must be one of: ' + store.LEVELS.join(', ') });
  }
  const course = store.updateCourse(req.course.id, { title, description, category, level });
  res.json({ course });
});

// DELETE /api/courses/:id  (instructor, own course)
app.delete('/api/courses/:id', requireRole('instructor'), ownCourse, (req, res) => {
  store.deleteCourse(req.course.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- lessons ---
// POST /api/courses/:id/lessons  (instructor, own course)
app.post('/api/courses/:id/lessons', requireRole('instructor'), ownCourse, (req, res) => {
  const { title, content, position } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Lesson title is required.' });
  if (!content || !content.trim()) return res.status(400).json({ error: 'Lesson content is required.' });
  const lesson = store.createLesson(req.course.id, { title: title.trim(), content: content.trim(), position });
  res.status(201).json({ lesson });
});

// GET /api/lessons/:id  (auth; students must be enrolled in the course)
app.get('/api/lessons/:id', requireAuth, (req, res) => {
  const lesson = store.getLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const course = store.getCourse(lesson.course_id);
  const isOwner = req.user.role === 'instructor' && course.instructor_id === req.user.id;
  const enrolled = req.user.role === 'student' && store.isEnrolled(course.id, req.user.id);
  if (!isOwner && !enrolled) {
    return res.status(403).json({ error: 'Forbidden: enroll in the course to read this lesson.' });
  }
  let completed = false;
  if (req.user.role === 'student') {
    completed = store.completedLessonIds(req.user.id, course.id).includes(lesson.id);
  }
  res.json({ lesson, course: { id: course.id, title: course.title }, completed });
});

// POST /api/lessons/:id/complete  (student, must be enrolled)
app.post('/api/lessons/:id/complete', requireRole('student'), (req, res) => {
  const lesson = store.getLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  if (!store.isEnrolled(lesson.course_id, req.user.id)) {
    return res.status(403).json({ error: 'Forbidden: enroll in the course first.' });
  }
  store.markLessonComplete(lesson.id, req.user.id);
  const total = store.getCourse(lesson.course_id).lessons.length;
  const done = store.completedLessonIds(req.user.id, lesson.course_id).length;
  res.json({ completed: true, completedLessons: done, totalLessons: total });
});

// DELETE /api/lessons/:id  (instructor, own course)
app.delete('/api/lessons/:id', requireRole('instructor'), (req, res) => {
  const lesson = store.getLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const course = store.getCourse(lesson.course_id);
  if (course.instructor_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden: you can only modify your own courses.' });
  }
  store.deleteLesson(lesson.id);
  res.json({ ok: true });
});

// --------------------------------------------------------------- enrollment -
// POST /api/courses/:id/enroll  (student); 409 when already enrolled
app.post('/api/courses/:id/enroll', requireRole('student'), (req, res) => {
  const course = store.getCourse(req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  const result = store.enroll(course.id, req.user.id);
  if (!result.ok) return res.status(409).json({ error: 'You are already enrolled in this course.' });
  res.status(201).json({ enrolled: true, courseId: course.id });
});

// ----------------------------------------------------------------- quizzes --
// POST /api/courses/:id/quizzes  (instructor, own course)
//   {title, questions: [{text, options: [4 strings], correctIndex}]}
app.post('/api/courses/:id/quizzes', requireRole('instructor'), ownCourse, (req, res) => {
  const { title, questions } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Quiz title is required.' });
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'At least one question is required.' });
  }
  for (const [i, q] of questions.entries()) {
    if (!q.text || !q.text.trim()) return res.status(400).json({ error: `Question ${i + 1}: text is required.` });
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some(o => typeof o !== 'string' || !o.trim())) {
      return res.status(400).json({ error: `Question ${i + 1}: exactly 4 non-empty options are required.` });
    }
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) {
      return res.status(400).json({ error: `Question ${i + 1}: correctIndex must be 0-3.` });
    }
  }
  const quiz = store.createQuiz(req.course.id, {
    title: title.trim(),
    questions: questions.map(q => ({ text: q.text.trim(), options: q.options.map(o => o.trim()), correctIndex: q.correctIndex }))
  });
  res.status(201).json({ quiz });
});

// GET /api/quizzes/:id  (auth; correct answers stripped for students;
//                        instructors see answers only for their own quizzes)
app.get('/api/quizzes/:id', requireAuth, (req, res) => {
  const quiz = store.getQuiz(req.params.id, false);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  const course = store.getCourse(quiz.course_id);
  const isOwner = req.user.role === 'instructor' && course.instructor_id === req.user.id;
  const enrolled = req.user.role === 'student' && store.isEnrolled(course.id, req.user.id);
  if (!isOwner && !enrolled) {
    return res.status(403).json({ error: 'Forbidden: enroll in the course to take this quiz.' });
  }
  if (isOwner) return res.json({ quiz: store.getQuiz(req.params.id, true) });
  res.json({ quiz });
});

// POST /api/quizzes/:id/submit  (student, must be enrolled)
//   {answers: [chosen indexes]} -> {score, total, correct: [bool], attemptId}
app.post('/api/quizzes/:id/submit', requireRole('student'), (req, res) => {
  const quiz = store.getQuiz(req.params.id, false);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  if (!store.isEnrolled(quiz.course_id, req.user.id)) {
    return res.status(403).json({ error: 'Forbidden: enroll in the course first.' });
  }
  const { answers } = req.body || {};
  if (!Array.isArray(answers) || answers.length !== quiz.questionCount) {
    return res.status(400).json({ error: `answers must be an array of ${quiz.questionCount} indexes.` });
  }
  const result = store.submitQuiz(quiz.id, req.user.id, answers);
  res.json(result);
});

// DELETE /api/quizzes/:id  (instructor, own course)
app.delete('/api/quizzes/:id', requireRole('instructor'), (req, res) => {
  const quiz = store.getQuiz(req.params.id, false);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  const course = store.getCourse(quiz.course_id);
  if (course.instructor_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden: you can only modify your own courses.' });
  }
  store.deleteQuiz(quiz.id);
  res.json({ ok: true });
});

// --------------------------------------------------------------- dashboards -
// GET /api/dashboard/me  (student): enrolled courses with progressPct and quiz bests
app.get('/api/dashboard/me', requireRole('student'), (req, res) => {
  res.json({ enrollments: store.studentDashboard(req.user.id) });
});

// GET /api/instructor/me  (instructor): own courses with counts and totals
app.get('/api/instructor/me', requireRole('instructor'), (req, res) => {
  res.json(store.instructorDashboard(req.user.id));
});

// ------------------------------------------------------------ static app ----
app.use(express.static(path.join(__dirname, 'public')));
// SPA fallback: unknown non-API routes serve index.html (hash routing on client).
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 + error handling for unknown API routes.
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
  console.log(`SkillSprint LMS running at http://localhost:${PORT}`);
});

module.exports = app;
