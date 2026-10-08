// js/teacher.js — Teacher dashboard: question bank, exam builder, results

(async function () {
  let profile;
  try {
    profile = await requireRole(['teacher']);
  } catch (e) {
    profile = null;
  }
  if (!profile) {
    window.location.replace('teacher-login.html');
    return;
  }

  if (!profile.is_approved) {
    document.querySelector('.dash-main').innerHTML = `
      <div class="dash-panel active" style="text-align:center; padding: 4rem 1rem;">
        <div style="font-size:3.5rem; margin-bottom:1rem;">⏳</div>
        <h2>Account Pending Admin Approval</h2>
        <p style="max-width:520px; margin: 1rem auto 2rem; color: var(--gold-light); line-height: 1.6;">
          Your teacher registration (<strong>${escapeHtml(profile.email)}</strong>) is pending administrator approval.
          Once approved by an Admin, you can create questions, assemble exams, and review candidate attempts.
        </p>
        <button class="btn btn-primary btn-inline" onclick="window.location.reload();">Refresh Approval Status ↻</button>
      </div>`;
    return;
  }

  document.getElementById('teacher-name').textContent = `${profile.name} · ${profile.staff_id || ''}`;
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await signOut();
    window.location.href = 'teacher-login.html';
  });

  // Tab navigation
  document.querySelectorAll('.dash-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.dash-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.dash-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      const targetPanel = document.getElementById('panel-' + tab.dataset.panel);
      if (targetPanel) targetPanel.classList.add('active');

      if (tab.dataset.panel === 'students') loadStudentManagement();
      if (tab.dataset.panel === 'banned') loadBannedStudents();
      if (tab.dataset.panel === 'bank') refreshBank();
      if (tab.dataset.panel === 'exams') refreshExams();
      if (tab.dataset.panel === 'results') refreshResultsExamSelect();
    });
  });

  // Student Management & Deletion logic
  async function loadStudentManagement() {
    const listEl = document.getElementById('students-approval-list');
    const filterSelect = document.getElementById('student-filter-select');
    if (!listEl) return;
    const filterVal = filterSelect ? filterSelect.value : 'all';
    listEl.innerHTML = '<div class="dash-empty">Loading student accounts…</div>';

    try {
      let students = await teacherListAllStudents();
      if (filterVal === 'pending') {
        students = students.filter((s) => !s.is_approved);
      } else if (filterVal === 'approved') {
        students = students.filter((s) => s.is_approved);
      }

      if (!students.length) {
        listEl.innerHTML = `<div class="dash-empty">No ${filterVal !== 'all' ? filterVal : ''} student accounts found.</div>`;
        return;
      }

      listEl.innerHTML = students
        .map(
          (s) => `
        <article class="dash-item" data-id="${s.id}">
          <div class="dash-item-main">
            <div class="dash-item-title">
              ${escapeHtml(s.name)} · <span class="mono">${escapeHtml(s.register_number || 'N/A')}</span>
              ${
                s.is_approved
                  ? '<span class="badge active" style="margin-left:8px; background:rgba(34,197,94,0.15); color:#4ade80; border:1px solid rgba(34,197,94,0.3);">Approved</span>'
                  : '<span class="badge draft" style="margin-left:8px; background:rgba(234,179,8,0.15); color:#fde047; border:1px solid rgba(234,179,8,0.3);">Pending Approval</span>'
              }
            </div>
            <div class="dash-item-meta mono">
              Email identity: <strong>${escapeHtml(s.email)}</strong> · Registered: ${new Date(s.created_at).toLocaleString()}
            </div>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            ${
              !s.is_approved
                ? `<button type="button" class="btn btn-primary btn-sm btn-approve-student" data-id="${s.id}">Approve Student ✓</button>`
                : ''
            }
            <button type="button" class="btn btn-ghost btn-sm btn-delete-student" data-id="${s.id}" data-name="${escapeHtml(s.name)}" style="color:var(--danger, #ff6b6b); border:1px solid rgba(255,107,107,0.3);">Delete Student 🗑</button>
          </div>
        </article>`
        )
        .join('');

      listEl.querySelectorAll('.btn-approve-student').forEach((b) => {
        b.addEventListener('click', async () => {
          b.disabled = true;
          b.textContent = 'Approving…';
          try {
            await teacherApproveStudent(b.dataset.id, true);
            await loadStudentManagement();
          } catch (err) {
            alert('Failed to approve student: ' + (err.message || err));
            b.disabled = false;
            b.textContent = 'Approve Student ✓';
          }
        });
      });

      listEl.querySelectorAll('.btn-delete-student').forEach((b) => {
        b.addEventListener('click', async () => {
          const name = b.dataset.name || 'this student';
          if (!confirm(`Are you sure you want to permanently delete student "${name}"?\nThis will remove their profile and exam history.`)) {
            return;
          }
          b.disabled = true;
          b.textContent = 'Deleting…';
          try {
            await teacherDeleteStudent(b.dataset.id);
            await loadStudentManagement();
          } catch (err) {
            alert('Failed to delete student: ' + (err.message || err));
            b.disabled = false;
            b.textContent = 'Delete Student 🗑';
          }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div class="dash-empty" style="color:var(--danger);">Error loading students: ${escapeHtml(e.message || String(e))}</div>`;
    }
  }

  document.getElementById('btn-refresh-students')?.addEventListener('click', loadStudentManagement);
  document.getElementById('student-filter-select')?.addEventListener('change', loadStudentManagement);
  loadStudentManagement();

  // ---- Banned Students (Violated) Management ----
  async function loadBannedStudents() {
    const listEl = document.getElementById('banned-students-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="dash-empty">Loading banned students…</div>';

    try {
      const violated = await teacherListViolatedStudents();

      if (!violated.length) {
        listEl.innerHTML = `
          <div class="dash-empty" style="padding: 3rem 1rem; text-align:center;">
            <div style="font-size:3rem; margin-bottom:1rem;">✅</div>
            <h3 style="margin-bottom:0.5rem;">No Banned Students</h3>
            <p style="color:var(--gold-light); max-width:400px; margin:0 auto;">All students are currently in good standing. Banned students will appear here when a proctoring violation lockout is triggered.</p>
          </div>`;
        return;
      }

      listEl.innerHTML = violated
        .map((v) => {
          const student = v.users || {};
          const exam = v.exams || {};
          const bannedAt = v.locked_at ? new Date(v.locked_at).toLocaleString() : 'Unknown';
          const scoreText = (v.score != null && v.max_score != null)
            ? `${v.score} / ${v.max_score}`
            : '—';
          const reason = v.submit_reason || 'Proctoring violations exceeded limit';
          return `
          <article class="dash-item" data-student-id="${escapeHtml(v.student_id || student.id || '')}" data-exam-id="${escapeHtml(v.exam_id || exam.id || '')}">
            <div class="dash-item-main">
              <div class="dash-item-title">
                ${escapeHtml(student.name || 'Unknown Student')} · <span class="mono">${escapeHtml(student.register_number || 'N/A')}</span>
                <span class="badge" style="margin-left:8px; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3);">🚫 BANNED</span>
              </div>
              <div class="dash-item-meta mono" style="margin-top:4px;">
                📋 Exam: <strong>${escapeHtml(exam.exam_code || '')} — ${escapeHtml(exam.title || 'Unknown Exam')}</strong>
              </div>
              <div class="dash-item-meta mono" style="margin-top:2px;">
                📧 ${escapeHtml(student.email || 'N/A')} · Score at ban: ${scoreText}
              </div>
              <div class="dash-item-meta mono" style="margin-top:2px; color: #f87171;">
                ⏰ Banned at: ${bannedAt}
              </div>
              <div class="dash-item-meta" style="margin-top:4px; font-size:12px; color:var(--gold-light);">
                📌 Reason: ${escapeHtml(reason)}
              </div>
            </div>
            <div style="display:flex; gap:8px; align-items:center; flex-shrink:0;">
              <button
                type="button"
                class="btn btn-primary btn-sm btn-unban-student"
                data-student-id="${escapeHtml(v.student_id || student.id || '')}"
                data-exam-id="${escapeHtml(v.exam_id || exam.id || '')}"
                data-student-name="${escapeHtml(student.name || 'Student')}"
                title="Approve unban — allow this student to retake the exam"
              >✅ Approve Unban</button>
            </div>
          </article>`;
        })
        .join('');

      // Wire up unban buttons
      listEl.querySelectorAll('.btn-unban-student').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const sid = btn.dataset.studentId;
          const eid = btn.dataset.examId;
          const sname = btn.dataset.studentName || 'this student';
          if (!confirm(`Approve unban for "${sname}"?\n\nThis will remove their violation lock and allow them to retake the exam. This action cannot be undone.`)) {
            return;
          }
          btn.disabled = true;
          btn.textContent = 'Unbanning…';
          try {
            await teacherUnlockStudent(sid, eid);
            await loadBannedStudents();
          } catch (err) {
            alert('Failed to unban student: ' + (err.message || err));
            btn.disabled = false;
            btn.textContent = '✅ Approve Unban';
          }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div class="dash-empty" style="color:var(--danger);">Error loading banned students: ${escapeHtml(e.message || String(e))}</div>`;
    }
  }

  document.getElementById('btn-refresh-banned')?.addEventListener('click', loadBannedStudents);
  loadBannedStudents();

  // MS Word Importer Logic
  let parsedWordQuestions = [];
  const btnImportWord = document.getElementById('btn-import-word');
  const wordWrap = document.getElementById('word-import-wrap');
  const wordInput = document.getElementById('word-file-input');
  const wordPreviewSection = document.getElementById('word-preview-section');
  const wordParsedList = document.getElementById('word-parsed-list');
  const parsedCountEl = document.getElementById('parsed-count');
  const wordErr = document.getElementById('word-import-error');

  if (btnImportWord) {
    btnImportWord.addEventListener('click', () => {
      wordWrap.hidden = !wordWrap.hidden;
      document.getElementById('q-form-wrap').hidden = true;
      wordErr.hidden = true;
    });
  }

  document.getElementById('btn-word-cancel')?.addEventListener('click', () => {
    wordWrap.hidden = true;
    wordInput.value = '';
    parsedWordQuestions = [];
    wordPreviewSection.hidden = true;
  });

  wordInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    wordErr.hidden = true;
    if (typeof mammoth === 'undefined') {
      wordErr.hidden = false;
      wordErr.textContent = 'Mammoth library failed to load. Check internet connection.';
      return;
    }
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const text = result.value || '';
      parsedWordQuestions = parseWordQuestionsText(text);

      if (!parsedWordQuestions.length) {
        throw new Error('No questions could be parsed from this document. Ensure questions follow format (Q1..., A)..., B)..., Answer: A).');
      }

      parsedCountEl.textContent = parsedWordQuestions.length;
      wordParsedList.innerHTML = parsedWordQuestions
        .map(
          (q, idx) => `
        <div style="margin-bottom:12px; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">
          <strong>Q${idx + 1}: ${escapeHtml(q.question_text)}</strong>
          <div style="font-size:12px; margin-top:4px; color:var(--gold-light);">
            Options: A) ${escapeHtml(q.options[0])} | B) ${escapeHtml(q.options[1])} | C) ${escapeHtml(q.options[2])} | D) ${escapeHtml(q.options[3])}<br>
            Correct: <strong>Option ${String.fromCharCode(65 + q.correct_option)}</strong> | Marks: ${q.marks}
          </div>
        </div>`
        )
        .join('');
      wordPreviewSection.hidden = false;
    } catch (err) {
      wordErr.hidden = false;
      wordErr.textContent = err.message || String(err);
      wordPreviewSection.hidden = true;
    }
  });

  document.getElementById('btn-word-save-all')?.addEventListener('click', async () => {
    if (!parsedWordQuestions.length) return;
    const saveBtn = document.getElementById('btn-word-save-all');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await bulkCreateQuestions(parsedWordQuestions);
      wordWrap.hidden = true;
      wordInput.value = '';
      parsedWordQuestions = [];
      wordPreviewSection.hidden = true;
      await refreshBank();
      alert('Successfully imported all questions into your question bank!');
    } catch (err) {
      wordErr.hidden = false;
      wordErr.textContent = err.message || String(err);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save All to Question Bank';
    }
  });

  function parseWordQuestionsText(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const questions = [];
    let currentQ = null;

    for (const line of lines) {
      const qMatch = line.match(/^(?:Q\d*[\.\:]?|\d+[\.\)]|Question\s*\d*[\.\:]?)\s*(.*)/i);
      const optMatch = line.match(/^([A-D])[\.\)]\s*(.*)/i);
      const ansMatch = line.match(/^(?:Answer|Ans|Correct[\s\-]*Option)\s*[\:\=]\s*([A-D])/i);
      const marksMatch = line.match(/^(?:Marks|Points)\s*[\:\=]\s*(\d+(?:\.\d+)?)/i);

      if (qMatch && !optMatch && !ansMatch && !marksMatch) {
        if (currentQ && currentQ.question_text) questions.push(currentQ);
        currentQ = {
          question_text: qMatch[1] || line,
          options: [],
          correct_option: 0,
          marks: 1,
        };
      } else if (optMatch && currentQ) {
        const idx = optMatch[1].toUpperCase().charCodeAt(0) - 65;
        currentQ.options[idx] = optMatch[2];
      } else if (ansMatch && currentQ) {
        currentQ.correct_option = ansMatch[1].toUpperCase().charCodeAt(0) - 65;
      } else if (marksMatch && currentQ) {
        currentQ.marks = parseFloat(marksMatch[1]) || 1;
      } else if (currentQ) {
        if (currentQ.options.length === 0) {
          currentQ.question_text += ' ' + line;
        }
      }
    }
    if (currentQ && currentQ.question_text) questions.push(currentQ);

    return questions.map((q) => ({
      question_text: q.question_text,
      options: [q.options[0] || 'Option A', q.options[1] || 'Option B', q.options[2] || 'Option C', q.options[3] || 'Option D'],
      correct_option: Math.max(0, Math.min(3, q.correct_option || 0)),
      marks: q.marks || 1,
    }));
  }



  let bank = [];
  let exams = [];

  async function refreshBank() {
    bank = await listMyQuestions();
    const list = document.getElementById('bank-list');
    if (!bank.length) {
      list.innerHTML = '<div class="dash-empty">No questions yet. Create your first MCQ.</div>';
      return;
    }
    list.innerHTML = bank
      .map(
        (q) => `
      <article class="dash-item" data-id="${q.id}">
        <div class="dash-item-main">
          <div class="dash-item-title">
            ${escapeHtml(q.question_text)}
            ${
              q.is_locked
                ? `<span class="badge draft" style="margin-left:8px; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3);" title="Used in active exam: ${escapeHtml(q.locked_exam_title || '')}">🔒 Locked (In Active Exam)</span>`
                : ''
            }
          </div>
          <div class="dash-item-meta mono">
            Correct: ${String.fromCharCode(65 + q.correct_option)} · ${q.marks} mark(s)
            ${q.topic ? ' · ' + escapeHtml(q.topic) : ''}
          </div>
          <ol class="dash-opts">
            ${(q.options || []).map((o, i) => `<li class="${i === q.correct_option ? 'correct' : ''}">${escapeHtml(o)}</li>`).join('')}
          </ol>
        </div>
        <div class="dash-item-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-act="edit">Edit ✏️</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="del" style="color:var(--danger, #ff6b6b); border:1px solid rgba(255,107,107,0.3);">Delete 🗑</button>
        </div>
      </article>`
      )
      .join('');

    list.querySelectorAll('.dash-item').forEach((el) => {
      el.querySelector('[data-act="edit"]').addEventListener('click', () => openQForm(el.dataset.id));
      const delBtn = el.querySelector('[data-act="del"]');
      delBtn.addEventListener('click', async () => {
        const qId = el.dataset.id;
        const qItem = bank.find((x) => x.id === qId);
        if (!confirm('Are you sure you want to delete this question from your question bank?')) return;
        delBtn.disabled = true;
        delBtn.textContent = 'Deleting…';
        try {
          await deleteQuestion(qId, false);
          await refreshBank();
        } catch (err) {
          const msg = err.message || String(err);
          if (msg.includes('locked exam') || msg.includes('locked')) {
            const examInfo = qItem && qItem.locked_exam_title ? ` ("${qItem.locked_exam_title}")` : '';
            if (
              confirm(
                `This question is attached to a locked active exam${examInfo}.\n\nDo you want to FORCE DELETE it? (This will un-link it from the exam and remove it from your question bank).`
              )
            ) {
              try {
                await deleteQuestion(qId, true);
                await refreshBank();
                return;
              } catch (forceErr) {
                alert('Failed to force delete question: ' + (forceErr.message || String(forceErr)));
              }
            }
          } else {
            alert('Failed to delete question: ' + msg);
          }
          delBtn.disabled = false;
          delBtn.textContent = 'Delete 🗑';
        }
      });
    });
  }

  document.getElementById('btn-delete-all-q')?.addEventListener('click', async () => {
    if (!confirm('⚠️ Are you sure you want to delete ALL questions from your question bank?\n\nThis will remove all questions and un-link them from exams. This action CANNOT be undone.')) {
      return;
    }
    const btn = document.getElementById('btn-delete-all-q');
    btn.disabled = true;
    btn.textContent = 'Deleting All…';
    try {
      await deleteAllQuestions();
      await refreshBank();
      alert('Successfully deleted all questions from your question bank!');
    } catch (err) {
      alert('Failed to delete all questions: ' + (err.message || String(err)));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Delete All Questions 🗑';
    }
  });

  function openQForm(id) {
    const wrap = document.getElementById('q-form-wrap');
    wrap.hidden = false;
    document.getElementById('q-form-error').hidden = true;
    if (id) {
      const q = bank.find((x) => x.id === id);
      document.getElementById('q-form-title').textContent = 'Edit Question';
      document.getElementById('q-edit-id').value = id;
      document.getElementById('q-text').value = q.question_text;
      (q.options || []).forEach((o, i) => {
        const inp = document.getElementById('q-opt-' + i);
        if (inp) inp.value = o;
      });
      document.getElementById('q-correct').value = String(q.correct_option);
      document.getElementById('q-topic').value = q.topic || '';
      document.getElementById('q-marks').value = q.marks;
      document.getElementById('q-neg').value = q.negative_marking_value;
    } else {
      document.getElementById('q-form-title').textContent = 'New Question';
      document.getElementById('q-edit-id').value = '';
      document.getElementById('q-text').value = '';
      [0, 1, 2, 3].forEach((i) => (document.getElementById('q-opt-' + i).value = ''));
      document.getElementById('q-correct').value = '0';
      document.getElementById('q-topic').value = '';
      document.getElementById('q-marks').value = '1';
      document.getElementById('q-neg').value = '0';
    }
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.getElementById('btn-new-q').addEventListener('click', () => openQForm(null));
  document.getElementById('btn-q-cancel').addEventListener('click', () => {
    document.getElementById('q-form-wrap').hidden = true;
  });

  document.getElementById('btn-q-save').addEventListener('click', async () => {
    const err = document.getElementById('q-form-error');
    err.hidden = true;
    const options = [0, 1, 2, 3].map((i) => document.getElementById('q-opt-' + i).value.trim());
    if (options.some((o) => !o) || !document.getElementById('q-text').value.trim()) {
      err.hidden = false;
      err.textContent = 'Fill in the question and all four options.';
      return;
    }
    const payload = {
      question_text: document.getElementById('q-text').value.trim(),
      options,
      correct_option: Number(document.getElementById('q-correct').value),
      marks: Number(document.getElementById('q-marks').value),
      negative_marking_value: Number(document.getElementById('q-neg').value),
      topic: document.getElementById('q-topic').value.trim(),
    };
    try {
      const id = document.getElementById('q-edit-id').value;
      if (id) await updateQuestion(id, payload);
      else await createQuestion(payload);
      document.getElementById('q-form-wrap').hidden = true;
      await refreshBank();
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message || String(e);
    }
  });

  // ---- Exams ----
  async function refreshExams() {
    exams = await listMyExams();
    const list = document.getElementById('exam-list');
    if (!exams.length) {
      list.innerHTML = '<div class="dash-empty">No exams yet. Build one from your question bank.</div>';
      return;
    }
    list.innerHTML = exams
      .map(
        (e) => `
      <article class="dash-item">
        <div class="dash-item-main">
          <div class="dash-item-title">${escapeHtml(e.title)}</div>
          <div class="dash-item-meta mono">
            ${escapeHtml(e.exam_code)} · ${e.duration_minutes} min ·
            <span class="badge ${e.status}">${e.status}</span>
            ${e.is_locked ? '<span class="badge locked">questions frozen</span>' : ''}
          </div>
        </div>
        <div class="dash-item-actions">
          ${
            e.status === 'draft'
              ? `<button type="button" class="btn btn-primary btn-sm" data-pub="${e.id}">Publish</button>`
              : `<button type="button" class="btn btn-ghost btn-sm" data-unpub="${e.id}">Unpublish</button>`
          }
          <button type="button" class="btn btn-ghost btn-sm btn-delete-exam" data-id="${e.id}" data-title="${escapeHtml(e.title)}" style="color:var(--danger, #ff6b6b); border:1px solid rgba(255,107,107,0.3);">Delete 🗑</button>
        </div>
      </article>`
      )
      .join('');

    list.querySelectorAll('[data-pub]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await setExamStatus(btn.dataset.pub, 'published');
          await refreshExams();
          await refreshBank();
        } catch (e) {
          alert(e.message);
        }
      });
    });
    list.querySelectorAll('[data-unpub]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await setExamStatus(btn.dataset.unpub, 'draft');
          await refreshExams();
          await refreshBank();
        } catch (e) {
          alert(e.message);
        }
      });
    });
    list.querySelectorAll('.btn-delete-exam').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const title = btn.dataset.title || 'this exam';
        if (!confirm(`Are you sure you want to delete exam "${title}"?\n\nThis will remove the exam and its question assignments.`)) {
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Deleting…';
        try {
          await deleteExam(btn.dataset.id);
          await refreshExams();
          await refreshBank();
        } catch (err) {
          alert('Failed to delete exam: ' + (err.message || String(err)));
          btn.disabled = false;
          btn.textContent = 'Delete 🗑';
        }
      });
    });
  }

  document.getElementById('btn-delete-all-exams')?.addEventListener('click', async () => {
    if (!confirm('⚠️ Are you sure you want to delete ALL exams?\n\nThis will remove all exams, attempts, and violation logs. This action CANNOT be undone.')) {
      return;
    }
    const btn = document.getElementById('btn-delete-all-exams');
    btn.disabled = true;
    btn.textContent = 'Deleting All…';
    try {
      await deleteAllExams();
      await refreshExams();
      await refreshBank();
      alert('Successfully deleted all exams!');
    } catch (err) {
      alert('Failed to delete all exams: ' + (err.message || String(err)));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Delete All Exams 🗑';
    }
  });

  function renderExamPicker() {
    const box = document.getElementById('ex-q-picker');
    if (!bank.length) {
      box.innerHTML = '<p class="dash-empty">Add questions to the bank first.</p>';
      return;
    }
    box.innerHTML = bank
      .map(
        (q) => `
      <label class="q-pick-row">
        <input type="checkbox" value="${q.id}">
        <span>${escapeHtml(q.question_text.slice(0, 120))}${q.question_text.length > 120 ? '…' : ''}</span>
      </label>`
      )
      .join('');
  }

  document.getElementById('btn-new-exam').addEventListener('click', () => {
    document.getElementById('exam-form-wrap').hidden = false;
    document.getElementById('ex-form-error').hidden = true;
    document.getElementById('ex-code').value = '';
    document.getElementById('ex-title').value = '';
    document.getElementById('ex-duration').value = '15';
    renderExamPicker();
  });
  document.getElementById('btn-ex-cancel').addEventListener('click', () => {
    document.getElementById('exam-form-wrap').hidden = true;
  });

  document.getElementById('btn-ex-save').addEventListener('click', async () => {
    const err = document.getElementById('ex-form-error');
    err.hidden = true;
    const selected = [...document.querySelectorAll('#ex-q-picker input:checked')].map((c) => c.value);
    if (!selected.length) {
      err.hidden = false;
      err.textContent = 'Select at least one question.';
      return;
    }
    try {
      await createExam({
        exam_code: document.getElementById('ex-code').value,
        title: document.getElementById('ex-title').value,
        duration_minutes: document.getElementById('ex-duration').value,
        questionIds: selected,
      });
      document.getElementById('exam-form-wrap').hidden = true;
      await refreshExams();
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message || String(e);
    }
  });

  // ---- Results ----
  async function refreshResultsExamSelect() {
    exams = await listMyExams();
    const sel = document.getElementById('results-exam');
    sel.innerHTML =
      '<option value="">Select an exam…</option>' +
      exams.map((e) => `<option value="${e.id}">${escapeHtml(e.exam_code)} — ${escapeHtml(e.title)}</option>`).join('');
  }

  document.getElementById('results-exam').addEventListener('change', async (ev) => {
    const examId = ev.target.value;
    const list = document.getElementById('results-list');
    if (!examId) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = '<div class="dash-empty">Loading…</div>';
    try {
      const attempts = await listExamAttempts(examId);
      if (!attempts.length) {
        list.innerHTML = '<div class="dash-empty">No attempts yet.</div>';
        return;
      }
      list.innerHTML = '';
      for (const a of attempts) {
        const student = a.users || {};
        const violations = await listViolationsForAttempt(a.id);
        const article = document.createElement('article');
        article.className = 'dash-item';
        article.innerHTML = `
          <div class="dash-item-main">
            <div class="dash-item-title">${escapeHtml(student.name || 'Student')} · <span class="mono">${escapeHtml(student.register_number || '')}</span></div>
            <div class="dash-item-meta mono">
              ${a.status} · score ${a.score != null ? a.score + '/' + (a.max_score ?? '—') : '—'}
              · ${a.submitted_at ? new Date(a.submitted_at).toLocaleString() : 'in progress'}
            </div>
            ${
              violations.length
                ? `<ul class="viol-mini">${violations
                    .map((v) => `<li><strong>${escapeHtml(v.type)}</strong> — ${escapeHtml(v.message)}</li>`)
                    .join('')}</ul>`
                : '<p class="dash-item-meta">No violations</p>'
            }
          </div>`;
        list.appendChild(article);
      }
    } catch (e) {
      list.innerHTML = `<div class="form-error">${escapeHtml(e.message)}</div>`;
    }
  });

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  await loadStudentManagement();
  await loadBannedStudents();
  await refreshBank();
  await refreshExams();
})();
