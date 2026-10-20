import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

/** Usuário do grupo Admin (o dono). Mesmo critério de podePagarPix. */
export async function ehAdmin(userId: string): Promise<boolean> {
  const rows = (await db.execute(sql`
    SELECT 1 FROM usuario_grupo ug JOIN grupo_usuario g ON g.id = ug.grupo_id
     WHERE ug.usuario_id = ${userId}::uuid AND g.nome = 'Admin' LIMIT 1
  `)) as unknown as unknown[];
  return rows.length > 0;
}
