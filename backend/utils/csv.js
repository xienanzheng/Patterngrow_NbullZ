export function parseCsvRows(csv) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];

    if (char === '"') {
      if (inQuotes && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      row.push(field);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
      if (char === '\r' && csv[index + 1] === '\n') index += 1;
      continue;
    }

    if (char === '\r' && inQuotes && csv[index + 1] === '\n') {
      field += '\n';
      index += 1;
      continue;
    }

    field += char;
  }

  if (inQuotes) throw new Error('CSV contains an unterminated quoted field.');

  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

export function parseCsvRecords(csv) {
  const parsed = parseCsvRows(csv);
  if (parsed.length < 2) return [];

  const headers = parsed[0].map((header, index) => {
    const trimmed = header.trim();
    return index === 0 ? trimmed.replace(/^\uFEFF/, '') : trimmed;
  });

  return parsed.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index]?.trim() ?? '']),
  ));
}
