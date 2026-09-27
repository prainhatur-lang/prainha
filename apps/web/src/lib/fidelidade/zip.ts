// Zip mínimo (STORE, sem compressão) — é o que o .pkpass precisa e evita
// dependência. Arquivos pequenos (<1 MB), sem zip64.

const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABELA[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(arquivos: Array<{ nome: string; dados: Buffer }>): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let off = 0;
  // data/hora DOS fixa (1/1/2020) — não importa pro pkpass
  const hora = 0, data = ((2020 - 1980) << 9) | (1 << 5) | 1;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const crc = crc32(a.dados);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // nome em UTF-8
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(hora, 10);
    lh.writeUInt16LE(data, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(a.dados.length, 18);
    lh.writeUInt32LE(a.dados.length, 22);
    lh.writeUInt16LE(nome.length, 26);
    lh.writeUInt16LE(0, 28);
    locais.push(lh, nome, a.dados);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(hora, 12);
    ch.writeUInt16LE(data, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(a.dados.length, 20);
    ch.writeUInt32LE(a.dados.length, 24);
    ch.writeUInt16LE(nome.length, 28);
    ch.writeUInt32LE(off, 42);
    centrais.push(ch, nome);
    off += 30 + nome.length + a.dados.length;
  }
  const central = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(central.length, 12);
  fim.writeUInt32LE(off, 16);
  return Buffer.concat([...locais, central, fim]);
}
