import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';

/** Gera um .bat per-filial. Auto-eleva (UAC) e chama o .ps1 instalador.
 *  O .bat eh pequeno (~1KB), so contem a URL do .ps1 com o token da filial. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new NextResponse('Login necessário', { status: 401 });
  }

  const filialId = req.nextUrl.searchParams.get('filial');
  if (!filialId) {
    return new NextResponse('Parâmetro `filial` faltando', { status: 400 });
  }

  // Busca a filial — token vai embutido no .bat
  const [filial] = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome, token: schema.filial.agenteToken })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);

  if (!filial) {
    return new NextResponse('Filial não encontrada', { status: 404 });
  }

  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const ps1Url = `${baseUrl}/api/agente-release/instalar.ps1?filial=${encodeURIComponent(filial.id)}&token=${encodeURIComponent(filial.token)}`;

  // Nome de arquivo amigavel
  const slug = filial.nome.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // .bat se auto-eleva (UAC) e chama o .ps1 inteiro via iwr | iex.
  const bat = `@echo off
title Instalador Concilia Agente - ${filial.nome}
:: Self-elevate (UAC)
>nul 2>&1 net session
if %errorlevel% NEQ 0 (
  echo Solicitando privilegios de Administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

:: Roda como Admin agora — baixa o instalador e executa
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; iex (iwr '${ps1Url}' -UseBasicParsing).Content"

echo.
echo Pressione qualquer tecla para fechar...
pause >nul
`;

  return new NextResponse(bat, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="instalar-${slug}.bat"`,
    },
  });
}
