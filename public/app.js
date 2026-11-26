// Mis Gastos — cliente web. Habla con la API del servidor (mismo origen).
const $ = (id) => document.getElementById(id);
const CATEGORIES = ['Comida', 'Transporte', 'Casa', 'Ocio', 'Salud', 'Otros'];
let token = localStorage.getItem('mg_token') || '';
let mode = 'login'; // o 'register'
let currentMonth = new Date().toISOString().slice(0, 7); // AAAA-MM
let deleteArmed = null;

const money = (cents) =>
  (cents / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const monthName = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
};
function showMsg(text, isError) {
  const el = $('msg');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
  el.hidden = false;
  clearTimeout(showMsg.t);
  showMsg.t = setTimeout(() => { el.hidden = true; }, 5000);
}
function headers() {
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) };
}
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

// --- Autenticación ---
function showAuth() {
  $('authView').hidden = false;
  $('appView').hidden = true;
}
function showApp(name) {
  $('authView').hidden = true;
  $('appView').hidden = false;
  $('userName').textContent = 'Hola, ' + name;
}
$('toggleAuth').addEventListener('click', () => {
  mode = mode === 'login' ? 'register' : 'login';
  $('authTitle').textContent = mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
  $('authBtn').textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
  $('toggleAuth').textContent = mode === 'login' ? '¿No tienes cuenta? Crea una' : '¿Ya tienes cuenta? Inicia sesión';
});
$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  try {
    let data;
    if (mode === 'register') {
      const name = $('name').value.trim();
      data = await api('/api/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
      showMsg('Cuenta creada. ¡Bienvenido, ' + data.user.name + '!');
    } else {
      data = await api('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    }
    token = data.token;
    localStorage.setItem('mg_token', token);
    showApp(data.user.name);
    loadExpenses();
  } catch (err) { showMsg(err.message, true); }
});
$('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* igual cerramos */ }
  token = '';
  localStorage.removeItem('mg_token');
  showAuth();
});

// --- Gastos ---
function monthParts() {
  $('monthLabel').textContent = monthName(currentMonth);
  $('date').max = new Date().toISOString().slice(0, 10);
}
$('prevMonth').addEventListener('click', () => { shiftMonth(-1); });
$('nextMonth').addEventListener('click', () => { shiftMonth(1); });
function shiftMonth(delta) {
  const [y, m] = currentMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  currentMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  monthParts();
  loadExpenses();
}
let searchTimer = null;
$('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadExpenses, 300); });
$('filterCategory').addEventListener('change', loadExpenses);

async function loadExpenses() {
  monthParts();
  const q = $('search').value.trim();
  const category = $('filterCategory').value;
  const params = new URLSearchParams({ month: currentMonth });
  if (category && category !== 'Todas') params.set('category', category);
  if (q) params.set('q', q);
  try {
    const data = await api('/api/expenses?' + params.toString());
    $('monthTotal').textContent = money(data.totalCents);
    $('monthCount').textContent = data.count + (data.count === 1 ? ' gasto este mes' : ' gastos este mes');
    const max = Math.max(1, ...Object.values(data.byCategory));
    $('byCategory').innerHTML = CATEGORIES.map((c) => {
      const cents = data.byCategory[c] || 0;
      const pct = Math.round((cents / max) * 100);
      return `<div class="bar-row"><span>${c}</span><span class="bar"><i style="width:${pct}%"></i></span><span class="amt">${money(cents)}</span></div>`;
    }).join('');
    const list = $('expenseList');
    list.innerHTML = '';
    $('emptyState').hidden = data.expenses.length > 0;
    for (const ex of data.expenses) {
      const li = document.createElement('li');
      li.innerHTML = `<div><div class="item-desc"></div><div class="item-meta"></div></div>
        <span class="item-amt"></span>
        <span class="item-actions">
          <button type="button" data-act="edit">Editar</button>
          <button type="button" class="danger" data-act="delete">Borrar</button>
        </span>`;
      li.querySelector('.item-desc').textContent = ex.description;
      li.querySelector('.item-meta').textContent = ex.category + ' · ' + ex.date;
      li.querySelector('.item-amt').textContent = money(ex.amountCents);
      li.querySelector('[data-act="edit"]').addEventListener('click', () => startEdit(ex));
      li.querySelector('[data-act="delete"]').addEventListener('click', (ev) => armDelete(ev.currentTarget, ex));
      list.appendChild(li);
    }
  } catch (err) { showMsg(err.message, true); }
}

function startEdit(ex) {
  $('expenseId').value = ex.id;
  $('description').value = ex.description;
  $('amount').value = ex.amount.toFixed(2);
  $('category').value = ex.category;
  $('date').value = ex.date;
  $('formTitle').textContent = 'Editar gasto';
  $('saveBtn').textContent = 'Guardar cambios';
  $('cancelEdit').hidden = false;
  $('description').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function resetForm() {
  $('expenseId').value = '';
  $('expenseForm').reset();
  $('formTitle').textContent = 'Agregar gasto';
  $('saveBtn').textContent = 'Guardar gasto';
  $('cancelEdit').hidden = true;
}
$('cancelEdit').addEventListener('click', resetForm);

function armDelete(btn, ex) {
  if (deleteArmed === ex.id) {
    deleteArmed = null;
    api('/api/expenses/' + ex.id, { method: 'DELETE' })
      .then(() => { showMsg('Gasto borrado.'); loadExpenses(); })
      .catch((err) => showMsg(err.message, true));
  } else {
    deleteArmed = ex.id;
    btn.textContent = '¿Seguro? Toca de nuevo';
    setTimeout(() => { if (deleteArmed === ex.id) { deleteArmed = null; btn.textContent = 'Borrar'; } }, 4000);
  }
}

$('expenseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    description: $('description').value.trim(),
    amount: Number($('amount').value),
    category: $('category').value,
    date: $('date').value,
  };
  const id = $('expenseId').value;
  try {
    if (id) {
      await api('/api/expenses/' + id, { method: 'PUT', body: JSON.stringify(payload) });
      showMsg('Gasto actualizado.');
    } else {
      await api('/api/expenses', { method: 'POST', body: JSON.stringify(payload) });
      showMsg('Gasto guardado.');
    }
    resetForm();
    const [y, m] = payload.date.split('-');
    currentMonth = y + '-' + m;
    loadExpenses();
  } catch (err) { showMsg(err.message, true); }
});

// --- Inicio ---
(async function init() {
  $('date').value = new Date().toISOString().slice(0, 10);
  monthParts();
  if (!token) { showAuth(); return; }
  try {
    const data = await api('/api/me');
    showApp(data.user.name);
    loadExpenses();
  } catch (e) {
    token = '';
    localStorage.removeItem('mg_token');
    showAuth();
  }
})();
