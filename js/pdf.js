import { formatDateBR, formatTimeBR, toDateInputValue } from './datetime.js';

export function generateReportPdf({ records, periodLabel, generatedAt = new Date() }) {
  const jsPDFConstructor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFConstructor) {
    throw new Error('O gerador de PDF não foi carregado. Verifique sua conexão e recarregue o app.');
  }

  const doc = new jsPDFConstructor({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;

  doc.setProperties({
    title: 'Clarity Glass - Relatório de Entrada de Materiais',
    subject: 'Relatório de materiais com nota fiscal recebidos na portaria',
    author: 'Portaria Clarity Glass',
    creator: 'Portaria Clarity Glass',
  });

  doc.setFillColor(11, 79, 138);
  doc.rect(0, 0, pageWidth, 27, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Clarity Glass – Relatório de Entrada de Materiais', margin, 11.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Portaria • Materiais com nota fiscal', margin, 18.5);

  doc.setTextColor(20, 33, 43);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Período: ${periodLabel}`, margin, 35);

  doc.setFont('helvetica', 'normal');
  doc.text(
    `Gerado em: ${formatDateBR(generatedAt)} às ${formatTimeBR(generatedAt)}`,
    pageWidth - margin,
    35,
    { align: 'right' }
  );
  doc.setTextColor(90, 107, 122);
  doc.setFontSize(9);
  doc.text(
    `${records.length} registro${records.length === 1 ? '' : 's'} no período`,
    pageWidth - margin,
    40,
    { align: 'right' }
  );

  const body = records.map((record) => [
    formatDateBR(record.dataHoraEntrada),
    record.fornecedor,
    record.numeroNF,
    formatTimeBR(record.dataHoraEntrada),
    record.dataHoraSaida ? formatTimeBR(record.dataHoraSaida) : 'Aguardando',
    record.observacao || '—',
  ]);

  if (!body.length) {
    body.push(['—', 'Nenhum registro no período', '—', '—', '—', '—']);
  }

  doc.autoTable({
    startY: 45,
    head: [['Data', 'Fornecedor', 'Nota Fiscal', 'Entrada', 'Saída', 'Observação']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 2.3,
      textColor: [30, 42, 53],
      lineColor: [211, 223, 233],
      lineWidth: 0.15,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [11, 79, 138],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'left',
    },
    alternateRowStyles: {
      fillColor: [246, 250, 253],
    },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 68 },
      2: { cellWidth: 34 },
      3: { cellWidth: 22, halign: 'center' },
      4: { cellWidth: 26, halign: 'center' },
      5: { cellWidth: 'auto' },
    },
    didParseCell: (data) => {
      if (
        data.section === 'body' &&
        data.column.index === 4 &&
        data.cell.raw === 'Aguardando'
      ) {
        data.cell.styles.textColor = [154, 98, 0];
        data.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { left: margin, right: margin, top: 34, bottom: 18 },
    showHead: 'everyPage',
  });

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(211, 223, 233);
    doc.setLineWidth(0.2);
    doc.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 130);
    doc.text('Clarity Glass • Portaria', margin, pageHeight - 8);
    doc.text(`Página ${page} de ${totalPages}`, pageWidth - margin, pageHeight - 8, {
      align: 'right',
    });
  }

  const fileName = `relatorio-portaria-clarity-${toDateInputValue(generatedAt)}.pdf`;
  return { blob: doc.output('blob'), fileName };
}
