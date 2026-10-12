/* SkillSprint LMS - single-page frontend.
 * Hash-routed vanilla JS. All rendering happens in this file;
 * styles live in styles.css. Zero network dependencies. */

(function () {
  'use strict';

  var app = document.getElementById('app');

  // ------------------------------------------------------------ state ----
  var state = {
    token: localStorage.getItem('skillsprint_token') || null,
    user: null
  };

  // ---------------------------------------------------------- helpers ----
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Minimal fetch wrapper. Throws {status, message} on HTTP errors.
  function api(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (state.token) opts.headers['Authorization'] = 'Bearer ' + state.token;
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.error) || 'Request failed');
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function setSession(token, user) {
    state.token = token;
    state.user = user;
    if (token) localStorage.setItem('skillsprint_token', token);
    else localStorage.removeItem('skillsprint_token');
    updateChrome();
  }

  function updateChrome() {
    var loggedIn = !!state.user;
    document.getElementById('loginLink').classList.toggle('hidden', loggedIn);
    document.getElementById('registerLink').classList.toggle('hidden', loggedIn);
    document.getElementById('logoutBtn').classList.toggle('hidden', !loggedIn);
    var chip = document.getElementById('userChip');
    chip.classList.toggle('hidden', !loggedIn);
    if (loggedIn) chip.textContent = state.user.name + ' (' + state.user.role + ')';
    document.querySelectorAll('.needs-auth').forEach(function (el) {
      var isDashboard = el.getAttribute('href') === '#/dashboard';
      var show = loggedIn && ((isDashboard && state.user.role === 'student') ||
        (!isDashboard && state.user.role === 'instructor'));
      el.classList.toggle('hidden', !show);
    });
  }

  function setNav(active) {
    document.querySelectorAll('.topnav a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === active);
    });
  }

  function alertHtml(kind, msg) {
    return '<div class="alert ' + kind + '">' + esc(msg) + '</div>';
  }

  function emptyHtml(msg) {
    return '<div class="empty">' + esc(msg) + '</div>';
  }

  function levelBadge(level) {
    return '<span class="badge amber">' + esc(level) + '</span>';
  }

  // Require login before rendering a view; redirects to #/login otherwise.
  function needLogin(role) {
    if (!state.user) { location.hash = '#/login'; return false; }
    if (role && state.user.role !== role) {
      app.innerHTML = alertHtml('error', 'This page requires a ' + role + ' account.');
      return false;
    }
    return true;
  }

  // Restore the session on page load so refresh keeps you signed in.
  function boot() {
    updateChrome();
    if (state.token) {
      api('GET', '/api/auth/me')
        .then(function (data) { state.user = data.user; updateChrome(); route(); })
        .catch(function () { setSession(null, null); route(); });
    } else {
      route();
    }
  }

  // ------------------------------------------------------------ router ---
  function route() {
    var hash = location.hash || '#/';
    var parts = hash.replace(/^#\//, '').split('/');
    var name = parts[0] || '';

    document.getElementById('topnav').classList.remove('open');

    if (name === '') return renderCatalog();
    if (name === 'course') return renderCourse(parts[1]);
    if (name === 'lesson') return renderLesson(parts[1]);
    if (name === 'quiz') return renderQuiz(parts[1]);
    if (name === 'dashboard') return renderDashboard();
    if (name === 'teach') return renderTeach();
    if (name === 'login') return renderLogin();
    if (name === 'register') return renderRegister();
    app.innerHTML = emptyHtml('Page not found.');
  }

  // ----------------------------------------------------------- catalog ---
  var catalogFilter = { q: '', category: '' };

  function renderCatalog() {
    setNav('catalog');
    var categoriesPromise = api('GET', '/api/courses/categories').catch(function () { return { categories: [] }; });
    categoriesPromise.then(function (data) {
      var opts = data.categories.map(function (c) {
        return '<option value="' + esc(c) + '"' + (catalogFilter.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('');
      app.innerHTML =
        '<section class="hero">' +
          '<h1>Learn at <span class="accent">full speed</span>.</h1>' +
          '<p>SkillSprint courses are built for doers: read focused lessons, prove what you learned with quizzes, and track real progress on your dashboard.</p>' +
          (state.user ? '' : '<a class="btn btn-accent" href="#/register">Start learning free</a>') +
        '</section>' +
        '<div class="toolbar">' +
          '<input type="text" id="searchQ" placeholder="Search courses..." value="' + esc(catalogFilter.q) + '" aria-label="Search courses">' +
          '<select id="filterCat" aria-label="Filter by category">' +
            '<option value="">All categories</option>' + opts +
          '</select>' +
        '</div>' +
        '<div id="courseGrid" class="grid"></div>';

      document.getElementById('searchQ').addEventListener('input', function (e) {
        catalogFilter.q = e.target.value;
        loadGrid();
      });
      document.getElementById('filterCat').addEventListener('change', function (e) {
        catalogFilter.category = e.target.value;
        loadGrid();
      });
      loadGrid();
    });
  }

  function loadGrid() {
    var grid = document.getElementById('courseGrid');
    grid.innerHTML = '<div class="empty">Loading courses...</div>';
    var params = new URLSearchParams();
    if (catalogFilter.q) params.set('q', catalogFilter.q);
    if (catalogFilter.category) params.set('category', catalogFilter.category);
    api('GET', '/api/courses?' + params.toString()).then(function (data) {
      if (!data.courses.length) {
        grid.innerHTML = emptyHtml('No courses match your search.');
        return;
      }
      grid.innerHTML = data.courses.map(function (c) {
        return '<article class="course-card">' +
          '<div><span class="badge">' + esc(c.category) + '</span>' + levelBadge(c.level) + '</div>' +
          '<h3><a href="#/course/' + c.id + '">' + esc(c.title) + '</a></h3>' +
          '<p class="desc">' + esc(c.description) + '</p>' +
          '<div class="card-meta">' + c.lesson_count + ' lessons &middot; ' + c.enrollment_count + ' enrolled &middot; by ' + esc(c.instructor_name) + '</div>' +
          '<a class="btn btn-outline btn-small" href="#/course/' + c.id + '">View course</a>' +
        '</article>';
      }).join('');
    }).catch(function (err) {
      grid.innerHTML = alertHtml('error', err.message);
    });
  }

  // ------------------------------------------------------ course detail --
  function renderCourse(id) {
    setNav('catalog');
    app.innerHTML = '<div class="empty">Loading course...</div>';
    api('GET', '/api/courses/' + encodeURIComponent(id)).then(function (data) {
      var c = data.course;
      var lessons = c.lessons.map(function (l, i) {
        return '<div class="lesson-row"><span><span class="pos">' + (i + 1) + '.</span>' +
          '<a href="#/lesson/' + l.id + '">' + esc(l.title) + '</a></span></div>';
      }).join('') || '<p class="muted">No lessons yet.</p>';

      var quizzes = c.quizzes.map(function (q) {
        return '<div class="quiz-row"><span><strong>' + esc(q.title) + '</strong> ' +
          '<span class="muted">(' + q.question_count + ' questions)</span></span>' +
          '<a class="btn btn-outline btn-small" href="#/quiz/' + q.id + '">Take quiz</a></div>';
      }).join('') || '<p class="muted">No quizzes yet.</p>';

      var action;
      if (!state.user) {
        action = '<a class="btn btn-primary" href="#/login">Log in to enroll</a>';
      } else if (state.user.role !== 'student') {
        action = '<p class="muted">You are signed in as an instructor.</p>';
      } else if (data.enrolled) {
        action = '<a class="btn btn-outline" href="#/dashboard">Enrolled - go to dashboard</a>';
      } else {
        action = '<button class="btn btn-accent" id="enrollBtn">Enroll now</button>';
      }

      app.innerHTML =
        '<div class="detail-head">' +
          '<div><span class="badge">' + esc(c.category) + '</span>' + levelBadge(c.level) + '</div>' +
          '<h1>' + esc(c.title) + '</h1>' +
          '<p>' + esc(c.description) + '</p>' +
          '<p class="byline">Instructor: ' + esc(c.instructor_name) + ' &middot; ' + c.lessons.length + ' lessons &middot; ' + c.quizzes.length + ' quizzes</p>' +
          '<div class="mt" id="courseAction">' + action + '</div>' +
          '<div id="courseMsg" class="mt"></div>' +
        '</div>' +
        '<div class="columns">' +
          '<div class="panel"><h2>Lessons</h2>' + lessons + '</div>' +
          '<div class="panel"><h2>Quizzes</h2>' + quizzes + '</div>' +
        '</div>';

      var btn = document.getElementById('enrollBtn');
      if (btn) {
        btn.addEventListener('click', function () {
          btn.disabled = true;
          api('POST', '/api/courses/' + c.id + '/enroll').then(function () {
            document.getElementById('courseMsg').innerHTML = alertHtml('success', 'Enrolled! Your dashboard now tracks this course.');
            document.getElementById('courseAction').innerHTML = '<a class="btn btn-outline" href="#/dashboard">Go to dashboard</a>';
          }).catch(function (err) {
            document.getElementById('courseMsg').innerHTML = alertHtml('error', err.message);
            btn.disabled = false;
          });
        });
      }
    }).catch(function (err) {
      app.innerHTML = alertHtml('error', err.message);
    });
  }

  // ------------------------------------------------------ lesson reader -
  function renderLesson(id) {
    setNav('');
    app.innerHTML = '<div class="empty">Loading lesson...</div>';
    api('GET', '/api/lessons/' + encodeURIComponent(id)).then(function (data) {
      var l = data.lesson;
      var action = '';
      if (state.user && state.user.role === 'student') {
        action = data.completed
          ? '<span class="done-tag">&#10003; Completed</span>'
          : '<button class="btn btn-accent" id="completeBtn">Mark as complete</button>';
      }
      app.innerHTML =
        '<article class="reader">' +
          '<p class="crumb"><a href="#/course/' + l.course_id + '">&larr; ' + esc(data.course.title) + '</a></p>' +
          '<h1>' + esc(l.title) + '</h1>' +
          '<div class="prose">' + esc(l.content) + '</div>' +
          '<div class="reader-actions" id="lessonActions">' + action + '</div>' +
          '<div id="lessonMsg" class="mt"></div>' +
        '</article>';

      var btn = document.getElementById('completeBtn');
      if (btn) {
        btn.addEventListener('click', function () {
          btn.disabled = true;
          api('POST', '/api/lessons/' + l.id + '/complete').then(function (r) {
            document.getElementById('lessonActions').innerHTML = '<span class="done-tag">&#10003; Completed</span>';
            document.getElementById('lessonMsg').innerHTML =
              alertHtml('success', 'Lesson completed. Progress: ' + r.completedLessons + ' of ' + r.totalLessons + ' lessons.');
          }).catch(function (err) {
            document.getElementById('lessonMsg').innerHTML = alertHtml('error', err.message);
            btn.disabled = false;
          });
        });
      }
    }).catch(function (err) {
      app.innerHTML = alertHtml('error', err.message);
    });
  }

  // --------------------------------------------------------- quiz taker --
  function renderQuiz(id) {
    setNav('');
    app.innerHTML = '<div class="empty">Loading quiz...</div>';
    api('GET', '/api/quizzes/' + encodeURIComponent(id)).then(function (data) {
      var quiz = data.quiz;
      // Safety check for the UI: correct answers must never reach the browser here.
      var leaked = quiz.questions.some(function (q) { return q.correctIndex !== undefined; });
      var blocks = quiz.questions.map(function (q, qi) {
        var opts = q.options.map(function (o, oi) {
          return '<label class="opt" data-q="' + qi + '" data-o="' + oi + '">' +
            '<input type="radio" name="q' + qi + '" value="' + oi + '"> <span>' + esc(o) + '</span></label>';
        }).join('');
        return '<div class="quiz-block"><p class="q">' + (qi + 1) + '. ' + esc(q.text) + '</p>' + opts + '</div>';
      }).join('');

      var canSubmit = state.user && state.user.role === 'student';
      app.innerHTML =
        '<article class="reader">' +
          '<h1>' + esc(quiz.title) + '</h1>' +
          '<p class="muted">' + quiz.questionCount + ' questions. Choose one answer per question.</p>' +
          (leaked ? alertHtml('error', 'Internal error: answer key leaked to the client.') : '') +
          '<div id="quizForm">' + blocks +
            (canSubmit
              ? '<button class="btn btn-primary" id="submitQuiz">Submit answers</button>'
              : '<p class="muted">Log in as a student and enroll in the course to submit.</p>') +
          '</div>' +
          '<div id="quizMsg" class="mt"></div>' +
        '</article>';

      // Highlight picked options.
      document.querySelectorAll('.opt').forEach(function (label) {
        label.addEventListener('click', function () {
          var q = label.getAttribute('data-q');
          document.querySelectorAll('.opt[data-q="' + q + '"]').forEach(function (l) { l.classList.remove('picked'); });
          label.classList.add('picked');
        });
      });

      var submit = document.getElementById('submitQuiz');
      if (submit) {
        submit.addEventListener('click', function () {
          var answers = [];
          for (var i = 0; i < quiz.questions.length; i++) {
            var sel = document.querySelector('input[name="q' + i + '"]:checked');
            if (!sel) {
              document.getElementById('quizMsg').innerHTML = alertHtml('error', 'Please answer every question before submitting.');
              return;
            }
            answers.push(parseInt(sel.value, 10));
          }
          submit.disabled = true;
          api('POST', '/api/quizzes/' + quiz.id + '/submit', { answers: answers }).then(function (r) {
            var pct = Math.round((r.score / r.total) * 100);
            var cls = pct >= 80 ? 'good' : pct >= 50 ? 'mid' : 'low';
            var banner = '<div class="score-banner ' + cls + '">You scored ' + r.score + ' of ' + r.total + ' (' + pct + '%)</div>';
            var review = quiz.questions.map(function (q, qi) {
              var opts = q.options.map(function (o, oi) {
                var cls2 = '';
                if (oi === answers[qi] && r.correct[qi]) cls2 = ' correct';
                else if (oi === answers[qi] && !r.correct[qi]) cls2 = ' wrong';
                return '<div class="opt' + cls2 + '"><span>' + esc(o) + '</span></div>';
              }).join('');
              var mark = r.correct[qi]
                ? '<span class="done-tag">&#10003; Correct</span>'
                : '<span style="color:var(--danger);font-weight:700">&#10007; Your answer was wrong</span>';
              return '<div class="quiz-block"><p class="q">' + (qi + 1) + '. ' + esc(q.text) + ' ' + mark + '</p>' + opts + '</div>';
            }).join('');
            document.getElementById('quizForm').innerHTML = banner + review +
              '<a class="btn btn-outline" href="#/dashboard">Back to dashboard</a>';
            document.getElementById('quizMsg').innerHTML = '';
            window.scrollTo(0, 0);
          }).catch(function (err) {
            document.getElementById('quizMsg').innerHTML = alertHtml('error', err.message);
            submit.disabled = false;
          });
        });
      }
    }).catch(function (err) {
      app.innerHTML = alertHtml('error', err.message);
    });
  }

  // ------------------------------------------------- student dashboard ---
  function renderDashboard() {
    if (!needLogin('student')) return;
    setNav('dashboard');
    app.innerHTML = '<div class="empty">Loading your dashboard...</div>';
    api('GET', '/api/dashboard/me').then(function (data) {
      var list = data.enrollments;
      var head = '<h1>My Learning</h1>' +
        '<p class="muted">Signed in as ' + esc(state.user.name) + '. ' + list.length + ' course(s) enrolled.</p>';
      if (!list.length) {
        app.innerHTML = head + emptyHtml('You are not enrolled in any course yet. Browse the catalog and enroll.') +
          '<p class="center"><a class="btn btn-primary" href="#/">Browse courses</a></p>';
        return;
      }
      app.innerHTML = head + '<div class="grid">' + list.map(function (e) {
        var scores = e.quizScores.length
          ? e.quizScores.map(function (s) {
              return '<span class="score-pill">' + esc(s.title) + ': ' + s.best + '/' + s.total + '</span>';
            }).join('')
          : '<span class="muted">No quiz attempts yet.</span>';
        return '<article class="course-card">' +
          '<div><span class="badge">' + esc(e.category) + '</span>' + levelBadge(e.level) + '</div>' +
          '<h3><a href="#/course/' + e.id + '">' + esc(e.title) + '</a></h3>' +
          '<div class="progress-row"><div class="progress"><span style="width:' + e.progressPct + '%"></span></div>' +
          '<span class="pct">' + e.progressPct + '%</span></div>' +
          '<div class="card-meta">' + e.completedLessons + ' of ' + e.totalLessons + ' lessons complete</div>' +
          '<div>' + scores + '</div>' +
        '</article>';
      }).join('') + '</div>';
    }).catch(function (err) {
      app.innerHTML = alertHtml('error', err.message);
    });
  }

  // ---------------------------------------------- instructor dashboard ---
  function renderTeach(after) {
    if (!needLogin('instructor')) return;
    setNav('teach');
    app.innerHTML = '<div class="empty">Loading instructor dashboard...</div>';
    api('GET', '/api/instructor/me').then(function (data) {
      var t = data.totals;
      var stats =
        '<div class="stat-row">' +
          '<div class="stat"><div class="n">' + t.courses + '</div><div class="l">Courses</div></div>' +
          '<div class="stat"><div class="n">' + t.lessons + '</div><div class="l">Lessons</div></div>' +
          '<div class="stat"><div class="n">' + t.quizzes + '</div><div class="l">Quizzes</div></div>' +
          '<div class="stat"><div class="n">' + t.enrollments + '</div><div class="l">Enrollments</div></div>' +
          '<div class="stat"><div class="n">' + t.students + '</div><div class="l">Students</div></div>' +
        '</div>';

      var courses = data.courses.map(function (c) {
        return '<tr><td><a href="#/course/' + c.id + '">' + esc(c.title) + '</a></td>' +
          '<td>' + esc(c.category) + '</td><td>' + esc(c.level) + '</td>' +
          '<td>' + c.lessonCount + '</td><td>' + c.quizCount + '</td><td>' + c.enrollmentCount + '</td>' +
          '<td><button class="btn btn-outline btn-small manage-btn" data-id="' + c.id + '">Manage</button> ' +
          '<button class="btn btn-danger btn-small del-course-btn" data-id="' + c.id + '">Delete</button></td></tr>';
      }).join('');

      app.innerHTML =
        '<h1>Instructor Dashboard</h1>' +
        '<p class="muted">Welcome back, ' + esc(state.user.name) + '. Create courses, add lessons and quizzes, and watch enrollments grow.</p>' +
        stats +
        '<div id="teachMsg"></div>' +
        '<details class="builder" open><summary>Create a new course</summary><div class="builder-body">' +
          '<div class="form-row">' +
            '<div class="field"><label>Title</label><input type="text" id="ncTitle"></div>' +
            '<div class="field"><label>Category</label><input type="text" id="ncCat" placeholder="e.g. Programming"></div>' +
            '<div class="field"><label>Level</label><select id="ncLevel"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></div>' +
          '</div>' +
          '<div class="field"><label>Description</label><textarea id="ncDesc" style="min-height:4rem"></textarea></div>' +
          '<button class="btn btn-primary" id="createCourseBtn">Create course</button>' +
        '</div></details>' +
        '<div class="panel"><h2>My courses</h2>' +
          (data.courses.length
            ? '<div style="overflow-x:auto"><table class="manage-table"><thead><tr>' +
              '<th>Title</th><th>Category</th><th>Level</th><th>Lessons</th><th>Quizzes</th><th>Enrolled</th><th>Actions</th>' +
              '</tr></thead><tbody>' + courses + '</tbody></table></div>'
            : emptyHtml('No courses yet. Create your first one above.')) +
        '</div>' +
        '<div id="manageArea"></div>';

      document.getElementById('createCourseBtn').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        api('POST', '/api/courses', {
          title: document.getElementById('ncTitle').value,
          description: document.getElementById('ncDesc').value,
          category: document.getElementById('ncCat').value,
          level: document.getElementById('ncLevel').value
        }).then(function () { renderTeach(); })
          .catch(function (err) {
            document.getElementById('teachMsg').innerHTML = alertHtml('error', err.message);
            btn.disabled = false;
          });
      });

      document.querySelectorAll('.del-course-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Delete this course and all its lessons and quizzes?')) return;
          api('DELETE', '/api/courses/' + b.getAttribute('data-id'))
            .then(function () { renderTeach(); })
            .catch(function (err) { document.getElementById('teachMsg').innerHTML = alertHtml('error', err.message); });
        });
      });

      document.querySelectorAll('.manage-btn').forEach(function (b) {
        b.addEventListener('click', function () { openManager(b.getAttribute('data-id')); });
      });
      if (typeof after === 'function') after();
    }).catch(function (err) {
      app.innerHTML = alertHtml('error', err.message);
    });
  }

  // Manage panel for one course: add/delete lessons and quizzes.
  function openManager(courseId) {
    var area = document.getElementById('manageArea');
    area.innerHTML = '<div class="empty">Loading course...</div>';
    api('GET', '/api/courses/' + encodeURIComponent(courseId)).then(function (data) {
      var c = data.course;
      var lessonRows = c.lessons.map(function (l) {
        return '<div class="lesson-row"><span><span class="pos">' + l.position + '.</span>' + esc(l.title) + '</span>' +
          '<button class="btn btn-danger btn-small del-lesson-btn" data-id="' + l.id + '">Delete</button></div>';
      }).join('') || '<p class="muted">No lessons yet.</p>';
      var quizRows = c.quizzes.map(function (q) {
        return '<div class="quiz-row"><span><strong>' + esc(q.title) + '</strong> <span class="muted">(' + q.question_count + ' questions)</span></span>' +
          '<button class="btn btn-danger btn-small del-quiz-btn" data-id="' + q.id + '">Delete</button></div>';
      }).join('') || '<p class="muted">No quizzes yet.</p>';

      area.innerHTML =
        '<div class="panel" id="managePanel"><h2>Manage: ' + esc(c.title) + '</h2>' +
          '<div id="manageMsg"></div>' +
          '<h3>Lessons</h3>' + lessonRows +
          '<details class="builder"><summary>Add a lesson</summary><div class="builder-body">' +
            '<div class="field"><label>Lesson title</label><input type="text" id="nlTitle"></div>' +
            '<div class="field"><label>Content <span class="hint">(plain text, paragraphs separated by blank lines)</span></label>' +
            '<textarea id="nlContent" style="min-height:9rem"></textarea></div>' +
            '<button class="btn btn-primary" id="addLessonBtn">Add lesson</button>' +
          '</div></details>' +
          '<h3 class="mt">Quizzes</h3>' + quizRows +
          '<details class="builder"><summary>Add a quiz</summary><div class="builder-body">' +
            '<div class="field"><label>Quiz title</label><input type="text" id="nqTitle"></div>' +
            '<div id="questionBlocks"></div>' +
            '<button class="btn btn-outline btn-small" id="addQBlock">+ Add question</button> ' +
            '<button class="btn btn-primary" id="addQuizBtn">Create quiz</button>' +
          '</div></details>' +
        '</div>';
      document.getElementById('managePanel').scrollIntoView({ behavior: 'smooth', block: 'start' });

      document.getElementById('addLessonBtn').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        api('POST', '/api/courses/' + c.id + '/lessons', {
          title: document.getElementById('nlTitle').value,
          content: document.getElementById('nlContent').value
        }).then(function () { afterMutate(c.id); })
          .catch(function (err) {
            document.getElementById('manageMsg').innerHTML = alertHtml('error', err.message);
            btn.disabled = false;
          });
      });

      var qCount = 0;
      function addQuestionBlock() {
        qCount++;
        var div = document.createElement('div');
        div.className = 'q-block';
        div.innerHTML =
          '<div class="field"><label>Question ' + qCount + '</label><input type="text" class="qb-text"></div>' +
          [0, 1, 2, 3].map(function (i) {
            return '<div class="field"><label>Option ' + (i + 1) + '</label><input type="text" class="qb-opt"></div>';
          }).join('') +
          '<div class="correct-pick"><label>Correct answer:</label><select class="qb-correct">' +
          [0, 1, 2, 3].map(function (i) { return '<option value="' + i + '">Option ' + (i + 1) + '</option>'; }).join('') +
          '</select> <button class="btn btn-danger btn-small qb-remove">Remove</button></div>';
        div.querySelector('.qb-remove').addEventListener('click', function () { div.remove(); });
        document.getElementById('questionBlocks').appendChild(div);
      }
      document.getElementById('addQBlock').addEventListener('click', addQuestionBlock);
      addQuestionBlock();

      document.getElementById('addQuizBtn').addEventListener('click', function () {
        var btn = this;
        var blocks = Array.prototype.slice.call(document.querySelectorAll('#questionBlocks .q-block'));
        var questions = blocks.map(function (b) {
          return {
            text: b.querySelector('.qb-text').value,
            options: Array.prototype.slice.call(b.querySelectorAll('.qb-opt')).map(function (i) { return i.value; }),
            correctIndex: parseInt(b.querySelector('.qb-correct').value, 10)
          };
        });
        btn.disabled = true;
        api('POST', '/api/courses/' + c.id + '/quizzes', {
          title: document.getElementById('nqTitle').value,
          questions: questions
        }).then(function () { afterMutate(c.id); })
          .catch(function (err) {
            document.getElementById('manageMsg').innerHTML = alertHtml('error', err.message);
            btn.disabled = false;
          });
      });

      area.querySelectorAll('.del-lesson-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Delete this lesson?')) return;
          api('DELETE', '/api/lessons/' + b.getAttribute('data-id'))
            .then(function () { openManager(c.id); afterMutate(c.id); })
            .catch(function (err) { document.getElementById('manageMsg').innerHTML = alertHtml('error', err.message); });
        });
      });
      area.querySelectorAll('.del-quiz-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Delete this quiz and all its attempts?')) return;
          api('DELETE', '/api/quizzes/' + b.getAttribute('data-id'))
            .then(function () { openManager(c.id); afterMutate(c.id); })
            .catch(function (err) { document.getElementById('manageMsg').innerHTML = alertHtml('error', err.message); });
        });
      });
    }).catch(function (err) {
      area.innerHTML = alertHtml('error', err.message);
    });
  }

  // Manage panel for one course: add/delete lessons and quizzes.
  // afterMutate re-renders the instructor dashboard (fresh totals) and
  // re-opens this course's manage panel.
  function afterMutate(courseId) {
    renderTeach(function () { openManager(courseId); });
  }

  // ------------------------------------------------------------ auth ------
  function renderLogin() {
    setNav('');
    app.innerHTML =
      '<div class="form-card"><h2>Log in to SkillSprint</h2>' +
      '<div id="loginMsg"></div>' +
      '<div class="field"><label>Email</label><input type="email" id="liEmail" autocomplete="email"></div>' +
      '<div class="field"><label>Password</label><input type="password" id="liPass" autocomplete="current-password"></div>' +
      '<button class="btn btn-primary" id="loginBtn" style="width:100%">Log in</button>' +
      '<p class="center muted">No account? <a href="#/register">Sign up</a></p>' +
      '<p class="muted" style="font-size:0.85rem">Demo accounts: instructor@example.com / teach123 &middot; demo@example.com / demo123</p>' +
      '</div>';
    var go = function () {
      var btn = document.getElementById('loginBtn');
      btn.disabled = true;
      api('POST', '/api/auth/login', {
        email: document.getElementById('liEmail').value,
        password: document.getElementById('liPass').value
      }).then(function (data) {
        setSession(data.token, data.user);
        location.hash = data.user.role === 'instructor' ? '#/teach' : '#/dashboard';
      }).catch(function (err) {
        document.getElementById('loginMsg').innerHTML = alertHtml('error', err.message);
        btn.disabled = false;
      });
    };
    document.getElementById('loginBtn').addEventListener('click', go);
    document.getElementById('liPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
  }

  function renderRegister() {
    setNav('');
    app.innerHTML =
      '<div class="form-card"><h2>Create your account</h2>' +
      '<div id="regMsg"></div>' +
      '<div class="field"><label>Full name</label><input type="text" id="rgName" autocomplete="name"></div>' +
      '<div class="field"><label>Email</label><input type="email" id="rgEmail" autocomplete="email"></div>' +
      '<div class="field"><label>Password <span class="hint">(at least 6 characters)</span></label>' +
      '<input type="password" id="rgPass" autocomplete="new-password"></div>' +
      '<div class="field"><label>I want to</label><select id="rgRole">' +
      '<option value="student">Learn (student)</option><option value="instructor">Teach (instructor)</option>' +
      '</select></div>' +
      '<button class="btn btn-primary" id="regBtn" style="width:100%">Sign up</button>' +
      '<p class="center muted">Have an account? <a href="#/login">Log in</a></p></div>';
    document.getElementById('regBtn').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      api('POST', '/api/auth/register', {
        name: document.getElementById('rgName').value,
        email: document.getElementById('rgEmail').value,
        password: document.getElementById('rgPass').value,
        role: document.getElementById('rgRole').value
      }).then(function (data) {
        setSession(data.token, data.user);
        location.hash = data.user.role === 'instructor' ? '#/teach' : '#/dashboard';
      }).catch(function (err) {
        document.getElementById('regMsg').innerHTML = alertHtml('error', err.message);
        btn.disabled = false;
      });
    });
  }

  // -------------------------------------------------------------- init ----
  document.getElementById('logoutBtn').addEventListener('click', function () {
    if (state.token) api('POST', '/api/auth/logout').catch(function () {});
    setSession(null, null);
    location.hash = '#/';
  });
  document.getElementById('menuToggle').addEventListener('click', function () {
    document.getElementById('topnav').classList.toggle('open');
  });

  window.addEventListener('hashchange', route);
  boot();
})();
