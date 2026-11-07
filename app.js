const STORAGE_KEY = 'kantan-kaikei-transactions';
const AMOUNTS_KEY = 'kantan-kaikei-amounts';
const defaultAmounts = [
  { id: 'item-100', label: '100円', amount: 100 },
  { id: 'item-150', label: '150円', amount: 150 },
  { id: 'item-200', label: '200円', amount: 200 },
  { id: 'item-300', label: '300円', amount: 300 },
  { id: 'drink-100', label: '飲み物', amount: 100 },
  { id: 'drink-250', label: '飲み物 おかわり自由', amount: 250 },
  { id: 'cheese-1700', label: 'チーズ', amount: 1700 },
  { id: 'game-30', label: 'ゲームチケット', amount: 30 },
  { id: 'game-300', label: 'ゲーム回数券', amount: 300 }
];

const amountList = document.querySelector('#amountList');
const currentTotal = document.querySelector('#currentTotal');
const entryDate = document.querySelector('#entryDate');
const headerDate = document.querySelector('#headerDate');
const dayTotal = document.querySelector('#dayTotal');
const entryCount = document.querySelector('#entryCount');
const historyList = document.querySelector('#historyList');
const saveMessage = document.querySelector('#saveMessage');
const cloudStatus = document.querySelector('#cloudStatus');

const cloud = window.CLOUD_CONFIG?.url && window.CLOUD_CONFIG?.anonKey && window.supabase
  ? window.supabase.createClient(window.CLOUD_CONFIG.url, window.CLOUD_CONFIG.anonKey)
  : null;

let amounts = loadAmounts();
let transactions = loadTransactions();

cloudStatus.textContent = cloud ? 'オンライン保存：接続済み' : '現在はこの端末に保存中（オンライン設定前）';

function formatYen(value) {
  return `¥${Number(value).toLocaleString('ja-JP')}`;
}

function todayString() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }).format(date);
}

function loadAmounts() {
  try {
    const saved = JSON.parse(localStorage.getItem(AMOUNTS_KEY));
    return Array.isArray(saved) && saved.length && typeof saved[0] === 'object' ? saved : defaultAmounts;
  } catch { return defaultAmounts; }
}

function loadTransactions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveData() {
  localStorage.setItem(AMOUNTS_KEY, JSON.stringify(amounts));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

async function loadCloudTransactions() {
  if (!cloud) return;
  const { data, error } = await cloud
    .from('accounting_entries')
    .select('id, entry_date, total, lines, created_at')
    .order('created_at', { ascending: true });
  if (error) {
    cloudStatus.textContent = 'オンライン履歴を読み込めませんでした';
    console.error(error);
    return;
  }
  const localSignatures = new Set(transactions.map(item => `${item.date}|${item.total}|${JSON.stringify(item.lines)}`));
  data.forEach(item => {
    const remoteEntry = { id: `cloud-${item.id}`, date: item.entry_date, total: item.total, lines: item.lines };
    const signature = `${remoteEntry.date}|${remoteEntry.total}|${JSON.stringify(remoteEntry.lines)}`;
    if (!localSignatures.has(signature)) transactions.push(remoteEntry);
  });
  saveData();
  renderHistory();
}

function renderAmountRows() {
  const previousValues = {};
  document.querySelectorAll('.quantity-input').forEach(input => { previousValues[input.dataset.id] = input.value; });
  amountList.innerHTML = amounts.map(item => `
    <div class="amount-row" data-row="${item.id}">
      <label class="amount-label" for="amount-${item.id}">${item.label}<span class="amount-unit">${formatYen(item.amount)}</span></label>
      <div class="quantity-control">
        <button class="quantity-button" type="button" data-action="decrease" data-id="${item.id}" aria-label="${item.label}を減らす">−</button>
        <input class="quantity-input" id="amount-${item.id}" data-id="${item.id}" data-amount="${item.amount}" type="number" min="0" step="1" inputmode="numeric" value="${previousValues[item.id] || 0}" aria-label="${item.label}の個数">
        <button class="quantity-button" type="button" data-action="increase" data-id="${item.id}" aria-label="${item.label}を増やす">＋</button>
      </div>
    </div>`).join('');
  updateTotal();
}

function updateTotal() {
  let total = 0;
  document.querySelectorAll('.quantity-input').forEach(input => {
    const quantity = Math.max(0, Number(input.value) || 0);
    input.value = quantity;
    total += Number(input.dataset.amount) * quantity;
    input.closest('.amount-row').classList.toggle('has-value', quantity > 0);
  });
  currentTotal.textContent = formatYen(total);
  return total;
}

function renderHistory() {
  const selectedDate = entryDate.value;
  const selected = transactions.filter(item => item.date === selectedDate);
  const selectedTotal = selected.reduce((sum, item) => sum + item.total, 0);
  dayTotal.textContent = formatYen(selectedTotal);
  entryCount.textContent = `${selected.length}件の会計`;

  if (!transactions.length) {
    historyList.innerHTML = '<div class="empty-history">保存した会計はまだありません</div>';
    return;
  }
  historyList.innerHTML = transactions.slice().reverse().map(item => {
    const detail = item.lines.filter(line => line.quantity > 0).map(line => `${line.label} ${formatYen(line.amount)} × ${line.quantity}`).join('　');
    return `<div class="history-item">
      <span class="history-time">${formatDate(item.date)}</span>
      <span class="history-detail">${detail || '個数なし'}</span>
      <strong class="history-total">${formatYen(item.total)}</strong>
      <button class="delete-button" type="button" data-delete="${item.id}">削除</button>
    </div>`;
  }).join('');
}

function clearInputs() {
  document.querySelectorAll('.quantity-input').forEach(input => { input.value = 0; });
  updateTotal();
  saveMessage.textContent = '';
}

async function saveEntry() {
  const total = updateTotal();
  if (!total) {
    saveMessage.textContent = '個数を1つ以上入力してください';
    saveMessage.style.color = 'var(--coral)';
    return;
  }
  const lines = [...document.querySelectorAll('.quantity-input')].map(input => {
    const item = amounts.find(entry => entry.id === input.dataset.id);
    return { label: item.label, amount: item.amount, quantity: Number(input.value) || 0 };
  });
  const entry = { id: Date.now(), date: entryDate.value, total, lines };
  transactions.push(entry);
  saveData();
  renderHistory();
  clearInputs();
  saveMessage.style.color = 'var(--green)';
  saveMessage.textContent = cloud ? '保存しました。オンラインにも反映しています' : '保存しました。次の会計を入力できます';
  if (cloud) {
    const { error } = await cloud.from('accounting_entries').insert({
      entry_date: entry.date,
      total: entry.total,
      lines: entry.lines
    });
    if (error) {
      saveMessage.style.color = 'var(--coral)';
      saveMessage.textContent = '端末には保存しましたが、オンライン保存に失敗しました';
      console.error(error);
    }
  }
}

amountList.addEventListener('click', event => {
  const button = event.target.closest('.quantity-button');
  if (!button) return;
  const input = document.querySelector(`#amount-${button.dataset.id}`);
  const change = button.dataset.action === 'increase' ? 1 : -1;
  input.value = Math.max(0, (Number(input.value) || 0) + change);
  updateTotal();
});
amountList.addEventListener('input', updateTotal);

document.querySelector('#addAmountButton').addEventListener('click', () => {
  const input = document.querySelector('#customAmount');
  const value = Number(input.value);
  if (!value || value < 1) return;
  amounts.push({ id: `custom-${Date.now()}`, label: `${value}円`, amount: value });
  amounts.sort((a, b) => a.amount - b.amount);
  input.value = '';
  saveData();
  renderAmountRows();
});
document.querySelector('#saveButton').addEventListener('click', saveEntry);
document.querySelector('#resetButton').addEventListener('click', clearInputs);
entryDate.addEventListener('change', renderHistory);
document.querySelectorAll('.view-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.view-tab').forEach(item => item.classList.toggle('is-active', item === tab));
    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.toggle('is-visible', panel.id === tab.dataset.view));
    if (tab.dataset.view === 'historyView') loadCloudTransactions();
  });
});
historyList.addEventListener('click', event => {
  const button = event.target.closest('[data-delete]');
  if (!button) return;
  transactions = transactions.filter(item => String(item.id) !== button.dataset.delete);
  saveData();
  renderHistory();
});
document.querySelector('#downloadButton').addEventListener('click', () => {
  if (!transactions.length) return;
  const header = ['日付', '金額ごとの内訳', '合計'];
  const rows = transactions.map(item => [item.date, item.lines.filter(line => line.quantity).map(line => `${line.label}${line.amount}円×${line.quantity}`).join(' / '), item.total]);
  const csv = [header, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `会計一覧_${todayString()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

entryDate.value = todayString();
headerDate.textContent = formatDate(entryDate.value);
renderAmountRows();
renderHistory();
loadCloudTransactions();
