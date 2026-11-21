// A faster drop-in for csv-reader 1.0.0 (make.fun's own CSV reader): the same answer
// {columns, rows, errors} for every input {text, header}, in far less CPU time.
//
// The reference reads one character at a time and builds every field a character
// at a time. This reader keeps the reference's state machine exactly — same
// records, same errors, same order — but moves the common case onto native
// string operations:
//
//   - A record whose line holds no quote is read whole: one slice and one
//     split(',') instead of a loop per character. A lone CR inside it is
//     dropped with a stray_cr error, exactly as the reference does; a final
//     CR before the LF is the CRLF line ending and is stripped, not an error.
//   - A record with a quote falls back to a field-by-field reader that
//     slices whole spans between quotes instead of appending characters, and
//     only walks a span character by character when it holds a line break
//     (to count lines and fold CRLF / lone CR to LF, as the reference does).
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Dependency-free ES module; run(input) is the entry point.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** Count line breaks in a quoted-field span: each LF one, each CRLF one, each lone CR one. */
function countBreaks(s) {
  let cnt = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 10) cnt++;
    else if (c === 13) {
      cnt++;
      if (s.charCodeAt(i + 1) === 10) i++;
    }
  }
  return cnt;
}

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not
  // followed by LF is dropped (stray_cr). Returns the field and how it ended; `added`
  // counts the characters kept. `value` starts as the caller passes it ('' normally,
  // '"' when re-reading after an unterminated quote).
  function readUnquoted(value) {
    let added = 0;
    let segStart = pos;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        // comma
        if (pos > segStart) {
          value += text.slice(segStart, pos);
          added += pos - segStart;
        }
        pos += 1;
        return { value, ended: COMMA, added };
      }
      if (c === 10) {
        // LF
        if (pos > segStart) {
          value += text.slice(segStart, pos);
          added += pos - segStart;
        }
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      if (c === 13) {
        // CR
        if (text.charCodeAt(pos + 1) === 10) {
          if (pos > segStart) {
            value += text.slice(segStart, pos);
            added += pos - segStart;
          }
          pos += 2;
          line += 1;
          return { value, ended: LINE_BREAK, added };
        }
        if (pos > segStart) {
          value += text.slice(segStart, pos);
          added += pos - segStart;
        }
        error('stray_cr');
        pos += 1;
        segStart = pos;
        continue;
      }
      pos += 1;
    }
    if (pos > segStart) {
      value += text.slice(segStart, pos);
      added += pos - segStart;
    }
    return { value, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    const parts = [];
    while (pos < n) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it is
        // read again as an unquoted field.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (q > pos) {
        const seg = text.slice(pos, q);
        if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
          parts.push(seg);
        } else {
          line += countBreaks(seg);
          parts.push(seg.replace(/\r\n?/g, '\n'));
        }
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one quote inside the field.
        parts.push('"');
        pos = q + 2;
        continue;
      }
      // The closing quote.
      pos = q + 1;
      const value = parts.join('');
      if (pos >= n) return { value, ended: END };
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return { value, ended: COMMA };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      // What follows the closing quote is appended as it stands, up to the next comma or line break.
      const junk = readUnquoted(value);
      if (junk.added > 0) error('quote_junk');
      return junk;
    }
    // Unreachable: the indexOf above returns -1 before pos can pass the end.
    pos = open + 1;
    line = openLine;
    error('unterminated_quote');
    return readUnquoted('"');
  }

  // Finish one record: the reference's skip rule, width, header, and short/long rows.
  // `lastQuoted` is whether the record's last field was quoted. Returns true when the
  // record counts (false when it was a line left with no characters).
  function finishRecord(fields, lastQuoted) {
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) return false;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return true;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
    return true;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record's line holds no quote, so no field can be quoted and
    // the record ends at the next LF (or the end of the text).
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n : nl;
    const q = text.indexOf('"', pos);
    if (q === -1 || q >= lineEnd) {
      const crlf = lineEnd < n && lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13;
      const content = text.slice(pos, crlf ? lineEnd - 1 : lineEnd);
      let fields;
      if (content.indexOf('\r') === -1) {
        fields = content.split(',');
      } else {
        // Lone CRs inside the line: each is dropped with a stray_cr error.
        fields = content.split(',');
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];
          const at = f.indexOf('\r');
          if (at !== -1) {
            const parts = f.split('\r');
            for (let k = 1; k < parts.length; k++) error('stray_cr');
            fields[i] = parts.join('');
          }
        }
      }
      line += 1;
      pos = lineEnd < n ? lineEnd + 1 : n;
      finishRecord(fields, false);
      continue;
    }

    // Slow path: the record holds a quote; read it field by field.
    const fields = [];
    let field;
    let lastQuoted = false;
    do {
      lastQuoted = text.charCodeAt(pos) === 34;
      field = lastQuoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);
    finishRecord(fields, lastQuoted);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
