// 測試用的 zip 產生器：做假的 DOCX、EPUB
import zlib from 'node:zlib';

/**
 * @param {Array<[string, string|Buffer, {store?: boolean}?]>} files 檔名、內容（store: 不壓縮）
 * @returns {Buffer}
 */
export function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content, { store = false } = {}] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = store ? data : zlib.deflateRawSync(data);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** 假的 Word 檔：paragraphs 是 [文字或 runs 陣列, 樣式 ID] */
export function makeDocx(paragraphs, { headingStyleId = 'Heading1', headingStyleName = 'heading 1' } = {}) {
  const runs = text => (Array.isArray(text) ? text : [text]).map(part => part === '\t' ? '<w:r><w:tab/></w:r>'
    : part === '\n' ? '<w:r><w:br/></w:r>' : `<w:r><w:t xml:space="preserve">${part}</w:t></w:r>`).join('');
  const body = paragraphs.map(([text, style]) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs(text)}</w:p>`).join('');
  return makeZip([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`],
    ['word/styles.xml', `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="${headingStyleId}"><w:name w:val="${headingStyleName}"/></w:style></w:styles>`]
  ]);
}

/** 假的 EPUB：chapters 是 [檔名, XHTML 的 body] */
export function makeEpub(chapters, { title = 'Test Book', encrypted = false } = {}) {
  const manifest = chapters.map(([file], i) => `<item id="c${i}" href="text/${file}" media-type="application/xhtml+xml"/>`).join('');
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('');
  return makeZip([
    ['mimetype', 'application/epub+zip', { store: true }],
    ['META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ...(encrypted ? [['META-INF/encryption.xml', `<encryption>${chapters.map(([file]) => `<CipherReference URI="OEBPS/text/${file}"/>`).join('')}</encryption>`]] : []),
    ['OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`],
    ...chapters.map(([file, body]) => [`OEBPS/text/${file}`,
      `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${body}</body></html>`])
  ]);
}
