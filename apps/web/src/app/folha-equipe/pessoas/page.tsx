// /folha-equipe/pessoas foi UNIFICADA em /rh/funcionarios (set/2026): a
// remuneração da folha semanal (papel, modelo, bônus, PIX, cliente do fiado)
// é editada no cadastro do funcionário, loja a loja. Mantém a rota só pra
// redirecionar link antigo/favorito. As APIs /api/folha-equipe/pessoas/*
// continuam vivas (a tela nova usa).

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function FolhaPessoasPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const sp = await props.searchParams;
  redirect(sp.filialId ? `/rh/funcionarios?filialId=${encodeURIComponent(sp.filialId)}` : '/rh/funcionarios');
}
