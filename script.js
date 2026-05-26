/* ═══════════════════════════════════════════════
   oink's — script.js
   ═══════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   FIREBASE CONFIG
   Substitua pelos dados do seu projeto Firebase
   ───────────────────────────────────────────── */
const firebaseConfig = {
  apiKey:            "SUA_API_KEY",
  authDomain:        "SEU_PROJECT.firebaseapp.com",
  projectId:         "SEU_PROJECT_ID",
  storageBucket:     "SEU_PROJECT.appspot.com",
  messagingSenderId: "SEU_SENDER_ID",
  appId:             "SEU_APP_ID"
};

let db = null;
let firestoreAvailable = false;

try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
} catch(e) {
  console.warn('Firebase init failed, using local storage:', e);
}

const COL = 'transactions';

/* ─────────────────────────────────────────────
   LOCAL STORAGE FALLBACK
   ───────────────────────────────────────────── */
const LOCAL_KEY = 'oinks_transactions';

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; }
}

function saveLocal(data) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
}

function addLocal(record) {
  const list = loadLocal();
  const id = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  list.unshift({ id, ...record });
  saveLocal(list);
  return id;
}

function updateLocal(id, data) {
  const list = loadLocal();
  const idx  = list.findIndex(t => t.id === id);
  if (idx !== -1) { list[idx] = { ...list[idx], ...data }; saveLocal(list); }
}

function deleteLocal(id) {
  saveLocal(loadLocal().filter(t => t.id !== id));
}

/* ─────────────────────────────────────────────
   FIRESTORE COM TIMEOUT
   ───────────────────────────────────────────── */
function withTimeout(promise, ms = 6000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

/* ─────────────────────────────────────────────
   ESTADO GLOBAL
   ───────────────────────────────────────────── */
let allTransactions = [];
let unsubscribe     = null;
let deleteTargetId  = null;
let chartMain       = null;
let chartLine       = null;
let chartDonut      = null;
let chartBar2       = null;

/* ─────────────────────────────────────────────
   UTILITÁRIOS
   ───────────────────────────────────────────── */
const fmt = (v) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const fmtDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const today = () => new Date().toISOString().slice(0, 10);

const parseAmount = (str) => {
  const clean = str.replace(/\./g, '').replace(',', '.');
  return parseFloat(clean);
};

/* ─────────────────────────────────────────────
   TOAST NOTIFICATIONS
   ───────────────────────────────────────────── */
const toastContainer = document.getElementById('toastContainer');

function showToast(message, type = 'info') {
  const icons = {
    success: 'ph-fill ph-check-circle',
    error:   'ph-fill ph-x-circle',
    info:    'ph-fill ph-info'
  };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="ph ${icons[type]}"></i><span>${message}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove());
  }, 3200);
}

/* ─────────────────────────────────────────────
   SIDEBAR / NAVEGAÇÃO
   ───────────────────────────────────────────── */
const sidebar       = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const overlay       = document.getElementById('overlay');
const menuBtn       = document.getElementById('menuBtn');
const pageTitle     = document.getElementById('pageTitle');

const sectionTitles = {
  dashboard:    'Dashboard',
  transactions: 'Transações',
  add:          'Novo Registro',
  chart:        'Gráficos e Análise'
};

sidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  document.body.classList.toggle('sidebar-collapsed');
});

menuBtn.addEventListener('click', () => {
  sidebar.classList.add('mobile-open');
  overlay.classList.add('show');
});

overlay.addEventListener('click', closeMobileSidebar);

function closeMobileSidebar() {
  sidebar.classList.remove('mobile-open');
  overlay.classList.remove('show');
}

document.querySelectorAll('.nav-item[data-section]').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.section);
    closeMobileSidebar();
  });
});

document.querySelectorAll('[data-goto]').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(el.dataset.goto);
  });
});

function navigateTo(sectionId) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
  if (navItem) navItem.classList.add('active');

  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const sec = document.getElementById(`sec-${sectionId}`);
  if (sec) sec.classList.add('active');

  pageTitle.textContent = sectionTitles[sectionId] || sectionId;

  if (sectionId === 'chart') renderAnalysisCharts();
}

/* ─────────────────────────────────────────────
   FIRESTORE — LISTENER EM TEMPO REAL
   ───────────────────────────────────────────── */
function startListener() {
  // Try Firestore with timeout; fall back to localStorage
  if (db) {
    const timeout = setTimeout(() => {
      console.warn('Firestore unreachable, switching to local storage.');
      firestoreAvailable = false;
      allTransactions = loadLocal();
      refreshAll();
    }, 5000);

    unsubscribe = db.collection(COL)
      .orderBy('date', 'desc')
      .onSnapshot(
        (snapshot) => {
          clearTimeout(timeout);
          firestoreAvailable = true;
          allTransactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          refreshAll();
        },
        (err) => {
          clearTimeout(timeout);
          console.error('Firestore error:', err);
          firestoreAvailable = false;
          allTransactions = loadLocal();
          refreshAll();
          showToast('Firebase indisponível — usando armazenamento local.', 'info');
        }
      );
  } else {
    firestoreAvailable = false;
    allTransactions = loadLocal();
    refreshAll();
  }
}

/* ─────────────────────────────────────────────
   ATUALIZAR TODA A UI
   ───────────────────────────────────────────── */
function refreshAll() {
  updateKPIs();
  renderMainChart();
  renderRecentList();
  renderCategoryGrid();
  renderTransactionsTable();
  populateCategoryFilter();
}

/* ─────────────────────────────────────────────
   KPI CARDS
   ───────────────────────────────────────────── */
function updateKPIs() {
  const income  = allTransactions.filter(t => t.type === 'receita').reduce((s, t) => s + t.amount, 0);
  const expense = allTransactions.filter(t => t.type === 'despesa').reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;

  document.getElementById('kpiBalance').textContent = fmt(balance);
  document.getElementById('kpiIncome').textContent  = fmt(income);
  document.getElementById('kpiExpense').textContent = fmt(expense);
  document.getElementById('kpiCount').textContent   = allTransactions.length;

  const incomeCount  = allTransactions.filter(t => t.type === 'receita').length;
  const expenseCount = allTransactions.filter(t => t.type === 'despesa').length;

  document.getElementById('kpiBalanceSub').textContent  = balance >= 0 ? 'saldo positivo ✓' : 'saldo negativo ✗';
  document.getElementById('kpiIncomeSub').textContent   = `${incomeCount} entrada${incomeCount !== 1 ? 's' : ''}`;
  document.getElementById('kpiExpenseSub').textContent  = `${expenseCount} saída${expenseCount !== 1 ? 's' : ''}`;
  document.getElementById('kpiCountSub').textContent    = 'no total';
}

/* ─────────────────────────────────────────────
   CHART.JS — PALETA OINK'S (MOSS & BONE)
   ───────────────────────────────────────────── */
const C = {
  income:  '#5c8a52',
  expense: '#a86b47',
  accent:  '#74a468',
  grid:    'rgba(92,138,82,0.10)',
  text:    '#8fbe82'
};

Chart.defaults.color = C.text;
Chart.defaults.font  = { family: 'DM Mono', size: 11, weight: '300' };

const gridOpts = { color: C.grid, drawBorder: false };
const tickOpts = { color: C.text, font: { size: 10, family: 'DM Mono', weight: '300' } };

/* ─────────────────────────────────────────────
   GRÁFICO PRINCIPAL (DASHBOARD) — BARRA MENSAL
   ───────────────────────────────────────────── */
function renderMainChart() {
  const ctx = document.getElementById('mainChart');
  if (!ctx) return;

  const { labels, incomeData, expenseData } = buildMonthlyData();

  if (chartMain) chartMain.destroy();

  chartMain = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Receitas',
          data: incomeData,
          backgroundColor: 'rgba(79,107,67,0.55)',
          borderColor: C.income,
          borderWidth: 1.5,
          borderRadius: 8,
          borderSkipped: false
        },
        {
          label: 'Despesas',
          data: expenseData,
          backgroundColor: 'rgba(168,107,71,0.5)',
          borderColor: C.expense,
          borderWidth: 1.5,
          borderRadius: 8,
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#2d3d28',
          borderColor: 'rgba(181,204,159,0.15)',
          borderWidth: 1,
          titleFont: { family: 'DM Mono', size: 11, weight: '300' },
          bodyFont:  { family: 'DM Mono', size: 11, weight: '300' },
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { grid: gridOpts, ticks: tickOpts },
        y: {
          grid: gridOpts,
          ticks: { ...tickOpts, callback: v => fmt(v) }
        }
      }
    }
  });
}

/* ─────────────────────────────────────────────
   HELPER — AGRUPA POR MÊS (últimos N meses)
   ───────────────────────────────────────────── */
function buildMonthlyData(months = 6) {
  const now = new Date();
  const labels = [], incomeData = [], expenseData = [];

  for (let i = months - 1; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('pt-BR', { month: 'short', year: '2-digit' });
    labels.push(label);

    const txs = allTransactions.filter(t => t.date && t.date.startsWith(key));
    incomeData.push(txs.filter(t => t.type === 'receita').reduce((s, t) => s + t.amount, 0));
    expenseData.push(txs.filter(t => t.type === 'despesa').reduce((s, t) => s + t.amount, 0));
  }
  return { labels, incomeData, expenseData };
}

/* ─────────────────────────────────────────────
   LISTA DE RECENTES (DASHBOARD)
   ───────────────────────────────────────────── */
function renderRecentList() {
  const list   = document.getElementById('recentList');
  const recent = allTransactions.slice(0, 5);

  if (recent.length === 0) {
    list.innerHTML = `
      <li class="empty-state">
        <i class="ph ph-receipt"></i>
        <span>nenhum registro ainda</span>
      </li>`;
    return;
  }

  list.innerHTML = recent.map(t => `
    <li class="recent-item">
      <span class="recent-dot ${t.type === 'receita' ? 'income' : 'expense'}"></span>
      <div class="recent-info">
        <div class="recent-desc">${escHtml(t.description)}</div>
        <div class="recent-cat">${escHtml(t.category)} · ${fmtDate(t.date)}</div>
      </div>
      <span class="recent-amount ${t.type === 'receita' ? 'income' : 'expense'}">
        ${t.type === 'receita' ? '+' : '-'} ${fmt(t.amount)}
      </span>
    </li>`).join('');
}

/* ─────────────────────────────────────────────
   GRID DE CATEGORIAS (DASHBOARD)
   ───────────────────────────────────────────── */
function renderCategoryGrid() {
  const grid   = document.getElementById('categoryGrid');
  const catMap = {};

  allTransactions.forEach(t => {
    if (!catMap[t.category]) catMap[t.category] = { total: 0, type: t.type };
    catMap[t.category].total += t.amount;
  });

  const entries = Object.entries(catMap);
  if (entries.length === 0) {
    grid.innerHTML = '<p class="placeholder-text">adicione registros para ver categorias.</p>';
    return;
  }

  grid.innerHTML = entries
    .sort((a, b) => b[1].total - a[1].total)
    .map(([cat, { total }]) => `
      <div class="category-badge">
        <span>${cat}</span>
        <strong>${fmt(total)}</strong>
      </div>`)
    .join('');
}

/* ─────────────────────────────────────────────
   TABELA DE TRANSAÇÕES
   ───────────────────────────────────────────── */
const filterType     = document.getElementById('filterType');
const filterCategory = document.getElementById('filterCategory');
const tableSearch    = document.getElementById('tableSearch');

filterType.addEventListener('change', renderTransactionsTable);
filterCategory.addEventListener('change', renderTransactionsTable);
tableSearch.addEventListener('input', renderTransactionsTable);

document.getElementById('globalSearch').addEventListener('input', (e) => {
  navigateTo('transactions');
  tableSearch.value = e.target.value;
  renderTransactionsTable();
});

function populateCategoryFilter() {
  const categories = [...new Set(allTransactions.map(t => t.category))].sort();
  const current    = filterCategory.value;
  filterCategory.innerHTML = '<option value="all">todas as categorias</option>';
  categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    if (c === current) opt.selected = true;
    filterCategory.appendChild(opt);
  });
}

function getFilteredTransactions() {
  const type  = filterType.value;
  const cat   = filterCategory.value;
  const query = tableSearch.value.trim().toLowerCase();

  return allTransactions.filter(t => {
    if (type !== 'all' && t.type !== type) return false;
    if (cat  !== 'all' && t.category !== cat) return false;
    if (query && !`${t.description} ${t.category} ${t.notes || ''}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

function renderTransactionsTable() {
  const tbody = document.getElementById('transactionsBody');
  const rows  = getFilteredTransactions();

  if (rows.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">
          <div class="empty-state">
            <i class="ph ph-database"></i>
            <span>nenhuma transação encontrada</span>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = rows.map(t => `
    <tr>
      <td>
        <div style="font-weight:600">${escHtml(t.description)}</div>
        ${t.notes ? `<div style="font-size:11px;color:var(--text-subtle);font-family:var(--font-mono);font-weight:300">${escHtml(t.notes)}</div>` : ''}
      </td>
      <td style="font-family:var(--font-mono);font-size:12px;font-weight:300;color:var(--text-muted)">${escHtml(t.category)}</td>
      <td>
        <span class="type-badge ${t.type === 'receita' ? 'income' : 'expense'}">
          <i class="ph ${t.type === 'receita' ? 'ph-trend-up' : 'ph-trend-down'}"></i>
          ${t.type === 'receita' ? 'receita' : 'despesa'}
        </span>
      </td>
      <td style="font-family:var(--font-mono);font-size:12px;font-weight:300;color:var(--text-muted)">${fmtDate(t.date)}</td>
      <td class="amount-cell ${t.type === 'receita' ? 'income' : 'expense'}">
        ${t.type === 'receita' ? '+' : '-'} ${fmt(t.amount)}
      </td>
      <td class="actions-cell">
        <div class="action-group">
          <button class="action-btn edit" title="Editar" onclick="openEditModal('${t.id}')">
            <i class="ph ph-pencil-simple"></i>
          </button>
          <button class="action-btn delete" title="Excluir" onclick="openConfirmModal('${t.id}')">
            <i class="ph ph-trash"></i>
          </button>
        </div>
      </td>
    </tr>`).join('');
}

/* ─────────────────────────────────────────────
   FORMULÁRIO — NOVO REGISTRO
   ───────────────────────────────────────────── */
const financeForm = document.getElementById('financeForm');
const submitBtn   = document.getElementById('submitBtn');
const clearBtn    = document.getElementById('clearBtn');

document.getElementById('date').value = today();

document.getElementById('amount').addEventListener('input', maskAmount);
document.getElementById('editAmount').addEventListener('input', maskAmount);

function maskAmount(e) {
  let v = e.target.value.replace(/\D/g, '');
  v = (parseInt(v || '0') / 100).toFixed(2);
  e.target.value = v.replace('.', ',');
}

financeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm()) return;

  setLoading(true);

  const data = {
    description: document.getElementById('desc').value.trim(),
    amount:      parseAmount(document.getElementById('amount').value),
    type:        document.getElementById('type').value,
    category:    document.getElementById('category').value,
    date:        document.getElementById('date').value,
    notes:       document.getElementById('notes').value.trim(),
    createdAt:   new Date().toISOString()
  };

  try {
    if (firestoreAvailable && db) {
      const fsData = { ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
      await withTimeout(db.collection(COL).add(fsData));
    } else {
      addLocal(data);
      allTransactions = loadLocal();
      refreshAll();
    }
    showToast('✓ Registro salvo com sucesso!', 'success');
    resetForm();
    navigateTo('transactions');
  } catch (err) {
    console.error(err);
    // Fallback to local if Firestore timed out or failed
    addLocal(data);
    allTransactions = loadLocal();
    refreshAll();
    showToast('✓ Registro salvo localmente!', 'success');
    resetForm();
    navigateTo('transactions');
  } finally {
    setLoading(false);
  }
});

clearBtn.addEventListener('click', resetForm);

function resetForm() {
  financeForm.reset();
  document.getElementById('date').value = today();
  ['desc','amount','type','category','date'].forEach(id => {
    document.getElementById(`${id}Err`).textContent = '';
    document.getElementById(id).closest('.input-wrap').classList.remove('error');
  });
}

function setLoading(on) {
  submitBtn.classList.toggle('loading', on);
  submitBtn.disabled = on;
}

function validateForm() {
  let ok = true;

  const checks = [
    { id: 'desc',     errId: 'descErr',     msg: 'descrição obrigatória.',  test: v => v.trim().length > 0 },
    { id: 'amount',   errId: 'amountErr',   msg: 'valor inválido.',         test: v => !isNaN(parseAmount(v)) && parseAmount(v) > 0 },
    { id: 'type',     errId: 'typeErr',     msg: 'selecione o tipo.',       test: v => v !== '' },
    { id: 'category', errId: 'categoryErr', msg: 'selecione a categoria.',  test: v => v !== '' },
    { id: 'date',     errId: 'dateErr',     msg: 'data obrigatória.',       test: v => v !== '' }
  ];

  checks.forEach(({ id, errId, msg, test }) => {
    const input = document.getElementById(id);
    const err   = document.getElementById(errId);
    const wrap  = input.closest('.input-wrap');
    if (!test(input.value)) {
      err.textContent = msg;
      wrap.classList.add('error');
      ok = false;
    } else {
      err.textContent = '';
      wrap.classList.remove('error');
    }
  });

  return ok;
}

/* ─────────────────────────────────────────────
   MODAL — EDITAR REGISTRO
   ───────────────────────────────────────────── */
const editModal  = document.getElementById('editModal');
const editForm   = document.getElementById('editForm');
const modalClose = document.getElementById('modalClose');
const cancelEdit = document.getElementById('cancelEdit');

modalClose.addEventListener('click', closeEditModal);
cancelEdit.addEventListener('click', closeEditModal);
editModal.addEventListener('click', (e) => { if (e.target === editModal) closeEditModal(); });

function openEditModal(id) {
  const t = allTransactions.find(x => x.id === id);
  if (!t) return;

  document.getElementById('editId').value       = id;
  document.getElementById('editDesc').value     = t.description;
  document.getElementById('editAmount').value   = t.amount.toFixed(2).replace('.', ',');
  document.getElementById('editType').value     = t.type;
  document.getElementById('editCategory').value = t.category;
  document.getElementById('editDate').value     = t.date;
  document.getElementById('editNotes').value    = t.notes || '';

  editModal.classList.add('open');
}

function closeEditModal() {
  editModal.classList.remove('open');
}

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('editId').value;

  const data = {
    description: document.getElementById('editDesc').value.trim(),
    amount:      parseAmount(document.getElementById('editAmount').value),
    type:        document.getElementById('editType').value,
    category:    document.getElementById('editCategory').value,
    date:        document.getElementById('editDate').value,
    notes:       document.getElementById('editNotes').value.trim(),
    updatedAt:   new Date().toISOString()
  };

  try {
    if (firestoreAvailable && db && !id.startsWith('local_')) {
      const fsData = { ...data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
      await withTimeout(db.collection(COL).doc(id).update(fsData));
    } else {
      updateLocal(id, data);
      allTransactions = loadLocal();
      refreshAll();
    }
    showToast('✓ Registro atualizado!', 'success');
    closeEditModal();
  } catch (err) {
    console.error(err);
    updateLocal(id, data);
    allTransactions = loadLocal();
    refreshAll();
    showToast('✓ Registro atualizado localmente!', 'success');
    closeEditModal();
  }
});

/* ─────────────────────────────────────────────
   MODAL — CONFIRMAR EXCLUSÃO
   ───────────────────────────────────────────── */
const confirmModal  = document.getElementById('confirmModal');
const confirmClose  = document.getElementById('confirmClose');
const cancelDelete  = document.getElementById('cancelDelete');
const confirmDelete = document.getElementById('confirmDelete');

confirmClose.addEventListener('click', closeConfirmModal);
cancelDelete.addEventListener('click', closeConfirmModal);
confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) closeConfirmModal(); });

function openConfirmModal(id) {
  deleteTargetId = id;
  confirmModal.classList.add('open');
}

function closeConfirmModal() {
  deleteTargetId = null;
  confirmModal.classList.remove('open');
}

confirmDelete.addEventListener('click', async () => {
  if (!deleteTargetId) return;
  try {
    if (firestoreAvailable && db && !deleteTargetId.startsWith('local_')) {
      await withTimeout(db.collection(COL).doc(deleteTargetId).delete());
    } else {
      deleteLocal(deleteTargetId);
      allTransactions = loadLocal();
      refreshAll();
    }
    showToast('Registro excluído.', 'info');
  } catch (err) {
    console.error(err);
    deleteLocal(deleteTargetId);
    allTransactions = loadLocal();
    refreshAll();
    showToast('Registro excluído.', 'info');
  } finally {
    closeConfirmModal();
  }
});

/* ─────────────────────────────────────────────
   SEÇÃO DE ANÁLISE — 3 GRÁFICOS
   ───────────────────────────────────────────── */
function renderAnalysisCharts() {
  renderLineChart();
  renderDonutChart();
  renderBarChart2();
}

// Histórico mensal — linha
function renderLineChart() {
  const ctx = document.getElementById('lineChart');
  if (!ctx) return;
  const { labels, incomeData, expenseData } = buildMonthlyData(12);

  if (chartLine) chartLine.destroy();
  chartLine = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Receitas',
          data: incomeData,
          borderColor: C.income,
          backgroundColor: 'rgba(79,107,67,0.08)',
          tension: 0.45,
          fill: true,
          pointBackgroundColor: C.income,
          pointRadius: 4,
          pointHoverRadius: 6
        },
        {
          label: 'Despesas',
          data: expenseData,
          borderColor: C.expense,
          backgroundColor: 'rgba(168,107,71,0.07)',
          tension: 0.45,
          fill: true,
          pointBackgroundColor: C.expense,
          pointRadius: 4,
          pointHoverRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: C.text,
            boxWidth: 10,
            font: { size: 11, family: 'DM Mono', weight: '300' }
          }
        },
        tooltip: {
          backgroundColor: '#2d3d28',
          borderColor: 'rgba(181,204,159,0.15)',
          borderWidth: 1,
          titleFont: { family: 'DM Mono', size: 11 },
          bodyFont:  { family: 'DM Mono', size: 11 },
          callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` }
        }
      },
      scales: {
        x: { grid: gridOpts, ticks: tickOpts },
        y: { grid: gridOpts, ticks: { ...tickOpts, callback: v => fmt(v) } }
      }
    }
  });
}

// Distribuição por categoria — donut
function renderDonutChart() {
  const ctx = document.getElementById('donutChart');
  if (!ctx) return;

  const catMap = {};
  allTransactions.forEach(t => {
    catMap[t.category] = (catMap[t.category] || 0) + t.amount;
  });

  const labels  = Object.keys(catMap);
  const data    = Object.values(catMap);
  // Moss-toned organic palette
  const palette = [
    '#3d5436','#4f6b43','#6b8c5a','#8aab74','#b5cc9f',
    '#a86b47','#c8b89a','#8b5a3c','#d9c9ab','#2d3d28'
  ];

  if (chartDonut) chartDonut.destroy();
  chartDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: palette.slice(0, labels.length),
        borderColor: '#faf6ee',
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: C.text,
            boxWidth: 10,
            font: { size: 10, family: 'DM Mono', weight: '300' }
          }
        },
        tooltip: {
          backgroundColor: '#2d3d28',
          borderColor: 'rgba(181,204,159,0.15)',
          borderWidth: 1,
          titleFont: { family: 'DM Mono', size: 11 },
          bodyFont:  { family: 'DM Mono', size: 11 },
          callbacks: { label: c => ` ${c.label}: ${fmt(c.parsed)}` }
        }
      }
    }
  });
}

// Receitas vs Despesas — barra agrupada
function renderBarChart2() {
  const ctx = document.getElementById('barChart2');
  if (!ctx) return;
  const { labels, incomeData, expenseData } = buildMonthlyData(6);

  if (chartBar2) chartBar2.destroy();
  chartBar2 = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Receitas',
          data: incomeData,
          backgroundColor: 'rgba(79,107,67,0.65)',
          borderColor: C.income,
          borderWidth: 1,
          borderRadius: 6
        },
        {
          label: 'Despesas',
          data: expenseData,
          backgroundColor: 'rgba(168,107,71,0.6)',
          borderColor: C.expense,
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: C.text,
            boxWidth: 10,
            font: { size: 10, family: 'DM Mono', weight: '300' }
          }
        },
        tooltip: {
          backgroundColor: '#2d3d28',
          borderColor: 'rgba(181,204,159,0.15)',
          borderWidth: 1,
          titleFont: { family: 'DM Mono', size: 11 },
          bodyFont:  { family: 'DM Mono', size: 11 },
          callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` }
        }
      },
      scales: {
        x: { grid: gridOpts, ticks: tickOpts },
        y: { grid: gridOpts, ticks: { ...tickOpts, callback: v => fmt(v) } }
      }
    }
  });
}

/* ─────────────────────────────────────────────
   SEGURANÇA — ESCAPAR HTML
   ───────────────────────────────────────────── */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─────────────────────────────────────────────
   INICIALIZAR
   ───────────────────────────────────────────── */
startListener();