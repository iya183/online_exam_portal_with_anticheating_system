// js/admin.js — Admin dashboard: unlocks, oversight

(async function () {
  let profile;
  try {
    profile = await requireRole(['admin']);
  } catch (_) {
    profile = null;
  }
  if (!profile) {
    window.location.replace('admin-login.html');
    return;
  }

  document.getElementById('admin-name').textContent = `${profile.name} · ${profile.staff_id || ''}`;
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await signOut();
    window.location.href = 'admin-login.html';
  });

  document.querySelectorAll('.dash-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.dash-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.dash-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      const targetPanel = document.getElementById('panel-' + tab.dataset.panel);
      if (targetPanel) targetPanel.classList.add('active');

      if (tab.dataset.panel === 'locks') loadLocks();
      if (tab.dataset.panel === 'teachers') loadPendingTeachers();
      if (tab.dataset.panel === 'attempts') loadAttempts();
      if (tab.dataset.panel === 'exams') loadExams();
      if (tab.dataset.panel === 'users') loadUsers();
    });
  });

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function loadLocks() {
    const list = document.getElementById('locks-list');
    if (!list) return;
    list.innerHTML = '<div class="dash-empty">Loading…</div>';
    try {
      const locks = await adminListLocks();
      if (!locks || !locks.length) {
        list.innerHTML = '<div class="dash-empty">No students currently locked or banned.</div>';
        return;
      }
      list.innerHTML = locks
        .map((l) => {
          const student = l.users || {};
          const exam = l.exams || {};
          const sName = escapeHtml(student.name || 'Student');
          const regNum = escapeHtml(student.register_number || 'N/A');
          const email = escapeHtml(student.email || 'N/A');
          const examCode = escapeHtml(exam.exam_code || 'EXAM');
          const examTitle = escapeHtml(exam.title || '');
          const lockDate = l.locked_at ? new Date(l.locked_at).toLocaleString() : 'Recently';

          return `
          <article class="dash-item">
            <div class="dash-item-main">
              <div class="dash-item-title">
                ${sName} · <span class="mono">${regNum}</span>
                <span class="badge locked" style="margin-left:8px; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3);">BANNED / LOCKED</span>
              </div>
              <div class="dash-item-meta mono">
                Registered Gmail / Email: <strong>${email}</strong><br>
                Exam: <strong>${examCode}</strong>${examTitle ? ' — ' + examTitle : ''}
                · Locked at: ${lockDate}
              </div>
            </div>
            <div class="dash-item-actions">
              <button type="button" class="btn btn-primary btn-sm"
                data-unlock-student="${l.student_id}" data-unlock-exam="${l.exam_id}">
                Unban & Allow Re-appear
              </button>
            </div>
          </article>`;
        })
        .join('');

      list.querySelectorAll('[data-unlock-student]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Unban this student and allow a new attempt on this exam?')) return;
          btn.disabled = true;
          try {
            await adminUnlock(btn.dataset.unlockStudent, btn.dataset.unlockExam);
            await loadLocks();
          } catch (e) {
            alert(e.message || String(e));
            btn.disabled = false;
          }
        });
      });
    } catch (e) {
      list.innerHTML = `<div class="form-error">${escapeHtml(e.message || String(e))}</div>`;
    }
  }

  async function loadPendingTeachers() {
    const list = document.getElementById('teachers-list');
    if (!list) return;
    list.innerHTML = '<div class="dash-empty">Loading…</div>';
    try {
      const pending = await adminGetPendingTeachers();
      if (!pending.length) {
        list.innerHTML = '<div class="dash-empty">No pending teacher approval requests.</div>';
        return;
      }
      list.innerHTML = pending
        .map((t) => `
        <article class="dash-item">
          <div class="dash-item-main">
            <div class="dash-item-title">${escapeHtml(t.name)} · <span class="mono">${escapeHtml(t.staff_id || 'N/A')}</span></div>
            <div class="dash-item-meta mono">
              Email: ${escapeHtml(t.email)} · Registered: ${new Date(t.created_at).toLocaleString()}
            </div>
          </div>
          <div class="dash-item-actions" style="display:flex; gap:8px;">
            <button type="button" class="btn btn-primary btn-sm" data-approve-teacher="${t.id}">Approve</button>
            <button type="button" class="btn btn-ghost btn-sm" style="color:var(--crimson-light);" data-reject-teacher="${t.id}">Reject</button>
          </div>
        </article>`)
        .join('');

      list.querySelectorAll('[data-approve-teacher]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Approve this teacher account?')) return;
          btn.disabled = true;
          try {
            await adminApproveTeacher(btn.dataset.approveTeacher, true);
            await loadPendingTeachers();
            await loadUsers();
          } catch (e) {
            alert(e.message);
            btn.disabled = false;
          }
        });
      });

      list.querySelectorAll('[data-reject-teacher]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Reject and delete this teacher registration request?')) return;
          btn.disabled = true;
          try {
            await adminApproveTeacher(btn.dataset.rejectTeacher, false);
            await loadPendingTeachers();
            await loadUsers();
          } catch (e) {
            alert(e.message);
            btn.disabled = false;
          }
        });
      });
    } catch (e) {
      list.innerHTML = `<div class="form-error">${escapeHtml(e.message)}</div>`;
    }
  }

  async function loadAttempts() {
    const list = document.getElementById('attempts-list');
    list.innerHTML = '<div class="dash-empty">Loading…</div>';
    try {
      const attempts = await adminListAllAttempts();
      if (!attempts.length) {
        list.innerHTML = '<div class="dash-empty">No attempts recorded.</div>';
        return;
      }
      list.innerHTML = '';
      for (const a of attempts) {
        const student = a.users || {};
        const exam = a.exams || {};
        const article = document.createElement('article');
        article.className = 'dash-item';
        article.innerHTML = `
          <div class="dash-item-main">
            <div class="dash-item-title">${escapeHtml(student.name)} · <span class="mono">${escapeHtml(student.register_number || 'N/A')}</span> (${escapeHtml(student.email || '')})</div>
            <div class="dash-item-meta mono">
              ${escapeHtml(exam.exam_code)} · ${a.status}
              · score ${a.score != null ? a.score + '/' + (a.max_score ?? '—') : '—'}
              · ${a.submitted_at ? new Date(a.submitted_at).toLocaleString() : 'in progress'}
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-show-viol="${a.id}">Show violations</button>
            <div class="viol-slot" id="viol-${a.id}" hidden></div>
          </div>`;
        list.appendChild(article);
      }
      list.querySelectorAll('[data-show-viol]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const slot = document.getElementById('viol-' + btn.dataset.showViol);
          if (!slot.hidden && slot.innerHTML) {
            slot.hidden = true;
            return;
          }
          const viols = await listViolationsForAttempt(btn.dataset.showViol);
          slot.hidden = false;
          slot.innerHTML = viols.length
            ? `<ul class="viol-mini">${viols
                .map(
                  (v) =>
                    `<li><span class="mono">${new Date(v.occurred_at).toLocaleTimeString()}</span> <strong>${escapeHtml(v.type)}</strong> — ${escapeHtml(v.message)}</li>`
                )
                .join('')}</ul>`
            : '<p class="dash-item-meta">No violations</p>';
        });
      });
    } catch (e) {
      list.innerHTML = `<div class="form-error">${escapeHtml(e.message)}</div>`;
    }
  }

  async function loadExams() {
    const list = document.getElementById('exams-list');
    list.innerHTML = '<div class="dash-empty">Loading…</div>';
    try {
      const exams = await adminListAllExams();
      list.innerHTML = exams.length
        ? exams
            .map((e) => {
              const teacher = e.users || {};
              return `
            <article class="dash-item">
              <div class="dash-item-main">
                <div class="dash-item-title">${escapeHtml(e.title)}</div>
                <div class="dash-item-meta mono">
                  ${escapeHtml(e.exam_code)} · ${e.duration_minutes}m ·
                  <span class="badge ${e.status}">${e.status}</span>
                  ${e.is_locked ? '<span class="badge locked">frozen</span>' : ''}
                  · teacher ${escapeHtml(teacher.name || '')} (${escapeHtml(teacher.email || teacher.staff_id || '')})
                </div>
              </div>
            </article>`;
            })
            .join('')
        : '<div class="dash-empty">No exams.</div>';
    } catch (e) {
      list.innerHTML = `<div class="form-error">${escapeHtml(e.message)}</div>`;
    }
  }

  let currentUsersData = [];
  let selectedUserRoleFilter = 'all';

  function renderFilteredUsers() {
    const list = document.getElementById('users-list');
    if (!list) return;

    let filtered = currentUsersData;
    if (selectedUserRoleFilter !== 'all') {
      filtered = currentUsersData.filter((u) => u.role === selectedUserRoleFilter);
    }

    if (!filtered.length) {
      list.innerHTML = `<div class="dash-empty">No ${selectedUserRoleFilter !== 'all' ? selectedUserRoleFilter : ''} users found.</div>`;
      return;
    }

    list.innerHTML = filtered
      .map(
        (u) => `
      <article class="dash-item" data-user-id="${u.id}">
        <div class="dash-item-main">
          <div class="dash-item-title">
            ${escapeHtml(u.name)}
            <span class="badge ${u.role}">${u.role}</span>
            ${u.is_approved ? '<span class="badge active" style="background:rgba(34,197,94,0.15); color:#4ade80; border:1px solid rgba(34,197,94,0.3);">Approved</span>' : '<span class="badge pending" style="background:rgba(234,179,8,0.15); color:#fde047; border:1px solid rgba(234,179,8,0.3);">Pending</span>'}
          </div>
          <div class="dash-item-meta mono">
            ${u.register_number ? 'REG: <strong>' + escapeHtml(u.register_number) + '</strong>' : 'STAFF: <strong>' + escapeHtml(u.staff_id || 'N/A') + '</strong>'}
            · Email: <strong>${escapeHtml(u.email)}</strong>
            · Joined: ${new Date(u.created_at).toLocaleString()}
          </div>
        </div>
        <div class="dash-item-actions">
          <button type="button" class="btn btn-ghost btn-sm btn-delete-user" data-id="${u.id}" data-name="${escapeHtml(u.name)}" style="color:var(--danger, #ff6b6b); border:1px solid rgba(255,107,107,0.3);">
            Delete User 🗑
          </button>
        </div>
      </article>`
      )
      .join('');

    list.querySelectorAll('.btn-delete-user').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const uId = btn.dataset.id;
        const uName = btn.dataset.name || 'this user';
        if (!confirm(`Are you sure you want to permanently delete user "${uName}"?\nThis will remove their profile and all associated data.`)) {
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Deleting…';
        try {
          await adminDeleteUser(uId);
          await loadUsers();
          await loadLocks();
          await loadAttempts();
        } catch (e) {
          alert('Failed to delete user: ' + (e.message || String(e)));
          btn.disabled = false;
          btn.textContent = 'Delete User 🗑';
        }
      });
    });
  }

  async function loadUsers() {
    const list = document.getElementById('users-list');
    if (!list) return;
    list.innerHTML = '<div class="dash-empty">Loading users…</div>';
    try {
      currentUsersData = await adminListUsers();
      
      const cntAll = document.getElementById('cnt-all');
      const cntStudents = document.getElementById('cnt-students');
      const cntTeachers = document.getElementById('cnt-teachers');
      const cntAdmins = document.getElementById('cnt-admins');

      if (cntAll) cntAll.textContent = currentUsersData.length;
      if (cntStudents) cntStudents.textContent = currentUsersData.filter((u) => u.role === 'student').length;
      if (cntTeachers) cntTeachers.textContent = currentUsersData.filter((u) => u.role === 'teacher').length;
      if (cntAdmins) cntAdmins.textContent = currentUsersData.filter((u) => u.role === 'admin').length;

      renderFilteredUsers();
    } catch (e) {
      list.innerHTML = `<div class="form-error">${escapeHtml(e.message)}</div>`;
    }
  }

  document.querySelectorAll('.user-subtab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.user-subtab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      selectedUserRoleFilter = tab.dataset.role;
      renderFilteredUsers();
    });
  });

  document.getElementById('btn-refresh-locks')?.addEventListener('click', loadLocks);
  const btnRefTeachers = document.getElementById('btn-refresh-teachers');
  if (btnRefTeachers) btnRefTeachers.addEventListener('click', loadPendingTeachers);
  document.getElementById('btn-refresh-attempts')?.addEventListener('click', loadAttempts);
  document.getElementById('btn-refresh-exams')?.addEventListener('click', loadExams);
  document.getElementById('btn-refresh-users')?.addEventListener('click', loadUsers);

  await loadLocks();
  await loadPendingTeachers();
  await loadAttempts();
  await loadExams();
  await loadUsers();
})();
