export async function createSampleDocumentFile(kind: 'invoice' | 'diagram' = 'invoice'): Promise<File> {
  const c = document.createElement('canvas');
  c.width = 960;
  c.height = 680;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  if (kind === 'invoice') {
    // Crisp off-white desk surface + white receipt card + colored objects so both OCR and Mirage detect rich items
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, c.width, c.height);

    // Desk card / invoice sheet
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(70, 50, 560, 580);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.strokeRect(70, 50, 560, 580);

    // Header
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('NORTHSTAR LAB SUPPLY', 105, 110);

    ctx.fillStyle = '#475569';
    ctx.font = '18px monospace';
    ctx.fillText('INVOICE #NS-2026-0418', 105, 145);
    ctx.fillText('DATE: 2026-11-18', 105, 173);

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(105, 198);
    ctx.lineTo(595, 198);
    ctx.stroke();

    // Table
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 17px monospace';
    ctx.fillText('ITEM', 105, 232);
    ctx.fillText('QTY', 400, 232);
    ctx.fillText('TOTAL', 500, 232);

    const rows = [
      ['Optical Lens 50mm', '2', '$340.00'],
      ['USB-C Sensor Array', '1', '$185.00'],
      ['Calibration Grid', '4', '$96.00'],
    ];
    ctx.font = '17px monospace';
    rows.forEach(([item, qty, total], idx) => {
      const y = 275 + idx * 42;
      ctx.fillStyle = '#1e293b';
      ctx.fillText(item, 105, y);
      ctx.fillText(qty, 410, y);
      ctx.fillText(total, 500, y);
    });

    ctx.strokeStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(105, 415);
    ctx.lineTo(595, 415);
    ctx.stroke();

    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('TOTAL DUE: $621.00', 105, 458);

    ctx.fillStyle = '#dc2626';
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 3;
    ctx.strokeRect(105, 500, 170, 52);
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('PAID', 158, 535);

    // Physical objects beside the invoice on the desk (blue mug + yellow pencil + green badge)
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.arc(770, 220, 74, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(770, 220, 54, 0, Math.PI * 2);
    ctx.fill();

    // Red notebook on lower right
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(695, 360, 190, 240);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('LAB NOTES', 735, 485);
  } else {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('OPTICAL BENCH SCHEMATIC', 64, 72);

    // Red laser module
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(90, 260, 150, 90);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('LASER 632nm', 104, 312);

    // Beam
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(240, 305);
    ctx.lineTo(760, 305);
    ctx.stroke();

    // Blue lens
    ctx.fillStyle = '#2563eb';
    ctx.beginPath();
    ctx.ellipse(480, 305, 22, 110, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.font = '18px monospace';
    ctx.fillText('LENS f = 100mm', 410, 455);

    // Green sensor
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(760, 235, 95, 140);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('SENSOR', 773, 312);
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to build sample image'))), 'image/png')
  );
  return new File([blob], kind === 'invoice' ? 'sample_invoice_desk.png' : 'sample_optical_bench.png', {
    type: 'image/png',
  });
}
