import {
  formatDateBR,
  formatTimeBR,
  greetingSP,
  getZonedParts,
} from './datetime.js';

const pad = (value) => String(value).padStart(2, '0');

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não foi possível ler a foto. Tente tirar outra.'));
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Não foi possível processar a foto.'));
        },
        type,
        quality
      );
      return;
    }

    try {
      const dataUrl = canvas.toDataURL(type, quality);
      const base64 = dataUrl.split(',')[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      resolve(new Blob([bytes], { type }));
    } catch (error) {
      reject(error);
    }
  });
}

export async function compressImage(file, maxDimension = 1280, quality = 0.82) {
  if (!file) throw new Error('Nenhuma foto selecionada.');
  if (!file.type.startsWith('image/')) throw new Error('O arquivo escolhido não é uma imagem.');

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error('Não foi possível ler as dimensões da foto.');

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Este navegador não conseguiu processar a foto.');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    return await canvasToBlob(canvas, 'image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function photoFileName(prefix = 'foto-portaria') {
  const parts = getZonedParts();
  return `${prefix}-${parts.year}${pad(parts.month)}${pad(parts.day)}-${pad(parts.hour)}${pad(parts.minute)}.jpg`;
}

export function createPhotoFile(photo) {
  if (!photo || !photo.blob) return null;
  return new File([photo.blob], photo.fileName || photoFileName(), {
    type: photo.blob.type || 'image/jpeg',
  });
}

export function buildMessageNF(record) {
  const lines = [
    '📦 *Chegou material com nota fiscal!*',
    '',
    `🏢 *Fornecedor:* ${record.fornecedor}`,
    `🧾 *NF:* ${record.numeroNF}`,
    `📅 *Data:* ${formatDateBR(record.dataHoraEntrada)}  🕒 *Hora:* ${formatTimeBR(record.dataHoraEntrada)}`,
  ];

  const observacao = String(record.observacao || '').trim();
  if (observacao) lines.push(`📝 *Obs.:* ${observacao}`);

  lines.push(
    '',
    'O material está aqui na portaria. Quando puderem, venham retirar. Obrigado!'
  );
  return lines.join('\n');
}

export function buildMessageSemNF(date = new Date(), observacao = '') {
  const greeting = greetingSP(date).toLowerCase();
  const message = `Olá, ${greeting}! 👋\nChegou uma encomenda dos Correios/Sedex (sem nota fiscal) e ela está aqui na portaria. Quando quiserem, podem vir buscar. Obrigado!`;
  const note = String(observacao || '').trim();
  return note ? `${message}\n\n📝 Obs.: ${note}` : message;
}

export function buildReportShareMessage(startLabel, endLabel) {
  return `Olá! Segue o relatório de materiais com nota fiscal recebidos na portaria no período de ${startLabel} a ${endLabel}.`;
}

export function normalizeWhatsAppNumber(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('0055')) digits = digits.slice(2);
  digits = digits.replace(/^0+/, '');
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }
  return digits;
}

export function isValidWhatsAppNumber(raw) {
  const digits = normalizeWhatsAppNumber(raw);
  return digits.length === 12 || digits.length === 13;
}

export function formatPhoneDisplay(raw) {
  const digits = normalizeWhatsAppNumber(raw);
  if (digits.length === 13) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return digits ? `+${digits}` : '';
}

export function canShareFiles(file) {
  if (!file || typeof navigator === 'undefined') return false;
  if (!navigator.share || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function shareFile(file, text) {
  if (!navigator.share) throw new Error('Compartilhamento não disponível neste navegador.');
  await navigator.share({ files: [file], text });
}

export async function shareText(text) {
  if (!navigator.share) throw new Error('Compartilhamento não disponível neste navegador.');
  await navigator.share({ text });
}

export function isAbortError(error) {
  return Boolean(error && error.name === 'AbortError');
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function openWhatsApp(number, text) {
  const digits = normalizeWhatsAppNumber(number);
  if (!digits) throw new Error('Número de destino inválido. Verifique as configurações.');
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
