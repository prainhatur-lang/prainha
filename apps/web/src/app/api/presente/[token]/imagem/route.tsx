// Imagem PNG do vale-presente (botão "Salvar como imagem no celular" da
// página pública /presente/[token]) — 04/11/2026. Só vale pago ou usado.

import { ImageResponse } from 'next/og';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const corta = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: bruto } = await params;
  const token = decodeURIComponent(bruto ?? '').replace(/^(\{\{\d+\}\})+/, '');
  if (token.length < 20) return new Response('não encontrado', { status: 404 });

  const [linha] = await db
    .select({ v: schema.valePresente, casa: schema.filial.nome })
    .from(schema.valePresente)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.valePresente.filialId))
    .where(eq(schema.valePresente.token, token))
    .limit(1);
  if (!linha) return new Response('não encontrado', { status: 404 });
  const { v, casa } = linha;
  if (v.status !== 'pago' && v.status !== 'usado') return new Response('vale ainda não pago', { status: 409 });

  const usado = v.status === 'usado';
  const credito = v.tipo === 'valor';
  const titulo = credito ? `${brl(Number(v.total))} de presente` : `Jantar para ${v.pessoas} pessoa${v.pessoas === 1 ? '' : 's'}`;
  const cor = usado ? '#64748b' : '#059669';

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#fffbeb', padding: 60 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            background: '#ffffff',
            borderRadius: 40,
            border: `6px solid ${cor}`,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              background: cor,
              color: '#ffffff',
              padding: '48px 40px',
            }}
          >
            <div style={{ display: 'flex', fontSize: 30, letterSpacing: 6, textTransform: 'uppercase', opacity: 0.9 }}>
              {`Vale-presente · ${corta(casa, 28)}`}
            </div>
            <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, marginTop: 16, textAlign: 'center' }}>{titulo}</div>
            <div
              style={{
                display: 'flex',
                marginTop: 24,
                background: '#ffffff',
                color: cor,
                borderRadius: 999,
                padding: '10px 32px',
                fontSize: 32,
                fontWeight: 700,
              }}
            >
              {usado ? 'JÁ UTILIZADO' : 'QUITADO'}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', padding: '48px 56px', flexGrow: 1 }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                background: '#f1f5f9',
                borderRadius: 28,
                padding: '28px 20px',
              }}
            >
              <div style={{ display: 'flex', fontSize: 28, color: '#64748b' }}>Código do vale</div>
              <div style={{ display: 'flex', fontSize: 96, fontWeight: 700, letterSpacing: 10, color: '#0f172a' }}>{v.codigo}</div>
              <div style={{ display: 'flex', fontSize: 26, color: '#64748b' }}>Mostre na chegada</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 40, fontSize: 38, color: '#334155' }}>
              {v.presenteados ? (
                <div style={{ display: 'flex' }}>
                  <span style={{ color: '#64748b', marginRight: 14 }}>Para:</span>
                  <span style={{ fontWeight: 700 }}>{corta(v.presenteados, 40)}</span>
                </div>
              ) : null}
              <div style={{ display: 'flex', marginTop: 10 }}>
                <span style={{ color: '#64748b', marginRight: 14 }}>De:</span>
                <span style={{ fontWeight: 700 }}>{corta(v.compradorNome ?? '', 40)}</span>
              </div>
            </div>

            {v.mensagem ? (
              <div
                style={{
                  display: 'flex',
                  marginTop: 36,
                  background: '#fffbeb',
                  borderLeft: '10px solid #fbbf24',
                  borderRadius: 16,
                  padding: '24px 28px',
                  fontSize: 34,
                  fontStyle: 'italic',
                  color: '#1e293b',
                }}
              >
                {corta(v.mensagem.replace(/\s+/g, ' ').trim(), 220)}
              </div>
            ) : null}

            <div style={{ display: 'flex', flexGrow: 1 }} />
            <div style={{ display: 'flex', justifyContent: 'center', fontSize: 24, color: '#94a3b8' }}>
              {credito ? 'Crédito em comida, bebida e serviço · usado de uma vez, numa visita' : 'Tudo pago, inclusive os 10% de serviço'}
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1350, headers: { 'Cache-Control': 'no-store' } },
  );
}
