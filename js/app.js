import * as db from './db.js';
import {
  formatDateBR,
  formatTimeBR,
  formatLongDateSP,
  formatElapsed,
  urgencyLevel,
  toDatetimeLocalValue,
  fromDatetimeLocalValue,
  getPeriodRange,
  toDateInputValue,
} from './datetime.js';
import {
  compressImage,
  photoFileName,
  createPhotoFile,
  buildMessageNF,
  buildMessageSemNF,
  buildReportShareMessage,
  canShareFiles,
  shareFile,
  shareText,
  isAbortError,
  downloadBlob,
  openWhatsApp,
  normalizeWhatsAppNumber,
  isValidWhatsAppNumber,
  formatPhoneDisplay,
} from './share.js';
import { generateReportPdf } from './pdf.js';

const CONFIG_KEY = 'portaria-clarity:config';
const DEFAULT_CONFIG = Object.freeze({
  numeroDestino: '5512988990837',
  nomeGrupo: 'Portaria principal e dos fundos Clarity',
});

const photoUI = {
  nf: {
    input: '#nf-foto',
    trigger: '#nf-photo-trigger',
    preview: '#nf-photo-preview',
    actions: '#nf-photo-actions',
    redo: '#nf-photo-redo',
    remove: '#nf-photo-remove',
    error: '#nf-foto-error',
  },
  semNf: {
    input: '#sem-nf-foto',
    trigger: '#sem-nf-photo-trigger',
    preview: '#sem-nf-photo-preview',
    actions: '#sem-nf-photo-actions',
    redo: '#sem-nf-photo-redo',
    remove: '#sem-nf-photo-remove',
    error: '#sem-nf-foto-error',
  },
};

const state = {
  config: loadConfig(),
  allRecords: [],
  reportRecords: [],
  reportRange: null,
  reportFilter: 'hoje',
  customStart: '',
  customEnd: '',
  photos: { nf: null, semNf: null },
  submitting: { nf: false, semNf: false },
  installPrompt: null,
};

let modalState = { onClose: null, previousFocus: null, closeOnOverlay: true };
let toastTimer = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function persistConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  state.config = config;
}

function showToast(message, type = '') {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show${type ? ` ${type}` : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = 'toast';
  }, 4200);
}

function lockButton(button, milliseconds = 2000) {
  button.disabled = true;
  const timer = setTimeout(() => {
    button.disabled = false;
  }, milliseconds);
  return () => {
    clearTimeout(timer);
    button.disabled = false;
  };
}

function setFieldError(input, errorElement, message) {
  if (errorElement) {
    errorElement.textContent = message || '';
    errorElement.hidden = !message;
  }
  if (input) {
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

function showInlineError(element, message) {
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
}

function getRoute() {
  const hash = window.location.hash.replace(/^#/, '');
  return hash || '/';
}

/* ------------------------------------------------------------------ */
/* Fotos                                                              */
/* ------------------------------------------------------------------ */

function setPhotoError(ui, message) {
  const errorElement = $(ui.error);
  if (!errorElement) return;
  errorElement.textContent = message || '';
  errorElement.hidden = !message;
}

function restorePhotoTrigger(trigger) {
  if (trigger.dataset.defaultHtml) {
    trigger.innerHTML = trigger.dataset.defaultHtml;
  }
}

function setPhoto(key, ui, photo) {
  const previous = state.photos[key];
  if (previous && previous.url) URL.revokeObjectURL(previous.url);

  const url = URL.createObjectURL(photo.blob);
  state.photos[key] = { ...photo, url };

  const preview = $(ui.preview);
  preview.src = url;
  preview.hidden = false;
  $(ui.trigger).hidden = true;
  $(ui.actions).hidden = false;
  setPhotoError(ui, '');
}

function clearPhoto(key, ui) {
  const photo = state.photos[key];
  if (photo && photo.url) URL.revokeObjectURL(photo.url);
  state.photos[key] = null;

  const preview = $(ui.preview);
  preview.removeAttribute('src');
  preview.hidden = true;

  const trigger = $(ui.trigger);
  trigger.hidden = false;
  trigger.disabled = false;
  restorePhotoTrigger(trigger);

  $(ui.actions).hidden = true;
  setPhotoError(ui, '');
}

function setupPhotoFlow(key, ui) {
  const input = $(ui.input);
  const trigger = $(ui.trigger);
  const redo = $(ui.redo);
  const remove = $(ui.remove);

  trigger.dataset.defaultHtml = trigger.innerHTML;

  trigger.addEventListener('click', () => input.click());
  redo.addEventListener('click', () => input.click());
  remove.addEventListener('click', () => clearPhoto(key, ui));

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;

    setPhotoError(ui, '');
    trigger.disabled = true;
    trigger.innerHTML = '<span class="photo-icon" aria-hidden="true">⏳</span><span>Processando foto…</span>';

    try {
      const blob = await compressImage(file);
      const fileName = photoFileName(key === 'nf' ? 'material-nf' : 'encomenda-sem-nf');
      setPhoto(key, ui, { blob, fileName });
    } catch (error) {
      setPhotoError(ui, error.message || 'Não foi possível processar a foto. Tente novamente.');
    } finally {
      trigger.disabled = false;
      restorePhotoTrigger(trigger);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Modais                                                             */
/* ------------------------------------------------------------------ */

function onModalKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal();
    return;
  }

  if (event.key !== 'Tab') return;

  const focusables = $$(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]',
    $('#modal-root')
  ).filter((element) => element.offsetParent !== null);

  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openModal(html, { onClose = null, closeOnOverlay = true } = {}) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-overlay" data-overlay>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-shell">
          <button type="button" class="modal-close" data-modal-close aria-label="Fechar">✕</button>
          ${html}
        </div>
      </div>
    </div>`;

  modalState = {
    onClose,
    closeOnOverlay,
    previousFocus: document.activeElement,
  };

  document.body.classList.add('modal-open');
  document.addEventListener('keydown', onModalKeydown);

  const overlay = $('[data-overlay]', root);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay && modalState.closeOnOverlay) closeModal();
  });
  $('[data-modal-close]', root).addEventListener('click', () => closeModal());

  const focusTarget = $('button, input, textarea, select, a[href]', root);
  if (focusTarget) {
    window.setTimeout(() => {
      if (document.body.classList.contains('modal-open')) focusTarget.focus();
    }, 60);
  }
}

function closeModal({ silent = false } = {}) {
  const root = $('#modal-root');
  if (!root || !root.firstChild) return;

  const { onClose, previousFocus } = modalState;
  root.innerHTML = '';
  document.body.classList.remove('modal-open');
  document.removeEventListener('keydown', onModalKeydown);
  modalState = { onClose: null, previousFocus: null, closeOnOverlay: true };

  if (!silent && typeof onClose === 'function') onClose();

  if (previousFocus && previousFocus.isConnected && previousFocus.offsetParent !== null) {
    previousFocus.focus();
  }
}

function confirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
}) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeModal({ silent: true });
      resolve(value);
    };

    openModal(
      `
      <h2 id="modal-title">${escapeHtml(title)}</h2>
      <p class="modal-text">${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block" data-confirm>
          ${escapeHtml(confirmLabel)}
        </button>
        <button type="button" class="btn btn-outline btn-block" data-cancel>
          ${escapeHtml(cancelLabel)}
        </button>
      </div>`,
      { onClose: () => finish(false) }
    );

    $('[data-confirm]').addEventListener('click', () => finish(true));
    $('[data-cancel]').addEventListener('click', () => finish(false));
  });
}

/* ------------------------------------------------------------------ */
/* Navegação                                                          */
/* ------------------------------------------------------------------ */

const routeNames = {
  '/': 'home',
  '/nova-nf': 'nova-nf',
  '/sem-nf': 'sem-nf',
  '/relatorio': 'relatorio',
  '/config': 'config',
};

function showView(name) {
  $$('.view').forEach((view) => {
    view.hidden = view.id !== `view-${name}`;
  });
  $('#main').classList.toggle('is-wide', name === 'relatorio');
  $('#nav-relatorio').classList.toggle('is-active', name === 'relatorio');
  $('#nav-config').classList.toggle('is-active', name === 'config');
  document.body.dataset.view = name;
}

async function handleRoute() {
  const route = getRoute();
  const name = routeNames[route] || 'home';

  closeModal({ silent: true });
  showView(name);
  window.scrollTo(0, 0);

  if (name !== 'nova-nf' && state.photos.nf) clearPhoto('nf', photoUI.nf);
  if (name !== 'sem-nf' && state.photos.semNf) clearPhoto('semNf', photoUI.semNf);

  if (name === 'home') {
    await renderHome();
  } else if (name === 'nova-nf') {
    await prepareNFView();
  } else if (name === 'sem-nf') {
    prepareSemNFView();
  } else if (name === 'relatorio') {
    await renderReport();
  } else if (name === 'config') {
    renderConfig();
  }
}

/* ------------------------------------------------------------------ */
/* Início e pendentes                                                 */
/* ------------------------------------------------------------------ */

function updateClock() {
  const element = $('#home-clock');
  if (!element) return;
  const now = new Date();
  element.textContent = `${formatLongDateSP(now)} • ${formatTimeBR(now)}`;
}

async function loadRecords() {
  try {
    state.allRecords = await db.listarRegistros();
  } catch (error) {
    state.allRecords = [];
    showToast('Não foi possível ler os dados salvos neste aparelho.', 'error');
    console.error(error);
  }
}

function renderPending() {
  const pending = state.allRecords
    .filter((record) => record.status === 'aguardando')
    .sort((a, b) => new Date(a.dataHoraEntrada) - new Date(b.dataHoraEntrada));

  const count = $('#pending-count');
  count.textContent = String(pending.length);
  count.setAttribute('aria-label', `${pending.length} aguardando retirada`);

  const list = $('#pending-list');
  if (!pending.length) {
    list.innerHTML = '<p class="empty-state">Nenhum material aguardando retirada.</p>';
    return;
  }

  list.innerHTML = pending
    .map((record) => {
      const level = urgencyLevel(record.dataHoraEntrada);
      return `
        <article class="pending-card urgency-${level}" data-id="${escapeHtml(record.id)}">
          <button type="button" class="btn btn-success btn-block btn-exit"
                  data-action="exit" data-id="${escapeHtml(record.id)}">✅ REGISTRAR SAÍDA</button>
          <div class="pending-body">
            <div class="pending-top">
              <h3>${escapeHtml(record.fornecedor)}</h3>
              <span class="elapsed">${formatElapsed(record.dataHoraEntrada)}</span>
            </div>
            <p class="pending-meta">
              NF <strong>${escapeHtml(record.numeroNF)}</strong> • Entrada às ${formatTimeBR(record.dataHoraEntrada)}
            </p>
            ${record.observacao ? `<p class="pending-obs">📝 ${escapeHtml(record.observacao)}</p>` : ''}
            <div class="pending-footer">
              <span class="pending-date">${formatDateBR(record.dataHoraEntrada)}</span>
              <button type="button" class="link-btn" data-action="resend" data-id="${escapeHtml(record.id)}">
                📤 Reenviar aviso
              </button>
            </div>
          </div>
        </article>`;
    })
    .join('');
}

function updateElapsedIndicators() {
  if (document.body.dataset.view !== 'home') return;
  for (const card of $$('.pending-card[data-id]')) {
    const record = state.allRecords.find((item) => item.id === card.dataset.id);
    if (!record) continue;
    const elapsed = $('.elapsed', card);
    if (elapsed) elapsed.textContent = formatElapsed(record.dataHoraEntrada);
    card.classList.remove('urgency-warning', 'urgency-critical');
    const level = urgencyLevel(record.dataHoraEntrada);
    if (level !== 'normal') card.classList.add(`urgency-${level}`);
  }
}

async function renderHome() {
  updateClock();
  await loadRecords();
  renderPending();
  renderSupplierSuggestions();
}

function renderSupplierSuggestions() {
  const records = [...state.allRecords].sort((a, b) => {
    const aDate = new Date(a.criadoEm || a.dataHoraEntrada).getTime();
    const bDate = new Date(b.criadoEm || b.dataHoraEntrada).getTime();
    return bDate - aDate;
  });

  const unique = [];
  const seen = new Set();
  for (const record of records) {
    const name = String(record.fornecedor || '').trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase('pt-BR');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
    if (unique.length >= 20) break;
  }

  $('#fornecedores-list').innerHTML = unique
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join('');

  const container = $('#fornecedores-recentes');
  const recent = unique.slice(0, 6);
  if (!recent.length) {
    container.innerHTML = '';
    container.hidden = true;
    return;
  }

  container.hidden = false;
  container.innerHTML = recent
    .map(
      (name) =>
        `<button type="button" class="chip" data-supplier="${escapeHtml(name)}">${escapeHtml(name)}</button>`
    )
    .join('');
}

function openExitDialog(record) {
  const openedAt = new Date();
  const initialValue = toDatetimeLocalValue(openedAt);

  openModal(`
    <h2 id="modal-title">Registrar saída</h2>
    <p class="modal-text">
      <strong>${escapeHtml(record.fornecedor)}</strong><br>
      NF ${escapeHtml(record.numeroNF)} • Entrada às ${formatTimeBR(record.dataHoraEntrada)}
    </p>
    <p class="exit-now">Saída agora: <strong id="exit-time-display">${formatTimeBR(openedAt)}</strong></p>
    <details class="adjust-time" id="exit-adjust">
      <summary>Ajustar hora de saída</summary>
      <div class="field">
        <label class="label" for="exit-datetime">Data e hora de saída</label>
        <input type="datetime-local" id="exit-datetime" value="${initialValue}">
      </div>
    </details>
    <p class="field-error" id="exit-error" role="alert" hidden></p>
    <div class="modal-actions">
      <button type="button" class="btn btn-success btn-xl btn-block" data-confirm-exit>
        ✅ CONFIRMAR SAÍDA
      </button>
      <button type="button" class="btn btn-outline btn-block" data-cancel-exit>Cancelar</button>
    </div>
  `);

  let manualAdjustment = false;
  const input = $('#exit-datetime');
  const display = $('#exit-time-display');
  const errorElement = $('#exit-error');

  input.addEventListener('input', () => {
    manualAdjustment = true;
    errorElement.hidden = true;
    const iso = fromDatetimeLocalValue(input.value);
    display.textContent = iso ? formatTimeBR(iso) : '--:--';
  });

  $('#exit-adjust').addEventListener('toggle', () => {
    if ($('#exit-adjust').open) input.focus();
  });

  $('[data-confirm-exit]').addEventListener('click', async () => {
    errorElement.hidden = true;
    const exitIso = manualAdjustment ? fromDatetimeLocalValue(input.value) : new Date().toISOString();

    if (!exitIso) {
      showInlineError(errorElement, 'Informe uma data e hora válidas.');
      return;
    }
    if (new Date(exitIso).getTime() < new Date(record.dataHoraEntrada).getTime()) {
      showInlineError(errorElement, 'A saída não pode ser anterior à entrada.');
      return;
    }
    if (new Date(exitIso).getTime() > Date.now() + 60000) {
      showInlineError(errorElement, 'A saída não pode estar no futuro.');
      return;
    }

    const button = $('[data-confirm-exit]');
    button.disabled = true;

    try {
      await db.salvarRegistro({ ...record, dataHoraSaida: exitIso, status: 'retirado' });
      closeModal({ silent: true });
      showToast('Saída registrada. Material retirado!');
      await renderHome();
    } catch (error) {
      button.disabled = false;
      showToast('Não foi possível registrar a saída.', 'error');
      console.error(error);
    }
  });

  $('[data-cancel-exit]').addEventListener('click', () => closeModal());
}

function openTextShareSheet({ title, message, subtitle = '' }) {
  const canShareText = typeof navigator.share === 'function';
  const numberLabel = formatPhoneDisplay(state.config.numeroDestino);

  openModal(`
    <h2 id="modal-title">${escapeHtml(title)}</h2>
    ${subtitle ? `<p class="modal-text">${escapeHtml(subtitle)}</p>` : ''}
    <pre class="message-preview">${escapeHtml(message)}</pre>
    <p class="hint">
      No WhatsApp, escolha o contato ou o grupo
      <strong>${escapeHtml(state.config.nomeGrupo)}</strong>.
    </p>
    <div class="modal-actions">
      ${
        canShareText
          ? '<button type="button" class="btn btn-primary btn-block" data-share-text>📤 Compartilhar mensagem</button>'
          : ''
      }
      <button type="button" class="btn ${canShareText ? 'btn-outline' : 'btn-primary'} btn-block" data-wa-number>
        💬 Enviar para ${escapeHtml(numberLabel)}
      </button>
      <button type="button" class="btn btn-ghost btn-block" data-close-sheet>Fechar</button>
    </div>
  `);

  if (canShareText) {
    $('[data-share-text]').addEventListener('click', async () => {
      try {
        await shareText(message);
        closeModal({ silent: true });
        showToast('Mensagem compartilhada!');
      } catch (error) {
        if (!isAbortError(error)) {
          showToast('Não foi possível compartilhar. Use a opção do WhatsApp.', 'error');
        }
      }
    });
  }

  $('[data-wa-number]').addEventListener('click', () => {
    try {
      openWhatsApp(state.config.numeroDestino, message);
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  $('[data-close-sheet]').addEventListener('click', () => closeModal());
}

function openResendDialog(record) {
  openTextShareSheet({
    title: 'Reenviar aviso',
    message: buildMessageNF(record),
    subtitle: `${record.fornecedor} • NF ${record.numeroNF}`,
  });
}

/* ------------------------------------------------------------------ */
/* Envio (Web Share / WhatsApp)                                       */
/* ------------------------------------------------------------------ */

function openSendSheet({ mode, title, message, photo, onClose }) {
  const file = createPhotoFile(photo);
  const fileShareSupported = file ? canShareFiles(file) : false;
  const textShareSupported = typeof navigator.share === 'function';
  const numberLabel = formatPhoneDisplay(state.config.numeroDestino);

  let primaryLabel;
  let primaryNote;

  if (photo) {
    if (fileShareSupported) {
      primaryLabel = '📤 Enviar com foto (escolher contato/grupo)';
      primaryNote = 'Abre a lista de apps do celular. Escolha o WhatsApp e o destino.';
    } else {
      primaryLabel = '⬇️ Baixar foto e abrir WhatsApp';
      primaryNote =
        'Seu navegador não anexa a foto automaticamente. A foto será baixada para você anexar manualmente.';
    }
  } else if (textShareSupported) {
    primaryLabel = '📤 Compartilhar mensagem';
    primaryNote = 'Abre a lista de apps do celular para escolher o contato ou grupo.';
  } else {
    primaryLabel = '💬 Enviar para o número';
    primaryNote = '';
  }

  openModal(
    `
    <h2 id="modal-title">${escapeHtml(title)}</h2>
    <p class="modal-text">
      ${
        mode === 'nf'
          ? 'O registro foi salvo. Agora envie o aviso ao almoxarifado:'
          : 'Confira a mensagem e envie o aviso:'
      }
    </p>
    <div class="share-preview">
      ${photo ? `<img class="share-photo" src="${photo.url}" alt="Foto que será enviada">` : ''}
      <pre class="message-preview">${escapeHtml(message)}</pre>
    </div>
    <p class="hint">
      ${primaryNote ? `${escapeHtml(primaryNote)} ` : ''}
      No WhatsApp, escolha o contato ou o grupo
      <strong>${escapeHtml(state.config.nomeGrupo)}</strong>.
      ${
        mode === 'nf'
          ? 'Se fechar sem enviar, o registro continua salvo e pode ser reenviado pelo card na tela inicial.'
          : 'Se fechar sem enviar, a foto será descartada.'
      }
    </p>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary btn-xl btn-block" data-share-primary>
        ${primaryLabel}
      </button>
      <button type="button" class="btn btn-outline btn-block" data-share-number>
        💬 Enviar só o texto para ${escapeHtml(numberLabel)}
      </button>
      <button type="button" class="btn btn-ghost btn-block" data-copy-message>📋 Copiar mensagem</button>
      <button type="button" class="btn btn-ghost btn-block" data-close-send>
        ${mode === 'nf' ? 'Fechar (registro já salvo)' : 'Fechar sem enviar'}
      </button>
    </div>
  `,
    { onClose }
  );

  const completeSend = () => {
    closeModal({ silent: true });
    showToast('Aviso enviado!');
    if (getRoute() !== '/') window.location.hash = '#/';
  };

  $('[data-share-primary]').addEventListener('click', async () => {
    const button = $('[data-share-primary]');
    button.disabled = true;

    try {
      if (photo) {
        if (fileShareSupported) {
          await shareFile(file, message);
          completeSend();
        } else {
          downloadBlob(photo.blob, photo.fileName);
          openWhatsApp(state.config.numeroDestino, message);
          showToast('Foto baixada. Anexe-a manualmente no WhatsApp.', 'info');
          button.disabled = false;
        }
      } else if (textShareSupported) {
        await shareText(message);
        completeSend();
      } else {
        openWhatsApp(state.config.numeroDestino, message);
        completeSend();
      }
    } catch (error) {
      button.disabled = false;
      if (isAbortError(error)) return;

      if (photo) {
        try {
          downloadBlob(photo.blob, photo.fileName);
          openWhatsApp(state.config.numeroDestino, message);
          showToast(
            'Não foi possível anexar automaticamente. A foto foi baixada; anexe-a manualmente no WhatsApp.',
            'info'
          );
          return;
        } catch (fallbackError) {
          console.error(fallbackError);
        }
      }

      showToast('Não foi possível compartilhar. Use a opção de enviar para o número.', 'error');
      console.error(error);
    }
  });

  $('[data-share-number]').addEventListener('click', () => {
    try {
      openWhatsApp(state.config.numeroDestino, message);
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  $('[data-copy-message]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(message);
      showToast('Mensagem copiada.');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = message;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        showToast('Mensagem copiada.');
      } catch {
        showToast('Não foi possível copiar a mensagem.', 'error');
      }
      textarea.remove();
    }
  });

  $('[data-close-send]').addEventListener('click', () => closeModal());
}

/* ------------------------------------------------------------------ */
/* Formulário COM NF                                                  */
/* ------------------------------------------------------------------ */

function cleanupNFForm() {
  $('#form-nf').reset();
  clearPhoto('nf', photoUI.nf);
  setFieldError($('#nf-fornecedor'), $('#nf-fornecedor-error'), '');
  setFieldError($('#nf-numero'), $('#nf-numero-error'), '');
}

function cleanupSemNFForm() {
  $('#form-sem-nf').reset();
  clearPhoto('semNf', photoUI.semNf);
}

async function prepareNFView() {
  cleanupNFForm();
  await loadRecords();
  renderSupplierSuggestions();
}

function prepareSemNFView() {
  cleanupSemNFForm();
}

function bindNFPhoto() {
  setupPhotoFlow('nf', photoUI.nf);
  setupPhotoFlow('semNf', photoUI.semNf);
}

function bindForms() {
  $('#nf-fornecedor').addEventListener('input', () => {
    setFieldError($('#nf-fornecedor'), $('#nf-fornecedor-error'), '');
  });
  $('#nf-numero').addEventListener('input', () => {
    setFieldError($('#nf-numero'), $('#nf-numero-error'), '');
  });

  $('#fornecedores-recentes').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-supplier]');
    if (!chip) return;
    const input = $('#nf-fornecedor');
    input.value = chip.dataset.supplier;
    input.focus();
    setFieldError(input, $('#nf-fornecedor-error'), '');
  });

  $('#form-nf').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.submitting.nf) return;

    const supplierInput = $('#nf-fornecedor');
    const numberInput = $('#nf-numero');
    const fornecedor = supplierInput.value.trim();
    const numeroNF = numberInput.value.trim();
    const observacao = $('#nf-obs').value.trim();

    setFieldError(supplierInput, $('#nf-fornecedor-error'), '');
    setFieldError(numberInput, $('#nf-numero-error'), '');

    let valid = true;
    if (!fornecedor) {
      setFieldError(supplierInput, $('#nf-fornecedor-error'), 'Informe o nome do fornecedor.');
      valid = false;
    }
    if (!numeroNF) {
      setFieldError(numberInput, $('#nf-numero-error'), 'Informe o número da nota fiscal.');
      valid = false;
    }
    if (!valid) {
      if (!fornecedor) supplierInput.focus();
      else numberInput.focus();
      return;
    }

    state.submitting.nf = true;
    const unlock = lockButton($('#nf-submit'), 2000);
    const nowIso = new Date().toISOString();

    const record = {
      id: db.createId(),
      tipo: 'com_nf',
      fornecedor,
      numeroNF,
      observacao,
      dataHoraEntrada: nowIso,
      dataHoraSaida: null,
      status: 'aguardando',
      criadoEm: nowIso,
    };

    try {
      await db.salvarRegistro(record);
      await requestPersistentStorage();
      state.allRecords = await db.listarRegistros();
      renderPending();

      openSendSheet({
        mode: 'nf',
        title: 'Registro salvo!',
        message: buildMessageNF(record),
        photo: state.photos.nf,
        onClose: () => {
          cleanupNFForm();
          if (getRoute() === '/nova-nf') window.location.hash = '#/';
        },
      });
    } catch (error) {
      unlock();
      state.submitting.nf = false;
      showToast('Não foi possível salvar o registro. Tente novamente.', 'error');
      console.error(error);
      return;
    }

    window.setTimeout(() => {
      state.submitting.nf = false;
    }, 2000);
  });

  $('#form-sem-nf').addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.submitting.semNf) return;

    const photo = state.photos.semNf;
    setPhotoError(photoUI.semNf, '');

    if (!photo) {
      setPhotoError(photoUI.semNf, 'Tire uma foto da encomenda para enviar.');
      $('#sem-nf-photo-trigger').focus();
      return;
    }

    state.submitting.semNf = true;
    lockButton($('#sem-nf-submit'), 2000);
    const observacao = $('#sem-nf-obs').value.trim();

    openSendSheet({
      mode: 'sem-nf',
      title: 'Encomenda pronta para avisar!',
      message: buildMessageSemNF(new Date(), observacao),
      photo,
      onClose: () => {
        cleanupSemNFForm();
        if (getRoute() === '/sem-nf') window.location.hash = '#/';
      },
    });

    window.setTimeout(() => {
      state.submitting.semNf = false;
    }, 2000);
  });
}

/* ------------------------------------------------------------------ */
/* Relatório                                                          */
/* ------------------------------------------------------------------ */

async function renderReport() {
  await loadRecords();

  const chips = $$('#report-filters [data-filter]');
  chips.forEach((chip) => {
    chip.classList.toggle('is-active', chip.dataset.filter === state.reportFilter);
  });

  $('#custom-range').hidden = state.reportFilter !== 'personalizado';

  if (!state.customStart) state.customStart = toDateInputValue(new Date());
  if (!state.customEnd) state.customEnd = toDateInputValue(new Date());
  $('#report-start').value = state.customStart;
  $('#report-end').value = state.customEnd;

  let range;
  try {
    range = getPeriodRange(state.reportFilter, state.customStart, state.customEnd);
  } catch (error) {
    showToast(error.message, 'error');
    state.reportFilter = 'hoje';
    chips.forEach((chip) => {
      chip.classList.toggle('is-active', chip.dataset.filter === 'hoje');
    });
    $('#custom-range').hidden = true;
    range = getPeriodRange('hoje');
  }

  state.reportRange = range;

  const filtered = state.allRecords
    .filter((record) => {
      const timestamp = new Date(record.dataHoraEntrada).getTime();
      return timestamp >= range.start.getTime() && timestamp < range.end.getTime();
    })
    .sort((a, b) => new Date(b.dataHoraEntrada) - new Date(a.dataHoraEntrada));

  state.reportRecords = filtered;

  $('#report-period').textContent = `Período: ${range.label}`;
  const waiting = filtered.filter((record) => record.status === 'aguardando').length;
  $('#report-summary').textContent =
    `${filtered.length} registro${filtered.length === 1 ? '' : 's'} • ` +
    `${waiting} aguardando retirada`;

  renderReportTable(filtered);

  $('#pdf-share').disabled = filtered.length === 0;
  $('#pdf-download').disabled = filtered.length === 0;
}

function renderReportTable(records) {
  const body = $('#report-body');
  const empty = $('#report-empty');
  const wrap = $('#report-table-wrap');

  if (!records.length) {
    body.innerHTML = '';
    empty.hidden = false;
    wrap.hidden = true;
    return;
  }

  empty.hidden = true;
  wrap.hidden = false;

  body.innerHTML = records
    .map(
      (record) => `
      <tr>
        <td class="cell-date" data-label="Data">${formatDateBR(record.dataHoraEntrada)}</td>
        <td class="cell-supplier" data-label="Fornecedor">${escapeHtml(record.fornecedor)}</td>
        <td class="cell-nf" data-label="Nota Fiscal">${escapeHtml(record.numeroNF)}</td>
        <td class="cell-entry" data-label="Entrada">${formatTimeBR(record.dataHoraEntrada)}</td>
        <td class="cell-exit" data-label="Saída">
          ${
            record.dataHoraSaida
              ? `<span class="status-pill done">${formatTimeBR(record.dataHoraSaida)}</span>`
              : '<span class="status-pill waiting">Aguardando</span>'
          }
        </td>
        <td class="obs-cell cell-obs" data-label="Observação">${record.observacao ? escapeHtml(record.observacao) : '—'}</td>
        <td class="actions-cell cell-actions">
          <button type="button" class="icon-action" data-edit="${escapeHtml(record.id)}"
                  aria-label="Editar registro de ${escapeHtml(record.fornecedor)}" title="Editar">
            ✏️<span>Editar</span>
          </button>
          <button type="button" class="icon-action danger" data-delete="${escapeHtml(record.id)}"
                  aria-label="Apagar registro de ${escapeHtml(record.fornecedor)}" title="Apagar">
            🗑️<span>Apagar</span>
          </button>
        </td>
      </tr>`
    )
    .join('');
}

function openEditDialog(record) {
  openModal(`
    <h2 id="modal-title">Editar registro</h2>
    <form id="edit-form" novalidate>
      <div class="field">
        <label class="label" for="edit-fornecedor">Fornecedor <span class="req">*</span></label>
        <input type="text" id="edit-fornecedor" value="${escapeHtml(record.fornecedor)}"
               maxlength="120" required>
        <p class="field-error" id="edit-fornecedor-error" role="alert" hidden></p>
      </div>
      <div class="field">
        <label class="label" for="edit-nf">Nota fiscal <span class="req">*</span></label>
        <input type="text" id="edit-nf" inputmode="numeric" value="${escapeHtml(record.numeroNF)}"
               maxlength="40" required>
        <p class="field-error" id="edit-nf-error" role="alert" hidden></p>
      </div>
      <div class="field">
        <label class="label" for="edit-obs">Observação</label>
        <textarea id="edit-obs" rows="2" maxlength="500">${escapeHtml(record.observacao || '')}</textarea>
      </div>
      <div class="field">
        <label class="label" for="edit-entrada">Data e hora de entrada <span class="req">*</span></label>
        <input type="datetime-local" id="edit-entrada"
               value="${toDatetimeLocalValue(record.dataHoraEntrada)}" required>
        <p class="field-error" id="edit-entrada-error" role="alert" hidden></p>
      </div>
      <div class="field">
        <label class="label" for="edit-saida">Data e hora de saída</label>
        <input type="datetime-local" id="edit-saida"
               value="${record.dataHoraSaida ? toDatetimeLocalValue(record.dataHoraSaida) : ''}">
        <p class="hint">Deixe vazio para manter “Aguardando retirada”.</p>
        <p class="field-error" id="edit-saida-error" role="alert" hidden></p>
      </div>
      <p class="field-error" id="edit-general-error" role="alert" hidden></p>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary btn-block">Salvar alterações</button>
        <button type="button" class="btn btn-outline btn-block" data-cancel-edit>Cancelar</button>
      </div>
    </form>
  `);

  $('[data-cancel-edit]').addEventListener('click', () => closeModal());

  $('#edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    const supplierInput = $('#edit-fornecedor');
    const numberInput = $('#edit-nf');
    const entryInput = $('#edit-entrada');
    const exitInput = $('#edit-saida');
    const generalError = $('#edit-general-error');

    const fornecedor = supplierInput.value.trim();
    const numeroNF = numberInput.value.trim();
    const observacao = $('#edit-obs').value.trim();
    const entradaIso = fromDatetimeLocalValue(entryInput.value);
    const exitValue = exitInput.value;
    const saidaIso = exitValue ? fromDatetimeLocalValue(exitValue) : null;

    setFieldError(supplierInput, $('#edit-fornecedor-error'), '');
    setFieldError(numberInput, $('#edit-nf-error'), '');
    setFieldError(entryInput, $('#edit-entrada-error'), '');
    setFieldError(exitInput, $('#edit-saida-error'), '');
    generalError.hidden = true;

    let valid = true;
    if (!fornecedor) {
      setFieldError(supplierInput, $('#edit-fornecedor-error'), 'Informe o fornecedor.');
      valid = false;
    }
    if (!numeroNF) {
      setFieldError(numberInput, $('#edit-nf-error'), 'Informe a nota fiscal.');
      valid = false;
    }
    if (!entradaIso) {
      setFieldError(entryInput, $('#edit-entrada-error'), 'Informe a data e a hora de entrada.');
      valid = false;
    }
    if (exitValue && !saidaIso) {
      setFieldError(exitInput, $('#edit-saida-error'), 'Informe uma data e hora de saída válidas.');
      valid = false;
    }
    if (entradaIso && new Date(entradaIso).getTime() > Date.now() + 60000) {
      setFieldError(entryInput, $('#edit-entrada-error'), 'A entrada não pode estar no futuro.');
      valid = false;
    }
    if (entradaIso && saidaIso && new Date(saidaIso).getTime() < new Date(entradaIso).getTime()) {
      setFieldError(exitInput, $('#edit-saida-error'), 'A saída não pode ser anterior à entrada.');
      valid = false;
    }
    if (!valid) {
      if (!fornecedor) supplierInput.focus();
      else if (!numeroNF) numberInput.focus();
      else if (!entradaIso) entryInput.focus();
      else exitInput.focus();
      return;
    }

    const submitButton = $('#edit-form button[type="submit"]');
    submitButton.disabled = true;

    try {
      await db.salvarRegistro({
        ...record,
        fornecedor,
        numeroNF,
        observacao,
        dataHoraEntrada: entradaIso,
        dataHoraSaida: saidaIso,
        status: saidaIso ? 'retirado' : 'aguardando',
      });
      closeModal({ silent: true });
      showToast('Registro atualizado.');
      await renderReport();
    } catch (error) {
      submitButton.disabled = false;
      showToast('Não foi possível salvar as alterações.', 'error');
      console.error(error);
    }
  });
}

async function deleteRecord(record) {
  const confirmed = await confirmDialog({
    title: 'Apagar registro?',
    message: `Apagar o registro de ${record.fornecedor} (NF ${record.numeroNF})? Esta ação não pode ser desfeita.`,
    confirmLabel: 'Apagar',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await db.apagarRegistro(record.id);
    showToast('Registro apagado.');
    await renderReport();
  } catch (error) {
    showToast('Não foi possível apagar o registro.', 'error');
    console.error(error);
  }
}

async function handlePdf(shouldShare) {
  if (!state.reportRecords.length || !state.reportRange) return;

  const shareButton = $('#pdf-share');
  const downloadButton = $('#pdf-download');
  const shareLabel = shareButton.textContent;
  const downloadLabel = downloadButton.textContent;

  if (shouldShare) {
    shareButton.disabled = true;
    shareButton.textContent = 'Gerando PDF…';
  } else {
    downloadButton.disabled = true;
    downloadButton.textContent = 'Gerando PDF…';
  }

  try {
    const { blob, fileName } = generateReportPdf({
      records: state.reportRecords,
      periodLabel: state.reportRange.label,
    });

    if (!shouldShare) {
      downloadBlob(blob, fileName);
      showToast('PDF baixado.');
      return;
    }

    const file = new File([blob], fileName, { type: 'application/pdf' });
    const message = buildReportShareMessage(
      state.reportRange.startLabel,
      state.reportRange.endLabel
    );

    if (canShareFiles(file)) {
      await shareFile(file, message);
      showToast('PDF compartilhado.');
    } else {
      downloadBlob(blob, fileName);
      openWhatsApp(state.config.numeroDestino, message);
      showToast('PDF baixado. Anexe-o manualmente no WhatsApp.', 'info');
    }
  } catch (error) {
    if (!isAbortError(error)) {
      showToast(error.message || 'Não foi possível gerar o PDF.', 'error');
      console.error(error);
    }
  } finally {
    shareButton.disabled = state.reportRecords.length === 0;
    shareButton.textContent = shareLabel;
    downloadButton.disabled = state.reportRecords.length === 0;
    downloadButton.textContent = downloadLabel;
  }
}

/* ------------------------------------------------------------------ */
/* Configurações                                                      */
/* ------------------------------------------------------------------ */

function renderConfig() {
  $('#cfg-numero').value = state.config.numeroDestino;
  $('#cfg-grupo').value = state.config.nomeGrupo;
  setFieldError($('#cfg-numero'), $('#cfg-numero-error'), '');
  setFieldError($('#cfg-grupo'), $('#cfg-grupo-error'), '');
  $('#install-app').hidden = !state.installPrompt;
}

function sanitizeImportedRecords(rawRecords) {
  const valid = [];
  const seen = new Set();
  let invalid = 0;

  for (const raw of rawRecords) {
    if (!raw || typeof raw !== 'object') {
      invalid += 1;
      continue;
    }

    const fornecedor = String(raw.fornecedor || '').trim();
    const numeroNF = String(raw.numeroNF || '').trim();
    const entryDate = new Date(raw.dataHoraEntrada);

    if (!fornecedor || !numeroNF || Number.isNaN(entryDate.getTime())) {
      invalid += 1;
      continue;
    }

    const exitDate = raw.dataHoraSaida ? new Date(raw.dataHoraSaida) : null;
    const hasExit = Boolean(exitDate && !Number.isNaN(exitDate.getTime()));
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : db.createId();

    if (seen.has(id)) {
      invalid += 1;
      continue;
    }
    seen.add(id);

    const createdDate = raw.criadoEm ? new Date(raw.criadoEm) : entryDate;

    valid.push({
      id,
      tipo: 'com_nf',
      fornecedor,
      numeroNF,
      observacao: String(raw.observacao || '').trim(),
      dataHoraEntrada: entryDate.toISOString(),
      dataHoraSaida: hasExit ? exitDate.toISOString() : null,
      status: hasExit ? 'retirado' : 'aguardando',
      criadoEm: Number.isNaN(createdDate.getTime()) ? entryDate.toISOString() : createdDate.toISOString(),
    });
  }

  return { valid, invalid };
}

function bindSettings() {
  $('#cfg-numero').addEventListener('input', () => {
    setFieldError($('#cfg-numero'), $('#cfg-numero-error'), '');
  });
  $('#cfg-grupo').addEventListener('input', () => {
    setFieldError($('#cfg-grupo'), $('#cfg-grupo-error'), '');
  });

  $('#form-config').addEventListener('submit', (event) => {
    event.preventDefault();
    const numberInput = $('#cfg-numero');
    const groupInput = $('#cfg-grupo');
    const normalized = normalizeWhatsAppNumber(numberInput.value);
    const group = groupInput.value.trim();
    let valid = true;

    setFieldError(numberInput, $('#cfg-numero-error'), '');
    setFieldError(groupInput, $('#cfg-grupo-error'), '');

    if (!isValidWhatsAppNumber(numberInput.value)) {
      setFieldError(
        numberInput,
        $('#cfg-numero-error'),
        'Informe um número válido com DDI e DDD. Ex.: 5512988990837.'
      );
      valid = false;
    }
    if (!group) {
      setFieldError(groupInput, $('#cfg-grupo-error'), 'Informe o nome do grupo.');
      valid = false;
    }
    if (!valid) {
      if (!isValidWhatsAppNumber(numberInput.value)) numberInput.focus();
      else groupInput.focus();
      return;
    }

    persistConfig({ numeroDestino: normalized, nomeGrupo: group });
    numberInput.value = normalized;
    showToast('Configurações salvas.');
  });

  $('#install-app').addEventListener('click', async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    try {
      await state.installPrompt.userChoice;
    } catch {
      // Ignora cancelamento.
    }
    state.installPrompt = null;
    $('#install-app').hidden = true;
  });

  $('#export-backup').addEventListener('click', async () => {
    try {
      const records = await db.listarRegistros();
      const payload = {
        app: 'portaria-clarity',
        versao: 1,
        exportadoEm: new Date().toISOString(),
        config: { ...state.config },
        registros: records,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      downloadBlob(blob, `backup-portaria-clarity-${toDateInputValue(new Date())}.json`);
      showToast('Backup exportado.');
    } catch (error) {
      showToast('Não foi possível exportar o backup.', 'error');
      console.error(error);
    }
  });

  $('#import-backup').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rawRecords = Array.isArray(parsed) ? parsed : parsed.registros;
      if (!Array.isArray(rawRecords)) {
        throw new Error('Arquivo de backup inválido.');
      }

      const { valid, invalid } = sanitizeImportedRecords(rawRecords);
      if (!valid.length) {
        throw new Error('Nenhum registro válido encontrado no arquivo.');
      }

      const confirmed = await confirmDialog({
        title: 'Importar backup',
        message:
          `${valid.length} registro${valid.length === 1 ? '' : 's'} válido${valid.length === 1 ? '' : 's'}` +
          `${invalid ? `, ${invalid} inválido${invalid === 1 ? '' : 's'} ignorado${invalid === 1 ? '' : 's'}` : ''}. ` +
          'Registros com o mesmo ID serão atualizados. Deseja continuar?',
        confirmLabel: 'Importar',
      });
      if (!confirmed) return;

      const result = await db.importarRegistros(valid);
      await renderHome();
      showToast(
        `Backup importado: ${result.novos} novo${result.novos === 1 ? '' : 's'}, ` +
          `${result.atualizados} atualizado${result.atualizados === 1 ? '' : 's'}.`
      );
    } catch (error) {
      showToast(error.message || 'Não foi possível importar o backup.', 'error');
      console.error(error);
    }
  });

  $('#clear-data').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Apagar todos os registros?',
      message:
        'Todos os registros deste aparelho serão apagados. Esta ação não pode ser desfeita. Exporte um backup antes.',
      confirmLabel: 'Sim, apagar tudo',
      danger: true,
    });
    if (!confirmed) return;

    try {
      await db.apagarTodos();
      state.allRecords = [];
      renderPending();
      showToast('Todos os registros foram apagados.');
    } catch (error) {
      showToast('Não foi possível apagar os registros.', 'error');
      console.error(error);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Relatório - eventos                                                */
/* ------------------------------------------------------------------ */

function bindReport() {
  $('#report-filters').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;

    state.reportFilter = chip.dataset.filter;
    if (state.reportFilter === 'personalizado') {
      if (!state.customStart) state.customStart = toDateInputValue(new Date());
      if (!state.customEnd) state.customEnd = toDateInputValue(new Date());
      $('#report-start').value = state.customStart;
      $('#report-end').value = state.customEnd;
    }
    renderReport();
  });

  $('#apply-custom').addEventListener('click', () => {
    const start = $('#report-start').value;
    const end = $('#report-end').value;
    if (!start || !end) {
      showToast('Informe as datas inicial e final.', 'error');
      return;
    }
    if (start > end) {
      showToast('A data inicial não pode ser depois da data final.', 'error');
      return;
    }
    state.customStart = start;
    state.customEnd = end;
    renderReport();
  });

  $('#report-body').addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-edit]');
    if (editButton) {
      const record = state.reportRecords.find((item) => item.id === editButton.dataset.edit);
      if (record) openEditDialog(record);
      return;
    }

    const deleteButton = event.target.closest('[data-delete]');
    if (deleteButton) {
      const record = state.reportRecords.find((item) => item.id === deleteButton.dataset.delete);
      if (record) deleteRecord(record);
    }
  });

  $('#pdf-share').addEventListener('click', () => handlePdf(true));
  $('#pdf-download').addEventListener('click', () => handlePdf(false));
}

/* ------------------------------------------------------------------ */
/* Pendentes - eventos                                                */
/* ------------------------------------------------------------------ */

function bindPending() {
  $('#pending-list').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const record = state.allRecords.find((item) => item.id === button.dataset.id);
    if (!record) return;

    if (button.dataset.action === 'exit') openExitDialog(record);
    else if (button.dataset.action === 'resend') openResendDialog(record);
  });
}

/* ------------------------------------------------------------------ */
/* Inicialização                                                      */
/* ------------------------------------------------------------------ */

async function requestPersistentStorage() {
  if (navigator.storage && typeof navigator.storage.persist === 'function') {
    try {
      await navigator.storage.persist();
    } catch {
      // Sem problema: o navegador pode negar a persistência.
    }
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((registration) => registration.update())
      .catch((error) => {
        console.warn('Service worker não registrado:', error);
      });
  });
}

function bindInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPrompt = event;
    const button = $('#install-app');
    if (button) button.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    showToast('App instalado na tela inicial!');
  });
}

async function init() {
  bindNFPhoto();
  bindForms();
  bindReport();
  bindPending();
  bindSettings();
  bindInstallPrompt();
  registerServiceWorker();

  window.addEventListener('hashchange', handleRoute);
  window.setInterval(() => {
    updateClock();
    updateElapsedIndicators();
  }, 30000);

  await requestPersistentStorage();
  await handleRoute();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
