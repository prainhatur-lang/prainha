// ZIP "STORE" (sem compressão) montado na mão — pro download em lote dos XMLs
// do mês sem depender de lib. XML é pequeno e o contador só precisa do pacote;
// streaming evita o teto de resposta da Vercel em mês cheio.
//
// Formato: local file header + dados por arquivo, central directory no fim.

const CRC_TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABELA[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDataHora(d: Date): { data: number; hora: number } {
  const ano = Math.max(1980, d.getFullYear());
  return {
    data: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

interface Entrada {
  nome: Buffer;
  crc: number;
  tamanho: number;
  offset: number;
  data: number;
  hora: number;
}

/** Monta o ZIP incrementalmente: `arquivo()` devolve o chunk pra emitir
 *  (header local + bytes) e `fim()` devolve o diretório central + EOCD. */
export class ZipStore {
  private entradas: Entrada[] = [];
  private offset = 0;

  arquivo(nome: string, conteudo: Buffer, quando?: Date): Buffer {
    const nomeBuf = Buffer.from(nome, 'ascii');
    const { data, hora } = dosDataHora(quando ?? new Date());
    const crc = crc32(conteudo);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    header.writeUInt16LE(20, 4); // versão
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(0, 8); // método 0 = store
    header.writeUInt16LE(hora, 10);
    header.writeUInt16LE(data, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(conteudo.length, 18); // comprimido = original (store)
    header.writeUInt32LE(conteudo.length, 22);
    header.writeUInt16LE(nomeBuf.length, 26);
    header.writeUInt16LE(0, 28); // extra
    this.entradas.push({ nome: nomeBuf, crc, tamanho: conteudo.length, offset: this.offset, data, hora });
    const chunk = Buffer.concat([header, nomeBuf, conteudo]);
    this.offset += chunk.length;
    return chunk;
  }

  fim(): Buffer {
    const partes: Buffer[] = [];
    const inicioCentral = this.offset;
    let tamCentral = 0;
    for (const e of this.entradas) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
      c.writeUInt16LE(20, 4); // feito por
      c.writeUInt16LE(20, 6); // precisa de
      c.writeUInt16LE(0, 8);
      c.writeUInt16LE(0, 10); // store
      c.writeUInt16LE(e.hora, 12);
      c.writeUInt16LE(e.data, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.tamanho, 20);
      c.writeUInt32LE(e.tamanho, 24);
      c.writeUInt16LE(e.nome.length, 28);
      // extra/comentário/disco/atributos = 0
      c.writeUInt32LE(e.offset, 42);
      partes.push(c, e.nome);
      tamCentral += 46 + e.nome.length;
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
    eocd.writeUInt16LE(this.entradas.length, 8);
    eocd.writeUInt16LE(this.entradas.length, 10);
    eocd.writeUInt32LE(tamCentral, 12);
    eocd.writeUInt32LE(inicioCentral, 16);
    partes.push(eocd);
    return Buffer.concat(partes);
  }
}
