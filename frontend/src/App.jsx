import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api';

const ROLE_INFO = {
  admin: {
    label: 'ADMIN — Full Access',
    bg: '#fee2e2',
    color: '#b91c1c',
    desc: 'Akses penuh: Buat, Edit, Hapus semua task, Bulk Action, & Export Laporan.',
  },
  manager: {
    label: 'MANAGER — Team Lead',
    bg: '#dbeafe',
    color: '#1d4ed8',
    desc: 'Kelola tim: Buat & Edit semua task, Bulk Action, Export, dan hapus task buatan sendiri.',
  },
  member: {
    label: 'MEMBER — Contributor',
    bg: '#dcfce7',
    color: '#15803d',
    desc: 'Fokus eksekusi: Update status pada task yang ditugaskan kepada Anda, unggah file, & diskusi.',
  },
};

export default function App() {
  // --- Auth State ---
  const [token, setToken] = useState(() => localStorage.getItem('jwt_token') || '');
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('auth_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loginForm, setLoginForm] = useState({ email: 'admin@example.com', password: 'password123' });
  const [authLoading, setAuthLoading] = useState(false);

  // Role Flags
  const currentRole = user?.role || 'member';
  const isAdmin = currentRole === 'admin';
  const isManager = currentRole === 'manager';
  const isMember = currentRole === 'member';
  const canManageTasks = isAdmin || isManager;

  // --- Tasks, Users & Filter State ---
  const [tasks, setTasks] = useState([]);
  const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0 });
  const [usersList, setUsersList] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  const [filters, setFilters] = useState({
    keyword: '',
    status: '',
    priority: '',
    assigned_user_id: '',
    sort_by: 'created_at',
    sort_dir: 'desc',
    page: 1,
  });

  // --- Modals & Detail Drawer State ---
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    status: 'pending',
    priority: 'medium',
    assigned_user_id: '',
    due_date: '',
  });

  const [activeTask, setActiveTask] = useState(null);
  const [commentInput, setCommentInput] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingFile, setUploadingFile] = useState(false);

  // --- Toasts & Real-time Channel ---
  const [toasts, setToasts] = useState([]);
  const channelRef = useRef(null);

  const notify = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const apiFetch = useCallback(
    async (endpoint, options = {}) => {
      const headers = {
        Accept: 'application/json',
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      };

      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      });

      if (response.status === 401 && token) {
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('auth_user');
        setToken('');
        setUser(null);
        notify('Sesi telah berakhir, silakan login kembali.', 'error');
        throw new Error('Unauthorized');
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Terjadi kesalahan pada server.');
      }
      return data;
    },
    [token, notify]
  );

  const fetchTasks = useCallback(
    async (silent = false) => {
      if (!token) return;
      if (!silent) setLoadingTasks(true);
      try {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([k, v]) => {
          if (v !== '' && v !== null) params.append(k, v);
        });
        params.append('per_page', '8');

        const res = await apiFetch(`/tasks?${params.toString()}`);
        setTasks(res.data.data || []);
        setPagination({
          current_page: res.data.current_page,
          last_page: res.data.last_page,
          total: res.data.total,
        });
      } catch (err) {
        if (!silent) notify(err.message, 'error');
      } finally {
        if (!silent) setLoadingTasks(false);
      }
    },
    [token, filters, apiFetch, notify]
  );

  const fetchTaskDetail = useCallback(
    async (taskId) => {
      try {
        const res = await apiFetch(`/tasks/${taskId}`);
        setActiveTask(res.data);
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [apiFetch, notify]
  );

  useEffect(() => {
    if (!token) return;
    apiFetch('/users')
      .then((res) => setUsersList(res.data || []))
      .catch(() => {});
  }, [token, apiFetch]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const broadcastEvent = useCallback((type, payload = {}) => {
    if (channelRef.current) {
      channelRef.current.postMessage({ type, payload });
    }
  }, []);

  useEffect(() => {
    if (!token) return;

    if ('BroadcastChannel' in window) {
      const bc = new BroadcastChannel('task_platform_realtime');
      bc.onmessage = (event) => {
        const { type, payload } = event.data || {};
        fetchTasks(true);
        if (activeTask && payload?.taskId === activeTask.id) {
          fetchTaskDetail(activeTask.id);
        }
        if (type === 'TASK_UPDATED') {
          notify('Real-time: Data task diperbarui.', 'info');
        } else if (type === 'COMMENT_ADDED') {
          notify('Real-time: Komentar baru masuk.', 'info');
        }
      };
      channelRef.current = bc;
    }

    const interval = setInterval(() => {
      fetchTasks(true);
      if (activeTask) fetchTaskDetail(activeTask.id);
    }, 8000);

    return () => {
      clearInterval(interval);
      if (channelRef.current) channelRef.current.close();
    };
  }, [token, activeTask, fetchTasks, fetchTaskDetail, notify]);

  // --- Handlers: Login & Logout ---
  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginForm),
      });
      const jwt = res.data.token;
      const profile = res.data.profile;
      localStorage.setItem('jwt_token', jwt);
      localStorage.setItem('auth_user', JSON.stringify(profile));
      setToken(jwt);
      setUser(profile);
      setSelectedIds([]);
      notify(`Login berhasil sebagai ${profile.name} (${profile.role.toUpperCase()})!`, 'success');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Abaikan
    }
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('auth_user');
    setToken('');
    setUser(null);
    setSelectedIds([]);
    notify('Anda telah logout.', 'info');
  };

  // --- Handlers: Create / Update / Delete Task ---
  const openCreateModal = () => {
    setEditingTask(null);
    setTaskForm({
      title: '',
      description: '',
      status: 'pending',
      priority: 'medium',
      assigned_user_id: '',
      due_date: '',
    });
    setShowFormModal(true);
  };

  const openEditModal = (task) => {
    setEditingTask(task);
    setTaskForm({
      title: task.title || '',
      description: task.description || '',
      status: task.status || 'pending',
      priority: task.priority || 'medium',
      assigned_user_id: task.assigned_user_id || '',
      due_date: task.due_date ? task.due_date.slice(0, 16) : '',
    });
    setShowFormModal(true);
  };

  const handleSaveTask = async (e) => {
    e.preventDefault();
    try {
      const payload = isMember
        ? { status: taskForm.status }
        : {
            ...taskForm,
            assigned_user_id: taskForm.assigned_user_id ? Number(taskForm.assigned_user_id) : null,
            due_date: taskForm.due_date || null,
          };

      if (editingTask) {
        await apiFetch(`/tasks/${editingTask.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        notify('Task berhasil diperbarui!');
      } else {
        await apiFetch('/tasks', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        notify('Task baru berhasil dibuat!');
      }

      setShowFormModal(false);
      fetchTasks();
      broadcastEvent('TASK_UPDATED', { taskId: editingTask?.id });
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  // Quick Status Change khusus Member pada task miliknya
  const handleQuickMemberStatus = async (taskId, newStatus) => {
    try {
      await apiFetch(`/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      notify(`Status task diperbarui menjadi ${newStatus.replace('_', ' ')}!`);
      fetchTasks();
      broadcastEvent('TASK_UPDATED', { taskId });
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const canDeleteTask = (task) => {
    if (isAdmin) return true;
    if (isManager && Number(task.created_by) === Number(user?.id)) return true;
    return false;
  };

  const handleDeleteTask = async (id) => {
    if (!window.confirm('Yakin ingin menghapus task ini?')) return;
    try {
      await apiFetch(`/tasks/${id}`, { method: 'DELETE' });
      notify('Task berhasil dihapus.');
      if (activeTask?.id === id) setActiveTask(null);
      fetchTasks();
      broadcastEvent('TASK_UPDATED', { taskId: id });
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  // --- Handlers: Bulk Update & Export Queue ---
  const toggleSelectTask = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleBulkStatus = async (status) => {
    if (!status || selectedIds.length === 0) return;
    try {
      await apiFetch('/tasks/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ task_ids: selectedIds, status }),
      });
      notify(`${selectedIds.length} task berhasil diubah ke status ${status.replace('_', ' ')}!`);
      setSelectedIds([]);
      await fetchTasks();
      broadcastEvent('TASK_UPDATED');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const handleExportReport = async (format) => {
    try {
      notify(`Menyiapkan laporan ${format.toUpperCase()}...`, 'info');
      const res = await apiFetch('/tasks/export', {
        method: 'POST',
        body: JSON.stringify({
          format,
          status: filters.status || null,
          priority: filters.priority || null,
        }),
      });

      const fileName = res.data.file_name;
      const downloadRes = await fetch(`${API_BASE}/tasks/exports/${fileName}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!downloadRes.ok) {
        throw new Error('Gagal mengunduh file laporan dari server.');
      }

      const blob = await downloadRes.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      notify(`Laporan ${fileName} berhasil diunduh!`, 'success');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  // --- Handlers: Drag-and-Drop File Upload ---
  const uploadFileWithProgress = (file) => {
    if (!activeTask || !file) return;
    setUploadingFile(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('attachment', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/tasks/${activeTask.id}/attachments`, true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      setUploadingFile(false);
      setUploadProgress(0);
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          notify('File berhasil diunggah!');
          fetchTaskDetail(activeTask.id);
          fetchTasks(true);
          broadcastEvent('TASK_UPDATED', { taskId: activeTask.id });
        } else {
          notify(res.message || 'Gagal mengunggah file.', 'error');
        }
      } catch {
        notify('Gagal memproses respons server.', 'error');
      }
    };

    xhr.onerror = () => {
      setUploadingFile(false);
      notify('Kesalahan jaringan saat mengunggah file.', 'error');
    };

    xhr.send(formData);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      uploadFileWithProgress(e.dataTransfer.files[0]);
    }
  };

  const handleDeleteAttachment = async (attId) => {
    try {
      await apiFetch(`/attachments/${attId}`, { method: 'DELETE' });
      notify('Lampiran dihapus.');
      fetchTaskDetail(activeTask.id);
      fetchTasks(true);
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const handleDownloadAttachment = async (att) => {
    try {
      const response = await fetch(`${API_BASE}/attachments/${att.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Gagal mengunduh file.');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.file_name;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!commentInput.trim() || !activeTask) return;
    try {
      await apiFetch(`/tasks/${activeTask.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ comment: commentInput }),
      });
      setCommentInput('');
      fetchTaskDetail(activeTask.id);
      fetchTasks(true);
      broadcastEvent('COMMENT_ADDED', { taskId: activeTask.id });
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  // ================= RENDER 1: HALAMAN LOGIN DENGAN PILIHAN 3 ROLE =================
  if (!token) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card" style={{ maxWidth: '460px' }}>
          <h1>TaskHub Pro</h1>
          <p>Pilih akun demo di bawah untuk menguji perbedaan hak akses (RBAC):</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ borderColor: loginForm.email === 'admin@example.com' ? '#2563eb' : undefined }}
              onClick={() => setLoginForm({ email: 'admin@example.com', password: 'password123' })}
            >
              👑 Admin
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ borderColor: loginForm.email === 'manager@example.com' ? '#2563eb' : undefined }}
              onClick={() => setLoginForm({ email: 'manager@example.com', password: 'password123' })}
            >
              📋 Manager
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ borderColor: loginForm.email === 'member@example.com' ? '#2563eb' : undefined }}
              onClick={() => setLoginForm({ email: 'member@example.com', password: 'password123' })}
            >
              👨‍💻 Member
            </button>
          </div>

          <div className="demo-box" style={{ display: 'block', lineHeight: '1.4' }}>
            {loginForm.email === 'admin@example.com' && (
              <span><strong>Role Admin:</strong> Full akses CRUD semua task, Bulk Action, Export, & Hapus task siapa saja.</span>
            )}
            {loginForm.email === 'manager@example.com' && (
              <span><strong>Role Manager:</strong> Buat & Edit task tim, Bulk Action, Export, & hapus task buatan sendiri.</span>
            )}
            {loginForm.email === 'member@example.com' && (
              <span><strong>Role Member:</strong> Hanya ubah status pada task yang ditugaskan kepadanya, upload file, & komentar.</span>
            )}
          </div>

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                className="input"
                value={loginForm.email}
                onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                className="input"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={authLoading}>
              {authLoading ? 'Memproses...' : 'Masuk ke Dashboard'}
            </button>
          </form>
        </div>

        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type}`}>
              {t.message}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const roleBadge = ROLE_INFO[currentRole] || ROLE_INFO.member;

  // ================= RENDER 2: DASHBOARD UTAMA =================
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span>TaskHub Pro</span>
          <span className="live-pill">
            <span className="live-dot" /> Live Sync
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span
            className="badge"
            style={{ background: roleBadge.bg, color: roleBadge.color, padding: '0.25rem 0.7rem' }}
          >
            {roleBadge.label}
          </span>
          <span style={{ fontSize: '0.88rem', color: 'var(--muted)' }}>
            <strong>{user?.name}</strong>
          </span>
          <button className="btn btn-outline btn-sm" onClick={handleLogout}>
            Ganti Role / Logout
          </button>
        </div>
      </header>

      <main className="container">
        {/* Banner Informasi Hak Akses Role Aktif */}
        <div
          style={{
            background: roleBadge.bg,
            color: roleBadge.color,
            padding: '0.7rem 1rem',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.85rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <span>
            <strong>Mode Hak Akses ({currentRole.toUpperCase()}):</strong> {roleBadge.desc}
          </span>
          {isMember && (
            <button
              className="btn btn-outline btn-sm"
              style={{ background: '#fff' }}
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  assigned_user_id: prev.assigned_user_id ? '' : String(user.id),
                  page: 1,
                }))
              }
            >
              {filters.assigned_user_id === String(user?.id) ? 'Tampilkan Semua Task' : 'Filter: Hanya Task Saya'}
            </button>
          )}
        </div>

        {/* Statistik Ringkas */}
        <div className="stats-grid">
          <div className="stat-card">
            <span>Total Tasks (Filter)</span>
            <strong>{pagination.total}</strong>
          </div>
          <div className="stat-card">
            <span>Halaman Aktif</span>
            <strong>
              {pagination.current_page} / {pagination.last_page}
            </strong>
          </div>
          <div className="stat-card">
            <span>Role Anda</span>
            <strong style={{ textTransform: 'capitalize' }}>{currentRole}</strong>
          </div>
        </div>

        {/* Baris Filter, Search, Sort & Tombol Aksi Sesuai Role */}
        <div className="toolbar">
          <div className="filter-group">
            <input
              type="text"
              className="input search-input"
              placeholder="Cari judul atau deskripsi task..."
              value={filters.keyword}
              onChange={(e) => setFilters({ ...filters, keyword: e.target.value, page: 1 })}
            />
            <select
              className="select"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}
            >
              <option value="">Semua Status</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              className="select"
              value={filters.priority}
              onChange={(e) => setFilters({ ...filters, priority: e.target.value, page: 1 })}
            >
              <option value="">Semua Prioritas</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <select
              className="select"
              value={filters.sort_by}
              onChange={(e) => setFilters({ ...filters, sort_by: e.target.value })}
            >
              <option value="created_at">Urut: Terbaru</option>
              <option value="due_date">Urut: Due Date</option>
              <option value="priority">Urut: Prioritas</option>
              <option value="title">Urut: Judul</option>
            </select>
          </div>

          {/* Tombol Manajerial: Hanya Muncul untuk Admin & Manager */}
          {canManageTasks && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {selectedIds.length > 0 && (
                <select
                  className="select"
                  defaultValue=""
                  onChange={(e) => {
                    handleBulkStatus(e.target.value);
                    e.target.value = '';
                  }}
                >
                  <option value="" disabled>
                    Bulk Status ({selectedIds.length})...
                  </option>
                  <option value="in_progress">Set In Progress</option>
                  <option value="completed">Set Completed</option>
                  <option value="cancelled">Set Cancelled</option>
                </select>
              )}
              <button className="btn btn-outline btn-sm" onClick={() => handleExportReport('csv')}>
                Export CSV
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => handleExportReport('pdf')}>
                Export PDF
              </button>
              <button className="btn btn-primary" onClick={openCreateModal}>
                + Buat Task
              </button>
            </div>
          )}
        </div>

        {/* Daftar Tasks */}
        {loadingTasks ? (
          <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Memuat data task...</p>
        ) : tasks.length === 0 ? (
          <div className="stat-card" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <p style={{ color: 'var(--muted)' }}>Tidak ada task yang sesuai dengan filter.</p>
          </div>
        ) : (
          <div className="task-list">
            {tasks.map((task) => {
              const isAssignedToMe = Number(task.assigned_user_id) === Number(user?.id);

              return (
                <div key={task.id} className="task-card">
                  <div className="task-main">
                    {canManageTasks && (
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(task.id)}
                        onChange={() => toggleSelectTask(task.id)}
                        style={{ marginTop: '0.35rem', cursor: 'pointer' }}
                      />
                    )}
                    <div className="task-info">
                      <h3 onClick={() => fetchTaskDetail(task.id)}>
                        {task.title}{' '}
                        {isAssignedToMe && (
                          <span
                            className="badge"
                            style={{ background: '#dcfce7', color: '#15803d', marginLeft: '0.4rem' }}
                          >
                            Ditugaskan ke Anda
                          </span>
                        )}
                      </h3>
                      <p style={{ fontSize: '0.86rem', color: 'var(--muted)' }}>
                        {task.description || 'Tidak ada deskripsi.'}
                      </p>
                      <div className="task-meta">
                        <span className={`badge status-${task.status}`}>{task.status.replace('_', ' ')}</span>
                        <span className={`badge priority-${task.priority}`}>{task.priority}</span>
                        <span>
                          Assignee: <strong>{task.assignee?.name || 'Unassigned'}</strong>
                        </span>
                        <span>Pembuat: {task.creator?.name || '-'}</span>
                        <span>Due: {task.due_date ? new Date(task.due_date).toLocaleDateString('id-ID') : '-'}</span>
                        <span>📎 {task.attachments_count || 0} File</span>
                        <span>💬 {task.comments_count || 0} Komentar</span>
                      </div>
                    </div>
                  </div>

                  {/* Aksi per Baris Disesuaikan dengan Role */}
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {isMember && isAssignedToMe && (
                      <select
                        className="select"
                        style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', width: 'auto' }}
                        value={task.status}
                        onChange={(e) => handleQuickMemberStatus(task.id, e.target.value)}
                      >
                        <option value="pending">Status: Pending</option>
                        <option value="in_progress">Status: In Progress</option>
                        <option value="completed">Status: Completed</option>
                      </select>
                    )}

                    <button className="btn btn-outline btn-sm" onClick={() => fetchTaskDetail(task.id)}>
                      Detail & File
                    </button>

                    {canManageTasks && (
                      <button className="btn btn-outline btn-sm" onClick={() => openEditModal(task)}>
                        Edit
                      </button>
                    )}

                    {canDeleteTask(task) && (
                      <button className="btn btn-danger btn-sm" onClick={() => handleDeleteTask(task.id)}>
                        Hapus
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Paginasi */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1.25rem' }}>
          <button
            className="btn btn-outline btn-sm"
            disabled={pagination.current_page <= 1}
            onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
          >
            &laquo; Sebelumnya
          </button>
          <button
            className="btn btn-outline btn-sm"
            disabled={pagination.current_page >= pagination.last_page}
            onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
          >
            Berikutnya &raquo;
          </button>
        </div>
      </main>

      {/* ================= MODAL CREATE / EDIT TASK ================= */}
      {showFormModal && (
        <div className="modal-backdrop" onClick={() => setShowFormModal(false)}>
          <div className="modal-panel" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingTask ? 'Edit Task' : 'Buat Task Baru'}</h2>
              <button className="btn btn-outline btn-sm" onClick={() => setShowFormModal(false)}>
                Tutup
              </button>
            </div>
            <form onSubmit={handleSaveTask}>
              <div className="form-group">
                <label>Judul Task *</label>
                <input
                  type="text"
                  className="input"
                  value={taskForm.title}
                  onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Deskripsi</label>
                <textarea
                  rows="3"
                  className="textarea"
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label>Status</label>
                  <select
                    className="select"
                    value={taskForm.status}
                    onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value })}
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Prioritas</label>
                  <select
                    className="select"
                    value={taskForm.priority}
                    onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label>Ditugaskan Ke (Assignee)</label>
                  <select
                    className="select"
                    value={taskForm.assigned_user_id}
                    onChange={(e) => setTaskForm({ ...taskForm, assigned_user_id: e.target.value })}
                  >
                    <option value="">-- Belum Ditugaskan --</option>
                    {usersList.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Tenggat Waktu (Due Date)</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={taskForm.due_date}
                    onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowFormModal(false)}>
                  Batal
                </button>
                <button type="submit" className="btn btn-primary">
                  Simpan Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL DETAIL TASK: UPLOAD DRAG-DROP & COMMENTS ================= */}
      {activeTask && (
        <div className="modal-backdrop" onClick={() => setActiveTask(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: '1.2rem' }}>{activeTask.title}</h2>
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                  Dibuat oleh {activeTask.creator?.name} • Assignee: {activeTask.assignee?.name || 'Unassigned'}
                </span>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => setActiveTask(null)}>
                Tutup
              </button>
            </div>

            <p style={{ marginBottom: '1.25rem', fontSize: '0.92rem' }}>
              {activeTask.description || 'Tidak ada deskripsi.'}
            </p>

            <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>
              Lampiran File ({activeTask.attachments?.length || 0})
            </h3>
            <div
              className={`dropzone ${dragActive ? 'active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById('hidden-file-input').click()}
            >
              <input
                id="hidden-file-input"
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files?.[0] && uploadFileWithProgress(e.target.files[0])}
              />
              <p style={{ fontWeight: 600 }}>Tarik & Lepas (Drag & Drop) file ke sini, atau klik untuk memilih</p>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                Mendukung Gambar (Thumbnail Otomatis), PDF/Dokumen, & Video • Dilengkapi Virus Scan & Versioning
              </span>

              {uploadingFile && (
                <div>
                  <div className="progress-bar-wrap">
                    <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <small style={{ color: 'var(--primary)', fontWeight: 600 }}>
                    Mengunggah... {uploadProgress}%
                  </small>
                </div>
              )}
            </div>

            <div className="attachment-grid">
              {activeTask.attachments?.map((att) => (
                <div key={att.id} className="attachment-item">
                  {(att.thumbnail_url || att.mime_type?.startsWith('image/')) && (
                    <img
                      src={att.thumbnail_url || att.file_url}
                      alt={att.file_name}
                      className="thumb-preview"
                    />
                  )}
                  <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{att.file_name}</div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
                    Versi v{att.version} • {(att.file_size / 1024).toFixed(1)} KB
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: 'auto' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => handleDownloadAttachment(att)}>
                      Unduh
                    </button>
                    {canManageTasks && (
                      <button className="btn btn-danger btn-sm" onClick={() => handleDeleteAttachment(att.id)}>
                        Hapus
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>
              Diskusi & Komentar Real-time ({activeTask.comments?.length || 0})
            </h3>
            <div className="comments-list">
              {activeTask.comments?.length === 0 ? (
                <p style={{ fontSize: '0.84rem', color: 'var(--muted)' }}>Belum ada komentar pada task ini.</p>
              ) : (
                activeTask.comments?.map((c) => (
                  <div key={c.id} className="comment-bubble">
                    <div className="comment-header">
                      <strong>{c.user?.name || 'User'}</strong>
                      <span>{c.created_at ? new Date(c.created_at).toLocaleString('id-ID') : ''}</span>
                    </div>
                    <div>{c.comment}</div>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleAddComment} style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                className="input"
                placeholder="Tulis komentar baru..."
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                required
              />
              <button type="submit" className="btn btn-primary">
                Kirim
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}