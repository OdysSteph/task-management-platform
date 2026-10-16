import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export default function App() {
  // --- Auth State ---
  const [token, setToken] = useState(() => localStorage.getItem('jwt_token') || '');
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('auth_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loginForm, setLoginForm] = useState({ email: 'admin@example.com', password: 'password123' });
  const [authLoading, setAuthLoading] = useState(false);

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

  // Helper Fetch API dengan JWT Bearer Token
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

  // --- Fetch Daftar Tasks ---
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

  // --- Fetch Detail Task (beserta Attachments & Comments) ---
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

  // --- Fetch Users untuk Dropdown Assignee ---
  useEffect(() => {
    if (!token) return;
    apiFetch('/users')
      .then((res) => setUsersList(res.data || []))
      .catch(() => { });
  }, [token, apiFetch]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // --- Real-time Sync (BroadcastChannel antar-tab + Live Polling 8 detik) ---
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
          notify('Real-time: Data task diperbarui oleh pengguna lain.', 'info');
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
      notify(`Selamat datang, ${profile.name}!`, 'success');
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
      // Abaikan jika token sudah expired
    }
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('auth_user');
    setToken('');
    setUser(null);
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
      const payload = {
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

  // --- Handlers: Bulk Update & Export Queue (Part 1.4 Integration) ---
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

  // --- Handlers: Drag-and-Drop File Upload dengan Progress Bar ---
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
          if(xhr.status == 422){
            notify('Gagal mengunggah file, max 2MB.', 'error');
          } else {
            notify(res.message || 'Gagal mengunggah file.', 'error');
          }
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

  // --- Handler: Tambah Komentar Real-time ---
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

  // ================= RENDER 1: HALAMAN LOGIN =================
  if (!token) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card">
          <h1>Task Management Platform</h1>
          <p>Silakan masuk menggunakan akun JWT Anda</p>

          <div className="demo-box">
            <div>
              <strong>Akun Demo:</strong> admin@example.com / password123
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setLoginForm({ email: 'admin@example.com', password: 'password123' })}
            >
              Isi Otomatis
            </button>
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

  // ================= RENDER 2: DASHBOARD UTAMA =================
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span>TaskHub Pro</span>
          <span className="live-pill">
            <span className="live-dot" /> Live Sync Active
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.88rem', color: 'var(--muted)' }}>
            Halo, <strong>{user?.name}</strong> ({user?.role})
          </span>
          <button className="btn btn-outline btn-sm" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <main className="container">
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
            <span>Dipilih (Bulk Action)</span>
            <strong>{selectedIds.length} Item</strong>
          </div>
        </div>

        {/* Baris Filter, Search, Sort & Tombol Aksi */}
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
                  Ubah Status ({selectedIds.length})...
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
            {tasks.map((task) => (
              <div key={task.id} className="task-card">
                <div className="task-main">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(task.id)}
                    onChange={() => toggleSelectTask(task.id)}
                    style={{ marginTop: '0.35rem', cursor: 'pointer' }}
                  />
                  <div className="task-info">
                    <h3 onClick={() => fetchTaskDetail(task.id)}>{task.title}</h3>
                    <p style={{ fontSize: '0.86rem', color: 'var(--muted)' }}>
                      {task.description || 'Tidak ada deskripsi.'}
                    </p>
                    <div className="task-meta">
                      <span className={`badge status-${task.status}`}>{task.status.replace('_', ' ')}</span>
                      <span className={`badge priority-${task.priority}`}>{task.priority}</span>
                      <span>Assignee: <strong>{task.assignee?.name || 'Unassigned'}</strong></span>
                      <span>Due: {task.due_date ? new Date(task.due_date).toLocaleDateString('id-ID') : '-'}</span>
                      <span>📎 {task.attachments_count || 0} File</span>
                      <span>💬 {task.comments_count || 0} Komentar</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => fetchTaskDetail(task.id)}>
                    Detail & File
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => openEditModal(task)}>
                    Edit
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDeleteTask(task.id)}>
                    Hapus
                  </button>
                </div>
              </div>
            ))}
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

            {/* Bagian 1: Drag & Drop File Upload + Progress Bar */}
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
                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteAttachment(att.id)}>
                      Hapus
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Bagian 2: Real-time Comments */}
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

      {/* Toast Notification Stack */}
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