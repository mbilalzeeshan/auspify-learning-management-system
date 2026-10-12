// SkillSprint LMS - database layer (SQLite via better-sqlite3)
// Handles schema creation, seeding, and all data-access helpers.

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

// The database file lives next to the server. It is excluded from git via .gitignore.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'skillsprint.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------- schema ----
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('student','instructor')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('Beginner','Intermediate','Advanced')),
    instructor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lesson_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL,
    UNIQUE (lesson_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS quizzes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    options TEXT NOT NULL, -- JSON array of exactly 4 strings
    correct_index INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enrolled_at TEXT NOT NULL,
    UNIQUE (course_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS quiz_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    answers TEXT NOT NULL, -- JSON array of chosen indexes
    taken_at TEXT NOT NULL
  );
`);

const now = () => new Date().toISOString();

// ---------------------------------------------------------------- seeding ---
// Seed data only runs on a brand-new database (no users table rows yet).
function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) return;

  const salt = () => crypto.randomBytes(16).toString('hex');
  const hash = (pw, s) => crypto.scryptSync(pw, s, 64).toString('hex');

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, salt, role, created_at) VALUES (?,?,?,?,?,?)'
  );
  const instructorSalt = salt();
  const demoSalt = salt();
  const instructorId = insertUser.run('SkillSprint Instructor', 'instructor@example.com',
    hash('teach123', instructorSalt), instructorSalt, 'instructor', now()).lastInsertRowid;
  const demoId = insertUser.run('Demo Student', 'demo@example.com',
    hash('demo123', demoSalt), demoSalt, 'student', now()).lastInsertRowid;

  const insertCourse = db.prepare(
    'INSERT INTO courses (title, description, category, level, instructor_id, created_at) VALUES (?,?,?,?,?,?)'
  );
  const insertLesson = db.prepare(
    'INSERT INTO lessons (course_id, title, content, position, created_at) VALUES (?,?,?,?,?)'
  );
  const insertQuiz = db.prepare(
    'INSERT INTO quizzes (course_id, title, created_at) VALUES (?,?,?)'
  );
  const insertQuestion = db.prepare(
    'INSERT INTO questions (quiz_id, text, options, correct_index, position) VALUES (?,?,?,?,?)'
  );
  const insertEnroll = db.prepare(
    'INSERT INTO enrollments (course_id, user_id, enrolled_at) VALUES (?,?,?)'
  );
  const insertProgress = db.prepare(
    'INSERT INTO lesson_progress (lesson_id, user_id, completed_at) VALUES (?,?,?)'
  );
  const insertAttempt = db.prepare(
    'INSERT INTO quiz_attempts (quiz_id, user_id, score, total, answers, taken_at) VALUES (?,?,?,?,?,?)'
  );

  const seedTx = db.transaction((courses) => {
    for (const c of courses) {
      const courseId = insertCourse.run(c.title, c.description, c.category, c.level, instructorId, now()).lastInsertRowid;
      c.lessons.forEach((l, i) => insertLesson.run(courseId, l.title, l.content, i + 1, now()));
      const quizId = insertQuiz.run(courseId, c.quiz.title, now()).lastInsertRowid;
      c.quiz.questions.forEach((q, i) =>
        insertQuestion.run(quizId, q.text, JSON.stringify(q.options), q.correctIndex, i + 1));
      c._courseId = courseId;
      c._quizId = quizId;
    }
  });
  seedTx(seedCourses());

  // Demo student: enrolled in courses 1 and 2, partial progress, one quiz attempt.
  const courseIds = db.prepare('SELECT id FROM courses ORDER BY id').all().map(r => r.id);
  insertEnroll.run(courseIds[0], demoId, now());
  insertEnroll.run(courseIds[1], demoId, now());

  const lessonsOf = (courseId) =>
    db.prepare('SELECT id FROM lessons WHERE course_id = ? ORDER BY position').all(courseId).map(r => r.id);
  lessonsOf(courseIds[0]).slice(0, 3).forEach(lid => insertProgress.run(lid, demoId, now()));
  lessonsOf(courseIds[1]).slice(0, 2).forEach(lid => insertProgress.run(lid, demoId, now()));

  const quizId = db.prepare('SELECT id FROM quizzes WHERE course_id = ? ORDER BY id LIMIT 1').get(courseIds[0]).id;
  const questions = db.prepare('SELECT correct_index FROM questions WHERE quiz_id = ? ORDER BY position').all(quizId);
  // Demo attempt: answers every question correctly except the last one.
  const answers = questions.map((q, i) => (i === questions.length - 1 ? (q.correct_index + 1) % 4 : q.correct_index));
  const score = answers.filter((a, i) => a === questions[i].correct_index).length;
  insertAttempt.run(quizId, demoId, score, questions.length, JSON.stringify(answers), now());
}

// The seed catalog. Lesson content is genuine instructional text, no filler.
function seedCourses() {
  return [
    {
      title: 'Python for Beginners',
      description: 'Start from zero and learn to write real Python programs: variables, loops, functions, and files. No prior programming experience needed.',
      category: 'Programming',
      level: 'Beginner',
      lessons: [
        {
          title: 'Setting Up and Running Your First Program',
          content: `Python is an interpreted language, which means you can run code line by line without a separate compilation step. Install Python 3 from python.org, then open a terminal and type \`python3\` to enter the interactive shell.

In the shell, try: print("Hello, SkillSprint"). The print() function displays text on the screen. Anything inside quotes is a string, a sequence of characters. Try basic arithmetic too: 3 + 4 * 2 follows the usual order of operations, and 2 ** 10 means 2 to the power of 10.

Save your work in a file ending in .py and run it with \`python3 filename.py\`. From now on, keep every exercise in a folder so you build a portfolio of programs as you learn.`
        },
        {
          title: 'Variables and Data Types',
          content: `A variable is a named box that holds a value. In Python you create one by assignment: name = "Ayesha". Python infers the type automatically, so you do not declare it.

The four types you will use constantly are integers (42), floats (3.14), strings ("hello"), and booleans (True, False). Check a type anytime with type(x). Convert between types with int(), float(), and str(): int("42") + 8 gives 50, while "42" + 8 raises a TypeError because you cannot add a string and a number.

Strings support slicing: word = "SkillSprint"; word[0:5] gives "Skill". Remember that indexes start at 0, so word[0] is "S". F-strings make formatted output easy: f"Score: {95 + 3}".`
        },
        {
          title: 'Control Flow: if, elif, else',
          content: `Programs make decisions with if statements. Python uses indentation, not braces, to mark blocks, so consistent 4-space indentation is required.

\`\`\`
score = 78
if score >= 90:
    print("A grade")
elif score >= 60:
    print("Pass")
else:
    print("Try again")
\`\`\`

Comparison operators are == (equal), != (not equal), <, >, <=, >=. Never confuse = (assignment) with == (comparison); it is one of the most common beginner bugs. Combine conditions with and, or, and not: if 0 <= x <= 100 and not done.

Boolean expressions evaluate lazily: in \`a and b\`, if a is False, b is never evaluated. This matters when b has side effects.`
        },
        {
          title: 'Loops: for and while',
          content: `A for loop repeats over a sequence. range(n) produces numbers 0 through n-1, so for i in range(5) runs five times. Loop over a list directly: for name in ["Ali", "Sara"]: print(name).

A while loop repeats until its condition is false. Always make progress toward ending the loop or it runs forever: n = 5; while n > 0: print(n); n -= 1. Infinite loops happen to everyone; press Ctrl+C to stop a runaway program.

break exits a loop immediately, and continue skips to the next iteration. Use them to handle special cases without nesting deeply: for line in lines: if line.startswith("#"): continue.`
        },
        {
          title: 'Functions: Packaging Reusable Logic',
          content: `A function is a named, reusable block. Define it with def, give parameters names, and return a result:

\`\`\`
def area_of_circle(radius):
    pi = 3.14159
    return pi * radius ** 2

print(area_of_circle(3))
\`\`\`

Parameters can have defaults: def greet(name="Student"). The return value replaces the call; a function without return gives back None. Docstrings (a triple-quoted string right after def) document what a function does.

Keep functions small and focused on one job. If a function needs more than three parameters or spans 30 lines, that is a sign to split it. Well-named functions are the difference between code you can read in six months and code you cannot.`
        }
      ],
      quiz: {
        title: 'Python Basics Check',
        questions: [
          { text: 'What does print(2 ** 3) output?', options: ['6', '8', '9', '16'], correctIndex: 1 },
          { text: 'Which statement creates a variable correctly in Python?', options: ['int x = 5', 'x := 5', 'x = 5', 'let x = 5'], correctIndex: 2 },
          { text: 'What is the result of "42" + 8 in Python?', options: ['50', '"428"', 'TypeError', '428'], correctIndex: 2 },
          { text: 'How does Python mark the body of an if statement?', options: ['Curly braces', 'Indentation', 'The keyword do', 'Parentheses'], correctIndex: 1 },
          { text: 'What does the keyword "break" do inside a loop?', options: ['Skips one iteration', 'Exits the loop immediately', 'Restarts the loop', 'Pauses the loop'], correctIndex: 1 }
        ]
      }
    },
    {
      title: 'Web Development Bootcamp',
      description: 'Build websites from scratch with HTML, CSS, and JavaScript. You will finish with a responsive personal portfolio you can actually publish.',
      category: 'Web Development',
      level: 'Beginner',
      lessons: [
        {
          title: 'How the Web Works',
          content: `When you type a URL, your browser performs a DNS lookup to translate the domain into an IP address, opens a TCP connection (usually over HTTPS on port 443), and sends an HTTP request. The server responds with HTML, CSS, and JavaScript, which the browser renders.

HTTP methods describe intent: GET fetches a resource, POST submits data, PUT updates, DELETE removes. Status codes tell you the outcome: 200 means OK, 404 means not found, 500 means the server failed. Learn to read the Network tab in your browser dev tools; it shows every request a page makes and is the fastest way to debug loading problems.

The web is stateless: each request is independent. Servers keep state with cookies, sessions, or tokens. Understanding this one idea unlocks how logins, carts, and APIs work.`
        },
        {
          title: 'HTML: Structure of a Page',
          content: `HTML describes structure with elements. A minimal page looks like:

\`\`\`
<!DOCTYPE html>
<html>
<head><title>My Page</title></head>
<body>
  <h1>Hello</h1>
  <p>This is a paragraph.</p>
  <a href="https://example.com">A link</a>
</body>
</html>
\`\`\`

Use semantic tags: <header>, <nav>, <main>, <section>, <footer> describe meaning, while <div> is a generic container. Semantic markup improves accessibility because screen readers announce the structure to users who cannot see it.

Forms collect input: <form> with <input>, <select>, and <button>. Always label inputs with <label> so users know what each field expects. Validate on the server, never only in the browser, because client-side checks are trivially bypassed.`
        },
        {
          title: 'CSS: Styling and Layout',
          content: `CSS rules select elements and set properties: h1 { color: #1e1b4b; font-size: 2rem; }. Three ways to apply CSS exist: inline styles, a <style> block, and external stylesheets. Prefer external stylesheets so styling stays in one maintainable place.

The box model governs every element: content, padding, border, margin from inside out. box-sizing: border-box makes width include padding and border, which is almost always what you want.

For layout, use Flexbox for one-dimensional arrangements (navbars, card rows) and Grid for two-dimensional ones (page layouts). Example: .row { display: flex; gap: 1rem; } lines up children with even spacing. Media queries adapt to screens: @media (max-width: 600px) { .row { flex-direction: column; } } stacks columns on phones.`
        },
        {
          title: 'JavaScript: Making Pages Interactive',
          content: `JavaScript runs in the browser and manipulates the page. document.querySelector("#btn") grabs an element by its id, and addEventListener attaches behavior: btn.addEventListener("click", () => alert("Hi")).

Variables: const for values that never change, let for ones that do; avoid var, which has confusing scoping rules. Arrays and objects hold collections: const user = { name: "Bilal", role: "student" }; user.name reads "Bilal".

Fetch talks to servers: const res = await fetch("/api/courses"); const data = await res.json();. Always check res.ok before using the payload, because fetch only rejects on network failure, not on a 404 or 500 response.`
        },
        {
          title: 'Responsive Design and Publishing',
          content: `Responsive design means one site works on phones, tablets, and desktops. Start mobile-first: design for a narrow screen, then add breakpoints for wider ones. Use relative units (rem, %, vh/vw) instead of fixed pixels for text and spacing.

The meta viewport tag is mandatory for mobile: <meta name="viewport" content="width=device-width, initial-scale=1">. Without it, phones render the desktop layout and shrink it.

To publish, you need hosting and a domain. Static sites (HTML/CSS/JS only) deploy free on services like GitHub Pages, Netlify, or Vercel: push your files, get a URL in minutes. Test on a real phone before you announce the launch; emulators miss touch-target and performance issues.`
        }
      ],
      quiz: {
        title: 'Web Foundations Check',
        questions: [
          { text: 'What does HTTP status code 404 mean?', options: ['Server error', 'Not found', 'Unauthorized', 'Request timeout'], correctIndex: 1 },
          { text: 'Which HTML tag is the best choice for the main heading of a page?', options: ['<div>', '<span>', '<h1>', '<b>'], correctIndex: 2 },
          { text: 'In the CSS box model, which layer is outermost?', options: ['Padding', 'Border', 'Content', 'Margin'], correctIndex: 3 },
          { text: 'Which keyword should you prefer for a value that never changes?', options: ['var', 'let', 'const', 'static'], correctIndex: 2 },
          { text: 'What does the meta viewport tag do?', options: ['Improves SEO ranking', 'Makes mobile browsers render at device width', 'Speeds up image loading', 'Enables dark mode'], correctIndex: 1 }
        ]
      }
    },
    {
      title: 'Data Science Essentials',
      description: 'Learn the data science workflow: cleaning data, exploring it with statistics, and building your first predictive model with Python.',
      category: 'Data Science',
      level: 'Intermediate',
      lessons: [
        {
          title: 'The Data Science Workflow',
          content: `Every data science project follows the same loop: define the question, collect data, clean it, explore it, model it, and communicate results. Beginners skip straight to modeling; professionals spend most of their time on cleaning because garbage in means garbage out.

Start by stating the decision the analysis will inform. "Predict house prices" is vague; "estimate a listing price within 10% so sellers can price competitively" is actionable. The question determines which data you need and how accurate the model must be.

Keep a lab notebook: record what you tried, what failed, and why. Reproducibility is what separates a science project from a lucky guess. Version your data and code so anyone can rerun your analysis and get the same numbers.`
        },
        {
          title: 'Cleaning Messy Data',
          content: `Real data is dirty: missing values, wrong types, duplicates, inconsistent labels ("NY", "New York", "nyc"). Load data with pandas: df = pd.read_csv("data.csv"), then inspect with df.head(), df.info(), and df.describe().

Handle missing values deliberately. df.dropna() removes rows, df.fillna(df.mean()) imputes numeric columns. Neither is always right: dropping 40% of rows destroys your sample, while imputing with the mean hides real uncertainty. Document the choice.

Standardize text with .str.lower().str.strip(), parse dates with pd.to_datetime(), and remove exact duplicates with df.drop_duplicates(). After cleaning, re-run df.info() to confirm types are what you expect; numbers stored as strings are a classic silent bug.`
        },
        {
          title: 'Exploratory Analysis and Visualization',
          content: `Before modeling, explore. Plot distributions with histograms to spot skew and outliers; plot pairs of variables with scatter plots to see relationships. A single chart often reveals what tables hide.

Summarize with statistics that match the data: the mean is sensitive to outliers, so pair it with the median. Correlation measures linear association between -1 and 1, but correlation is not causation; ice cream sales and drownings correlate because both rise in summer.

Group comparisons answer business questions: df.groupby("category")["revenue"].mean() shows which category earns most on average. Visualize grouped results with bar charts. Always label axes and titles; an unlabeled chart communicates nothing.`
        },
        {
          title: 'Your First Predictive Model',
          content: `Supervised learning predicts a target from features. Regression predicts numbers (house prices); classification predicts categories (spam or not). Split data into training and test sets: train on 80%, evaluate on the remaining 20% that the model has never seen.

With scikit-learn, the pattern is always fit then predict:

\`\`\`
from sklearn.linear_model import LinearRegression
model = LinearRegression()
model.fit(X_train, y_train)
predictions = model.predict(X_test)
\`\`\`

Evaluate regression with mean absolute error (average dollars off) and classification with accuracy plus a confusion matrix. Never evaluate on training data; a model can memorize training rows and still fail on new ones. That gap is called overfitting, and the train/test split is how you detect it.`
        },
        {
          title: 'Communicating Results',
          content: `Analysis only matters if someone acts on it. Lead with the recommendation, then the evidence: "Raise the ad budget 15%; campaigns with this profile returned 2.3x spend last quarter." Executives decide on the first slide, so put the answer there.

State uncertainty honestly. "Revenue will grow 12% plus or minus 4%" beats a false precise "12.34%". Show your key assumption: if it breaks, the conclusion breaks. List what you did not check so nobody assumes you did.

Share code and data, not just screenshots. A notebook that reruns end to end is worth ten slide decks because anyone can verify it. Clear communication is the skill that turns a good analyst into an indispensable one.`
        }
      ],
      quiz: {
        title: 'Data Science Check',
        questions: [
          { text: 'In a typical project, where do data scientists spend most of their time?', options: ['Training models', 'Cleaning and preparing data', 'Writing reports', 'Tuning hyperparameters'], correctIndex: 1 },
          { text: 'Why do you split data into train and test sets?', options: ['To make training faster', 'To detect overfitting on unseen data', 'To reduce memory usage', 'To balance the classes'], correctIndex: 1 },
          { text: 'Which metric is appropriate for a regression problem like predicting prices?', options: ['Accuracy', 'Mean absolute error', 'F1 score', 'Confusion matrix alone'], correctIndex: 1 },
          { text: 'What is the main risk of imputing 40% missing values with the column mean?', options: ['It is too slow', 'It hides real uncertainty in the data', 'It changes the column type', 'It always causes overfitting'], correctIndex: 1 },
          { text: 'Ice cream sales and drowning rates correlate strongly. What is the correct conclusion?', options: ['Ice cream causes drowning', 'Correlation does not imply causation; heat drives both', 'Drowning causes ice cream sales', 'The data must be wrong'], correctIndex: 1 }
        ]
      }
    },
    {
      title: 'Cybersecurity Fundamentals',
      description: 'Think like an attacker and defend like a professional: core security concepts, common vulnerabilities, and hands-on defensive habits.',
      category: 'Cybersecurity',
      level: 'Beginner',
      lessons: [
        {
          title: 'The CIA Triad',
          content: `All of information security rests on three goals. Confidentiality means only authorized people can read data; encryption and access controls enforce it. Integrity means data is not altered without detection; hashes and signatures enforce it. Availability means systems work when needed; backups and redundancy enforce it.

Every attack targets one of the three. Ransomware destroys availability (and confidentiality when data is exfiltrated). A man-in-the-middle attack breaks confidentiality and integrity. A DDoS attack breaks availability by overwhelming a service.

When you analyze any system, ask the three questions: who can read this, how would I know if it changed, and what happens if it goes down? Those questions turn abstract security into concrete design decisions.`
        },
        {
          title: 'Authentication and Passwords',
          content: `Authentication proves identity. The three factors are something you know (password), something you have (phone), and something you are (fingerprint). Requiring two factors (2FA) blocks the vast majority of account takeovers because stealing a password alone is no longer enough.

Passwords must be stored hashed with a slow, salted algorithm like bcrypt, scrypt, or Argon2. Salting means each password gets a unique random value before hashing, so identical passwords produce different hashes and precomputed rainbow tables become useless. Never store plaintext passwords; a database leak then hands attackers every account.

Use a password manager and unique passwords per site. Credential stuffing, trying leaked passwords on other sites, works because people reuse passwords. Length beats complexity: four random words are both stronger and more memorable than one tricky 8-character password.`
        },
        {
          title: 'Common Web Vulnerabilities',
          content: `The OWASP Top 10 catalogs the most critical web risks. Three you must know: injection, broken access control, and cross-site scripting (XSS).

SQL injection happens when user input is concatenated into a query: ' OR '1'='1 can log an attacker in. The fix is parameterized queries, where input is always treated as data, never code. This is the same principle behind prompt injection in AI systems: never let untrusted input become instructions.

XSS injects scripts into pages other users view. Stored XSS in a comment field runs JavaScript in every visitor's browser, stealing sessions. Escape output and use Content Security Policy headers. Broken access control means the server trusts the client: always re-check permissions on the server for every request, even if the UI hides the button.`
        },
        {
          title: 'Social Engineering and Phishing',
          content: `Most breaches start with a person, not a firewall. Phishing emails create urgency ("your account will be locked"), impersonate authority (your CEO, your bank), and push you to a lookalike login page that harvests credentials.

Verify through a second channel: if an email asks for a wire transfer, call the sender at a known number. Check the actual sender domain, not just the display name; support@paypa1.com is not PayPal. Hover links to see the real destination before clicking.

Organizations fight this with training and simulated phishing, plus technical controls like email authentication (SPF, DKIM, DMARC) and hardware security keys. If you do click, report it immediately; fast reporting limits damage and is always better than hiding it.`
        },
        {
          title: 'Defensive Habits and Next Steps',
          content: `Security is a habit, not a product. Patch promptly: most exploited vulnerabilities have had fixes available for months. Back up with the 3-2-1 rule: three copies, two different media, one offsite, and test restores before you need them.

Segment your network so a compromised laptop cannot reach everything; least privilege means every account and service gets only the access it needs. Monitor logs for anomalies: failed logins at 3 AM, impossible travel between logins, new admin accounts.

To go deeper, practice legally: platforms like TryHackMe and HackTheBox provide labs, and bug bounty programs pay for responsibly reported vulnerabilities with clear scope. Never test systems you do not own or lack written permission to test; unauthorized access is a crime in most countries regardless of intent.`
        }
      ],
      quiz: {
        title: 'Security Basics Check',
        questions: [
          { text: 'Which goal of the CIA triad does ransomware primarily attack?', options: ['Confidentiality', 'Integrity', 'Availability', 'Authenticity'], correctIndex: 2 },
          { text: 'What is the purpose of salting a password before hashing it?', options: ['To make passwords shorter', 'To make identical passwords hash differently and defeat rainbow tables', 'To encrypt the password', 'To compress the hash'], correctIndex: 1 },
          { text: 'What is the correct fix for SQL injection?', options: ['Blocking the attacker IP', 'Parameterized queries that treat input as data', 'Hiding error messages', 'Using a longer password'], correctIndex: 1 },
          { text: 'An urgent email from "your CEO" asks for gift card codes. What should you do?', options: ['Reply immediately to help', 'Verify through a separate known channel before acting', 'Forward it to coworkers', 'Click the link to check it is real'], correctIndex: 1 },
          { text: 'What does the 3-2-1 backup rule require?', options: ['3 passwords, 2 devices, 1 cloud', '3 copies, 2 different media, 1 offsite', '3 firewalls, 2 antiviruses, 1 VPN', '3 admins, 2 backups, 1 test'], correctIndex: 1 }
        ]
      }
    },
    {
      title: 'Linux Command Line Basics',
      description: 'Become confident in the terminal: navigating the filesystem, managing files, permissions, and the tools every developer and sysadmin uses daily.',
      category: 'IT & Systems',
      level: 'Beginner',
      lessons: [
        {
          title: 'Navigating the Filesystem',
          content: `The Linux filesystem is a single tree starting at / (root). Your files live in /home/yourname. pwd prints where you are, ls lists files, and cd changes directory: cd /var/log moves you to the log folder, cd .. goes up one level, cd ~ returns home.

Paths are absolute (starting with /) or relative (starting from here). Tab completion finishes names for you; use it constantly to avoid typos. ls -la shows hidden files (those starting with .) and permissions.

Learn man: man ls opens the manual for ls. Press q to quit. Almost every command supports --help for a quick summary. Reading documentation is a core Linux skill, not a sign of weakness.`
        },
        {
          title: 'Files, Directories, and Text Tools',
          content: `Create with touch file.txt and mkdir projects. Copy with cp, move or rename with mv, delete files with rm and directories with rm -r. There is no trash can: rm deletes permanently, so double-check wildcards before rm *.log.

Read files with cat (small files), less (paged viewing, q quits), head and tail (first/last lines). tail -f log.txt follows a file as it grows, which is how you watch live server logs.

Pipes connect commands: cat access.log | grep "404" | wc -l counts 404 errors. grep searches text, sort orders lines, uniq -c counts duplicates. Combining small tools with pipes is the Unix philosophy: do one thing well, then compose.`
        },
        {
          title: 'Permissions and Ownership',
          content: `Every file has an owner, a group, and three permission sets: read (r=4), write (w=2), execute (x=1). ls -l shows them: -rw-r--r-- means the owner can read and write, everyone else can only read. Directories need x to be entered.

chmod changes permissions: chmod 755 script.sh grants rwxr-xr-x, chmod 600 secrets.txt grants rw------- so only you can read it. chown user:group file changes ownership; you usually need sudo for that.

Run privileged commands with sudo, which asks for your password and logs the action. Never run a full shell as root for routine work, and never run curl ... | sudo bash on scripts you have not read; that hands a stranger root on your machine.`
        },
        {
          title: 'Processes, Packages, and SSH',
          content: `ps aux lists processes; kill PID stops one, kill -9 PID force-stops a stuck one. top and htop show live resource usage. Jobs started with & run in the background; jobs and fg manage them.

Install software with your package manager: sudo apt update && sudo apt install htop on Debian/Ubuntu. update refreshes the package list; forgetting it is why "package not found" happens.

ssh user@server opens a remote shell; scp file user@server:/path copies files over SSH. Generate keys with ssh-keygen and copy the public key with ssh-copy-id so you can log in without a password. Disable password SSH logins on servers you manage; key-only authentication defeats brute-force attacks entirely.`
        }
      ],
      quiz: {
        title: 'Terminal Skills Check',
        questions: [
          { text: 'Which command shows your current directory?', options: ['ls', 'pwd', 'cd', 'whoami'], correctIndex: 1 },
          { text: 'What does "chmod 600 secrets.txt" do?', options: ['Deletes the file', 'Gives only the owner read and write access', 'Makes it executable by everyone', 'Moves it to a secure folder'], correctIndex: 1 },
          { text: 'How do you watch a log file as new lines are appended?', options: ['cat -f log.txt', 'tail -f log.txt', 'watch log.txt', 'less -a log.txt'], correctIndex: 1 },
          { text: 'Why should you avoid piping an unread script into "sudo bash"?', options: ['It is too slow', 'It gives a stranger root access to your machine', 'It breaks the package manager', 'It only works on servers'], correctIndex: 1 }
        ]
      }
    }
  ];
}

// ----------------------------------------------------------------- users ----
function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
}
function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function createUser(name, email, passwordHash, salt, role) {
  const r = db.prepare(
    'INSERT INTO users (name, email, password_hash, salt, role, created_at) VALUES (?,?,?,?,?,?)'
  ).run(name, email.toLowerCase(), passwordHash, salt, role, now());
  return findUserById(r.lastInsertRowid);
}

// --------------------------------------------------------------- sessions ---
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)')
    .run(token, userId, now());
  return token;
}
function getUserByToken(token) {
  if (!token) return null;
  const row = db.prepare(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
  ).get(token);
  return row || null;
}
function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// ---------------------------------------------------------------- courses ---
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

function listCourses({ q, category }) {
  let sql = `SELECT c.*, u.name AS instructor_name,
             (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lesson_count,
             (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS enrollment_count
             FROM courses c JOIN users u ON u.id = c.instructor_id`;
  const where = [], params = [];
  if (q) { where.push('(c.title LIKE ? OR c.description LIKE ? OR c.category LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category) { where.push('c.category = ?'); params.push(category); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY c.created_at DESC, c.id DESC';
  return db.prepare(sql).all(...params);
}

function getCourse(id) {
  const course = db.prepare(
    `SELECT c.*, u.name AS instructor_name FROM courses c
     JOIN users u ON u.id = c.instructor_id WHERE c.id = ?`
  ).get(id);
  if (!course) return null;
  course.lessons = db.prepare(
    'SELECT id, title, position FROM lessons WHERE course_id = ? ORDER BY position, id'
  ).all(id);
  course.quizzes = db.prepare(
    'SELECT q.id, q.title, (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count FROM quizzes q WHERE q.course_id = ? ORDER BY q.id'
  ).all(id);
  return course;
}

function createCourse({ title, description, category, level, instructorId }) {
  const r = db.prepare(
    'INSERT INTO courses (title, description, category, level, instructor_id, created_at) VALUES (?,?,?,?,?,?)'
  ).run(title, description, category, level, instructorId, now());
  return getCourse(r.lastInsertRowid);
}

function updateCourse(id, fields) {
  const allowed = ['title', 'description', 'category', 'level'];
  const sets = [], params = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(`${k} = ?`); params.push(fields[k]); }
  }
  if (!sets.length) return getCourse(id);
  params.push(id);
  db.prepare(`UPDATE courses SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getCourse(id);
}

function deleteCourse(id) {
  db.prepare('DELETE FROM courses WHERE id = ?').run(id);
}

function categories() {
  return db.prepare('SELECT DISTINCT category FROM courses ORDER BY category').all().map(r => r.category);
}

// ---------------------------------------------------------------- lessons ---
function createLesson(courseId, { title, content, position }) {
  let pos = position;
  if (pos === undefined || pos === null) {
    const row = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM lessons WHERE course_id = ?').get(courseId);
    pos = row.p;
  }
  const r = db.prepare(
    'INSERT INTO lessons (course_id, title, content, position, created_at) VALUES (?,?,?,?,?)'
  ).run(courseId, title, content, pos, now());
  return db.prepare('SELECT * FROM lessons WHERE id = ?').get(r.lastInsertRowid);
}

function getLesson(id) {
  return db.prepare('SELECT * FROM lessons WHERE id = ?').get(id);
}

function deleteLesson(id) {
  db.prepare('DELETE FROM lessons WHERE id = ?').run(id);
}

function markLessonComplete(lessonId, userId) {
  db.prepare('INSERT OR IGNORE INTO lesson_progress (lesson_id, user_id, completed_at) VALUES (?,?,?)')
    .run(lessonId, userId, now());
}

function completedLessonIds(userId, courseId) {
  return db.prepare(
    `SELECT lp.lesson_id AS id FROM lesson_progress lp
     JOIN lessons l ON l.id = lp.lesson_id
     WHERE lp.user_id = ? AND l.course_id = ?`
  ).all(userId, courseId).map(r => r.id);
}

// -------------------------------------------------------------- enrollment --
function enroll(courseId, userId) {
  try {
    db.prepare('INSERT INTO enrollments (course_id, user_id, enrolled_at) VALUES (?,?,?)')
      .run(courseId, userId, now());
    return { ok: true };
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return { ok: false, duplicate: true };
    throw e;
  }
}

function isEnrolled(courseId, userId) {
  return !!db.prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND user_id = ?').get(courseId, userId);
}

// ----------------------------------------------------------------- quizzes --
function createQuiz(courseId, { title, questions }) {
  const tx = db.transaction(() => {
    const quizId = db.prepare('INSERT INTO quizzes (course_id, title, created_at) VALUES (?,?,?)')
      .run(courseId, title, now()).lastInsertRowid;
    questions.forEach((q, i) => {
      db.prepare('INSERT INTO questions (quiz_id, text, options, correct_index, position) VALUES (?,?,?,?,?)')
        .run(quizId, q.text, JSON.stringify(q.options), q.correctIndex, i + 1);
    });
    return quizId;
  });
  return getQuiz(tx(), false);
}

// getQuiz(id, includeAnswers): when includeAnswers is false (student view),
// correct_index is stripped and questions carry only id/text/options.
function getQuiz(id, includeAnswers) {
  const quiz = db.prepare(
    `SELECT q.*, c.title AS course_title FROM quizzes q
     JOIN courses c ON c.id = q.course_id WHERE q.id = ?`
  ).get(id);
  if (!quiz) return null;
  const rows = db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position, id').all(id);
  quiz.questions = rows.map(r => {
    const base = { id: r.id, text: r.text, options: JSON.parse(r.options), position: r.position };
    if (includeAnswers) base.correctIndex = r.correct_index;
    return base;
  });
  quiz.questionCount = rows.length;
  return quiz;
}

function getQuizRaw(id) {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(id);
  if (!quiz) return null;
  quiz.questions = db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position, id').all(id);
  return quiz;
}

function deleteQuiz(id) {
  db.prepare('DELETE FROM quizzes WHERE id = ?').run(id);
}

function submitQuiz(quizId, userId, answers) {
  const quiz = getQuizRaw(quizId);
  if (!quiz) return null;
  const correct = quiz.questions.map((q, i) => answers[i] === q.correct_index);
  const score = correct.filter(Boolean).length;
  const r = db.prepare(
    'INSERT INTO quiz_attempts (quiz_id, user_id, score, total, answers, taken_at) VALUES (?,?,?,?,?,?)'
  ).run(quizId, userId, score, quiz.questions.length, JSON.stringify(answers), now());
  return { attemptId: r.lastInsertRowid, score, total: quiz.questions.length, correct };
}

function bestScores(userId, courseId) {
  // Best score per quiz in the course for this user.
  return db.prepare(
    `SELECT q.id AS quiz_id, q.title, MAX(a.score) AS best, q2.total AS total
     FROM quizzes q
     JOIN quiz_attempts a ON a.quiz_id = q.id AND a.user_id = ?
     JOIN (SELECT quiz_id, MAX(total) AS total FROM quiz_attempts WHERE user_id = ? GROUP BY quiz_id) q2 ON q2.quiz_id = q.id
     WHERE q.course_id = ?
     GROUP BY q.id`
  ).all(userId, userId, courseId);
}

// --------------------------------------------------------------- dashboard --
function studentDashboard(userId) {
  const enrolls = db.prepare(
    `SELECT e.enrolled_at, c.id, c.title, c.description, c.category, c.level, u.name AS instructor_name
     FROM enrollments e
     JOIN courses c ON c.id = e.course_id
     JOIN users u ON u.id = c.instructor_id
     WHERE e.user_id = ? ORDER BY e.enrolled_at DESC`
  ).all(userId);
  return enrolls.map(c => {
    const totalLessons = db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE course_id = ?').get(c.id).n;
    const done = completedLessonIds(userId, c.id).length;
    const progressPct = totalLessons === 0 ? 0 : Math.round((done / totalLessons) * 100);
    return {
      ...c,
      totalLessons,
      completedLessons: done,
      progressPct,
      quizScores: bestScores(userId, c.id)
    };
  });
}

function instructorDashboard(instructorId) {
  const courses = db.prepare('SELECT * FROM courses WHERE instructor_id = ? ORDER BY created_at DESC, id DESC').all(instructorId);
  const totals = { courses: courses.length, lessons: 0, quizzes: 0, enrollments: 0, students: 0 };
  const studentIds = new Set();
  const list = courses.map(c => {
    const lessonCount = db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE course_id = ?').get(c.id).n;
    const quizCount = db.prepare('SELECT COUNT(*) AS n FROM quizzes WHERE course_id = ?').get(c.id).n;
    const enrolls = db.prepare('SELECT user_id FROM enrollments WHERE course_id = ?').all(c.id);
    enrolls.forEach(e => studentIds.add(e.user_id));
    totals.lessons += lessonCount;
    totals.quizzes += quizCount;
    totals.enrollments += enrolls.length;
    return { ...c, lessonCount, quizCount, enrollmentCount: enrolls.length };
  });
  totals.students = studentIds.size;
  return { totals, courses: list };
}

seed();

module.exports = {
  db, LEVELS,
  findUserByEmail, findUserById, createUser,
  createSession, getUserByToken, deleteSession,
  listCourses, getCourse, createCourse, updateCourse, deleteCourse, categories,
  createLesson, getLesson, deleteLesson, markLessonComplete, completedLessonIds,
  enroll, isEnrolled,
  createQuiz, getQuiz, deleteQuiz, submitQuiz, bestScores,
  studentDashboard, instructorDashboard
};
