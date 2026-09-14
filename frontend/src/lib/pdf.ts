function formatDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function slugify(text: string) {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'topic'
  );
}

// Builds a PDF containing just the topic header and the learner's monologue —
// their own spoken segments plus any generated completions, concatenated into
// one flowing essay (no speaker labels, no English gloss, no back-and-forth
// nudges) — and triggers a browser download. Runs entirely client-side.
// jsPDF is ~350 kB and only needed here, so it's loaded on first use.
export async function downloadEssayPdf(params: {
  topic: string;
  targetMinutes: number;
  elapsedSeconds: number;
  paragraphs: string[];
}) {
  const { topic, targetMinutes, elapsedSeconds, paragraphs } = params;
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 56;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - marginX * 2;
  const bottomMargin = 56;
  let y = 64;

  function ensureSpace(lineHeight: number) {
    if (y + lineHeight > pageHeight - bottomMargin) {
      doc.addPage();
      y = 64;
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(topic || 'Topic practice', marginX, y);
  y += 26;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(
    `Parle topic practice - target ${targetMinutes} min, practiced ${formatDuration(elapsedSeconds)} - ${new Date().toLocaleDateString()}`,
    marginX,
    y,
  );
  y += 30;
  doc.setTextColor(0);

  const cleanParagraphs = paragraphs.map((p) => p.trim()).filter(Boolean);

  doc.setFontSize(12);
  if (cleanParagraphs.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.text('(No transcript yet.)', marginX, y);
  } else {
    doc.setFont('helvetica', 'normal');
    for (const paragraph of cleanParagraphs) {
      for (const line of doc.splitTextToSize(paragraph, maxWidth)) {
        ensureSpace(17);
        doc.text(line, marginX, y);
        y += 17;
      }
      y += 12;
    }
  }

  doc.save(`parle-${slugify(topic)}-essay-${new Date().toISOString().slice(0, 10)}.pdf`);
}
