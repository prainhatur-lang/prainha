-- Cardápio de exemplo da demonstração (cópia do vendas_teste, 02/11/2026).
-- Aplicado pelo demo/iniciar.sh só quando o banco está vazio.



CREATE TABLE public.area (
    codigo integer NOT NULL,
    nome text
);

CREATE TABLE public.garcom_pin (
    login text NOT NULL,
    pin_hash text NOT NULL,
    salt text NOT NULL,
    nome text,
    criado_em timestamp with time zone DEFAULT now(),
    atualizado_em timestamp with time zone DEFAULT now(),
    gerente boolean DEFAULT false NOT NULL,
    producao boolean DEFAULT false NOT NULL,
    recepcao boolean DEFAULT false NOT NULL
);

CREATE TABLE public.produto_local (
    codigo_pdv integer NOT NULL,
    produto_codigo integer,
    nome text,
    tamanho text,
    preco numeric,
    area_codigo integer,
    comanda_mobile boolean,
    atualizado timestamp with time zone DEFAULT now(),
    nome_busca text,
    categoria text,
    categoria_ordem integer,
    sem_estoque boolean DEFAULT false,
    cardapio_digital boolean DEFAULT true,
    descricao text,
    preparo text,
    estoque numeric,
    sem_servico boolean DEFAULT false,
    dobrado_vale boolean DEFAULT false
);

COPY public.area (codigo, nome) FROM stdin;
1	COZ PRAINHA
2	BAR
3	COZ PETISCO
4	DRINKS
5	Pastel
6	Destilados
7	Coz Terraco
8	TERRACO
9	luau
10	RECEPÇÃO
\.

COPY public.garcom_pin (login, pin_hash, salt, nome, criado_em, atualizado_em, gerente, producao, recepcao) FROM stdin;
teste	c69a36dd0ba196948a1e38486242805b89c0c62e0091c2c71351c918956dae60	df7bc1e1a873b3f3ba8c043bbe9d9256	Teste Tablets	2026-11-02 09:15:26.860828-03	2026-11-02 09:15:26.860828-03	f	f	f
\.

COPY public.produto_local (codigo_pdv, produto_codigo, nome, tamanho, preco, area_codigo, comanda_mobile, atualizado, nome_busca, categoria, categoria_ordem, sem_estoque, cardapio_digital, descricao, preparo, estoque, sem_servico, dobrado_vale) FROM stdin;
128	97	Vodka Nacional	Abacaxi	28	4	t	2026-11-02 11:50:36.081219-03	vodka nacional abacaxi	Drink	999	f	t	\N	\N	\N	f	f
193	121	Espumante Casa Perini Aquarela	\N	135	2	t	2026-11-02 11:50:36.081219-03	espumante casa perini aquarela 	Espumante	999	f	t	\N	\N	\N	f	f
140	99	pastel	Filé	19	3	t	2026-11-02 11:50:36.081219-03	pastel file	Petiscos	999	f	t	Pastel grande crocante com recheio a sua escolha.	\N	\N	f	f
181	109	Black and White	Garrafa	150	4	t	2026-11-02 11:50:36.081219-03	black and white garrafa	Whisky	999	f	t	\N	\N	\N	f	f
180	109	Black and White	Dose	15	4	t	2026-11-02 11:50:36.081219-03	black and white dose	Whisky	999	f	f	\N	\N	\N	f	f
919	573	Taça de cristal	\N	30	\N	t	2026-11-02 11:50:36.081219-03	taca de cristal 	Acompanhamentos	999	f	f	\N	\N	\N	f	f
139	99	pastel	Camarão	24	3	t	2026-11-02 11:50:36.081219-03	pastel camarao	Petiscos	999	f	t	Pastel grande crocante com recheio a sua escolha.	\N	\N	f	f
177	106	Molho Gorgonzola	\N	12	\N	t	2026-11-02 11:50:36.081219-03	molho gorgonzola 	Complemento	999	f	t	\N	\N	\N	f	f
178	107	Molho Laranja	\N	7	\N	t	2026-11-02 11:50:36.081219-03	molho laranja 	Complemento	999	f	t	\N	\N	\N	f	f
179	108	Molho Cogumelo Creme de Leite e cogumelos	\N	12	\N	t	2026-11-02 11:50:36.081219-03	molho cogumelo creme de leite e cogumelos 	Complemento	999	f	t	\N	\N	\N	f	f
203	131	Strawberryoska	\N	32	4	t	2026-11-02 11:50:36.081219-03	strawberryoska 	Drink	999	f	t	Delicioso coquetel de morango, prosecco e vodka.	\N	\N	f	f
141	99	pastel	Queijo	14	3	t	2026-11-02 11:50:36.081219-03	pastel queijo	Petiscos	999	f	t	Pastel grande crocante com recheio a sua escolha.	\N	\N	f	f
1608	1016	Mexilhao na cumbuca (consulta)	\N	80	1	t	2026-11-02 11:50:36.081219-03	mexilhao na cumbuca (consulta) 	Petiscos	999	f	t	Mexilhao fresco no molho a base de tomate, creme de leite e especiarias. Acompanha torradas feitas na hora.	\N	\N	f	f
212	101	SUCOS JARRA	Manga	20	4	t	2026-11-02 11:50:36.081219-03	sucos jarra manga	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
204	132	Spritz Aperol	\N	30	4	t	2026-11-02 11:50:36.081219-03	spritz aperol 	Drink	999	f	t	Espumante, Aperol e água com gás.	\N	\N	f	f
209	94	Vodka Importada	\N	27	4	t	2026-11-02 11:50:36.081219-03	vodka importada 	Drink	999	f	t	\N	\N	\N	f	f
206	134	Manga Bebada	\N	31	4	t	2026-11-02 11:50:36.081219-03	manga bebada 	Drink	999	f	t	Drink a base de manga descascada, dois morangos médios, uma dose de vodka, uma dose de espumante, gelo e açucar.	\N	\N	f	f
211	102	SUCOS COPO	Manga	12	4	t	2026-11-02 11:50:36.081219-03	sucos copo manga	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
205	133	Cuba Libre	\N	22	4	t	2026-11-02 11:50:36.081219-03	cuba libre 	Drink	999	f	t	Tradicional drink a base de Montila, gelo e coca-cola	\N	\N	f	f
207	135	Mojito	\N	28	4	t	2026-11-02 11:50:36.081219-03	mojito 	Drink	999	f	t	Tônica, Bacardi com hotelã e limão.	\N	\N	f	f
261	176	Espumante Rio Sol Brut Rose	\N	120	2	t	2026-11-02 11:50:36.081219-03	espumante rio sol brut rose 	Espumante	999	f	t	\N	\N	\N	f	f
1008	634	LEITE CONDENSADO	\N	2	\N	t	2026-11-02 11:50:36.081219-03	leite condensado 	Complemento	999	f	t	\N	\N	\N	f	f
143	100	Arroz	\N	7	\N	t	2026-11-02 11:50:36.081219-03	arroz 	Complemento	999	f	t	\N	\N	\N	f	f
462	333	cachaça	Abacaxi	24	2	t	2026-11-02 11:50:36.081219-03	cachaca abacaxi	Drink	999	f	t	\N	\N	\N	f	f
2237	1571	Vinho Branco La Linda Chardonnay	\N	190	2	t	2026-11-02 11:50:36.081219-03	vinho branco la linda chardonnay 	Vinho	999	f	t	\N	\N	\N	f	f
2238	1572	T Vinho branco La Linda Chardonnay	\N	190	8	t	2026-11-02 11:50:36.081219-03	t vinho branco la linda chardonnay 	Vinho	999	f	f	\N	\N	\N	f	f
2153	1512	T Vinho Tinto Scala Coeli Reserva	\N	1629	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto scala coeli reserva 	Vinho	999	f	f	\N	\N	\N	f	f
218	142	Guarana Zero	\N	10	2	t	2026-11-02 11:50:36.081219-03	guarana zero 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
263	178	Petit Gateau de chocolate com sorvete de creme	\N	28	1	t	2026-11-02 11:50:36.081219-03	petit gateau de chocolate com sorvete de creme 	Sobremesa	999	f	t	\N	\N	\N	f	f
264	179	Petit Gateau de Doce de Leite com sorvete de creme	\N	28	1	t	2026-11-02 11:50:36.081219-03	petit gateau de doce de leite com sorvete de creme 	Sobremesa	999	f	t	\N	\N	\N	f	f
259	174	Agua tonica Antartica lata	\N	10	2	t	2026-11-02 11:50:36.081219-03	agua tonica antartica lata 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
217	141	Vinagrete	\N	10	1	t	2026-11-02 11:50:36.081219-03	vinagrete 	Acompanhamentos	999	f	t	\N	\N	\N	f	f
255	170	Cigarro Calton Dunhill	\N	20	2	t	2026-11-02 11:50:36.081219-03	cigarro calton dunhill 	Cigarro	999	t	t	\N	\N	0	f	f
144	101	SUCOS JARRA	Abacaxi	20	4	t	2026-11-02 11:50:36.081219-03	sucos jarra abacaxi	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
710	420	Sagatiba	Garrafa	110	4	f	2026-11-02 11:50:36.081219-03	sagatiba garrafa	Cachaça	999	f	f	\N	\N	\N	f	f
470	333	cachaça	Morango	26	2	t	2026-11-02 11:50:36.081219-03	cachaca morango	Drink	999	f	t	\N	\N	\N	f	f
708	419	Ypioca Reserva	Garrafa	150	4	f	2026-11-02 11:50:36.081219-03	ypioca reserva garrafa	Cachaça	999	f	f	\N	\N	\N	f	f
709	420	Sagatiba	Dose	11	4	f	2026-11-02 11:50:36.081219-03	sagatiba dose	Cachaça	999	f	f	\N	\N	\N	f	f
1402	855	Canelone de abobrinha	\N	69	7	t	2026-11-02 11:50:36.081219-03	canelone de abobrinha 	Terraco Prainha	999	f	t	\N	\N	\N	f	f
1012	638	Arroz de castanha	\N	12	1	t	2026-11-02 11:50:36.081219-03	arroz de castanha 	Acompanhamentos	999	f	t	\N	\N	\N	f	f
483	338	Red Bull Tropical	\N	23	2	t	2026-11-02 11:50:36.081219-03	red bull tropical 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
485	339	Gin Beefeater Pink	Dose	25	4	f	2026-11-02 11:50:36.081219-03	gin beefeater pink dose	Gin	999	f	f	\N	\N	\N	f	f
750	449	Brandade de bacalhau	\N	17	1	t	2026-11-02 11:50:36.081219-03	brandade de bacalhau 	Petiscos	999	f	f	\N	\N	\N	f	f
1417	870	BATATA FRITA	\N	15	3	t	2026-11-02 11:50:36.081219-03	batata frita 	Complemento	999	f	t	\N	\N	\N	f	f
142	99	pastel	Vento	10	3	t	2026-11-02 11:50:36.081219-03	pastel vento	Petiscos	999	f	t	Pastel grande crocante com recheio a sua escolha.	\N	\N	f	f
1536	779	T Gin	MANGA	25	8	t	2026-11-02 11:50:36.081219-03	t gin manga	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
147	101	SUCOS JARRA	Limão	22	4	t	2026-11-02 11:50:36.081219-03	sucos jarra limao	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
146	101	SUCOS JARRA	Laranja	20	4	t	2026-11-02 11:50:36.081219-03	sucos jarra laranja	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
766	464	Gin Hendricks	Garrafa	360	4	f	2026-11-02 11:50:36.081219-03	gin hendricks garrafa	Gin	999	f	f	\N	\N	\N	f	f
294	209	Espumante Chandon Brut	\N	175	2	t	2026-11-02 11:50:36.081219-03	espumante chandon brut 	Espumante	999	f	t	\N	\N	\N	f	f
406	102	SUCOS COPO	FrutasVermelhas	15	4	t	2026-11-02 11:50:36.081219-03	sucos copo frutasvermelhas	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
148	101	SUCOS JARRA	Maracujá	20	4	t	2026-11-02 11:50:36.081219-03	sucos jarra maracuja	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
306	218	Banana flambada no licor com sorvete	\N	28	1	t	2026-11-02 11:50:36.081219-03	banana flambada no licor com sorvete 	Sobremesa	999	f	t	\N	\N	\N	f	f
1764	1135	Fys Guarana	\N	10	2	t	2026-11-02 11:50:36.081219-03	fys guarana 	Bebida não alcoolica	999	t	t	\N	\N	-2	f	f
1747	1118	Entrada dia dos namorados	\N	0.01	7	t	2026-11-02 11:50:36.081219-03	entrada dia dos namorados 	Terraco Prainha	999	f	f	\N	\N	\N	f	f
711	421	T Seleta Ouro	Dose	11	8	t	2026-11-02 11:50:36.081219-03	t seleta ouro dose	Cachaça	999	f	f	\N	\N	\N	f	f
295	210	Buchanans 12 anos	Dose	32	4	t	2026-11-02 11:50:36.081219-03	buchanans 12 anos dose	Whisky	999	f	t	\N	\N	\N	f	f
883	548	STOLICHNAYA	Dose	35	4	f	2026-11-02 11:50:36.081219-03	stolichnaya dose	Vodka	999	f	f	\N	\N	\N	f	f
296	210	Buchanans 12 anos	Garrafa	390	4	t	2026-11-02 11:50:36.081219-03	buchanans 12 anos garrafa	Whisky	999	f	t	\N	\N	\N	f	f
304	216	Licor 43 (dose)	\N	18	4	f	2026-11-02 11:50:36.081219-03	licor 43 (dose) 	Licor.	999	f	f	\N	\N	\N	f	f
420	306	Gin	\N	35	4	t	2026-11-02 11:50:36.081219-03	gin 	Drink	999	f	t	\N	\N	\N	f	f
407	101	SUCOS JARRA	FrutasVermelhas	25	4	t	2026-11-02 11:50:36.081219-03	sucos jarra frutasvermelhas	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
152	102	SUCOS COPO	Abacaxi	12	4	t	2026-11-02 11:50:36.081219-03	sucos copo abacaxi	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
155	102	SUCOS COPO	Limão	12	4	t	2026-11-02 11:50:36.081219-03	sucos copo limao	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
421	306	Gin	Kiwi	27	4	t	2026-11-02 11:50:36.081219-03	gin kiwi	Drink	999	f	t	\N	\N	\N	f	f
411	301	Sprite Zero	\N	10	2	t	2026-11-02 11:50:36.081219-03	sprite zero 	Bebida não alcoolica	999	f	t	\N	\N	2	f	f
417	306	Gin	Abacaxi	29	4	t	2026-11-02 11:50:36.081219-03	gin abacaxi	Drink	999	f	t	\N	\N	\N	f	f
332	235	Vodka Orloff	Dose	13	4	f	2026-11-02 11:50:36.081219-03	vodka orloff dose	Vodka	999	f	f	\N	\N	\N	f	f
151	101	SUCOS JARRA	Tangerina	20	4	t	2026-11-02 11:50:36.081219-03	sucos jarra tangerina	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
408	300	Rolha	\N	50	\N	t	2026-11-02 11:50:36.081219-03	rolha 	Vinho	999	f	f	\N	\N	\N	f	f
413	303	Gin Beefeater	Dose	25	4	f	2026-11-02 11:50:36.081219-03	gin beefeater dose	Gin	999	f	f	\N	\N	\N	f	f
419	306	Gin	Caju	30	4	t	2026-11-02 11:50:36.081219-03	gin caju	Drink	999	f	t	\N	\N	\N	f	f
395	290	Gin Tanqueray	Dose	25	4	f	2026-11-02 11:50:36.081219-03	gin tanqueray dose	Gin	999	f	f	\N	\N	\N	f	f
426	306	Gin	Maracujá	30	4	t	2026-11-02 11:50:36.081219-03	gin maracuja	Drink	999	f	t	\N	\N	\N	f	f
423	306	Gin	Laranja	25	4	t	2026-11-02 11:50:36.081219-03	gin laranja	Drink	999	f	t	\N	\N	\N	f	f
424	306	Gin	Limão	25	4	t	2026-11-02 11:50:36.081219-03	gin limao	Drink	999	f	t	\N	\N	\N	f	f
129	97	Vodka Nacional	Kiwi	27	4	t	2026-11-02 11:50:36.081219-03	vodka nacional kiwi	Drink	999	f	t	\N	\N	\N	f	f
391	287	Berinjela a parmegiana	\N	58	1	t	2026-11-02 11:50:36.081219-03	berinjela a parmegiana 	Pratos	999	f	t	Berinjela a parmegiana, coberta com delicioso molho de tomate artesanal e queijo gratinado	\N	\N	f	f
390	286	Vinagrete de polvo	\N	66	3	t	2026-11-02 11:50:36.081219-03	vinagrete de polvo 	Petiscos	999	f	t	Polvo em vinagrete artesanal com toque cítrico, servido com torradas quentinhas feitas na hora.	\N	\N	f	f
394	289	smirnoff	Garrafa	160	4	f	2026-11-02 11:50:36.081219-03	smirnoff garrafa	Vodka	999	f	f	\N	\N	\N	f	f
617	398	Vinho Branco Esporao Pe Branco	\N	93	2	t	2026-11-02 11:50:36.081219-03	vinho branco esporao pe branco 	Vinho	999	f	t	\N	\N	\N	f	f
396	290	Gin Tanqueray	Garrafa	260	4	f	2026-11-02 11:50:36.081219-03	gin tanqueray garrafa	Gin	999	f	f	\N	\N	\N	f	f
778	470	Bacardi	Garrafa	80	4	t	2026-11-02 11:50:36.081219-03	bacardi garrafa	Rum	999	f	t	\N	\N	\N	f	f
2294	1626	Carajillo	\N	36	4	t	2026-11-02 11:50:36.081219-03	carajillo 	Drink	999	f	t	Café especial com licor 43	\N	\N	f	f
2243	1577	VINHO TINTO SUOLO ROSSO D.O.P DI MANDURIA 2020	\N	280	2	t	2026-11-02 11:50:36.081219-03	vinho tinto suolo rosso d.o.p di manduria 2020 	Vinho	999	f	t	\N	\N	\N	f	f
2260	1592	Soda Prainha Summer	\N	26	4	t	2026-11-02 11:50:36.081219-03	soda prainha summer 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
2261	1593	Soda Italiana Curacau Blue	\N	26	4	t	2026-11-02 11:50:36.081219-03	soda italiana curacau blue 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
2262	1594	Soda Italiana Frutas Vermelhas	\N	26	4	t	2026-11-02 11:50:36.081219-03	soda italiana frutas vermelhas 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
2263	1595	Soda Italiana Gengibre e Limao	\N	26	4	t	2026-11-02 11:50:36.081219-03	soda italiana gengibre e limao 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
2264	1596	T Soda Italiana Curacau Blue	\N	26	8	t	2026-11-02 11:50:36.081219-03	t soda italiana curacau blue 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2266	1598	T Soda Italiana Gengibre e Limao	\N	26	8	t	2026-11-02 11:50:36.081219-03	t soda italiana gengibre e limao 	Terraco Bebidas	999	f	f	.	\N	\N	f	f
2290	1622	Frapuccino Da Casa	\N	26	4	t	2026-11-02 11:50:36.081219-03	frapuccino da casa 	Cafes	999	f	t	Café especial batido com gelo, leite condensado, toque especial do barista e chantilly	\N	\N	f	f
2279	1611	Cafe Latte	\N	14	4	t	2026-11-02 11:50:36.081219-03	cafe latte 	Cafes	999	f	t	Café especial 100ml acompanhado com leite vaporizado cremoso	\N	\N	f	f
2283	1615	Cappucino Terraco	\N	18	4	t	2026-11-02 11:50:36.081219-03	cappucino terraco 	Cafes	999	f	t	Café especial 100ml acompanhado com bordas de avela, Leite vaporizado cremoso, canela polvilhada e cacau 100% e um toque especial da casa	\N	\N	f	f
2293	1625	T Irish Coffe	\N	28.9	8	t	2026-11-02 11:50:36.081219-03	t irish coffe 	Terraco Bebidas	999	f	f	Café especial com acucar mascavo, whiky finalizado com creme de chantilly	\N	\N	f	f
2281	1613	Cappucino Italiano	\N	16	4	t	2026-11-02 11:50:36.081219-03	cappucino italiano 	Cafes	999	f	t	Café especial 100ml acompanhado com Leite vaporizado cremoso, canela polvilhada e cacau 100%	\N	\N	f	f
2289	1621	Affogatto Kids	\N	24	4	t	2026-11-02 11:50:36.081219-03	affogatto kids 	Cafes	999	f	t	Sorvete de creme com chocolate cremoso kids, disquetes coloridos e chantilly especial	\N	\N	f	f
2268	1600	Expresso Curto	\N	9	4	t	2026-11-02 11:50:36.081219-03	expresso curto 	Cafes	999	f	t	Cafe especial de 30 a 50ml acompanhado por agua com gás	\N	\N	f	f
2292	1624	Irish Coffe	\N	35	4	t	2026-11-02 11:50:36.081219-03	irish coffe 	Cafes	999	f	t	Café especial com acucar mascavo, whisky finalizado com creme de chantilly	\N	\N	f	f
2297	1629	T Prainha Bourbon	\N	31.9	8	t	2026-11-02 11:50:36.081219-03	t prainha bourbon 	Terraco Bebidas	999	f	f	Café especial 60ml, whiky bourbon, creme de chantilly, leite condensado, gelo e um toque especial	\N	\N	f	f
430	306	Gin	Tangerina	27	4	t	2026-11-02 11:50:36.081219-03	gin tangerina	Drink	999	f	t	\N	\N	\N	f	f
1422	875	Vinho Rose Cartuxa EA	\N	140	2	t	2026-11-02 11:50:36.081219-03	vinho rose cartuxa ea 	Vinho	999	f	t	\N	\N	\N	f	f
214	138	Vinho Branco Redwood Creek California	\N	159	2	t	2026-11-02 11:50:36.081219-03	vinho branco redwood creek california 	Vinho	999	f	t	\N	\N	\N	f	f
145	101	SUCOS JARRA	Kiwi	22	4	t	2026-11-02 11:50:36.081219-03	sucos jarra kiwi	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
434	307	Penne ao molho pomodoro	\N	45	1	t	2026-11-02 11:50:36.081219-03	penne ao molho pomodoro 	Pratos	999	f	t	Massa penne cozida al dente e delicadamente coberta com um molho de tomate fresco, ervas e temperos, proporcionando um prato clássico e reconfortante da culinária italiana. ---- English ---- Penne with pomodoro sauce - Penne pasta cooked al dente and delicately coated with a sauce made from fresh tomatoes, herbs, and spices, offering a classic and comforting dish from Italian cuisine.	\N	\N	f	f
438	311	Purê de batatas	\N	13	\N	t	2026-11-02 11:50:36.081219-03	pure de batatas 	Complemento	999	f	t	\N	\N	\N	f	f
489	342	Sex on the beach	\N	29	4	t	2026-11-02 11:50:36.081219-03	sex on the beach 	Drink	999	f	t	Vodka, licor de pessego, suco de laranja, groselha	\N	\N	f	f
501	353	Tequila  (dose)	\N	18	4	t	2026-11-02 11:50:36.081219-03	tequila  (dose) 	Drink	999	f	t	\N	\N	\N	f	f
499	351	Arroz com brocolis	\N	12	1	t	2026-11-02 11:50:36.081219-03	arroz com brocolis 	Acompanhamentos	999	f	t	\N	\N	\N	f	f
486	339	Gin Beefeater Pink	Garrafa	260	4	f	2026-11-02 11:50:36.081219-03	gin beefeater pink garrafa	Gin	999	f	f	\N	\N	\N	f	f
500	352	Margarita	\N	28	4	t	2026-11-02 11:50:36.081219-03	margarita 	Drink	999	f	t	Tequila, limao e sal	\N	\N	f	f
491	344	Espumante Rio Sol Brut Branco	\N	120	2	t	2026-11-02 11:50:36.081219-03	espumante rio sol brut branco 	Espumante	999	f	t	\N	\N	\N	f	f
492	345	Montilla Carta Branca	Dose	9	4	t	2026-11-02 11:50:36.081219-03	montilla carta branca dose	Rum	999	f	f	\N	\N	\N	f	f
493	345	Montilla Carta Branca	Garrafa	95	4	t	2026-11-02 11:50:36.081219-03	montilla carta branca garrafa	Rum	999	f	f	\N	\N	\N	f	f
1517	950	Montilla Cristal	Dose	9	4	t	2026-11-02 11:50:36.081219-03	montilla cristal dose	Rum	999	f	t	\N	\N	\N	f	f
57	41	Batata frita	\N	28	3	t	2026-11-02 11:50:36.081219-03	batata frita 	Petiscos	999	f	t	Batatas fritas douradas, crocantes e cheias de sabor.	\N	\N	f	f
517	356	Moqueca camarao VG de Santa Catarina	2 pessoas	230	1	t	2026-11-02 11:50:36.081219-03	moqueca camarao vg de santa catarina 2 pessoas	Moquecas	999	f	t	Deliciosa Moqueca Sergipana de camarão zero de Santa Catarina, preparada com leite de coco e legumes frescos, acompanhada de arroz branco, farofa especial da casa, vinagrete bem picadinho e um irresistível pirão. ---- English ---- Delicious Sergipe-style Moqueca made with zero shrimp from Santa Catarina, cooked in coconut milk with fresh vegetables. Served with white rice, the house's special farofa, finely chopped vinaigrette, and a delightful pirão	\N	\N	f	f
776	469	Licor Dom Luiz	Garrafa	210	4	t	2026-11-02 11:50:36.081219-03	licor dom luiz garrafa	Licor.	999	f	t	\N	\N	\N	f	f
1518	950	Montilla Cristal	Garrafa	95	4	t	2026-11-02 11:50:36.081219-03	montilla cristal garrafa	Rum	999	f	f	\N	\N	\N	f	f
516	355	Trocar Vodka por Stolichnaya	\N	5	\N	t	2026-11-02 11:50:36.081219-03	trocar vodka por stolichnaya 	Complemento	999	f	t	\N	\N	\N	f	f
1265	781	Sumo de limao	\N	3	4	t	2026-11-02 11:50:36.081219-03	sumo de limao 	Drink	999	f	f	\N	\N	\N	f	f
2265	1597	T Soda Italiana Frutas Vermelhas	\N	26	8	t	2026-11-02 11:50:36.081219-03	t soda italiana frutas vermelhas 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2267	1599	T Soda Prainha Summer	\N	26	8	t	2026-11-02 11:50:36.081219-03	t soda prainha summer 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2270	1602	Expresso Macchiato	\N	10	4	t	2026-11-02 11:50:36.081219-03	expresso macchiato 	Cafes	999	f	t	Café especial de 45ml com leite vaporizado cremoso	\N	\N	f	f
2301	1633	Cebola Caramelizada	\N	4	\N	t	2026-11-02 11:50:36.081219-03	cebola caramelizada 	Complemento	999	f	t	\N	\N	\N	f	f
590	375	Catchup Sache Heinz	\N	0.5	\N	t	2026-11-02 11:50:36.081219-03	catchup sache heinz 	Acompanhamentos	999	f	f	\N	\N	\N	f	f
2271	1603	Expresso Panna	\N	11	4	t	2026-11-02 11:50:36.081219-03	expresso panna 	Cafes	999	f	t	Café expresso de 45 ml com com chantilly especial e canela	\N	\N	f	f
2272	1604	Expresso carioca	\N	9	4	t	2026-11-02 11:50:36.081219-03	expresso carioca 	Cafes	999	f	t	Café especial suave de 45ml diluido com agua quente	\N	\N	f	f
2274	1606	T Expresso Curto	\N	8.9	8	t	2026-11-02 11:50:36.081219-03	t expresso curto 	Terraco Bebidas	999	f	f	Cafe especial de 30 a 50ml acompanhado por agua com gás	\N	\N	f	f
2275	1607	T Expresso Machiato	\N	9.5	8	t	2026-11-02 11:50:36.081219-03	t expresso machiato 	Terraco Bebidas	999	f	f	Café especial de 45ml com leite vaporizado cremoso	\N	\N	f	f
2276	1608	T Expresso Panna	\N	10.5	8	t	2026-11-02 11:50:36.081219-03	t expresso panna 	Terraco Bebidas	999	f	f	Café expresso de 45 ml com com chantilly especial e canela	\N	\N	f	f
2277	1609	Expresso Doppio	\N	12	4	t	2026-11-02 11:50:36.081219-03	expresso doppio 	Cafes	999	f	t	Café especial dobrado 100ml acompanhado com agua com gás	\N	\N	f	f
99901	99901	Chope Dobrado	\N	14	2	t	2026-11-02 11:50:36.081219-03	chope dobrado 	Cerveja	999	f	f	\N	\N	\N	f	t
88801	0	Almoco executivo teste	\N	59.9	1	t	2026-11-02 11:50:36.081219-03	almoco executivo teste 	Teste	999	f	f	\N	\N	\N	f	f
370	267	Coquetel de frutas COM álcool	\N	31	4	t	2026-11-02 11:50:36.081219-03	coquetel de frutas com alcool 	Drink	999	f	t	Vodka, frutas vermelhas, leite consensado e calda de chocolate	\N	\N	f	f
353	250	Arroz com Brocolis	\N	9	\N	t	2026-11-02 11:50:36.081219-03	arroz com brocolis 	Complemento	999	f	t	\N	\N	\N	f	f
352	249	Fanta Laranja KS 290 ml	\N	10	2	t	2026-11-02 11:50:36.081219-03	fanta laranja ks 290 ml 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
369	266	Molho Gorgonzola	\N	9	1	t	2026-11-02 11:50:36.081219-03	molho gorgonzola 	Acompanhamentos	999	f	f	\N	\N	\N	f	f
848	519	Prato Descartavel	\N	2	\N	t	2026-11-02 11:50:36.081219-03	prato descartavel 	Complemento	999	f	t	\N	\N	\N	f	f
1011	637	Porçao de pastel de camarao	\N	50	3	t	2026-11-02 11:50:36.081219-03	porcao de pastel de camarao 	Petiscos	999	f	f	\N	\N	\N	f	f
2278	1610	T Expresso Doppio	\N	11.9	8	t	2026-11-02 11:50:36.081219-03	t expresso doppio 	Terraco Bebidas	999	f	f	Café especial dobrado 100ml acompanhado com agua com gás	\N	\N	f	f
702	416	Burrata, prosciutto, confit de tomate cereja e azeite trufado	\N	78	1	t	2026-11-02 11:50:36.081219-03	burrata, prosciutto, confit de tomate cereja e azeite trufado 	Petiscos	999	f	t	Deliciosa Burrata italiana sobre uma cama de tomate cereja confit, regada com molho pesto e decorada com lascas de presunto de Parma, finalizada com um fio de azeite trufado. ---- English ---- Delicious Italian Burrata on a bed of confit cherry tomatoes, drizzled with pesto sauce, adorned with slices of Parma ham, and finished with a thread of truffle-infused olive oil.	\N	\N	f	f
414	303	Gin Beefeater	Garrafa	260	4	f	2026-11-02 11:50:36.081219-03	gin beefeater garrafa	Gin	999	f	f	\N	\N	\N	f	f
416	305	Espumante casa Perini Brut Rose	\N	135	2	t	2026-11-02 11:50:36.081219-03	espumante casa perini brut rose 	Espumante	999	f	t	\N	\N	\N	f	f
1424	877	Pirao de leite	\N	12	1	t	2026-11-02 11:50:36.081219-03	pirao de leite 	Acompanhamentos	999	f	t	\N	\N	\N	f	f
850	520	Chivas Regal 12 anos	Garrafa	330	4	t	2026-11-02 11:50:36.081219-03	chivas regal 12 anos garrafa	Whisky	999	f	t	\N	\N	\N	f	f
712	421	T Seleta Ouro	Garrafa	110	8	t	2026-11-02 11:50:36.081219-03	t seleta ouro garrafa	Cachaça	999	f	f	\N	\N	\N	f	f
707	419	Ypioca Reserva	Dose	17	4	t	2026-11-02 11:50:36.081219-03	ypioca reserva dose	Cachaça	999	f	t	\N	\N	\N	f	f
329	233	Absolut	Dose	22	4	f	2026-11-02 11:50:36.081219-03	absolut dose	Vodka	999	f	f	\N	\N	\N	f	f
726	430	Moqueca de file de Robalo	1 pessoas	115	1	t	2026-11-02 11:50:36.081219-03	moqueca de file de robalo 1 pessoas	Moquecas	999	f	t	Deliciosa moqueca sergipana de Robalo no coco com legumes frescos, acompanhado de arroz branco, farofa especial da casa, vinagrete bem picadinho e um maravilhoso pirão. ---- English ---- Delicious Sergipe-style Moqueca featuring fresh Robalo fish cooked in coconut milk with a medley of fresh vegetables. Served alongside white rice, the house's special farofa, finely chopped vinaigrette, and a delightful pirão.	\N	\N	f	f
597	380	Ciroc	Garrafa	300	4	f	2026-11-02 11:50:36.081219-03	ciroc garrafa	Vodka	999	f	f	\N	\N	\N	f	f
593	377	Grey Goose	Garrafa	350	4	f	2026-11-02 11:50:36.081219-03	grey goose garrafa	Vodka	999	f	f	\N	\N	\N	f	f
596	380	Ciroc	Dose	25	4	f	2026-11-02 11:50:36.081219-03	ciroc dose	Vodka	999	f	f	\N	\N	\N	f	f
606	387	Xarope Monin Grenadine	Garrafa	160	4	f	2026-11-02 11:50:36.081219-03	xarope monin grenadine garrafa	Bebida não alcoolica	999	f	f	\N	\N	\N	f	f
727	430	Moqueca de file de Robalo	2 pessoas	199	1	t	2026-11-02 11:50:36.081219-03	moqueca de file de robalo 2 pessoas	Moquecas	999	f	t	Deliciosa moqueca sergipana de Robalo no coco com legumes frescos, acompanhado de arroz branco, farofa especial da casa, vinagrete bem picadinho e um maravilhoso pirão. ---- English ---- Delicious Sergipe-style Moqueca featuring fresh Robalo fish cooked in coconut milk with a medley of fresh vegetables. Served alongside white rice, the house's special farofa, finely chopped vinaigrette, and a delightful pirão.	\N	\N	f	f
730	432	File de Robalo grelhado com legumes	1 pessoas	69	1	f	2026-11-02 11:50:36.081219-03	file de robalo grelhado com legumes 1 pessoas	Pratos	999	f	f	Filé alto de Robalo fresco gralhado no azeite extra virgem acompanhado de legumes salteados.	\N	\N	f	f
112	94	Vodka Importada	Kiwi	30	4	t	2026-11-02 11:50:36.081219-03	vodka importada kiwi	Drink	999	f	t	\N	\N	\N	f	f
737	436	File ao molho exclusivo com torradas	\N	72	1	t	2026-11-02 11:50:36.081219-03	file ao molho exclusivo com torradas 	Petiscos	999	f	t	Delicioso file em cubos com um molho exclusivo de shitake, shimeji e creme de leite. Acompanha torradas feita na hora.	\N	\N	f	f
474	333	cachaça	Uva	25	2	t	2026-11-02 11:50:36.081219-03	cachaca uva	Drink	999	f	t	\N	\N	\N	f	f
738	437	Creme de limao siciliano	\N	6	\N	t	2026-11-02 11:50:36.081219-03	creme de limao siciliano 	Complemento	999	f	t	\N	\N	\N	f	f
254	94	Vodka Importada	Uva	32	4	t	2026-11-02 11:50:36.081219-03	vodka importada uva	Drink	999	f	t	\N	\N	\N	f	f
589	374	Adocante	\N	1	\N	t	2026-11-02 11:50:36.081219-03	adocante 	Complemento	999	f	t	\N	\N	\N	f	f
2285	1617	Affogatto Especial	\N	22	4	t	2026-11-02 11:50:36.081219-03	affogatto especial 	Cafes	999	f	t	Café especial acompanhado com sorvete de creme e chantilly especial	\N	\N	f	f
472	333	cachaça	Tangerina	24	2	t	2026-11-02 11:50:36.081219-03	cachaca tangerina	Drink	999	f	t	\N	\N	\N	f	f
315	224	Farofa especial	\N	9	1	t	2026-11-02 11:50:36.081219-03	farofa especial 	Acompanhamentos	999	f	t	\N	\N	\N	f	f
349	246	Vinho Branco Santa Helena Reserva Chadonay	\N	82	2	t	2026-11-02 11:50:36.081219-03	vinho branco santa helena reserva chadonay 	Vinho	999	f	t	\N	\N	\N	f	f
330	233	Absolut	Garrafa	250	4	f	2026-11-02 11:50:36.081219-03	absolut garrafa	Vodka	999	f	f	\N	\N	\N	f	f
333	235	Vodka Orloff	Garrafa	110	4	f	2026-11-02 11:50:36.081219-03	vodka orloff garrafa	Vodka	999	f	f	\N	\N	\N	f	f
777	470	Bacardi	Dose	15	4	t	2026-11-02 11:50:36.081219-03	bacardi dose	Rum	999	f	f	\N	\N	\N	f	f
337	239	COUVERT	\N	20	\N	t	2026-11-02 11:50:36.081219-03	couvert 	Couvert	999	f	f	\N	\N	\N	f	f
2296	1628	Prainha Bourbon	\N	32	4	t	2026-11-02 11:50:36.081219-03	prainha bourbon 	Cafes	999	f	t	Café especial 60ml, whiky bourbon, creme de chantilly, leite condensado, gelo e um toque especial	\N	\N	f	f
2473	1800	Pudim de coco com frutas vermelhas	\N	26	3	t	2026-11-02 11:50:36.081219-03	pudim de coco com frutas vermelhas 	Sobremesa	999	f	t	\N	\N	\N	f	f
612	393	absolut	\N	20	\N	t	2026-11-02 11:50:36.081219-03	absolut 	Complemento	999	f	t	\N	\N	\N	f	f
522	359	Espumante Rio Sol Moscatel	\N	120	2	t	2026-11-02 11:50:36.081219-03	espumante rio sol moscatel 	Espumante	999	f	t	\N	\N	\N	f	f
518	356	Moqueca camarao VG de Santa Catarina	1 pessoas	135	1	t	2026-11-02 11:50:36.081219-03	moqueca camarao vg de santa catarina 1 pessoas	Moquecas	999	f	t	Deliciosa Moqueca Sergipana de camarão zero de Santa Catarina, preparada com leite de coco e legumes frescos, acompanhada de arroz branco, farofa especial da casa, vinagrete bem picadinho e um irresistível pirão. ---- English ---- Delicious Sergipe-style Moqueca made with zero shrimp from Santa Catarina, cooked in coconut milk with fresh vegetables. Served with white rice, the house's special farofa, finely chopped vinaigrette, and a delightful pirão	\N	\N	f	f
521	358	Mini Pudim	\N	19	1	t	2026-11-02 11:50:36.081219-03	mini pudim 	Sobremesa	999	f	t	\N	\N	\N	f	f
375	272	vodka smirnof 1.75l	\N	150	2	t	2026-11-02 11:50:36.081219-03	vodka smirnof 1.75l 	Vodka	999	t	f	\N	\N	0	f	f
376	273	Hortela	\N	1.5	\N	t	2026-11-02 11:50:36.081219-03	hortela 	Complemento	999	f	t	\N	\N	\N	f	f
377	274	Limao	\N	1.5	\N	t	2026-11-02 11:50:36.081219-03	limao 	Complemento	999	f	t	\N	\N	\N	f	f
378	275	caju	\N	2	\N	t	2026-11-02 11:50:36.081219-03	caju 	Complemento	999	f	t	\N	\N	\N	f	f
379	276	morango	\N	2	\N	t	2026-11-02 11:50:36.081219-03	morango 	Complemento	999	f	t	\N	\N	\N	f	f
380	277	Uva	\N	2.5	\N	t	2026-11-02 11:50:36.081219-03	uva 	Complemento	999	f	t	\N	\N	\N	f	f
381	278	Abacaxi	\N	2	\N	t	2026-11-02 11:50:36.081219-03	abacaxi 	Complemento	999	f	t	\N	\N	\N	f	f
382	279	Tangerina	\N	2	\N	t	2026-11-02 11:50:36.081219-03	tangerina 	Complemento	999	f	t	\N	\N	\N	f	f
385	281	Legumes Salteados	\N	15	\N	t	2026-11-02 11:50:36.081219-03	legumes salteados 	Complemento	999	f	t	\N	\N	\N	f	f
386	282	Linguni na manteiga e queijo Grana Padano	\N	18	\N	t	2026-11-02 11:50:36.081219-03	linguni na manteiga e queijo grana padano 	Complemento	999	f	t	\N	\N	\N	f	f
387	283	Fetuccine na manteiga e Queijo Parmegiano Regiano	\N	18	\N	t	2026-11-02 11:50:36.081219-03	fetuccine na manteiga e queijo parmegiano regiano 	Complemento	999	f	t	\N	\N	\N	f	f
790	481	Torradas feitas na hora	\N	10	1	t	2026-11-02 11:50:36.081219-03	torradas feitas na hora 	Acompanhamentos	999	f	t	\N	\N	\N	f	f
794	484	Whisky Ballantines Finest 750 ml	Dose	19	4	t	2026-11-02 11:50:36.081219-03	whisky ballantines finest 750 ml dose	Whisky	999	f	t	\N	\N	\N	f	f
795	484	Whisky Ballantines Finest 750 ml	Garrafa	190	4	t	2026-11-02 11:50:36.081219-03	whisky ballantines finest 750 ml garrafa	Whisky	999	f	f	\N	\N	\N	f	f
812	492	Budweiser long neck 330 ml	\N	14	2	t	2026-11-02 11:50:36.081219-03	budweiser long neck 330 ml 	Cerveja	999	f	t	\N	\N	\N	f	f
797	97	Vodka Nacional	Limao siciliano	29	4	t	2026-11-02 11:50:36.081219-03	vodka nacional limao siciliano	Drink	999	f	t	\N	\N	\N	f	f
798	94	Vodka Importada	Limao siciliano	31	4	t	2026-11-02 11:50:36.081219-03	vodka importada limao siciliano	Drink	999	f	t	\N	\N	\N	f	f
805	333	cachaça	Limao siciliano	26	2	t	2026-11-02 11:50:36.081219-03	cachaca limao siciliano	Drink	999	f	t	\N	\N	\N	f	f
753	452	Carregador portatil	\N	200	4	t	2026-11-02 11:50:36.081219-03	carregador portatil 	Couvert	999	f	f	\N	\N	\N	f	f
130	97	Vodka Nacional	Laranja	22	4	t	2026-11-02 11:50:36.081219-03	vodka nacional laranja	Drink	999	f	t	\N	\N	\N	f	f
2306	1638	Robalo grelhado no azeite com legumes	\N	89	1	t	2026-11-02 11:50:36.081219-03	robalo grelhado no azeite com legumes 	Pratos	999	f	t	Robalo grelhado acompanhado de legumes grelhados no azeite de oliva, uma combinação leve e saudável para apreciar os sabores frescos do mar e dos vegetais.---- English ----\r\nGrilled Robalo served with vegetables grilled in olive oil, a light and healthy combination to savor the fresh flavors of the sea and vegetables.	\N	\N	f	f
765	464	Gin Hendricks	Dose	30	4	f	2026-11-02 11:50:36.081219-03	gin hendricks dose	Gin	999	f	f	\N	\N	\N	f	f
785	476	Pina colada	\N	28	4	t	2026-11-02 11:50:36.081219-03	pina colada 	Drink	999	f	t	Licor Malibu, run bacardi, abacaxi e leite condensado	\N	\N	f	f
775	469	Licor Dom Luiz	Dose	20	4	t	2026-11-02 11:50:36.081219-03	licor dom luiz dose	Licor.	999	f	t	\N	\N	\N	f	f
587	372	Mascavo	\N	1	\N	t	2026-11-02 11:50:36.081219-03	mascavo 	Complemento	999	f	t	\N	\N	\N	f	f
588	373	Branco	\N	1	\N	t	2026-11-02 11:50:36.081219-03	branco 	Complemento	999	f	t	\N	\N	\N	f	f
591	376	Maionese Sache	\N	1	\N	t	2026-11-02 11:50:36.081219-03	maionese sache 	Acompanhamentos	999	f	f	\N	\N	\N	f	f
592	377	Grey Goose	Dose	25	4	f	2026-11-02 11:50:36.081219-03	grey goose dose	Vodka	999	f	f	\N	\N	\N	f	f
605	387	Xarope Monin Grenadine	Dose	12	4	t	2026-11-02 11:50:36.081219-03	xarope monin grenadine dose	Bebida não alcoolica	999	f	f	\N	\N	\N	f	f
793	483	Bulldog Gin	Garrafa	280	4	f	2026-11-02 11:50:36.081219-03	bulldog gin garrafa	Gin	999	f	f	\N	\N	\N	f	f
799	485	196 Sonhos	\N	31	4	t	2026-11-02 11:50:36.081219-03	196 sonhos 	Drink	999	f	t	Gin Beefeter. limao, tonica e pimenta	\N	\N	f	f
796	306	Gin	Limao siciliano	30	4	t	2026-11-02 11:50:36.081219-03	gin limao siciliano	Drink	999	f	t	\N	\N	\N	f	f
849	520	Chivas Regal 12 anos	Dose	25	4	t	2026-11-02 11:50:36.081219-03	chivas regal 12 anos dose	Whisky	999	f	t	\N	\N	\N	f	f
611	392	Grey goose	\N	25	\N	t	2026-11-02 11:50:36.081219-03	grey goose 	Complemento	999	f	t	\N	\N	\N	f	f
614	395	Molho creme limao siciliano	\N	9	\N	t	2026-11-02 11:50:36.081219-03	molho creme limao siciliano 	Complemento	999	f	t	\N	\N	\N	f	f
792	483	Bulldog Gin	Dose	30	4	f	2026-11-02 11:50:36.081219-03	bulldog gin dose	Gin	999	f	f	\N	\N	\N	f	f
902	101	SUCOS JARRA	UVA	23	4	t	2026-11-02 11:50:36.081219-03	sucos jarra uva	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
2422	1749	Gelo para Uisque	\N	10	2	t	2026-11-02 11:50:36.081219-03	gelo para uisque 	Bebida não alcoolica	999	f	f	\N	\N	\N	f	f
831	507	Ypioca Envelhecida 150	Dose	17	4	f	2026-11-02 11:50:36.081219-03	ypioca envelhecida 150 dose	Cachaça	999	f	f	\N	\N	\N	f	f
837	511	Germana	Dose	20	4	f	2026-11-02 11:50:36.081219-03	germana dose	Cachaça	999	f	f	\N	\N	\N	f	f
838	511	Germana	Garrafa	280	4	f	2026-11-02 11:50:36.081219-03	germana garrafa	Cachaça	999	f	f	\N	\N	\N	f	f
855	525	RAMBUTAM	\N	6	\N	t	2026-11-02 11:50:36.081219-03	rambutam 	Complemento	999	f	t	\N	\N	\N	f	f
861	531	Mix de mini pasteis	\N	41	3	t	2026-11-02 11:50:36.081219-03	mix de mini pasteis 	Petiscos	999	f	t	Mix de mini pastéis crocantes, recheados com queijo derretido, filé suculento, camarões e aratu.	\N	\N	f	f
857	527	Taça De Vidro	\N	25	\N	t	2026-11-02 11:50:36.081219-03	taca de vidro 	Vinho	999	f	f	\N	\N	\N	f	f
860	530	Pure De Batatas	\N	13	\N	t	2026-11-02 11:50:36.081219-03	pure de batatas 	Complemento	999	f	t	\N	\N	\N	f	f
871	539	Vinho Branco Cartuxa Pera Manca	\N	800	2	t	2026-11-02 11:50:36.081219-03	vinho branco cartuxa pera manca 	Vinho	999	f	t	\N	\N	\N	f	f
872	540	Isqueiro	\N	10	4	t	2026-11-02 11:50:36.081219-03	isqueiro 	Cigarro	999	t	t	\N	\N	0	f	f
891	553	Arroz Biro-biro	\N	12	\N	t	2026-11-02 11:50:36.081219-03	arroz biro-biro 	Complemento	999	f	t	\N	\N	\N	f	f
875	542	Vinho Branco Monte Velho Esporao	\N	129	2	t	2026-11-02 11:50:36.081219-03	vinho branco monte velho esporao 	Vinho	999	f	t	\N	\N	\N	f	f
876	543	Vinho Tinto Monte Velho Esporao	\N	139	2	t	2026-11-02 11:50:36.081219-03	vinho tinto monte velho esporao 	Vinho	999	f	t	\N	\N	\N	f	f
881	547	Gin AB gin	Dose	25	4	f	2026-11-02 11:50:36.081219-03	gin ab gin dose	Gin	999	f	f	\N	\N	\N	f	f
892	554	Arroz biro biro	\N	15	1	t	2026-11-02 11:50:36.081219-03	arroz biro biro 	Acompanhamentos	999	f	t	\N	\N	\N	f	f
884	548	STOLICHNAYA	Garrafa	350	4	f	2026-11-02 11:50:36.081219-03	stolichnaya garrafa	Vodka	999	f	f	\N	\N	\N	f	f
2482	1809	Shot Azulzinho	\N	15	4	t	2026-11-02 11:50:36.081219-03	shot azulzinho 	Drink	999	f	t	Vodka, curaçau blue e espuma de gengibre	\N	\N	f	f
917	572	johnnie walker black label	Dose	29	4	t	2026-11-02 11:50:36.081219-03	johnnie walker black label dose	Whisky	999	f	t	\N	\N	\N	f	f
878	545	Frutas para Drink	\N	50	4	t	2026-11-02 11:50:36.081219-03	frutas para drink 	Drink	999	t	f	\N	\N	0	f	f
840	513	Fettuccine Parmegiano Regiano	\N	18	1	t	2026-11-02 11:50:36.081219-03	fettuccine parmegiano regiano 	Acompanhamentos	999	f	t	Fettuccine envolto com manteiga e finalzado com queijo Pamigiano Reggiano	\N	\N	f	f
843	515	Moqueca de Pitu	1 pessoas	180	1	t	2026-11-02 11:50:36.081219-03	moqueca de pitu 1 pessoas	Moquecas	999	f	t	Deliciosa moqueca sergipana de pitu no coco com legumes frescos, acompanhado de arroz branco, farofa especial da casa, vinagrete bem picadinho e um maravilhoso pirão.	\N	\N	f	f
844	515	Moqueca de Pitu	2 pessoas	280	1	t	2026-11-02 11:50:36.081219-03	moqueca de pitu 2 pessoas	Moquecas	999	f	t	Deliciosa moqueca sergipana de pitu no coco com legumes frescos, acompanhado de arroz branco, farofa especial da casa, vinagrete bem picadinho e um maravilhoso pirão.	\N	\N	f	f
845	516	Delicia de Pitu	\N	190	1	t	2026-11-02 11:50:36.081219-03	delicia de pitu 	Petiscos	999	f	t	Pitu fresco, camarão de água doce com sabor inconfundível, servido com leve toque cítrico e textura perfeita.	\N	\N	f	f
854	524	Champagne Moet & Chandon	\N	800	2	t	2026-11-02 11:50:36.081219-03	champagne moet & chandon 	Espumante	999	f	t	\N	\N	\N	f	f
858	528	Pure de batatas	\N	15	1	t	2026-11-02 11:50:36.081219-03	pure de batatas 	Acompanhamentos	999	f	t	\N	\N	\N	f	f
859	529	Pure de banana da terra	\N	15	1	t	2026-11-02 11:50:36.081219-03	pure de banana da terra 	Acompanhamentos	999	f	t	\N	\N	\N	f	f
862	532	Molho Shitake e Shimeji	\N	15	1	t	2026-11-02 11:50:36.081219-03	molho shitake e shimeji 	Acompanhamentos	999	f	f	\N	\N	\N	f	f
874	541	Saco de gelo	\N	25	2	t	2026-11-02 11:50:36.081219-03	saco de gelo 	Acompanhamentos	999	f	f	\N	\N	\N	f	f
877	544	Vinho Tinto Esporao Reserva	\N	349	2	t	2026-11-02 11:50:36.081219-03	vinho tinto esporao reserva 	Vinho	999	f	t	\N	\N	\N	f	f
882	547	Gin AB gin	Garrafa	260	4	f	2026-11-02 11:50:36.081219-03	gin ab gin garrafa	Gin	999	f	f	\N	\N	\N	f	f
908	565	Black Label	Garrafa	360	4	f	2026-11-02 11:50:36.081219-03	black label garrafa	Whisky	999	f	f	\N	\N	\N	f	f
893	555	Molho limao siciliano	\N	9	1	t	2026-11-02 11:50:36.081219-03	molho limao siciliano 	Acompanhamentos	999	f	f	\N	\N	\N	f	f
894	556	Legumes salteados	\N	20	1	t	2026-11-02 11:50:36.081219-03	legumes salteados 	Acompanhamentos	999	f	t	\N	\N	\N	f	f
895	557	Molho rose	\N	8	1	t	2026-11-02 11:50:36.081219-03	molho rose 	Acompanhamentos	999	f	f	\N	\N	\N	f	f
903	102	SUCOS COPO	UVA	14	4	t	2026-11-02 11:50:36.081219-03	sucos copo uva	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
907	565	Black Label	Dose	29	4	f	2026-11-02 11:50:36.081219-03	black label dose	Whisky	999	f	t	\N	\N	\N	f	f
918	572	johnnie walker black label	Garrafa	360	4	t	2026-11-02 11:50:36.081219-03	johnnie walker black label garrafa	Whisky	999	f	t	\N	\N	\N	f	f
911	567	Saco de Gelo de Whisky	\N	30	2	t	2026-11-02 11:50:36.081219-03	saco de gelo de whisky 	Drink	999	f	f	\N	\N	\N	f	f
914	570	johnnie walker gold	Dose	45	4	t	2026-11-02 11:50:36.081219-03	johnnie walker gold dose	Whisky	999	f	t	\N	\N	\N	f	f
915	570	johnnie walker gold	Garrafa	650	4	t	2026-11-02 11:50:36.081219-03	johnnie walker gold garrafa	Whisky	999	f	t	\N	\N	\N	f	f
2317	1648	Carvão	\N	20	2	t	2026-11-02 11:50:36.081219-03	carvao 	Couvert	999	f	f	\N	\N	\N	f	f
923	576	Licor Mozart chocolate	Garrafa	200	4	t	2026-11-02 11:50:36.081219-03	licor mozart chocolate garrafa	Licor.	999	f	f	\N	\N	\N	f	f
922	576	Licor Mozart chocolate	Dose	30	4	t	2026-11-02 11:50:36.081219-03	licor mozart chocolate dose	Licor.	999	f	f	\N	\N	\N	f	f
977	607	Camarao no kokonattsu com gergelim	\N	125	1	t	2026-11-02 11:50:36.081219-03	camarao no kokonattsu com gergelim 	Petiscos	999	f	t	Camarao crocante empanado com coco e gergelim acompanhado com molho oriental	\N	\N	f	f
937	586	Ciroc - Destilado	Dose	25	4	t	2026-11-02 11:50:36.081219-03	ciroc - destilado dose	Vodka	999	f	t	\N	\N	\N	f	f
971	603	Ypioca Prata - Destilado	Dose	9	4	t	2026-11-02 11:50:36.081219-03	ypioca prata - destilado dose	Cachaça	999	f	t	\N	\N	\N	f	f
933	584	Absolut - Destilado	Dose	22	4	t	2026-11-02 11:50:36.081219-03	absolut - destilado dose	Vodka	999	f	t	\N	\N	\N	f	f
935	585	Belvedere destilado	Garrafa	350	4	t	2026-11-02 11:50:36.081219-03	belvedere destilado garrafa	Vodka	999	f	t	\N	\N	\N	f	f
936	585	Belvedere destilado	Dose	30	4	t	2026-11-02 11:50:36.081219-03	belvedere destilado dose	Vodka	999	f	t	\N	\N	\N	f	f
954	594	Gin Beefeater Pink - Destilado	Garrafa	260	4	f	2026-11-02 11:50:36.081219-03	gin beefeater pink - destilado garrafa	Gin	999	f	f	\N	\N	\N	f	f
929	582	Licor 43	Garrafa	350	4	t	2026-11-02 11:50:36.081219-03	licor 43 garrafa	Licor.	999	f	t	\N	\N	\N	f	f
930	582	Licor 43	Dose	25	4	t	2026-11-02 11:50:36.081219-03	licor 43 dose	Licor.	999	f	t	\N	\N	\N	f	f
969	602	Seleta Ouro - Destilado	Dose	11	4	t	2026-11-02 11:50:36.081219-03	seleta ouro - destilado dose	Cachaça	999	f	t	\N	\N	\N	f	f
956	595	Gin Hendricks - Destilado	Garrafa	360	4	t	2026-11-02 11:50:36.081219-03	gin hendricks - destilado garrafa	Gin	999	f	t	\N	\N	\N	f	f
944	589	STOLICHNAYA - Destilado	Garrafa	350	4	t	2026-11-02 11:50:36.081219-03	stolichnaya - destilado garrafa	Vodka	999	f	t	\N	\N	\N	f	f
947	591	Bulldog Gin - Destilado	Dose	30	4	t	2026-11-02 11:50:36.081219-03	bulldog gin - destilado dose	Gin	999	f	f	\N	\N	\N	f	f
949	592	Gin AB gin - Destilado	Dose	25	4	f	2026-11-02 11:50:36.081219-03	gin ab gin - destilado dose	Gin	999	f	f	\N	\N	\N	f	f
953	594	Gin Beefeater Pink - Destilado	Dose	25	4	f	2026-11-02 11:50:36.081219-03	gin beefeater pink - destilado dose	Gin	999	f	f	\N	\N	\N	f	f
941	588	smirnoff - Destilado	Dose	20	4	t	2026-11-02 11:50:36.081219-03	smirnoff - destilado dose	Vodka	999	f	t	\N	\N	\N	f	f
965	600	Sagatiba - Destilado	Dose	11	4	t	2026-11-02 11:50:36.081219-03	sagatiba - destilado dose	Cachaça	999	f	t	\N	\N	\N	f	f
940	587	Grey Goose - Destilado	Garrafa	350	4	t	2026-11-02 11:50:36.081219-03	grey goose - destilado garrafa	Vodka	999	f	t	\N	\N	\N	f	f
988	617	Lounge taxa	\N	250	\N	t	2026-11-02 11:50:36.081219-03	lounge taxa 	Couvert	999	f	f	\N	\N	\N	f	f
978	608	T Licor Cointreau 700 ml	\N	18	8	t	2026-11-02 11:50:36.081219-03	t licor cointreau 700 ml 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
932	583	Licor amarula	Garrafa	250	4	t	2026-11-02 11:50:36.081219-03	licor amarula garrafa	Licor.	999	f	t	\N	\N	\N	f	f
958	596	Gin Tanqueray - Destilado	Garrafa	260	4	t	2026-11-02 11:50:36.081219-03	gin tanqueray - destilado garrafa	Gin	999	f	t	\N	\N	\N	f	f
934	584	Absolut - Destilado	Garrafa	250	4	t	2026-11-02 11:50:36.081219-03	absolut - destilado garrafa	Vodka	999	f	t	\N	\N	\N	f	f
938	586	Ciroc - Destilado	Garrafa	300	4	t	2026-11-02 11:50:36.081219-03	ciroc - destilado garrafa	Vodka	999	f	t	\N	\N	\N	f	f
939	587	Grey Goose - Destilado	Dose	25	4	t	2026-11-02 11:50:36.081219-03	grey goose - destilado dose	Vodka	999	f	t	\N	\N	\N	f	f
942	588	smirnoff - Destilado	Garrafa	160	4	t	2026-11-02 11:50:36.081219-03	smirnoff - destilado garrafa	Vodka	999	f	t	\N	\N	\N	f	f
943	589	STOLICHNAYA - Destilado	Dose	35	4	t	2026-11-02 11:50:36.081219-03	stolichnaya - destilado dose	Vodka	999	f	t	\N	\N	\N	f	f
945	590	Vodka Orloff - Destilados	Dose	13	4	t	2026-11-02 11:50:36.081219-03	vodka orloff - destilados dose	Vodka	999	f	f	\N	\N	\N	f	f
946	590	Vodka Orloff - Destilados	Garrafa	110	4	t	2026-11-02 11:50:36.081219-03	vodka orloff - destilados garrafa	Vodka	999	f	f	\N	\N	\N	f	f
950	592	Gin AB gin - Destilado	Garrafa	220	4	t	2026-11-02 11:50:36.081219-03	gin ab gin - destilado garrafa	Gin	999	f	f	\N	\N	\N	f	f
975	605	Vinho Branco Esporao Reserva	\N	285	2	t	2026-11-02 11:50:36.081219-03	vinho branco esporao reserva 	Vinho	999	f	t	\N	\N	\N	f	f
983	612	Tequila Jose Cuervo Prata Silver	Garrafa	240	4	t	2026-11-02 11:50:36.081219-03	tequila jose cuervo prata silver garrafa	Tequila	999	f	t	\N	\N	\N	f	f
963	599	Germana - Destilado	Dose	20	4	t	2026-11-02 11:50:36.081219-03	germana - destilado dose	Cachaça	999	f	t	\N	\N	\N	f	f
951	593	Gin Beefeater - Destilado	Dose	25	4	t	2026-11-02 11:50:36.081219-03	gin beefeater - destilado dose	Gin	999	f	t	\N	\N	\N	f	f
955	595	Gin Hendricks - Destilado	Dose	30	4	t	2026-11-02 11:50:36.081219-03	gin hendricks - destilado dose	Gin	999	f	t	\N	\N	\N	f	f
957	596	Gin Tanqueray - Destilado	Dose	25	4	t	2026-11-02 11:50:36.081219-03	gin tanqueray - destilado dose	Gin	999	f	t	\N	\N	\N	f	f
964	599	Germana - Destilado	Garrafa	280	4	t	2026-11-02 11:50:36.081219-03	germana - destilado garrafa	Cachaça	999	f	t	\N	\N	\N	f	f
979	609	Red Bull Melancia	\N	23	2	t	2026-11-02 11:50:36.081219-03	red bull melancia 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
966	600	Sagatiba - Destilado	Garrafa	110	4	t	2026-11-02 11:50:36.081219-03	sagatiba - destilado garrafa	Cachaça	999	f	t	\N	\N	\N	f	f
970	602	Seleta Ouro - Destilado	Garrafa	110	4	t	2026-11-02 11:50:36.081219-03	seleta ouro - destilado garrafa	Cachaça	999	f	t	\N	\N	\N	f	f
980	610	Agua Tonica Antartica Zero Acucar	\N	10	2	t	2026-11-02 11:50:36.081219-03	agua tonica antartica zero acucar 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
972	603	Ypioca Prata - Destilado	Garrafa	90	4	t	2026-11-02 11:50:36.081219-03	ypioca prata - destilado garrafa	Cachaça	999	f	t	\N	\N	\N	f	f
982	612	Tequila Jose Cuervo Prata Silver	Dose	18	4	t	2026-11-02 11:50:36.081219-03	tequila jose cuervo prata silver dose	Tequila	999	f	t	\N	\N	\N	f	f
2307	1639	Salmao grelhado no azeite extra virgem	\N	96	1	t	2026-11-02 11:50:36.081219-03	salmao grelhado no azeite extra virgem 	Pratos	999	f	t	Uma deliciosa e saudável opção, onde o suculento filé de salmão é delicadamente grelhado em azeite extra virgem, realçando seu sabor natural e proporcionando uma textura irresistível. Acompanha um delicioso acompanhamento à sua escolha.  ----- English ----- A delightful and healthy choice where the succulent salmon fillet is gently grilled in extra virgin olive oil, enhancing its natural flavor and providing an irresistible texture. Served with a delicious side of  your choice.	\N	\N	f	f
995	623	Embarque lancha	\N	50	4	t	2026-11-02 11:50:36.081219-03	embarque lancha 	Couvert	999	f	f	\N	\N	\N	f	f
2316	1647	Absolut Elyx 750 ml	Garrafa	400	4	f	2026-11-02 11:50:36.081219-03	absolut elyx 750 ml garrafa	Vodka	999	f	f	\N	\N	\N	f	f
931	583	Licor amarula	Dose	18	4	t	2026-11-02 11:50:36.081219-03	licor amarula dose	Licor.	999	f	t	\N	\N	\N	f	f
952	593	Gin Beefeater - Destilado	Garrafa	260	4	t	2026-11-02 11:50:36.081219-03	gin beefeater - destilado garrafa	Gin	999	f	t	\N	\N	\N	f	f
2311	1643	Campari garrafa	\N	150	2	t	2026-11-02 11:50:36.081219-03	campari garrafa 	Drink	999	f	f	\N	\N	\N	f	f
2312	1644	Vermoth garrafa	\N	150	2	f	2026-11-02 11:50:36.081219-03	vermoth garrafa 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2315	1647	Absolut Elyx 750 ml	Dose	28	4	f	2026-11-02 11:50:36.081219-03	absolut elyx 750 ml dose	Vodka	999	f	f	\N	\N	\N	f	f
1004	632	stolichnaya Gluten Free	Dose	30	4	t	2026-11-02 11:50:36.081219-03	stolichnaya gluten free dose	Vodka	999	f	f	\N	\N	\N	f	f
1016	640	Johnnie Red Label	Garrafa	200	4	t	2026-11-02 11:50:36.081219-03	johnnie red label garrafa	Whisky	999	f	t	\N	\N	\N	f	f
1049	669	PARK	\N	90	\N	t	2026-11-02 11:50:36.081219-03	park 	Couvert	999	f	f	\N	\N	\N	f	f
1611	1017	Negroni	\N	32	4	t	2026-11-02 11:50:36.081219-03	negroni 	Drink	999	f	t	Vermuth, campari e gin	\N	\N	f	f
1066	678	Tabua	\N	100	\N	f	2026-11-02 11:50:36.081219-03	tabua 	Couvert	999	f	f	\N	\N	\N	f	f
1053	671	Folhado De Creme com Geleia De Morango	\N	28	1	t	2026-11-02 11:50:36.081219-03	folhado de creme com geleia de morango 	Sobremesa	999	f	t	\N	\N	\N	f	f
1050	99	pastel	Vegano	16	3	t	2026-11-02 11:50:36.081219-03	pastel vegano	Petiscos	999	f	t	Pastel grande crocante com recheio a sua escolha.	\N	\N	f	f
1054	672	Abacaxi	\N	2	\N	t	2026-11-02 11:50:36.081219-03	abacaxi 	Complemento	999	f	t	\N	\N	\N	f	f
1056	674	T Lagoa Azul	\N	27	8	t	2026-11-02 11:50:36.081219-03	t lagoa azul 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1057	675	T Por do Sol Prainha	\N	28	8	t	2026-11-02 11:50:36.081219-03	t por do sol prainha 	Terraco Bebidas	999	f	f	Licor de Menta, Licor curaçau blue, prosecco e groselha	\N	\N	f	f
1033	654	Sorvete Fruttare Limao	\N	15	4	t	2026-11-02 11:50:36.081219-03	sorvete fruttare limao 	Sorvetes	999	f	t	\N	\N	14	f	f
1068	680	CaipiCorona	\N	37	4	t	2026-11-02 11:50:36.081219-03	caipicorona 	Drink	999	f	t	Corona, tequila, e limao	\N	\N	f	f
1084	693	Bombom Tita	\N	5	4	t	2026-11-02 11:50:36.081219-03	bombom tita 	Sobremesa	999	f	f	\N	\N	\N	f	f
997	625	COPO DE VIDRO	\N	10	\N	f	2026-11-02 11:50:36.081219-03	copo de vidro 	Couvert	999	f	f	\N	\N	\N	f	f
1005	632	stolichnaya Gluten Free	Garrafa	350	4	t	2026-11-02 11:50:36.081219-03	stolichnaya gluten free garrafa	Vodka	999	f	f	\N	\N	\N	f	f
1035	656	Sorvete Fruttare Caja	\N	12	4	t	2026-11-02 11:50:36.081219-03	sorvete fruttare caja 	Sorvetes	999	f	t	\N	\N	17	f	f
1037	658	Sorvete magnum Branco	\N	25	4	t	2026-11-02 11:50:36.081219-03	sorvete magnum branco 	Sorvetes	999	t	t	\N	\N	-7	f	f
1091	699	Hendrics	\N	5	\N	t	2026-11-02 11:50:36.081219-03	hendrics 	Complemento	999	f	t	\N	\N	\N	f	f
1041	661	seriguela	\N	2	\N	t	2026-11-02 11:50:36.081219-03	seriguela 	Complemento	999	f	t	\N	\N	\N	f	f
1015	640	Johnnie Red Label	Dose	20	4	t	2026-11-02 11:50:36.081219-03	johnnie red label dose	Whisky	999	f	t	\N	\N	\N	f	f
1031	652	Sorvete Eskibon Mini bombom	\N	18	4	t	2026-11-02 11:50:36.081219-03	sorvete eskibon mini bombom 	Sorvetes	999	t	t	\N	\N	-14	f	f
1034	655	Sorvete Fruttare Coco	\N	12	4	t	2026-11-02 11:50:36.081219-03	sorvete fruttare coco 	Sorvetes	999	t	t	\N	\N	-2	f	f
1086	695	Vinho Rose Portas do Sol Alorna Tejo	\N	78	2	t	2026-11-02 11:50:36.081219-03	vinho rose portas do sol alorna tejo 	Vinho	999	f	t	\N	\N	\N	f	f
1093	701	Tequila Jose Cuervo Ouro	Dose	22	4	t	2026-11-02 11:50:36.081219-03	tequila jose cuervo ouro dose	Tequila	999	f	t	\N	\N	\N	f	f
1094	701	Tequila Jose Cuervo Ouro	Garrafa	270	4	t	2026-11-02 11:50:36.081219-03	tequila jose cuervo ouro garrafa	Tequila	999	f	t	\N	\N	\N	f	f
1097	703	Destilado Absolut Elyx 750ML	Garrafa	400	4	t	2026-11-02 11:50:36.081219-03	destilado absolut elyx 750ml garrafa	Vodka	999	f	f	\N	\N	\N	f	f
1096	703	Destilado Absolut Elyx 750ML	Dose	28	4	t	2026-11-02 11:50:36.081219-03	destilado absolut elyx 750ml dose	Vodka	999	f	f	\N	\N	\N	f	f
1121	727	Vinho Tinto Esporao Colheita	\N	229	2	t	2026-11-02 11:50:36.081219-03	vinho tinto esporao colheita 	Vinho	999	f	t	\N	\N	\N	f	f
1122	728	Vinho Tinto Cortes de Cima	\N	329	2	t	2026-11-02 11:50:36.081219-03	vinho tinto cortes de cima 	Vinho	999	f	t	\N	\N	\N	f	f
1123	729	Vinho Tinto Serras do Azeitao Bacalhoa	\N	149	2	t	2026-11-02 11:50:36.081219-03	vinho tinto serras do azeitao bacalhoa 	Vinho	999	f	t	\N	\N	\N	f	f
1430	883	Cozumel	\N	8	2	t	2026-11-02 11:50:36.081219-03	cozumel 	Drink	999	f	t	\N	\N	\N	f	f
1125	731	Vinho Tinto Luigi Bosca Malbec	\N	340	2	t	2026-11-02 11:50:36.081219-03	vinho tinto luigi bosca malbec 	Vinho	999	f	t	\N	\N	\N	f	f
1126	732	Vinho Tinto Bacalhoa Merlot	\N	390	2	t	2026-11-02 11:50:36.081219-03	vinho tinto bacalhoa merlot 	Vinho	999	f	t	\N	\N	\N	f	f
1128	734	Vinho Tinto Cartuxa Evora Colheita	\N	420	2	t	2026-11-02 11:50:36.081219-03	vinho tinto cartuxa evora colheita 	Vinho	999	f	t	\N	\N	\N	f	f
1085	694	Vinho Branco Portas do Sol Alorna Tejo	\N	78	2	t	2026-11-02 11:50:36.081219-03	vinho branco portas do sol alorna tejo 	Vinho	999	f	t	\N	\N	\N	f	f
1115	721	Vinho Tinto Almanegra	\N	429	2	t	2026-11-02 11:50:36.081219-03	vinho tinto almanegra 	Vinho	999	f	t	\N	\N	\N	f	f
1118	724	T Vinho Tinto Angelica Zapata Malbec Alta	\N	715	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto angelica zapata malbec alta 	Vinho	999	f	f	\N	\N	\N	f	f
1119	725	T Vinho Tinto Nicola Catena Bonarda	\N	1100	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto nicola catena bonarda 	Vinho	999	f	f	\N	\N	\N	f	f
1538	961	Espumante Almadem Brut Branco	\N	70	2	f	2026-11-02 11:50:36.081219-03	espumante almadem brut branco 	Espumante	999	f	f	\N	\N	\N	f	f
1160	766	T Guarana Lata	\N	10	8	t	2026-11-02 11:50:36.081219-03	t guarana lata 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1161	767	T Guarana Zero	\N	10	8	t	2026-11-02 11:50:36.081219-03	t guarana zero 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1163	769	T Perrie Jouet	\N	570	8	t	2026-11-02 11:50:36.081219-03	t perrie jouet 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1172	776	T Cafe Expresso	\N	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1174	776	T Cafe Expresso	\N	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1178	776	T Cafe Expresso	STARBUCKS BLONDE (FRACO)	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso starbucks blonde (fraco)	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1180	776	T Cafe Expresso	\N	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1181	777	T Vodka Nacional	Abacaxi	25	8	t	2026-11-02 11:50:36.081219-03	t vodka nacional abacaxi	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1187	777	T Vodka Nacional	Morango	30	8	t	2026-11-02 11:50:36.081219-03	t vodka nacional morango	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1182	777	T Vodka Nacional	Kiwi	30	8	t	2026-11-02 11:50:36.081219-03	t vodka nacional kiwi	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1183	777	T Vodka Nacional	Laranja	23	8	t	2026-11-02 11:50:36.081219-03	t vodka nacional laranja	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1185	777	T Vodka Nacional	Maracujá	26	8	t	2026-11-02 11:50:36.081219-03	t vodka nacional maracuja	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1190	777	T Vodka Nacional	Umbu	20	8	t	2026-11-02 11:50:36.081219-03	t vodka nacional umbu	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1192	777	T Vodka Nacional	Uva	27	8	t	2026-11-02 11:50:36.081219-03	t vodka nacional uva	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1198	777	T Vodka Nacional	Limao siciliano	28	8	t	2026-11-02 11:50:36.081219-03	t vodka nacional limao siciliano	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1170	776	T Cafe Expresso	\N	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1173	776	T Cafe Expresso	Brasil	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso brasil	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1175	776	T Cafe Expresso	cappricio	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso cappricio	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1177	776	T Cafe Expresso	STARBUCKS PIKE PLACE(MEDIO)	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso starbucks pike place(medio)	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1179	776	T Cafe Expresso	STARBUCKS EXPRESSO (FORTE)	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso starbucks expresso (forte)	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1220	778	T Vodka Importada	Limao siciliano	31	8	t	2026-11-02 11:50:36.081219-03	t vodka importada limao siciliano	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1184	777	T Vodka Nacional	Limão	27	8	t	2026-11-02 11:50:36.081219-03	t vodka nacional limao	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1186	777	T Vodka Nacional	Tangerina	27	8	t	2026-11-02 11:50:36.081219-03	t vodka nacional tangerina	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1188	777	T Vodka Nacional	Siriguela	27	8	t	2026-11-02 11:50:36.081219-03	t vodka nacional siriguela	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1189	777	T Vodka Nacional	\N	30	8	t	2026-11-02 11:50:36.081219-03	t vodka nacional 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1191	777	T Vodka Nacional	Caju	28	8	t	2026-11-02 11:50:36.081219-03	t vodka nacional caju	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1213	778	T Vodka Importada	Uva	29	8	t	2026-11-02 11:50:36.081219-03	t vodka importada uva	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1229	779	T Gin	Laranja	25	8	t	2026-11-02 11:50:36.081219-03	t gin laranja	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1224	779	T Gin	Acerola	25	8	t	2026-11-02 11:50:36.081219-03	t gin acerola	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1226	779	T Gin	\N	27	8	t	2026-11-02 11:50:36.081219-03	t gin 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1227	779	T Gin	Kiwi	27	8	t	2026-11-02 11:50:36.081219-03	t gin kiwi	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1230	779	T Gin	Limão	25	8	t	2026-11-02 11:50:36.081219-03	t gin limao	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1234	779	T Gin	Rambutan	29	8	t	2026-11-02 11:50:36.081219-03	t gin rambutan	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1233	779	T Gin	Morango	27	8	t	2026-11-02 11:50:36.081219-03	t gin morango	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1236	779	T Gin	Tangerina	25	8	t	2026-11-02 11:50:36.081219-03	t gin tangerina	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1239	779	T Gin	Umbu	25	8	t	2026-11-02 11:50:36.081219-03	t gin umbu	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1243	779	T Gin	Jabuticaba	27	8	t	2026-11-02 11:50:36.081219-03	t gin jabuticaba	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2319	1650	Fetuccine ao Pomodoro	\N	18	\N	t	2026-11-02 11:50:36.081219-03	fetuccine ao pomodoro 	Complemento	999	f	t	\N	\N	\N	f	f
1202	778	T Vodka Importada	Abacaxi	30	8	t	2026-11-02 11:50:36.081219-03	t vodka importada abacaxi	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1203	778	T Vodka Importada	Kiwi	31	8	t	2026-11-02 11:50:36.081219-03	t vodka importada kiwi	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1204	778	T Vodka Importada	Laranja	29	8	t	2026-11-02 11:50:36.081219-03	t vodka importada laranja	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1223	779	T Gin	Abacaxi	25	8	t	2026-11-02 11:50:36.081219-03	t gin abacaxi	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1205	778	T Vodka Importada	Limão	27	8	t	2026-11-02 11:50:36.081219-03	t vodka importada limao	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1206	778	T Vodka Importada	Maracujá	29	8	t	2026-11-02 11:50:36.081219-03	t vodka importada maracuja	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1241	779	T Gin	Limao siciliano	27	8	t	2026-11-02 11:50:36.081219-03	t gin limao siciliano	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1207	778	T Vodka Importada	Tangerina	29	8	t	2026-11-02 11:50:36.081219-03	t vodka importada tangerina	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1225	779	T Gin	Caju	27	8	t	2026-11-02 11:50:36.081219-03	t gin caju	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1208	778	T Vodka Importada	Morango	31	8	t	2026-11-02 11:50:36.081219-03	t vodka importada morango	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1209	778	T Vodka Importada	Siriguela	30	8	t	2026-11-02 11:50:36.081219-03	t vodka importada siriguela	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1210	778	T Vodka Importada	\N	32	8	t	2026-11-02 11:50:36.081219-03	t vodka importada 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1212	778	T Vodka Importada	Caju	31	8	t	2026-11-02 11:50:36.081219-03	t vodka importada caju	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1249	780	T Cachaça	Laranja	22	8	t	2026-11-02 11:50:36.081219-03	t cachaca laranja	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1232	779	T Gin	Maracujá	25	8	t	2026-11-02 11:50:36.081219-03	t gin maracuja	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1244	780	T Cachaça	Abacaxi	22	8	t	2026-11-02 11:50:36.081219-03	t cachaca abacaxi	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1235	779	T Gin	Siriguela	25	8	t	2026-11-02 11:50:36.081219-03	t gin siriguela	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1238	779	T Gin	Uva	25	8	t	2026-11-02 11:50:36.081219-03	t gin uva	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1245	780	T Cachaça	Acerola	20	8	t	2026-11-02 11:50:36.081219-03	t cachaca acerola	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1252	780	T Cachaça	Morango	22	8	t	2026-11-02 11:50:36.081219-03	t cachaca morango	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1247	780	T Cachaça	\N	24	8	t	2026-11-02 11:50:36.081219-03	t cachaca 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1248	780	T Cachaça	Kiwi	23	8	t	2026-11-02 11:50:36.081219-03	t cachaca kiwi	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1250	780	T Cachaça	Limão	22	8	t	2026-11-02 11:50:36.081219-03	t cachaca limao	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1251	780	T Cachaça	Maracujá	20	8	t	2026-11-02 11:50:36.081219-03	t cachaca maracuja	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1254	780	T Cachaça	Tangerina	22	8	t	2026-11-02 11:50:36.081219-03	t cachaca tangerina	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1253	780	T Cachaça	Rambutan	27	8	t	2026-11-02 11:50:36.081219-03	t cachaca rambutan	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1256	780	T Cachaça	Uva	22	8	t	2026-11-02 11:50:36.081219-03	t cachaca uva	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1257	780	T Cachaça	Umbu	20	8	t	2026-11-02 11:50:36.081219-03	t cachaca umbu	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1246	780	T Cachaça	Caju	23	8	t	2026-11-02 11:50:36.081219-03	t cachaca caju	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1260	780	T Cachaça	Siriguela	20	8	t	2026-11-02 11:50:36.081219-03	t cachaca siriguela	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1291	797	T Bulleit Bourbon	Garrafa	300	8	t	2026-11-02 11:50:36.081219-03	t bulleit bourbon garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1262	780	T Cachaça	Limao siciliano	24	8	t	2026-11-02 11:50:36.081219-03	t cachaca limao siciliano	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1264	780	T Cachaça	Jabuticaba	22	8	t	2026-11-02 11:50:36.081219-03	t cachaca jabuticaba	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1477	776	T Cafe Expresso	\N	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1273	788	T Germana	Garrafa	280	8	f	2026-11-02 11:50:36.081219-03	t germana garrafa	Cachaça	999	f	f	\N	\N	\N	f	f
1276	790	T Tequila Jose Cuervo Ouro -	Dose	22	8	t	2026-11-02 11:50:36.081219-03	t tequila jose cuervo ouro - dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1480	776	T Cafe Expresso	\N	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1283	793	T Bacardi	Garrafa	80	8	t	2026-11-02 11:50:36.081219-03	t bacardi garrafa	Rum	999	f	f	\N	\N	\N	f	f
1285	794	T Absolut - Destilado	Garrafa	190	8	t	2026-11-02 11:50:36.081219-03	t absolut - destilado garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1287	795	T johnnie walker black label	Garrafa	280	8	t	2026-11-02 11:50:36.081219-03	t johnnie walker black label garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1289	796	T johnnie walker gold	Garrafa	650	8	t	2026-11-02 11:50:36.081219-03	t johnnie walker gold garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1481	306	Gin	MANGA	29	4	t	2026-11-02 11:50:36.081219-03	gin manga	Drink	999	f	t	\N	\N	\N	f	f
1526	958	T Black and White	Dose	22	8	t	2026-11-02 11:50:36.081219-03	t black and white dose	Whisky	999	f	f	\N	\N	\N	f	f
1528	959	T Johnnie Walker Double Black	Dose	35	8	t	2026-11-02 11:50:36.081219-03	t johnnie walker double black dose	Whisky	999	f	f	\N	\N	\N	f	f
1478	776	T Cafe Expresso	\N	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
446	319	Maracuja	\N	2	\N	t	2026-11-02 11:50:36.081219-03	maracuja 	Complemento	999	f	t	\N	\N	\N	f	f
1479	776	T Cafe Expresso	\N	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1485	918	T Red Bull Tropical	\N	20	8	t	2026-11-02 11:50:36.081219-03	t red bull tropical 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1272	788	T Germana	Dose	20	8	t	2026-11-02 11:50:36.081219-03	t germana dose	Cachaça	999	f	f	\N	\N	\N	f	f
1277	790	T Tequila Jose Cuervo Ouro -	Garrafa	270	8	t	2026-11-02 11:50:36.081219-03	t tequila jose cuervo ouro - garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1282	793	T Bacardi	Dose	15	8	t	2026-11-02 11:50:36.081219-03	t bacardi dose	Rum	999	f	f	\N	\N	\N	f	f
1284	794	T Absolut - Destilado	Dose	20	8	t	2026-11-02 11:50:36.081219-03	t absolut - destilado dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1286	795	T johnnie walker black label	Dose	22	8	t	2026-11-02 11:50:36.081219-03	t johnnie walker black label dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1288	796	T johnnie walker gold	Dose	45	8	t	2026-11-02 11:50:36.081219-03	t johnnie walker gold dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1290	797	T Bulleit Bourbon	Dose	22	8	t	2026-11-02 11:50:36.081219-03	t bulleit bourbon dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1320	802	T Licor Mozart (chocolate)	Garrafa	200	8	t	2026-11-02 11:50:36.081219-03	t licor mozart (chocolate) garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1321	803	T Licor Amarula	Dose	18	8	t	2026-11-02 11:50:36.081219-03	t licor amarula dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1324	804	T Jarra Sucos	Kiwi	22	8	t	2026-11-02 11:50:36.081219-03	t jarra sucos kiwi	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1327	804	T Jarra Sucos	Maracujá	18	8	t	2026-11-02 11:50:36.081219-03	t jarra sucos maracuja	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1328	804	T Jarra Sucos	Morango	23	8	t	2026-11-02 11:50:36.081219-03	t jarra sucos morango	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1330	804	T Jarra Sucos	Tangerina	18	8	t	2026-11-02 11:50:36.081219-03	t jarra sucos tangerina	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1331	804	T Jarra Sucos	Manga	18	8	t	2026-11-02 11:50:36.081219-03	t jarra sucos manga	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1333	804	T Jarra Sucos	FrutasVermelhas	25	8	t	2026-11-02 11:50:36.081219-03	t jarra sucos frutasvermelhas	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1336	804	T Jarra Sucos	UVA	21	8	t	2026-11-02 11:50:36.081219-03	t jarra sucos uva	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1338	805	T Licor Frangelico	Dose	18	8	t	2026-11-02 11:50:36.081219-03	t licor frangelico dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1319	802	T Licor Mozart (chocolate)	Dose	30	8	t	2026-11-02 11:50:36.081219-03	t licor mozart (chocolate) dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1322	803	T Licor Amarula	Garrafa	250	8	t	2026-11-02 11:50:36.081219-03	t licor amarula garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1323	804	T Jarra Sucos	Abacaxi	18	8	t	2026-11-02 11:50:36.081219-03	t jarra sucos abacaxi	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1325	804	T Jarra Sucos	Laranja	18	8	t	2026-11-02 11:50:36.081219-03	t jarra sucos laranja	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1326	804	T Jarra Sucos	Limão	18	8	t	2026-11-02 11:50:36.081219-03	t jarra sucos limao	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1329	804	T Jarra Sucos	Seriguela	21	8	t	2026-11-02 11:50:36.081219-03	t jarra sucos seriguela	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1332	804	T Jarra Sucos	Caju	23	8	t	2026-11-02 11:50:36.081219-03	t jarra sucos caju	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1334	804	T Jarra Sucos	Acerola	21	8	t	2026-11-02 11:50:36.081219-03	t jarra sucos acerola	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1335	804	T Jarra Sucos	Limão Siciliano	25	8	t	2026-11-02 11:50:36.081219-03	t jarra sucos limao siciliano	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1339	805	T Licor Frangelico	Garrafa	250	8	t	2026-11-02 11:50:36.081219-03	t licor frangelico garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1318	801	T Licor 43	Dose	20	8	t	2026-11-02 11:50:36.081219-03	t licor 43 dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1344	809	T Grey Goose - Destilado	Garrafa	350	8	t	2026-11-02 11:50:36.081219-03	t grey goose - destilado garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1410	863	T Mentiroska	\N	18	8	t	2026-11-02 11:50:36.081219-03	t mentiroska 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1431	333	cachaça	MANGA	23	2	t	2026-11-02 11:50:36.081219-03	cachaca manga	Drink	999	f	t	\N	\N	\N	f	f
1474	776	T Cafe Expresso	\N	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1476	776	T Cafe Expresso	\N	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1418	871	Vinho Tinto DV Catena Malbec 2018	\N	490	2	t	2026-11-02 11:50:36.081219-03	vinho tinto dv catena malbec 2018 	Vinho	999	f	t	\N	\N	\N	f	f
1419	872	Vinho Branco DV Catena Chardonnay 2019	\N	290	2	t	2026-11-02 11:50:36.081219-03	vinho branco dv catena chardonnay 2019 	Vinho	999	f	t	\N	\N	\N	f	f
1420	873	T Vinho Tinto Catena Zapata Malbec Argentino 2018	\N	1800	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto catena zapata malbec argentino 2018 	Vinho	999	t	f	\N	\N	0	f	f
1452	776	T Cafe Expresso	\N	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1462	913	T Sol Long Neck	\N	8	8	t	2026-11-02 11:50:36.081219-03	t sol long neck 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1473	776	T Cafe Expresso	\N	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1475	776	T Cafe Expresso	\N	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1819	1190	T Vinho Tinto Toro Loco	\N	89	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto toro loco 	Vinho	999	f	f	\N	\N	\N	f	f
1823	1194	T Vinho Branco Redwood Creek California	\N	159	8	t	2026-11-02 11:50:36.081219-03	t vinho branco redwood creek california 	Vinho	999	f	f	\N	\N	\N	f	f
1825	1196	T Vinho Tinto DV Catena Malbec 2018	\N	490	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto dv catena malbec 2018 	Vinho	999	f	f	\N	\N	\N	f	f
1484	917	T Red Bull Melancia	\N	20	8	t	2026-11-02 11:50:36.081219-03	t red bull melancia 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1535	97	Vodka Nacional	MANGA	26	4	t	2026-11-02 11:50:36.081219-03	vodka nacional manga	Drink	999	f	t	\N	\N	\N	f	f
1527	958	T Black and White	Garrafa	120	8	t	2026-11-02 11:50:36.081219-03	t black and white garrafa	Whisky	999	f	f	\N	\N	\N	f	f
1483	916	T Red Bull	\N	20	8	t	2026-11-02 11:50:36.081219-03	t red bull 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1529	959	T Johnnie Walker Double Black	Garrafa	350	8	t	2026-11-02 11:50:36.081219-03	t johnnie walker double black garrafa	Whisky	999	f	f	\N	\N	\N	f	f
1531	960	T Old Parr	Garrafa	300	8	t	2026-11-02 11:50:36.081219-03	t old parr garrafa	Whisky	999	f	f	\N	\N	\N	f	f
1579	988	Red Bull zero acucar	\N	23	2	t	2026-11-02 11:50:36.081219-03	red bull zero acucar 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
1569	981	Licor Bailey's	Garrafa	270	4	t	2026-11-02 11:50:36.081219-03	licor bailey's garrafa	Licor.	999	f	t	\N	\N	\N	f	f
1575	984	Evento Doutora thais	\N	160	2	t	2026-11-02 11:50:36.081219-03	evento doutora thais 	Terraco Prainha	999	f	f	\N	\N	\N	f	f
1631	1036	Prainha Já	\N	31	4	t	2026-11-02 11:50:36.081219-03	prainha ja 	Drink	999	f	t	Gin, sumo de maracuja, limão e xarope de hibiscus	\N	\N	f	f
1537	780	T Cachaça	MANGA	25	8	t	2026-11-02 11:50:36.081219-03	t cachaca manga	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1534	94	Vodka Importada	MANGA	29	4	t	2026-11-02 11:50:36.081219-03	vodka importada manga	Drink	999	f	t	\N	\N	\N	f	f
1559	973	T Vinho Pera Manca TINTO 2015	\N	5800	8	t	2026-11-02 11:50:36.081219-03	t vinho pera manca tinto 2015 	Terraco Bebidas	999	t	f	\N	\N	0	f	f
1568	981	Licor Bailey's	Dose	20	4	t	2026-11-02 11:50:36.081219-03	licor bailey's dose	Licor.	999	f	t	\N	\N	\N	f	f
1606	1014	T Red Bull zero	\N	20	8	t	2026-11-02 11:50:36.081219-03	t red bull zero 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1556	970	Terraço Evento FBG	\N	160	1	t	2026-11-02 11:50:36.081219-03	terraco evento fbg 	Terraco Prainha	999	f	f	\N	\N	\N	f	f
1603	1012	Licor Marie Briza	Dose	18	4	t	2026-11-02 11:50:36.081219-03	licor marie briza dose	Licor.	999	f	f	\N	\N	\N	f	f
1635	1040	T Prainha Mule	\N	31	8	t	2026-11-02 11:50:36.081219-03	t prainha mule 	Terraco Bebidas	999	f	f	Gin, sumo de limão, espuma de frutas vermelha.	\N	\N	f	f
1621	1026	Porçao de frutas	\N	20	2	t	2026-11-02 11:50:36.081219-03	porcao de frutas 	Drink	999	f	f	\N	\N	\N	f	f
1644	1049	Prainha GT	\N	32	4	t	2026-11-02 11:50:36.081219-03	prainha gt 	Drink	999	f	t	Gin, sumo de limão, xarope de toranja, tonica e espuma de frutas vermelhas	\N	\N	f	f
1627	1032	Prainha Mule	\N	31	4	t	2026-11-02 11:50:36.081219-03	prainha mule 	Drink	999	f	t	Gin, sumo de limão, espuma de frutas vermelha.	\N	\N	f	f
1636	1041	Prainha Sunset	\N	31	4	t	2026-11-02 11:50:36.081219-03	prainha sunset 	Drink	999	f	t	Vodka, malibu, abacaxi, laranja, Grenadine.	\N	\N	f	f
1645	1050	Prainha pineapple	\N	31	4	t	2026-11-02 11:50:36.081219-03	prainha pineapple 	Drink	999	f	t	Vodka, abacaxi, xarope de gengibre e limão.	\N	\N	f	f
1672	1054	Jhonnie walker blue label	Garrafa	1900	4	t	2026-11-02 11:50:36.081219-03	jhonnie walker blue label garrafa	Whisky	999	f	f	\N	\N	\N	f	f
1687	1066	Conhaque Miolo Imperial 15 anos	Dose	22	4	t	2026-11-02 11:50:36.081219-03	conhaque miolo imperial 15 anos dose	Conhaque	999	f	t	\N	\N	\N	f	f
1682	1063	Conhaque Martell XO Supremme	Dose	160	4	t	2026-11-02 11:50:36.081219-03	conhaque martell xo supremme dose	Conhaque	999	f	t	Um cognac de personalidade rica, perfeito para ocasiões especiais. Possui uma cor âmbar dourado intenso e um aroma encorpado, rico e forte, com um toque de frutas secas.\r\nNo paladar é complexo e cheio de sabor com toques de amêndoas e baunilha. Um cognac forte com um longo pós-gosto.\r\n\r\nCaracterísticas:\r\nImportado da França.\r\nGraduação Alcoólica: 40% vol.	\N	\N	f	f
1685	1064	Conhaque Cortel Napoleon	Garrafa	320	4	t	2026-11-02 11:50:36.081219-03	conhaque cortel napoleon garrafa	Conhaque	999	f	f	\N	\N	\N	f	f
1688	1066	Conhaque Miolo Imperial 15 anos	Garrafa	310	4	t	2026-11-02 11:50:36.081219-03	conhaque miolo imperial 15 anos garrafa	Conhaque	999	f	t	\N	\N	\N	f	f
1692	1068	T Conhaque Domecq	Garrafa	130	8	t	2026-11-02 11:50:36.081219-03	t conhaque domecq garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1689	1067	Conhaque Domecq	Dose	9	4	t	2026-11-02 11:50:36.081219-03	conhaque domecq dose	Conhaque	999	f	t	\N	\N	\N	f	f
1646	1051	Prainha Sensation	\N	30	4	t	2026-11-02 11:50:36.081219-03	prainha sensation 	Drink	999	f	t	Gin, Aperol, xarope de maracuja, sumo de limão siciliano.	\N	\N	f	f
1690	1067	Conhaque Domecq	Garrafa	130	4	t	2026-11-02 11:50:36.081219-03	conhaque domecq garrafa	Conhaque	999	f	t	\N	\N	\N	f	f
1691	1068	T Conhaque Domecq	Dose	9	8	t	2026-11-02 11:50:36.081219-03	t conhaque domecq dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1671	1054	Jhonnie walker blue label	Dose	160	4	t	2026-11-02 11:50:36.081219-03	jhonnie walker blue label dose	Whisky	999	f	f	\N	\N	\N	f	f
1696	1070	T Conhaque Martell XO Supremme	Garrafa	1990	8	t	2026-11-02 11:50:36.081219-03	t conhaque martell xo supremme garrafa	Terraco Bebidas	999	f	f	Um cognac de personalidade rica, perfeito para ocasiões especiais. Possui uma cor âmbar dourado intenso e um aroma encorpado, rico e forte, com um toque de frutas secas.\r\nNo paladar é complexo e cheio de sabor com toques de amêndoas e baunilha. Um cognac forte com um longo pós-gosto.\r\n\r\nCaracterísticas:\r\nImportado da França.\r\nGraduação Alcoólica: 40% vol.	\N	\N	f	f
1643	1048	Strawberry Gin Basil Smash	\N	30	4	t	2026-11-02 11:50:36.081219-03	strawberry gin basil smash 	Drink	999	f	t	Gin, limão, manjericão e morango	\N	\N	f	f
1679	1060	Campari Dose	\N	12	4	t	2026-11-02 11:50:36.081219-03	campari dose 	Drink	999	f	t	\N	\N	\N	f	f
1684	1064	Conhaque Cortel Napoleon	Dose	35	4	t	2026-11-02 11:50:36.081219-03	conhaque cortel napoleon dose	Conhaque	999	f	f	\N	\N	\N	f	f
1693	1069	T Conhaque Cortel Napoleon	Dose	35	8	t	2026-11-02 11:50:36.081219-03	t conhaque cortel napoleon dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1695	1070	T Conhaque Martell XO Supremme	Dose	160	8	t	2026-11-02 11:50:36.081219-03	t conhaque martell xo supremme dose	Terraco Bebidas	999	f	f	Um cognac de personalidade rica, perfeito para ocasiões especiais. Possui uma cor âmbar dourado intenso e um aroma encorpado, rico e forte, com um toque de frutas secas.\r\nNo paladar é complexo e cheio de sabor com toques de amêndoas e baunilha. Um cognac forte com um longo pós-gosto.\r\n\r\nCaracterísticas:\r\nImportado da França.\r\nGraduação Alcoólica: 40% vol.	\N	\N	f	f
1647	1052	Prainha blue	\N	28	4	t	2026-11-02 11:50:36.081219-03	prainha blue 	Drink	999	f	t	Gin, prosecco, licor de laranja, limão siciliano, e xarope curaçau blue	\N	\N	f	f
1714	1087	Royal Salute	Dose	140	4	t	2026-11-02 11:50:36.081219-03	royal salute dose	Whisky	999	f	t	\N	\N	\N	f	f
1697	1071	T Conhaque Miolo Imperial 15 anos	Dose	22	8	t	2026-11-02 11:50:36.081219-03	t conhaque miolo imperial 15 anos dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1698	1071	T Conhaque Miolo Imperial 15 anos	Garrafa	310	8	t	2026-11-02 11:50:36.081219-03	t conhaque miolo imperial 15 anos garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1704	1077	T Lagosta Ao Molho De Camarao	\N	135	7	t	2026-11-02 11:50:36.081219-03	t lagosta ao molho de camarao 	Pratos	999	f	t	Lagosta com molho de camarão, servida com um risoto cremoso	\N	\N	f	f
1708	1081	T Prainha blue	\N	28	8	t	2026-11-02 11:50:36.081219-03	t prainha blue 	Terraco Bebidas	999	f	f	Gin, prosecco, licor de laranja, limão siciliano, e xarope curaçau blue	\N	\N	f	f
1713	1086	Vinho Branco Angelica Zapata Chardonnay Alta	\N	360	2	t	2026-11-02 11:50:36.081219-03	vinho branco angelica zapata chardonnay alta 	Vinho	999	f	t	\N	\N	\N	f	f
1715	1087	Royal Salute	Garrafa	1600	4	t	2026-11-02 11:50:36.081219-03	royal salute garrafa	Whisky	999	f	f	\N	\N	\N	f	f
1716	1088	Charuto Cohiba SIGLO II	\N	200	8	t	2026-11-02 11:50:36.081219-03	charuto cohiba siglo ii 	Cigarro	999	t	t	\N	\N	0	f	f
1717	1089	Charuto Romeo Y Julieta	\N	200	8	t	2026-11-02 11:50:36.081219-03	charuto romeo y julieta 	Cigarro	999	t	t	\N	\N	0	f	f
1732	1104	PRATO	\N	15	\N	t	2026-11-02 11:50:36.081219-03	prato 	Souvenir	999	f	f	\N	\N	\N	f	f
1733	1105	COPO	\N	10	\N	t	2026-11-02 11:50:36.081219-03	copo 	Souvenir	999	f	f	\N	\N	\N	f	f
1734	1106	TALHER	\N	10	\N	t	2026-11-02 11:50:36.081219-03	talher 	Souvenir	999	f	f	\N	\N	\N	f	f
1741	1112	Rum Malibu	Garrafa	190	4	t	2026-11-02 11:50:36.081219-03	rum malibu garrafa	Rum	999	f	t	\N	\N	\N	f	f
1705	1078	T Lagosta Grelhada	\N	129	7	t	2026-11-02 11:50:36.081219-03	t lagosta grelhada 	Pratos	999	f	t	lagosta fresca grelhada no azeite extravirgem acompanhado de massa ou risoto	\N	\N	f	f
1694	1069	T Conhaque Cortel Napoleon	Garrafa	320	8	t	2026-11-02 11:50:36.081219-03	t conhaque cortel napoleon garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1756	1127	Fettuccine ao Pomodoro	\N	20	1	t	2026-11-02 11:50:36.081219-03	fettuccine ao pomodoro 	Acompanhamentos	999	f	t	Massa fresca envolta com molho pomodoro feito com tomate, majericao e fio de azeite extravirgem	\N	\N	f	f
1785	1156	T Vinho Tinto Ricossa Barbera D'asti DOCG	\N	230	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto ricossa barbera d'asti docg 	Vinho	999	f	f	\N	\N	\N	f	f
1731	1103	COLLER	\N	50	\N	t	2026-11-02 11:50:36.081219-03	coller 	Souvenir	999	f	f	\N	\N	\N	f	f
1740	1112	Rum Malibu	Dose	15	4	t	2026-11-02 11:50:36.081219-03	rum malibu dose	Rum	999	f	t	\N	\N	\N	f	f
1763	1134	Vinho Tinto Toro Loco	\N	89	2	t	2026-11-02 11:50:36.081219-03	vinho tinto toro loco 	Vinho	999	f	t	\N	\N	\N	f	f
1768	1139	Amstel Ultra Long neck Sem Gluten	\N	14	2	t	2026-11-02 11:50:36.081219-03	amstel ultra long neck sem gluten 	Cerveja	999	f	t	\N	\N	\N	f	f
1784	1155	Vinho Tinto Ricossa Barbera D'asti DOCG	\N	230	2	t	2026-11-02 11:50:36.081219-03	vinho tinto ricossa barbera d'asti docg 	Vinho	999	f	t	\N	\N	\N	f	f
1799	1170	TAÇA Vinho Branco Angelica Zapata Chardonnay Alta	\N	92	8	t	2026-11-02 11:50:36.081219-03	taca vinho branco angelica zapata chardonnay alta 	Vinho	999	f	f	\N	\N	\N	f	f
1815	1186	T Vinho Rose Cartuxa EA	\N	140	8	t	2026-11-02 11:50:36.081219-03	t vinho rose cartuxa ea 	Vinho	999	f	f	\N	\N	\N	f	f
1847	1218	T Vinho Branco Monte Velho Esporao	\N	129	8	t	2026-11-02 11:50:36.081219-03	t vinho branco monte velho esporao 	Vinho	999	f	f	\N	\N	\N	f	f
2340	1671	Vinho Tinto Monte dos cabaços Colheita Selec	\N	249	2	t	2026-11-02 11:50:36.081219-03	vinho tinto monte dos cabacos colheita selec 	Vinho	999	f	t	\N	\N	\N	f	f
2341	1672	T Vinho Tinto Monte dos cabaços Colheita Selec	\N	249	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto monte dos cabacos colheita selec 	Vinho	999	f	f	\N	\N	\N	f	f
2342	1673	T Vinho Tinto.COM Premium	\N	115	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto.com premium 	Vinho	999	f	f	\N	\N	\N	f	f
2345	1676	Vinho Tinto Tres Bagos Reserva	\N	205	2	t	2026-11-02 11:50:36.081219-03	vinho tinto tres bagos reserva 	Vinho	999	f	t	\N	\N	\N	f	f
2346	1677	T Vinho Tinto Tres Bagos Reserva	\N	205	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto tres bagos reserva 	Vinho	999	f	f	\N	\N	\N	f	f
2347	1678	Vinho Branco Meruge	\N	425	2	t	2026-11-02 11:50:36.081219-03	vinho branco meruge 	Vinho	999	f	t	\N	\N	\N	f	f
2348	1679	T Vinho Branco Meruge	\N	425	8	t	2026-11-02 11:50:36.081219-03	t vinho branco meruge 	Vinho	999	f	f	\N	\N	\N	f	f
2350	1681	T Vinho Tinto Dourosa	\N	199	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto dourosa 	Vinho	999	f	f	\N	\N	\N	f	f
2351	1682	Vinho Branco La Rosa Reserva	\N	295	2	t	2026-11-02 11:50:36.081219-03	vinho branco la rosa reserva 	Vinho	999	f	t	\N	\N	\N	f	f
2353	1684	Vinho Branco Flor de Vetus Verdejo	\N	185	2	t	2026-11-02 11:50:36.081219-03	vinho branco flor de vetus verdejo 	Vinho	999	f	t	\N	\N	\N	f	f
450	323	Frutas vermelhas	\N	4	\N	t	2026-11-02 11:50:36.081219-03	frutas vermelhas 	Complemento	999	f	t	\N	\N	\N	f	f
2358	1689	T Vinho Branco Tapada do Chaves	\N	395	8	t	2026-11-02 11:50:36.081219-03	t vinho branco tapada do chaves 	Vinho	999	f	f	\N	\N	\N	f	f
2355	1686	Vinho Tinto Izadi Crianza	\N	255	2	t	2026-11-02 11:50:36.081219-03	vinho tinto izadi crianza 	Vinho	999	f	t	\N	\N	\N	f	f
2356	1687	T Vinho Tinto Izadi Crianza	\N	255	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto izadi crianza 	Vinho	999	f	f	\N	\N	\N	f	f
2359	1690	Vinho Tinto La Tour de Fontes	\N	219	2	t	2026-11-02 11:50:36.081219-03	vinho tinto la tour de fontes 	Vinho	999	f	t	\N	\N	\N	f	f
2357	1688	Vinho Branco Tapada do Chaves	\N	395	2	t	2026-11-02 11:50:36.081219-03	vinho branco tapada do chaves 	Vinho	999	f	t	\N	\N	\N	f	f
1909	1277	T Espumante Chandon Brut	\N	175	8	t	2026-11-02 11:50:36.081219-03	t espumante chandon brut 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1911	1279	T Espumante Chandon Baby	\N	65	8	t	2026-11-02 11:50:36.081219-03	t espumante chandon baby 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1913	1281	T Espumante Casa Valduga 130 Premiado	\N	290	8	t	2026-11-02 11:50:36.081219-03	t espumante casa valduga 130 premiado 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1927	1295	Sorvete Tablito Maximo Avelã	\N	17	2	t	2026-11-02 11:50:36.081219-03	sorvete tablito maximo avela 	Sorvetes	999	t	t	\N	\N	-4	f	f
1930	1298	COOLER ISOPOR	\N	100	2	t	2026-11-02 11:50:36.081219-03	cooler isopor 	Souvenir	999	f	f	\N	\N	\N	f	f
2226	1563	Blonde Citrus Highball	\N	28	4	t	2026-11-02 11:50:36.081219-03	blonde citrus highball 	Drink	999	f	t	Drink feito com Jhonnie Walker Blonde, gelo, refrigerante de limão e rodela de laranja	\N	\N	f	f
1935	1303	Gin The Legend	Dose	25	4	t	2026-11-02 11:50:36.081219-03	gin the legend dose	Gin	999	f	t	\N	\N	\N	f	f
1936	1303	Gin The Legend	Garrafa	280	4	t	2026-11-02 11:50:36.081219-03	gin the legend garrafa	Gin	999	f	t	\N	\N	\N	f	f
1940	1307	Smirnoff Ice	\N	19	2	t	2026-11-02 11:50:36.081219-03	smirnoff ice 	Vodka	999	f	t	\N	\N	12	f	f
1972	1339	Camisas UV Personalizada Prainha	Tamanho Extra G	60	\N	t	2026-11-02 11:50:36.081219-03	camisas uv personalizada prainha tamanho extra g	Souvenir	999	f	f	\N	\N	\N	f	f
1974	1339	Camisas UV Personalizada Prainha	Tamanho M	60	\N	t	2026-11-02 11:50:36.081219-03	camisas uv personalizada prainha tamanho m	Souvenir	999	f	f	\N	\N	\N	f	f
1839	1210	T Vinho Tinto Monte Velho Esporao	\N	139	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto monte velho esporao 	Vinho	999	f	f	\N	\N	\N	f	f
1841	1212	T Vinho Tinto Esporao Colheita	\N	229	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto esporao colheita 	Vinho	999	f	f	\N	\N	\N	f	f
1843	1214	T Vinho Tinto Cortes de Cima	\N	329	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto cortes de cima 	Vinho	999	f	f	\N	\N	\N	f	f
1845	1216	T Vinho Tinto Bacalhoa Merlot	\N	390	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto bacalhoa merlot 	Vinho	999	f	f	\N	\N	\N	f	f
1853	1224	T Vinho Tinto Esporao Reserva	\N	349	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto esporao reserva 	Vinho	999	f	f	\N	\N	\N	f	f
1855	1226	T Vinho Tinto Cartuxa Evora Colheita	\N	420	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto cartuxa evora colheita 	Vinho	999	f	f	\N	\N	\N	f	f
1857	1228	T Vinho Tinto Luigi Bosca Malbec	\N	340	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto luigi bosca malbec 	Vinho	999	f	f	\N	\N	\N	f	f
1861	1232	T Vinho Branco Portas do Sol Alorna Tejo	\N	78	8	t	2026-11-02 11:50:36.081219-03	t vinho branco portas do sol alorna tejo 	Vinho	999	f	f	\N	\N	\N	f	f
1867	1238	T Vinho Tinto Cartuxa EA	\N	140	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto cartuxa ea 	Vinho	999	f	f	\N	\N	\N	f	f
1871	1242	T Vinho Tinto Serras do Azeitao Bacalhoa	\N	149	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto serras do azeitao bacalhoa 	Vinho	999	f	f	\N	\N	\N	f	f
1873	1244	T Vinho Tinto Almanegra	\N	429	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto almanegra 	Vinho	999	f	f	\N	\N	\N	f	f
1875	1246	T Vinho Branco DV Catena Chardonnay 2019	\N	290	8	t	2026-11-02 11:50:36.081219-03	t vinho branco dv catena chardonnay 2019 	Vinho	999	f	f	\N	\N	\N	f	f
1882	1253	T Licor Bailey's	Dose	20	8	t	2026-11-02 11:50:36.081219-03	t licor bailey's dose	Licor.	999	f	f	\N	\N	\N	f	f
1884	1254	T Licor Marie Briza	Dose	18	8	t	2026-11-02 11:50:36.081219-03	t licor marie briza dose	Licor.	999	f	f	\N	\N	\N	f	f
1897	1265	T Espumante Casa Perini Brut	\N	135	8	t	2026-11-02 11:50:36.081219-03	t espumante casa perini brut 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1901	1269	T Espumante Chandon Passion Rose 750ml	\N	175	8	t	2026-11-02 11:50:36.081219-03	t espumante chandon passion rose 750ml 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1905	1273	T Espumante Rio Sol Demi Sec	\N	120	8	t	2026-11-02 11:50:36.081219-03	t espumante rio sol demi sec 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2424	1751	Vinho Tinto Paulo laureano Classico	\N	79	2	t	2026-11-02 11:50:36.081219-03	vinho tinto paulo laureano classico 	Vinho	999	f	t	\N	\N	\N	f	f
1921	1289	Vinho Tinto Angelica Zapata Malbec Alta	\N	715	2	t	2026-11-02 11:50:36.081219-03	vinho tinto angelica zapata malbec alta 	Vinho	999	f	t	\N	\N	\N	f	f
1973	1339	Camisas UV Personalizada Prainha	Tamanho G	60	\N	t	2026-11-02 11:50:36.081219-03	camisas uv personalizada prainha tamanho g	Souvenir	999	f	f	\N	\N	\N	f	f
1916	1284	Baden Baden witbier	\N	26	2	t	2026-11-02 11:50:36.081219-03	baden baden witbier 	Cerveja	999	f	t	\N	\N	\N	f	f
1975	1339	Camisas UV Personalizada Prainha	Tamanho P	60	\N	t	2026-11-02 11:50:36.081219-03	camisas uv personalizada prainha tamanho p	Souvenir	999	f	f	\N	\N	\N	f	f
1979	1342	Chapéu De Palha	\N	70	\N	t	2026-11-02 11:50:36.081219-03	chapeu de palha 	Souvenir	999	t	f	\N	\N	0	f	f
1978	1341	Boné Personalizado Prainha	\N	90	\N	t	2026-11-02 11:50:36.081219-03	bone personalizado prainha 	Souvenir	999	t	f	\N	\N	0	f	f
1980	1343	Caneta Personalizada	\N	40	\N	t	2026-11-02 11:50:36.081219-03	caneta personalizada 	Souvenir	999	t	f	\N	\N	0	f	f
1981	1344	Canivete Multifunção Personalizado Prainha	\N	120	\N	t	2026-11-02 11:50:36.081219-03	canivete multifuncao personalizado prainha 	Souvenir	999	t	f	\N	\N	0	f	f
2382	1713	Vinho Tinto Alorna Portas do Sol Tejo	\N	78	2	t	2026-11-02 11:50:36.081219-03	vinho tinto alorna portas do sol tejo 	Vinho	999	f	t	\N	\N	\N	f	f
2427	1754	Vinho Rose Quinta da Alorna	\N	119	2	t	2026-11-02 11:50:36.081219-03	vinho rose quinta da alorna 	Vinho	999	f	t	\N	\N	\N	f	f
1890	1258	T Espumante Rio Sol Brut Rose	\N	120	8	t	2026-11-02 11:50:36.081219-03	t espumante rio sol brut rose 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1892	1260	T Espumante Rio Sol Moscatel	\N	120	8	t	2026-11-02 11:50:36.081219-03	t espumante rio sol moscatel 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2349	1680	Vinho Tinto Dourosa	\N	199	2	t	2026-11-02 11:50:36.081219-03	vinho tinto dourosa 	Vinho	999	f	t	\N	\N	\N	f	f
2352	1683	T Vinho Branco La Rosa Reserva	\N	295	8	t	2026-11-02 11:50:36.081219-03	t vinho branco la rosa reserva 	Vinho	999	f	f	\N	\N	\N	f	f
2361	1692	Vinho Tinto Lespinouse	\N	239	2	t	2026-11-02 11:50:36.081219-03	vinho tinto lespinouse 	Vinho	999	f	t	\N	\N	\N	f	f
2364	1695	T Vinho branco Manoella	\N	285	8	t	2026-11-02 11:50:36.081219-03	t vinho branco manoella 	Vinho	999	f	f	\N	\N	\N	f	f
2362	1693	T Vinho Tinto Lespinouse	\N	239	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto lespinouse 	Vinho	999	f	f	\N	\N	\N	f	f
2363	1694	Vinho Branco Manoella	\N	285	2	t	2026-11-02 11:50:36.081219-03	vinho branco manoella 	Vinho	999	f	t	\N	\N	\N	f	f
2367	1698	T Vinho Branco Quanta Terra G Reserva	\N	485	8	t	2026-11-02 11:50:36.081219-03	t vinho branco quanta terra g reserva 	Vinho	999	f	f	\N	\N	\N	f	f
2368	1699	Vinho Branco Alba de Vetus Albarino	\N	269	2	t	2026-11-02 11:50:36.081219-03	vinho branco alba de vetus albarino 	Vinho	999	f	t	\N	\N	\N	f	f
2372	1703	Vinho Branco Tira o Veu Susana Esteban	\N	599	2	t	2026-11-02 11:50:36.081219-03	vinho branco tira o veu susana esteban 	Vinho	999	f	t	\N	\N	\N	f	f
2373	1704	T Vinho Branco Tira o Veu Susana Esteban	\N	599	8	t	2026-11-02 11:50:36.081219-03	t vinho branco tira o veu susana esteban 	Vinho	999	f	f	\N	\N	\N	f	f
2374	1705	Vinho Rose Phenomena	\N	545	2	t	2026-11-02 11:50:36.081219-03	vinho rose phenomena 	Vinho	999	f	t	\N	\N	\N	f	f
2375	1706	T Vinho Rose Phenomena	\N	545	8	t	2026-11-02 11:50:36.081219-03	t vinho rose phenomena 	Vinho	999	f	f	\N	\N	\N	f	f
2377	1708	Vinho Branco Vinyle	\N	785	2	t	2026-11-02 11:50:36.081219-03	vinho branco vinyle 	Vinho	999	f	t	\N	\N	\N	f	f
2378	1709	T Vinho Branco Vinyle	\N	785	8	t	2026-11-02 11:50:36.081219-03	t vinho branco vinyle 	Vinho	999	f	f	\N	\N	\N	f	f
2379	1710	T Vinho Tinto Vinhas do Passadouro Quinta do Noval	\N	1980	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto vinhas do passadouro quinta do noval 	Vinho	999	f	f	\N	\N	\N	f	f
1886	1255	Licor Peachtree	Garrafa	250	4	t	2026-11-02 11:50:36.081219-03	licor peachtree garrafa	Licor.	999	f	t	\N	\N	\N	f	f
1887	1255	Licor Peachtree	Dose	18	4	t	2026-11-02 11:50:36.081219-03	licor peachtree dose	Licor.	999	f	t	\N	\N	\N	f	f
2366	1697	Vinho Branco Quanta Terra G Reserva	\N	485	2	t	2026-11-02 11:50:36.081219-03	vinho branco quanta terra g reserva 	Vinho	999	f	t	\N	\N	\N	f	f
2369	1700	T Vinho Branco Alba de Vetus Albarino	\N	269	8	t	2026-11-02 11:50:36.081219-03	t vinho branco alba de vetus albarino 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2044	1405	Medalhao do LuxoAju	\N	95	1	t	2026-11-02 11:50:36.081219-03	medalhao do luxoaju 	Pratos	999	f	t	Medalhão de filé ao molho especial de queijo gorgonzola acompanhado de uma guarnição a escolha.	\N	\N	f	f
1988	1351	T Vinho Branco Angelica Zapata Chardonnay Alta	\N	360	8	t	2026-11-02 11:50:36.081219-03	t vinho branco angelica zapata chardonnay alta 	Vinho	999	f	f	\N	\N	\N	f	f
1993	1356	VINHO TINTO ALMA VIVA EPU	\N	980	2	t	2026-11-02 11:50:36.081219-03	vinho tinto alma viva epu 	Vinho	999	f	t	\N	\N	\N	f	f
1995	1358	VINHO TINTO PENINSULA LIMITED CARMENERE 2019	\N	400	2	t	2026-11-02 11:50:36.081219-03	vinho tinto peninsula limited carmenere 2019 	Vinho	999	f	t	\N	\N	\N	f	f
2002	1364	Vinho Tinto Montes Alpha Cabernet sauvgnon 2018	\N	299	2	t	2026-11-02 11:50:36.081219-03	vinho tinto montes alpha cabernet sauvgnon 2018 	Vinho	999	f	t	\N	\N	\N	f	f
2017	99	pastel	\N	25	3	t	2026-11-02 11:50:36.081219-03	pastel 	Petiscos	999	f	t	Pastel grande crocante com recheio a sua escolha.	\N	\N	f	f
2026	1387	T Vinho Tinto Montes Alpha Cabernet sauvgnon 2018	\N	299	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto montes alpha cabernet sauvgnon 2018 	Vinho	999	f	f	\N	\N	\N	f	f
1976	1339	Camisas UV Personalizada Prainha	Tamanho PP	60	\N	t	2026-11-02 11:50:36.081219-03	camisas uv personalizada prainha tamanho pp	Souvenir	999	f	f	\N	\N	\N	f	f
2050	1411	Robalo na cama de tomate cereja	\N	89	1	t	2026-11-02 11:50:36.081219-03	robalo na cama de tomate cereja 	Pratos	999	f	t	Filé de Robalo grelhado em azeite extra virgem com crosta de castanha, sobre uma cama de tomate cereja confitado e acompanhado por uma refrescante salada com queijo de búfala. ---- English ---- Grilled Robalo fillet in extra virgin olive oil with a crust of nuts, resting on a bed of confit cherry tomatoes and accompanied by a refreshing salad with buffalo cheese.	\N	\N	f	f
2039	1400	Camarao ao molho do chef	\N	120	1	t	2026-11-02 11:50:36.081219-03	camarao ao molho do chef 	Pratos	999	f	t	Camarões zero, flambados no conhaque, são servidos com um molho especial do chef feito com creme de leite fresco, cogumelos Paris e mostarda Dijon. Acompanha arroz com brócolis. Uma explosão de sabores em um prato refinado e delicioso. --- English --- Deep Sea Shrimp Flambeed in Cognac - Zero shrimp, flambeed in cognac, served with a chef's special sauce made with fresh cream, Paris mushrooms, and Dijon mustard. Served with broccoli rice. An explosion of flavors in a refined and delicious dish.	\N	\N	f	f
2041	1402	Fettuccine com mix de frutos do mar	\N	110	1	t	2026-11-02 11:50:36.081219-03	fettuccine com mix de frutos do mar 	Pratos	999	f	t	Deliciosa massa grano duro com molho pomodoro fresco e um mix de frutos do mar, uma combinação irresistível de sabores do mar em cada garfada. ---- English ---- Delicious durum wheat pasta with fresh pomodoro sauce and a mix of seafood, an irresistible combination of sea flavors in every bite.	\N	\N	f	f
2115	1474	Vinho Tinto Scala Coeli	\N	1175	2	t	2026-11-02 11:50:36.081219-03	vinho tinto scala coeli 	Vinho	999	f	t	\N	\N	\N	f	f
2117	1476	Vinho Branco Marquesa de Alorna Grande Reserva	\N	369	2	t	2026-11-02 11:50:36.081219-03	vinho branco marquesa de alorna grande reserva 	Vinho	999	f	t	\N	\N	\N	f	f
2121	1480	Vinho Tinto Mouchao	\N	665	2	t	2026-11-02 11:50:36.081219-03	vinho tinto mouchao 	Vinho	999	f	t	\N	\N	\N	f	f
2043	1404	File Matapoa com pure leve	\N	78	1	t	2026-11-02 11:50:36.081219-03	file matapoa com pure leve 	Pratos	999	f	t	Fantástico filé bovino com um molho elaborado a partir do próprio fundo de carne do filé, acompanhado de tomate cereja confitado em baixa temperatura. Acompanha um purê leve, sem manteiga. ---- English ---- Fantastic beef fillet with a sauce made from the meat's own juices, accompanied by slow-cooked cherry tomatoes. Served with a light butter-free mashed potato.	\N	\N	f	f
2049	1410	Papelote de Salmao	\N	89	1	t	2026-11-02 11:50:36.081219-03	papelote de salmao 	Pratos	999	f	t	Filé de Salmão cozido no papel alumínio com especiarias, mantendo seus sucos e sabores intactos. Acompanha arroz de amêndoas, proporcionando uma combinação de texturas e aromas deliciosos. ---- English ---- Salmon fillet cooked in aluminum foil with spices, preserving its juices and flavors. Served with almond rice, offering a delightful combination of textures and aromas.	\N	\N	f	f
2051	1412	Salmao ao polvo	\N	99	1	t	2026-11-02 11:50:36.081219-03	salmao ao polvo 	Pratos	999	f	t	Salmao e polvo grelhados, servidos com creme de palmito pupunha e toque de molho oriental	\N	\N	f	f
2040	1401	Dueto do mar	\N	94	1	t	2026-11-02 11:50:36.081219-03	dueto do mar 	Pratos	999	f	t	File alto de Robalo fresco acompanhado de camarão zero de Santa Catarina grelhado em azeite extra virgem, coberto por vinagrete brunoise e pimenta rosa. Acompanhado por musseline de mandioca e crisp de parmesão preto. ---- English ---- High-cut fresh Robalo fillet paired with grilled zero shrimp from Santa Catarina in extra virgin olive oil, topped with brunoise vinaigrette and pink pepper. Served with mandioca mousseline and black parmesan crisp.	\N	\N	f	f
2052	1413	Lagoa Azul	\N	27	4	t	2026-11-02 11:50:36.081219-03	lagoa azul 	Drink	999	f	t	Vodka, Curacae blues, sumo de limao e sprite	\N	\N	f	f
2056	1417	T Prainha pineapple	\N	28	8	t	2026-11-02 11:50:36.081219-03	t prainha pineapple 	Terraco Bebidas	999	f	f	Vodka, abacaxi, xarope de gengibre e limão.	\N	\N	f	f
1994	1357	T VINHO TINTO SUOLO ROSSO D.O.P DI MANDURIA 2020	\N	280	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto suolo rosso d.o.p di manduria 2020 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1996	1359	VINHO TINTO CALYPTRA PRESTIGE	\N	280	2	t	2026-11-02 11:50:36.081219-03	vinho tinto calyptra prestige 	Vinho	999	f	t	\N	\N	\N	f	f
1998	1361	Licor Villa Massa Limoncello	Dose	19	2	t	2026-11-02 11:50:36.081219-03	licor villa massa limoncello dose	Licor.	999	f	t	\N	\N	\N	f	f
2425	1752	T Vinho Tinto PLaureano Classico	\N	79	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto plaureano classico 	Vinho	999	f	f	\N	\N	\N	f	f
2016	1378	T Vaza Barris	\N	34	8	t	2026-11-02 11:50:36.081219-03	t vaza barris 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2021	1382	Vinho Branco Cartuxa Colheita Evora	\N	300	2	t	2026-11-02 11:50:36.081219-03	vinho branco cartuxa colheita evora 	Vinho	999	f	t	\N	\N	\N	f	f
2028	1389	vinho branco serras do azeitão bacalhoa	\N	149	2	t	2026-11-02 11:50:36.081219-03	vinho branco serras do azeitao bacalhoa 	Vinho	999	f	t	\N	\N	\N	f	f
2047	1408	File Shi-Shi com massa especial	\N	83	1	t	2026-11-02 11:50:36.081219-03	file shi-shi com massa especial 	Pratos	999	f	t	File mignon suculento com molho exclusivo de shitake e shimeji em creme de leite e especiarias, acompanhado de massa italiana com queijo Parmigiano Reggiano.\r\n\r\nTender filet mignon with an exclusive sauce of shiitake and shimeji mushrooms in cream and spices, served with Italian pasta with Parmigiano Reggiano cheese.	\N	\N	f	f
2053	1414	T Margarita	\N	28	8	t	2026-11-02 11:50:36.081219-03	t margarita 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2054	1415	T Negroni	\N	30	8	t	2026-11-02 11:50:36.081219-03	t negroni 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2057	1418	Carne do sol de File	\N	79	1	t	2026-11-02 11:50:36.081219-03	carne do sol de file 	Pratos	999	f	t	Uma iguaria nordestina, ressaltando a suculência do filé mignon. Acompanhada de farofa de farinha fina e vinagrete fresco. Opções variadas de acompanhamentos. ---- English ---- Sun-Dried Filet Mignon - A Northeastern delicacy, emphasizing the succulence of filet mignon. Served with fine flour farofa and fresh vinaigrette. Various optional accompaniment choices.	\N	\N	f	f
2109	1468	Vinho Verde Condes de Barcelos	\N	90	2	t	2026-11-02 11:50:36.081219-03	vinho verde condes de barcelos 	Vinho	999	f	t	\N	\N	\N	f	f
2106	1465	T Vinho Tinto Rosso Puglia IGP	\N	149	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto rosso puglia igp 	Vinho	999	f	f	\N	\N	\N	f	f
2168	1516	SEM alcool	MANGA	17	4	t	2026-11-02 11:50:36.081219-03	sem alcool manga	Drink	999	f	t	\N	\N	\N	f	f
2099	1458	T Vinho Tinto Paya Malbec	\N	340	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto paya malbec 	Vinho	999	f	f	\N	\N	\N	f	f
2100	1459	Vinho Tinto Paya Malbec	\N	340	2	t	2026-11-02 11:50:36.081219-03	vinho tinto paya malbec 	Vinho	999	f	t	\N	\N	\N	f	f
2101	1460	Vinho Branco Foral de Evora	\N	256	2	t	2026-11-02 11:50:36.081219-03	vinho branco foral de evora 	Vinho	999	f	t	\N	\N	\N	f	f
2102	1461	T Vinho Branco Foral de Evora	\N	256	8	t	2026-11-02 11:50:36.081219-03	t vinho branco foral de evora 	Vinho	999	f	f	\N	\N	\N	f	f
2105	1464	Vinho Tinto Rosso Puglia IGP	\N	149	2	t	2026-11-02 11:50:36.081219-03	vinho tinto rosso puglia igp 	Vinho	999	f	t	\N	\N	\N	f	f
2180	1517	T Vinho Tinto Tiago Cabaco Vinhas Velhas	\N	205	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto tiago cabaco vinhas velhas 	Vinho	999	f	f	\N	\N	\N	f	f
2107	1466	Vinho Tinto Quanta Terra G Reserva	\N	394	2	t	2026-11-02 11:50:36.081219-03	vinho tinto quanta terra g reserva 	Vinho	999	f	t	\N	\N	\N	f	f
2108	1467	T Vinho Tinto Quanta Terra G Reserva	\N	394	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto quanta terra g reserva 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2111	1470	Vinho Branco Quinta da Alorna Reserva Chardonay	\N	119	2	t	2026-11-02 11:50:36.081219-03	vinho branco quinta da alorna reserva chardonay 	Vinho	999	f	t	\N	\N	\N	f	f
2112	1471	T Vinho Branco Quinta da Alorna Reserva	\N	119	8	t	2026-11-02 11:50:36.081219-03	t vinho branco quinta da alorna reserva 	Vinho	999	f	f	\N	\N	\N	f	f
2116	1475	T Vinho Tinto Scala Coeli	\N	1175	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto scala coeli 	Vinho	999	f	f	\N	\N	\N	f	f
2118	1477	T Vinho Branco Marquesa de Alorna Grande Reserva	\N	369	8	t	2026-11-02 11:50:36.081219-03	t vinho branco marquesa de alorna grande reserva 	Vinho	999	f	f	\N	\N	\N	f	f
2120	1479	T Vinho Tinto Marquesa de Alorna Grande Reserva	\N	316	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto marquesa de alorna grande reserva 	Vinho	999	f	f	\N	\N	\N	f	f
2135	1494	Vinho Tinto Quinta do Noval Douro DOC Reserva	\N	329	2	t	2026-11-02 11:50:36.081219-03	vinho tinto quinta do noval douro doc reserva 	Vinho	999	f	t	\N	\N	\N	f	f
2141	1500	Vinho Tinto Amadeo Gran Reserva Malbec	\N	192	2	t	2026-11-02 11:50:36.081219-03	vinho tinto amadeo gran reserva malbec 	Vinho	999	f	t	\N	\N	\N	f	f
2142	1501	T Vinho Tinto Amadeo Gran Reserva Malbec	\N	192	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto amadeo gran reserva malbec 	Vinho	999	f	f	\N	\N	\N	f	f
2170	1516	SEM alcool	Maracujá	19	4	t	2026-11-02 11:50:36.081219-03	sem alcool maracuja	Drink	999	f	t	\N	\N	\N	f	f
2162	1516	SEM alcool	Kiwi	23	4	t	2026-11-02 11:50:36.081219-03	sem alcool kiwi	Drink	999	f	t	\N	\N	\N	f	f
2370	1701	Vinho Tinto Chateau La Courtiade	\N	209	2	t	2026-11-02 11:50:36.081219-03	vinho tinto chateau la courtiade 	Vinho	999	f	t	\N	\N	\N	f	f
2113	1472	Vinho Tinto Escultor	\N	705	2	t	2026-11-02 11:50:36.081219-03	vinho tinto escultor 	Vinho	999	f	t	\N	\N	\N	f	f
2114	1473	T Vinho Tinto Escultor	\N	533	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto escultor 	Vinho	999	f	f	\N	\N	\N	f	f
2119	1478	Vinho Tinto Marquesa de Alorna Grande Reserva	\N	316	2	t	2026-11-02 11:50:36.081219-03	vinho tinto marquesa de alorna grande reserva 	Vinho	999	f	t	\N	\N	\N	f	f
2122	1481	T Vinho Tinto Mouchao	\N	665	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto mouchao 	Vinho	999	f	f	\N	\N	\N	f	f
2123	1482	Vinho Tinto Tiago Cabaco Vinhas Velhas	\N	205	2	t	2026-11-02 11:50:36.081219-03	vinho tinto tiago cabaco vinhas velhas 	Vinho	999	f	t	\N	\N	\N	f	f
2124	1483	Vinho Tinto Salbide	\N	122	2	t	2026-11-02 11:50:36.081219-03	vinho tinto salbide 	Vinho	999	f	t	\N	\N	\N	f	f
2125	1484	T Vinho Tinto Salbide	\N	122	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto salbide 	Vinho	999	f	f	\N	\N	\N	f	f
2126	1485	Vinho Tinto Mayor de Castilla Reserva	\N	201	2	t	2026-11-02 11:50:36.081219-03	vinho tinto mayor de castilla reserva 	Vinho	999	f	t	\N	\N	\N	f	f
2128	1487	Vinho Tinto Izadi El Regalo	\N	533	2	t	2026-11-02 11:50:36.081219-03	vinho tinto izadi el regalo 	Vinho	999	f	t	\N	\N	\N	f	f
2127	1486	T Vinho Tinto Mayor de Castilla Reserva	\N	201	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto mayor de castilla reserva 	Vinho	999	f	f	\N	\N	\N	f	f
2129	1488	T Vinho Tinto Izadi El Regalo	\N	533	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto izadi el regalo 	Vinho	999	f	f	\N	\N	\N	f	f
2136	1495	T Vinho Tinto Quinta do Noval Reserva DOC	\N	329	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto quinta do noval reserva doc 	Vinho	999	f	f	\N	\N	\N	f	f
2137	1496	Vinho Branco Amadeo Chardonnay	\N	86	2	t	2026-11-02 11:50:36.081219-03	vinho branco amadeo chardonnay 	Vinho	999	f	t	\N	\N	\N	f	f
2139	1498	Vinho Rose Ceressou	\N	110	2	t	2026-11-02 11:50:36.081219-03	vinho rose ceressou 	Vinho	999	f	t	\N	\N	\N	f	f
2140	1499	T Vinho Rose Ceressou	\N	110	8	t	2026-11-02 11:50:36.081219-03	t vinho rose ceressou 	Vinho	999	f	f	\N	\N	\N	f	f
2143	1502	Vinho Tinto MOB Gauve	\N	928	2	t	2026-11-02 11:50:36.081219-03	vinho tinto mob gauve 	Vinho	999	f	t	\N	\N	\N	f	f
2144	1503	T Vinho Tinto MOB Gauve	\N	928	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto mob gauve 	Vinho	999	f	f	\N	\N	\N	f	f
2157	1516	SEM alcool	Abacaxi	24	4	t	2026-11-02 11:50:36.081219-03	sem alcool abacaxi	Drink	999	f	t	\N	\N	\N	f	f
2146	1505	Vinho Tinto Sem Vergonha	\N	415	2	t	2026-11-02 11:50:36.081219-03	vinho tinto sem vergonha 	Vinho	999	f	t	\N	\N	\N	f	f
2147	1506	T Vinho Tinto Sem Vergonha	\N	415	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto sem vergonha 	Vinho	999	f	f	\N	\N	\N	f	f
2148	1507	T Vinho Tinto Cartuxa Reserva Evora 3 L	\N	1450	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto cartuxa reserva evora 3 l 	Vinho	999	f	f	\N	\N	\N	f	f
2156	1515	Catado de Caranguejo	\N	38	3	t	2026-11-02 11:50:36.081219-03	catado de caranguejo 	Petiscos	999	f	t	Catado de caranguejo refogado e crocante na farinha panko	\N	\N	f	f
2159	1516	SEM alcool	Caju	24	4	t	2026-11-02 11:50:36.081219-03	sem alcool caju	Drink	999	f	t	\N	\N	\N	f	f
2160	1516	SEM alcool	\N	24	4	t	2026-11-02 11:50:36.081219-03	sem alcool 	Drink	999	f	t	\N	\N	\N	f	f
2166	1516	SEM alcool	Limao siciliano	24	4	t	2026-11-02 11:50:36.081219-03	sem alcool limao siciliano	Drink	999	f	t	\N	\N	\N	f	f
2145	1504	Vinho Tinto Cabriolet	\N	472	2	t	2026-11-02 11:50:36.081219-03	vinho tinto cabriolet 	Vinho	999	f	t	\N	\N	\N	f	f
2167	1516	SEM alcool	Limão	24	4	t	2026-11-02 11:50:36.081219-03	sem alcool limao	Drink	999	f	t	\N	\N	\N	f	f
2110	1469	T Vinho Verde Condes de Barcelos	\N	90	8	t	2026-11-02 11:50:36.081219-03	t vinho verde condes de barcelos 	Vinho	999	f	f	\N	\N	\N	f	f
2371	1702	T Vinho Tinto Chateau La Courtiade	\N	209	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto chateau la courtiade 	Vinho	999	f	f	\N	\N	\N	f	f
2181	1518	T Vinho Branco Cartuxa Colheita Evora	\N	300	8	t	2026-11-02 11:50:36.081219-03	t vinho branco cartuxa colheita evora 	Vinho	999	f	f	\N	\N	\N	f	f
2380	1711	Vinho Tinto.COM Premium	\N	115	2	t	2026-11-02 11:50:36.081219-03	vinho tinto.com premium 	Vinho	999	f	t	\N	\N	\N	f	f
2418	1745	T VINHO TINTO PENINSULA LIMITED CARMENERE 2019	\N	400	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto peninsula limited carmenere 2019 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2176	1516	SEM alcool	Tangerina	21	4	t	2026-11-02 11:50:36.081219-03	sem alcool tangerina	Drink	999	f	t	\N	\N	\N	f	f
2409	1738	T Licor Peachtree	Dose	18	8	t	2026-11-02 11:50:36.081219-03	t licor peachtree dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2384	1715	T Vinho Tinto Alorna Portas do Sol Tejo	\N	78	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto alorna portas do sol tejo 	Vinho	999	f	f	\N	\N	\N	f	f
2408	1738	T Licor Peachtree	Garrafa	250	8	t	2026-11-02 11:50:36.081219-03	t licor peachtree garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2401	1732	T Espumante Casa Perini Demi-sec	\N	135	8	t	2026-11-02 11:50:36.081219-03	t espumante casa perini demi-sec 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2404	1735	Licor Cointreau (dose)	\N	18	4	t	2026-11-02 11:50:36.081219-03	licor cointreau (dose) 	Licor.	999	f	t	\N	\N	\N	f	f
2406	1737	T Licor Limoncello	Dose	19	8	t	2026-11-02 11:50:36.081219-03	t licor limoncello dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2179	1516	SEM alcool	Uva	24	4	t	2026-11-02 11:50:36.081219-03	sem alcool uva	Drink	999	f	t	\N	\N	\N	f	f
2414	1742	Vinho do Porto Burmester (Taça)	Dose	28	2	t	2026-11-02 11:50:36.081219-03	vinho do porto burmester (taca) dose	Vinho	999	f	t	\N	\N	\N	f	f
2428	1755	T Vinho Rose Quinta da Alorna	\N	119	8	t	2026-11-02 11:50:36.081219-03	t vinho rose quinta da alorna 	Vinho	999	f	f	\N	\N	\N	f	f
2434	1761	Espumante Cava Jaume Serra Brut	\N	89	2	t	2026-11-02 11:50:36.081219-03	espumante cava jaume serra brut 	Espumante	999	f	f	\N	\N	\N	f	f
2441	1768	beefeter 24 london	\N	485	2	t	2026-11-02 11:50:36.081219-03	beefeter 24 london 	Gin	999	f	f	\N	\N	\N	f	f
2438	1765	Camarao Grelhado	\N	125	1	t	2026-11-02 11:50:36.081219-03	camarao grelhado 	Petiscos	999	f	t	6 Camarões VG suculentos grelhados, acompanhados de brócolis e palmito.	\N	\N	f	f
2504	1829	T SEM alcool	Caju	21	8	t	2026-11-02 11:50:36.081219-03	t sem alcool caju	Drink	999	f	f	\N	\N	\N	f	f
2505	1829	T SEM alcool	\N	22	8	t	2026-11-02 11:50:36.081219-03	t sem alcool 	Drink	999	f	f	\N	\N	\N	f	f
2511	1829	T SEM alcool	Limao siciliano	22	8	t	2026-11-02 11:50:36.081219-03	t sem alcool limao siciliano	Drink	999	f	f	\N	\N	\N	f	f
2521	1829	T SEM alcool	Tangerina	20	8	t	2026-11-02 11:50:36.081219-03	t sem alcool tangerina	Drink	999	f	f	\N	\N	\N	f	f
2512	1829	T SEM alcool	Limão	20	8	t	2026-11-02 11:50:36.081219-03	t sem alcool limao	Drink	999	f	f	\N	\N	\N	f	f
2515	1829	T SEM alcool	Maracujá	20	8	t	2026-11-02 11:50:36.081219-03	t sem alcool maracuja	Drink	999	f	f	\N	\N	\N	f	f
2516	1829	T SEM alcool	Morango	21	8	t	2026-11-02 11:50:36.081219-03	t sem alcool morango	Drink	999	f	f	\N	\N	\N	f	f
2545	1849	Chivas Regal 18 anos	Garrafa	590	4	t	2026-11-02 11:50:36.081219-03	chivas regal 18 anos garrafa	Whisky	999	f	f	\N	\N	\N	f	f
2546	1850	Espumante Chandon Brut Rose 750ml	\N	175	2	t	2026-11-02 11:50:36.081219-03	espumante chandon brut rose 750ml 	Espumante	999	f	t	\N	\N	\N	f	f
2541	1846	Vinho Branco Paulo Laureano Nosso Terrior	\N	179	2	t	2026-11-02 11:50:36.081219-03	vinho branco paulo laureano nosso terrior 	Vinho	999	f	t	\N	\N	\N	f	f
2604	1899	T Suco COPO	Limão	10	8	t	2026-11-02 11:50:36.081219-03	t suco copo limao	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2693	1962	Bolinho de peixe recheado com camarao 1 unid	\N	55	3	t	2026-11-02 11:50:36.081219-03	bolinho de peixe recheado com camarao 1 unid 	Petiscos	999	t	t	Bolinho de peixe recheado com camarao, creme de alho poro e geleia de limao de siciliano	\N	-10	f	f
2497	1824	Picanha Black Angus na chapa 250 gramas (consulta)	\N	149	1	t	2026-11-02 11:50:36.081219-03	picanha black angus na chapa 250 gramas (consulta) 	Parrilha ( Na Brasa )	999	t	t	suculenta e saborosa, acompanhada por farofa amanteigada, cebola caramelizada, vinagrete e uma guarnição à sua escolha. Uma combinação irresistível de sabores e texturas para uma experiência gastronômica verdadeiramente deliciosa. ---- English ---- Angus Picanha - Succulent and flavorful, accompanied by buttery farofa, caramelized onions, vinaigrette, and one additional side of your choice. An irresistible combination of flavors and textures for a truly delightful gastronomic experience.	\N	-16	f	f
2550	99	pastel	Lagosta com Creme de Queijo	34	3	t	2026-11-02 11:50:36.081219-03	pastel lagosta com creme de queijo	Petiscos	999	f	t	Pastel grande crocante com recheio a sua escolha.	\N	\N	f	f
2559	1859	Conhaque Hennessy	Dose	35	4	t	2026-11-02 11:50:36.081219-03	conhaque hennessy dose	Conhaque	999	f	t	\N	\N	\N	f	f
2562	1861	T Conhaque Hennessy	Dose	35	8	t	2026-11-02 11:50:36.081219-03	t conhaque hennessy dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2488	1815	Biscoito Wafel	\N	4	\N	t	2026-11-02 11:50:36.081219-03	biscoito wafel 	Complemento	999	f	t	\N	\N	\N	f	f
2509	1829	T SEM alcool	Laranja	18	8	t	2026-11-02 11:50:36.081219-03	t sem alcool laranja	Drink	999	f	f	\N	\N	\N	f	f
2513	1829	T SEM alcool	MANGA	20	8	t	2026-11-02 11:50:36.081219-03	t sem alcool manga	Drink	999	f	f	\N	\N	\N	f	f
2542	1847	T Vinho Branco Paulo Laureano Nosso Terrior	\N	179	8	t	2026-11-02 11:50:36.081219-03	t vinho branco paulo laureano nosso terrior 	Vinho	999	f	f	\N	\N	\N	f	f
2544	1849	Chivas Regal 18 anos	Dose	80	4	t	2026-11-02 11:50:36.081219-03	chivas regal 18 anos dose	Whisky	999	f	t	\N	\N	\N	f	f
2520	1829	T SEM alcool	Siriguela	20	8	t	2026-11-02 11:50:36.081219-03	t sem alcool siriguela	Drink	999	f	f	\N	\N	\N	f	f
2524	1829	T SEM alcool	Uva	20	8	t	2026-11-02 11:50:36.081219-03	t sem alcool uva	Drink	999	f	f	\N	\N	\N	f	f
2548	1852	T Espumante Chandon Brut Rose 750ml	\N	175	8	t	2026-11-02 11:50:36.081219-03	t espumante chandon brut rose 750ml 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2549	99	pastel	Charque com Queijo Coalho	18	3	t	2026-11-02 11:50:36.081219-03	pastel charque com queijo coalho	Petiscos	999	f	t	Pastel grande crocante com recheio a sua escolha.	\N	\N	f	f
2581	1879	Sorvete Eskibon Mini Morango	\N	18	4	t	2026-11-02 11:50:36.081219-03	sorvete eskibon mini morango 	Sorvetes	999	t	f	\N	\N	-2	f	f
2502	1829	T SEM alcool	Abacaxi	20	8	t	2026-11-02 11:50:36.081219-03	t sem alcool abacaxi	Drink	999	f	f	\N	\N	\N	f	f
2566	1864	T Vinho Rose Condes de Barcelos	\N	95	8	t	2026-11-02 11:50:36.081219-03	t vinho rose condes de barcelos 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2598	1896	Dejavu	\N	35	4	t	2026-11-02 11:50:36.081219-03	dejavu 	Drink	999	f	t	Vodka, limão siciliano, soda de manga	\N	\N	f	f
153	102	SUCOS COPO	Kiwi	16	4	t	2026-11-02 11:50:36.081219-03	sucos copo kiwi	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
154	102	SUCOS COPO	Laranja	12	4	t	2026-11-02 11:50:36.081219-03	sucos copo laranja	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
2538	1843	Vinho Branco Paulo Laureano Classico	\N	107	2	t	2026-11-02 11:50:36.081219-03	vinho branco paulo laureano classico 	Vinho	999	f	t	\N	\N	\N	f	f
2583	1881	Vinho Tinto Finca Amadeo Malbec	\N	99	2	t	2026-11-02 11:50:36.081219-03	vinho tinto finca amadeo malbec 	Vinho	999	f	t	\N	\N	\N	f	f
2586	1884	Pirao de moqueca	\N	15	1	t	2026-11-02 11:50:36.081219-03	pirao de moqueca 	Acompanhamentos	999	f	f	\N	\N	\N	f	f
2597	1895	Sabe de nada inocente	\N	35	4	t	2026-11-02 11:50:36.081219-03	sabe de nada inocente 	Drink	999	f	t	Gin, xarope de frutas vermelhas, limão e tangerina	\N	\N	f	f
2591	1889	Risoto com Alho poro	\N	64	1	t	2026-11-02 11:50:36.081219-03	risoto com alho poro 	Pratos	999	f	t	Cremoso e aromático, preparado com alho-poró fresco e finalizado com toque de parmesão.	\N	\N	f	f
2590	1888	Risoto De Camarao	\N	99	1	t	2026-11-02 11:50:36.081219-03	risoto de camarao 	Pratos	999	f	t	Camarões suculentos mergulhados em um risoto ultra cremoso.	\N	\N	f	f
2593	1891	Basil Slash	\N	35	4	t	2026-11-02 11:50:36.081219-03	basil slash 	Drink	999	f	t	Gin, Limão siciliano, manjericão e gengibre	\N	\N	f	f
2594	1892	Guava Fitz	\N	35	4	t	2026-11-02 11:50:36.081219-03	guava fitz 	Drink	999	f	t	Gin, Limão siciliano, goiaba e angostura	\N	\N	f	f
2621	1902	T Chivas Regal 18 anos	Dose	80	8	t	2026-11-02 11:50:36.081219-03	t chivas regal 18 anos dose	Whisky	999	f	f	\N	\N	\N	f	f
2595	1893	Fitzgerald	\N	35	4	t	2026-11-02 11:50:36.081219-03	fitzgerald 	Drink	999	f	t	Gin, Limão siciliano e angostura	\N	\N	f	f
2596	1894	Cacau Collins	\N	35	4	t	2026-11-02 11:50:36.081219-03	cacau collins 	Drink	999	f	t	Gin, Licor, Canela, limão siciliano e cacau	\N	\N	f	f
2599	1897	Aperol Prainha	\N	35	4	t	2026-11-02 11:50:36.081219-03	aperol prainha 	Drink	999	f	t	Espumante, aperol e laranja	\N	\N	f	f
2601	1899	T Suco COPO	Abacaxi	10	8	t	2026-11-02 11:50:36.081219-03	t suco copo abacaxi	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2625	1904	T Royal Salute	Dose	140	8	t	2026-11-02 11:50:36.081219-03	t royal salute dose	Whisky	999	f	f	\N	\N	\N	f	f
2602	1899	T Suco COPO	Kiwi	10	8	t	2026-11-02 11:50:36.081219-03	t suco copo kiwi	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2603	1899	T Suco COPO	Laranja	10	8	t	2026-11-02 11:50:36.081219-03	t suco copo laranja	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2620	1901	T Chivas Regal 12 anos	Garrafa	280	8	t	2026-11-02 11:50:36.081219-03	t chivas regal 12 anos garrafa	Whisky	999	f	f	\N	\N	\N	f	f
2610	1899	T Suco COPO	FrutasVermelhas	15	8	t	2026-11-02 11:50:36.081219-03	t suco copo frutasvermelhas	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2614	1899	T Suco COPO	UVA	14	8	t	2026-11-02 11:50:36.081219-03	t suco copo uva	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2623	1903	T Jhonnie walker blue label	Dose	160	8	t	2026-11-02 11:50:36.081219-03	t jhonnie walker blue label dose	Whisky	999	f	f	\N	\N	\N	f	f
2626	1904	T Royal Salute	Garrafa	1600	8	t	2026-11-02 11:50:36.081219-03	t royal salute garrafa	Whisky	999	f	f	\N	\N	\N	f	f
2627	1905	T Absolut	Dose	20	8	f	2026-11-02 11:50:36.081219-03	t absolut dose	Vodka	999	f	f	\N	\N	\N	f	f
2606	1899	T Suco COPO	Morango	13	8	t	2026-11-02 11:50:36.081219-03	t suco copo morango	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2608	1899	T Suco COPO	Tangerina	10	8	t	2026-11-02 11:50:36.081219-03	t suco copo tangerina	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2609	1899	T Suco COPO	Manga	10	8	t	2026-11-02 11:50:36.081219-03	t suco copo manga	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2612	1899	T Suco COPO	Limão Siciliano	15	8	t	2026-11-02 11:50:36.081219-03	t suco copo limao siciliano	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2613	1899	T Suco COPO	Caju	13	8	t	2026-11-02 11:50:36.081219-03	t suco copo caju	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2619	1901	T Chivas Regal 12 anos	Dose	22	8	t	2026-11-02 11:50:36.081219-03	t chivas regal 12 anos dose	Whisky	999	f	f	\N	\N	\N	f	f
2622	1902	T Chivas Regal 18 anos	Garrafa	590	8	t	2026-11-02 11:50:36.081219-03	t chivas regal 18 anos garrafa	Whisky	999	f	f	\N	\N	\N	f	f
2624	1903	T Jhonnie walker blue label	Garrafa	1900	8	t	2026-11-02 11:50:36.081219-03	t jhonnie walker blue label garrafa	Whisky	999	f	f	\N	\N	\N	f	f
2628	1905	T Absolut	Garrafa	199	8	f	2026-11-02 11:50:36.081219-03	t absolut garrafa	Vodka	999	f	f	\N	\N	\N	f	f
2663	1936	T Vinho Tinto Tarapaca Leon Syrah	\N	130	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto tarapaca leon syrah 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2654	1928	T Eisenbahn long Neck	\N	8	8	t	2026-11-02 11:50:36.081219-03	t eisenbahn long neck 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2655	1929	T Fitzgerald	\N	35	8	t	2026-11-02 11:50:36.081219-03	t fitzgerald 	Terraco Bebidas	999	f	f	Gin, Limão siciliano e angostura	\N	\N	f	f
2697	1966	Robalo ao creme de castanha e queijo	\N	110	1	t	2026-11-02 11:50:36.081219-03	robalo ao creme de castanha e queijo 	Pratos	999	f	t	Robalo ao creme de castanha e queijo acompanhado de banana da terra	\N	\N	f	f
2659	1933	Ypioca Ouro- Destilado	Dose	9	4	t	2026-11-02 11:50:36.081219-03	ypioca ouro- destilado dose	Cachaça	999	f	t	\N	\N	\N	f	f
2660	1933	Ypioca Ouro- Destilado	Garrafa	90	4	t	2026-11-02 11:50:36.081219-03	ypioca ouro- destilado garrafa	Cachaça	999	f	t	\N	\N	\N	f	f
2662	1935	Vinho Tinto Tarapaca Leon Syrah	\N	130	2	t	2026-11-02 11:50:36.081219-03	vinho tinto tarapaca leon syrah 	Vinho	999	f	t	\N	\N	\N	f	f
2666	1939	T Vinho Tinto PLaureano Classico MEIA GARRAFA	\N	59	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto plaureano classico meia garrafa 	Vinho	999	f	f	\N	\N	\N	f	f
2677	1947	Champagne Jules Pierlot Brut	\N	580	2	t	2026-11-02 11:50:36.081219-03	champagne jules pierlot brut 	Espumante	999	f	t	\N	\N	\N	f	f
2695	1964	Coxa de frango recheada	\N	65	1	t	2026-11-02 11:50:36.081219-03	coxa de frango recheada 	Pratos	999	t	t	Coxa de frango recheada com cogumelos e rucula servida com pure de batata e caldo de frango artesanal	\N	-8	f	f
2710	1971	Vinho Tinto Santa Helena Reservado Cabernet Sauvignon	\N	89	2	t	2026-11-02 11:50:36.081219-03	vinho tinto santa helena reservado cabernet sauvignon 	Vinho	999	f	t	\N	\N	\N	f	f
2712	1972	SAKE DOURADO	Garrafa	280	4	f	2026-11-02 11:50:36.081219-03	sake dourado garrafa	Cachaça	999	f	f	\N	\N	\N	f	f
2738	1976	T Vinho Tinto Amadeo Cabernet Sauvignon	\N	119	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto amadeo cabernet sauvignon 	Vinho	999	f	f	\N	\N	\N	f	f
2739	1977	Vinho Tinto Amadeo Cabernet Sauvignon	\N	119	2	t	2026-11-02 11:50:36.081219-03	vinho tinto amadeo cabernet sauvignon 	Vinho	999	f	t	\N	\N	\N	f	f
2741	1979	Vinho Tinto Condor Cabernet Sauvignon	\N	112	2	t	2026-11-02 11:50:36.081219-03	vinho tinto condor cabernet sauvignon 	Vinho	999	f	t	\N	\N	\N	f	f
2742	1980	T Vinho Tinto Condor Cabernet Sauvignon	\N	112	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto condor cabernet sauvignon 	Vinho	999	f	f	\N	\N	\N	f	f
2744	1982	Vinho Tinto Don Luciano reserva	\N	109	2	t	2026-11-02 11:50:36.081219-03	vinho tinto don luciano reserva 	Vinho	999	f	t	\N	\N	\N	f	f
2745	1983	T Vinho Tinto Don Luciano reserva	\N	109	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto don luciano reserva 	Vinho	999	f	f	\N	\N	\N	f	f
2750	1988	Vinho Tinto Primitivo IGP	\N	182	2	t	2026-11-02 11:50:36.081219-03	vinho tinto primitivo igp 	Vinho	999	f	t	\N	\N	\N	f	f
2751	1989	T Vinho Tinto Primitivo IGP	\N	182	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto primitivo igp 	Vinho	999	f	f	\N	\N	\N	f	f
2763	1999	T Vinho Branco BONS VENTOS 2024	\N	89	8	t	2026-11-02 11:50:36.081219-03	t vinho branco bons ventos 2024 	Vinho	999	f	f	\N	\N	\N	f	f
2779	2014	Picanha do Sertão na chapa 250 gramas (conuslta)	\N	80	1	t	2026-11-02 11:50:36.081219-03	picanha do sertao na chapa 250 gramas (conuslta) 	Parrilha ( Na Brasa )	999	f	t	Picanha de novilho (nelore)especial do sertão, acompanhada por farofa amanteigada, cebola caramelizada, vinagrete e uma guarnição à sua escolha. Uma combinação irresistível de sabores e texturas para uma experiência gastronômica verdadeiramente deliciosa.	\N	\N	f	f
2773	2008	Moqueca de Lagosta	2 pessoas	240	1	t	2026-11-02 11:50:36.081219-03	moqueca de lagosta 2 pessoas	Moquecas	999	f	t	Deliciosa moqueca sergipana de lagosta  no coco com legumes frescos, acompanhado de arroz branco, farofa especial da casa, vinagrete bem picadinho e um maravilhoso pirão. ---- English ---- \r\nDelightful Sergipe-style Moqueca featuring lobster and zero shrimp from Santa Catarina cooked in coconut milk with fresh vegetables. Served alongside white rice, the house's special farofa, finely chopped vinaigrette, and a delightful pirão.	\N	\N	f	f
2765	2001	Vinho Tinto BONS VENTOS 2023	\N	99	2	t	2026-11-02 11:50:36.081219-03	vinho tinto bons ventos 2023 	Vinho	999	f	t	\N	\N	\N	f	f
2747	1985	Vinho Tinto Izadi Larrosa	\N	235	2	t	2026-11-02 11:50:36.081219-03	vinho tinto izadi larrosa 	Vinho	999	f	t	\N	\N	\N	f	f
2748	1986	T Vinho Tinto Izadi Larrosa 750ml	\N	235	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto izadi larrosa 750ml 	Vinho	999	f	f	\N	\N	\N	f	f
2783	2018	Licor Sheridan	Garrafa	350	4	t	2026-11-02 11:50:36.081219-03	licor sheridan garrafa	Licor.	999	f	t	\N	\N	\N	f	f
2766	2002	T Vinho Tinto BONS VENTOS 2023	\N	99	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto bons ventos 2023 	Vinho	999	f	f	\N	\N	\N	f	f
2762	1998	Vinho branco BONS VENTOS 2024	\N	89	2	t	2026-11-02 11:50:36.081219-03	vinho branco bons ventos 2024 	Vinho	999	f	t	\N	\N	\N	f	f
2768	2004	Espumante FREIXENET BRUT ROSE	\N	159	2	t	2026-11-02 11:50:36.081219-03	espumante freixenet brut rose 	Espumante	999	f	t	\N	\N	\N	f	f
2769	2005	T Espumante FREIXENET BRUT ROSE	\N	159	8	t	2026-11-02 11:50:36.081219-03	t espumante freixenet brut rose 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2772	2008	Moqueca de Lagosta	1 pessoas	150	1	t	2026-11-02 11:50:36.081219-03	moqueca de lagosta 1 pessoas	Moquecas	999	f	t	Deliciosa moqueca sergipana de lagosta  no coco com legumes frescos, acompanhado de arroz branco, farofa especial da casa, vinagrete bem picadinho e um maravilhoso pirão. ---- English ---- \r\nDelightful Sergipe-style Moqueca featuring lobster and zero shrimp from Santa Catarina cooked in coconut milk with fresh vegetables. Served alongside white rice, the house's special farofa, finely chopped vinaigrette, and a delightful pirão.	\N	\N	f	f
60	44	Heineken LONG NECK 330 ML	\N	16	2	t	2026-11-02 11:50:36.081219-03	heineken long neck 330 ml 	Cerveja	999	f	t	\N	\N	\N	f	f
64	48	Coca cola Lata	\N	10	2	t	2026-11-02 11:50:36.081219-03	coca cola lata 	Bebida não alcoolica	999	f	f	\N	\N	\N	f	f
65	49	Guarana Lata	\N	10	2	t	2026-11-02 11:50:36.081219-03	guarana lata 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
54	38	File com fritas	\N	65	3	t	2026-11-02 11:50:36.081219-03	file com fritas 	Petiscos	999	f	t	Suculento filé grelhado acompanhado de batatas douradas e crocantes.	\N	\N	f	f
62	46	Stella Artois Long Neck	\N	16	2	t	2026-11-02 11:50:36.081219-03	stella artois long neck 	Cerveja	999	f	t	\N	\N	\N	f	f
2784	2018	Licor Sheridan	Dose	25	4	t	2026-11-02 11:50:36.081219-03	licor sheridan dose	Licor.	999	f	t	\N	\N	\N	f	f
1	1	Gorjeta	\N	1	\N	t	2026-11-02 11:50:36.081219-03	gorjeta 	Serviço	999	f	t	\N	\N	\N	f	f
2	2	Gorjeta excedente	\N	1	\N	t	2026-11-02 11:50:36.081219-03	gorjeta excedente 	Serviço	999	f	t	\N	\N	\N	f	f
75	59	Caldinho de bacalhau	\N	27	3	t	2026-11-02 11:50:36.081219-03	caldinho de bacalhau 	Petiscos	999	f	t	Cremoso e leve, com o sabor marcante do mar em cada colherada.	\N	\N	f	f
1006	633	Licor Frangelico	Dose	18	4	t	2026-11-02 11:50:36.081219-03	licor frangelico dose	Licor.	999	f	t	\N	\N	\N	f	f
104	87	Arroz branco	\N	9	1	t	2026-11-02 11:50:36.081219-03	arroz branco 	Acompanhamentos	999	f	t	\N	\N	\N	f	f
67	51	Schweppes Citrus Lata	\N	10	2	t	2026-11-02 11:50:36.081219-03	schweppes citrus lata 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
74	58	Caldinho de camarao	\N	31	3	t	2026-11-02 11:50:36.081219-03	caldinho de camarao 	Petiscos	999	f	t	Cremoso e cheio de sabor, com camarões e toque de tempero da casa.	\N	\N	f	f
94	77	Red Bull	\N	23	2	t	2026-11-02 11:50:36.081219-03	red bull 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
113	94	Vodka Importada	Laranja	26	4	t	2026-11-02 11:50:36.081219-03	vodka importada laranja	Drink	999	f	t	\N	\N	\N	f	f
79	63	Catado de Aratu	\N	49	3	t	2026-11-02 11:50:36.081219-03	catado de aratu 	Petiscos	999	t	t	Catado de aratu refogado e crocante na farinha panko.	\N	-4	f	f
87	71	Old Parr	Dose	29	4	t	2026-11-02 11:50:36.081219-03	old parr dose	Whisky	999	f	t	\N	\N	\N	f	f
89	72	Camarao Paris no panko e molho especial dijon	\N	138	1	t	2026-11-02 11:50:36.081219-03	camarao paris no panko e molho especial dijon 	Petiscos	999	f	t	Camarao VG crocante empanado em farinha Panko, servido com molho especial de creme de leite fresco, cogumelo paris e mostarda dijon.	\N	\N	f	f
69	53	Agua de coco JARRA	\N	19	2	t	2026-11-02 11:50:36.081219-03	agua de coco jarra 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
88	71	Old Parr	Garrafa	360	4	t	2026-11-02 11:50:36.081219-03	old parr garrafa	Whisky	999	f	t	\N	\N	\N	f	f
68	52	Agua de coco COPO	\N	10	2	t	2026-11-02 11:50:36.081219-03	agua de coco copo 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
1007	633	Licor Frangelico	Garrafa	250	4	t	2026-11-02 11:50:36.081219-03	licor frangelico garrafa	Licor.	999	f	t	\N	\N	\N	f	f
119	95	Com Leite	\N	2	\N	t	2026-11-02 11:50:36.081219-03	com leite 	Complemento	999	f	t	\N	\N	\N	f	f
115	94	Vodka Importada	Maracujá	30	4	t	2026-11-02 11:50:36.081219-03	vodka importada maracuja	Drink	999	f	t	\N	\N	\N	f	f
116	94	Vodka Importada	Tangerina	30	4	t	2026-11-02 11:50:36.081219-03	vodka importada tangerina	Drink	999	f	t	\N	\N	\N	f	f
464	333	cachaça	Caju	25	2	t	2026-11-02 11:50:36.081219-03	cachaca caju	Drink	999	f	t	\N	\N	\N	f	f
832	507	Ypioca Envelhecida 150	Garrafa	150	4	f	2026-11-02 11:50:36.081219-03	ypioca envelhecida 150 garrafa	Cachaça	999	f	f	\N	\N	\N	f	f
1171	776	T Cafe Expresso	Arpeggio	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso arpeggio	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1176	776	T Cafe Expresso	Roma	18	8	t	2026-11-02 11:50:36.081219-03	t cafe expresso roma	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1345	810	T Belvedere destilado	Garrafa	350	8	t	2026-11-02 11:50:36.081219-03	t belvedere destilado garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1346	810	T Belvedere destilado	Dose	30	8	t	2026-11-02 11:50:36.081219-03	t belvedere destilado dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1347	811	T STOLICHNAYA - Destilado	Dose	35	8	t	2026-11-02 11:50:36.081219-03	t stolichnaya - destilado dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1348	811	T STOLICHNAYA - Destilado	Garrafa	350	8	t	2026-11-02 11:50:36.081219-03	t stolichnaya - destilado garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1349	812	T stolichnaya Gluten Free	Dose	30	8	t	2026-11-02 11:50:36.081219-03	t stolichnaya gluten free dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1350	812	T stolichnaya Gluten Free	Garrafa	350	8	t	2026-11-02 11:50:36.081219-03	t stolichnaya gluten free garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1357	816	T Bulldog Gin - Destilado	Dose	30	8	t	2026-11-02 11:50:36.081219-03	t bulldog gin - destilado dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1533	777	T Vodka Nacional	MANGA	25	8	t	2026-11-02 11:50:36.081219-03	t vodka nacional manga	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1358	816	T Bulldog Gin - Destilado	Garrafa	280	8	t	2026-11-02 11:50:36.081219-03	t bulldog gin - destilado garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1361	818	T Gin Hendricks - Destilado	Dose	30	8	t	2026-11-02 11:50:36.081219-03	t gin hendricks - destilado dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1362	818	T Gin Hendricks - Destilado	Garrafa	360	8	t	2026-11-02 11:50:36.081219-03	t gin hendricks - destilado garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1364	820	T Stella Artois Long Neck	\N	12	8	t	2026-11-02 11:50:36.081219-03	t stella artois long neck 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1365	821	T Johnnie Red Label	Dose	20	8	t	2026-11-02 11:50:36.081219-03	t johnnie red label dose	Whisky	999	f	f	\N	\N	\N	f	f
1366	821	T Johnnie Red Label	Garrafa	200	8	t	2026-11-02 11:50:36.081219-03	t johnnie red label garrafa	Whisky	999	f	f	\N	\N	\N	f	f
1367	822	T Licor Dom Luiz	Dose	18	8	t	2026-11-02 11:50:36.081219-03	t licor dom luiz dose	Licor.	999	f	f	\N	\N	\N	f	f
1368	822	T Licor Dom Luiz	Garrafa	130	8	t	2026-11-02 11:50:36.081219-03	t licor dom luiz garrafa	Licor.	999	f	f	\N	\N	\N	f	f
1353	814	T Ciroc - Destilado	Dose	25	8	t	2026-11-02 11:50:36.081219-03	t ciroc - destilado dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1363	819	T Heineken LONG NECK	\N	16	8	t	2026-11-02 11:50:36.081219-03	t heineken long neck 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1351	813	T Smirnoff - Destilado	Dose	15	8	t	2026-11-02 11:50:36.081219-03	t smirnoff - destilado dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1356	815	T Gin Tanqueray - Destilado	Garrafa	260	8	t	2026-11-02 11:50:36.081219-03	t gin tanqueray - destilado garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1355	815	T Gin Tanqueray - Destilado	Dose	25	8	t	2026-11-02 11:50:36.081219-03	t gin tanqueray - destilado dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1354	814	T Ciroc - Destilado	Garrafa	300	8	t	2026-11-02 11:50:36.081219-03	t ciroc - destilado garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1360	817	T Gin Beefeater - Destilado	Garrafa	260	8	t	2026-11-02 11:50:36.081219-03	t gin beefeater - destilado garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1343	809	T Grey Goose - Destilado	Dose	25	8	t	2026-11-02 11:50:36.081219-03	t grey goose - destilado dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1359	817	T Gin Beefeater - Destilado	Dose	25	8	t	2026-11-02 11:50:36.081219-03	t gin beefeater - destilado dose	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1378	832	Johnnie Walker Double Black	Dose	35	4	t	2026-11-02 11:50:36.081219-03	johnnie walker double black dose	Whisky	999	f	t	\N	\N	\N	f	f
1379	832	Johnnie Walker Double Black	Garrafa	430	4	t	2026-11-02 11:50:36.081219-03	johnnie walker double black garrafa	Whisky	999	f	f	\N	\N	\N	f	f
1835	1206	T Vinho Branco Cartuxa Pera Manca	\N	800	8	t	2026-11-02 11:50:36.081219-03	t vinho branco cartuxa pera manca 	Vinho	999	f	f	\N	\N	\N	f	f
1883	1253	T Licor Bailey's	Garrafa	270	8	t	2026-11-02 11:50:36.081219-03	t licor bailey's garrafa	Licor.	999	f	f	\N	\N	\N	f	f
2287	1619	Mocha Gelada	\N	24	4	t	2026-11-02 11:50:36.081219-03	mocha gelada 	Cafes	999	f	t	Café especial batido com sorvete de creme, bordas de avela e chantilly especial	\N	\N	f	f
110	93	Caldinho de sururu	\N	26	3	t	2026-11-02 11:50:36.081219-03	caldinho de sururu 	Petiscos	999	t	t	Receita tradicional com o toque do Prainha: sururu bem temperado e caldo quentinho	\N	-65	f	f
281	196	Bolinho de Bacalhau Portugues 8un	\N	59	3	t	2026-11-02 11:50:36.081219-03	bolinho de bacalhau portugues 8un 	Petiscos	999	f	t	Bolinhos crocantes de bacalhau acompanhados por molhos especiais: limão siciliano, rosé ou gorgonzola.	\N	\N	f	f
2228	1565	Johnnie Walker Blonde	Dose	20	4	t	2026-11-02 11:50:36.081219-03	johnnie walker blonde dose	Whisky	999	f	t	\N	\N	\N	f	f
2217	1554	Agua Cristal COM gas 500 ml	\N	10	2	t	2026-11-02 11:50:36.081219-03	agua cristal com gas 500 ml 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
2233	1568	Seleta Prata - Destilado	Dose	8	4	t	2026-11-02 11:50:36.081219-03	seleta prata - destilado dose	Cachaça	999	f	t	\N	\N	\N	f	f
191	119	Eisenbahn 600 ml	\N	20	2	t	2026-11-02 11:50:36.081219-03	eisenbahn 600 ml 	Cerveja	999	t	t	\N	\N	-93	f	f
1024	645	Sorvete Frutilly Morango	\N	15	4	t	2026-11-02 11:50:36.081219-03	sorvete frutilly morango 	Sorvetes	999	t	t	\N	\N	-38	f	f
445	318	Manga	\N	2	\N	t	2026-11-02 11:50:36.081219-03	manga 	Complemento	999	f	t	\N	\N	\N	f	f
2797	2031	Vinho do Porto dom jose	Dose	30	2	t	2026-11-02 11:50:36.081219-03	vinho do porto dom jose dose	Vinho	999	f	t	\N	\N	\N	f	f
2798	2031	Vinho do Porto dom jose	Garrafa	35	2	t	2026-11-02 11:50:36.081219-03	vinho do porto dom jose garrafa	Vinho	999	f	f	\N	\N	\N	f	f
2803	2036	Stella Artois Pure Gold 600 ml	\N	24	2	t	2026-11-02 11:50:36.081219-03	stella artois pure gold 600 ml 	Cerveja	999	f	t	\N	\N	87	f	f
2018	1379	Salada de Polvo	\N	89	3	t	2026-11-02 11:50:36.081219-03	salada de polvo 	Pratos	999	f	t	Salada refrescante de polvo grelhado, combinando folhas verdes frescas, tomate cereja suculento e tangerina cítrica, proporcionando uma explosão de sabores e texturas em cada garfada. ---- English ---- Refreshing salad featuring grilled octopus, crisp green leaves, juicy cherry tomatoes, and citrusy tangerine, delivering a burst of flavors and textures with every bite.	\N	\N	f	f
111	94	Vodka Importada	Abacaxi	30	4	t	2026-11-02 11:50:36.081219-03	vodka importada abacaxi	Drink	999	f	t	\N	\N	\N	f	f
114	94	Vodka Importada	Limão	28	4	t	2026-11-02 11:50:36.081219-03	vodka importada limao	Drink	999	f	t	\N	\N	\N	f	f
2171	1516	SEM alcool	Morango	24	4	t	2026-11-02 11:50:36.081219-03	sem alcool morango	Drink	999	f	t	\N	\N	\N	f	f
251	97	Vodka Nacional	Caju	29	4	t	2026-11-02 11:50:36.081219-03	vodka nacional caju	Drink	999	f	t	\N	\N	\N	f	f
252	97	Vodka Nacional	Uva	27	4	t	2026-11-02 11:50:36.081219-03	vodka nacional uva	Drink	999	f	t	\N	\N	\N	f	f
345	242	Corona extra Long Neck	\N	16	2	t	2026-11-02 11:50:36.081219-03	corona extra long neck 	Cerveja	999	f	t	\N	\N	\N	f	f
253	94	Vodka Importada	Caju	30	4	t	2026-11-02 11:50:36.081219-03	vodka importada caju	Drink	999	f	t	\N	\N	\N	f	f
210	97	Vodka Nacional	\N	25	4	t	2026-11-02 11:50:36.081219-03	vodka nacional 	Drink	999	f	t	\N	\N	\N	f	f
1767	1138	Fys Laranja Pera	\N	10	2	t	2026-11-02 11:50:36.081219-03	fys laranja pera 	Bebida não alcoolica	999	f	t	\N	\N	20	f	f
1792	1163	Fys Tonica Zero	\N	10	2	t	2026-11-02 11:50:36.081219-03	fys tonica zero 	Bebida não alcoolica	999	f	t	\N	\N	27	f	f
53	37	Heineken 600ml	\N	24	2	t	2026-11-02 11:50:36.081219-03	heineken 600ml 	Cerveja	999	t	t	\N	\N	-166	f	f
85	69	Coca-cola Zero Lata	\N	10	2	t	2026-11-02 11:50:36.081219-03	coca-cola zero lata 	Bebida não alcoolica	999	f	f	\N	\N	\N	f	f
1317	801	T Licor 43	Garrafa	250	8	t	2026-11-02 11:50:36.081219-03	t licor 43 garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
921	575	Heineken Zero 0.0  Long Neck	\N	15	2	t	2026-11-02 11:50:36.081219-03	heineken zero 0.0  long neck 	Cerveja	999	f	t	\N	\N	\N	f	f
1036	657	Sorvete Chicabon	\N	15	4	t	2026-11-02 11:50:36.081219-03	sorvete chicabon 	Sorvetes	999	t	t	\N	\N	-31	f	f
2805	2038	Prato redondo 20 cm Melanina Azul	\N	20	\N	f	2026-11-02 11:50:36.081219-03	prato redondo 20 cm melanina azul 	Souvenir	999	t	f	\N	\N	0	f	f
2582	1880	Sorvete Tablito 3 Chocolate	\N	18	4	t	2026-11-02 11:50:36.081219-03	sorvete tablito 3 chocolate 	Sorvetes	999	t	t	\N	\N	0	f	f
867	535	Sorvete de creme	\N	15	3	t	2026-11-02 11:50:36.081219-03	sorvete de creme 	Sobremesa	999	t	f	\N	\N	-11	f	f
1573	982	Agua Indaia COM gas 500 ml	\N	10	2	t	2026-11-02 11:50:36.081219-03	agua indaia com gas 500 ml 	Bebida não alcoolica	999	t	f	\N	\N	-6	f	f
2806	2039	Prato redondo 25,5 cm Melanina Branco	\N	20	\N	f	2026-11-02 11:50:36.081219-03	prato redondo 25,5 cm melanina branco 	utensílios	999	t	f	\N	\N	0	f	f
2807	2040	Prato redondoSobremesa 18 cm Melanina	\N	20	\N	f	2026-11-02 11:50:36.081219-03	prato redondosobremesa 18 cm melanina 	utensílios	999	t	f	\N	\N	0	f	f
1352	813	T Smirnoff - Destilado	Garrafa	110	8	t	2026-11-02 11:50:36.081219-03	t smirnoff - destilado garrafa	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1460	911	Stella Artois Sem Gluten Long Neck	\N	15	2	t	2026-11-02 11:50:36.081219-03	stella artois sem gluten long neck 	Cerveja	999	f	t	\N	\N	\N	f	f
190	118	Stella Artois 600 ml	\N	24	2	t	2026-11-02 11:50:36.081219-03	stella artois 600 ml 	Cerveja	999	t	t	\N	\N	-12	f	f
1711	1084	T Moscow Mule	\N	30	8	t	2026-11-02 11:50:36.081219-03	t moscow mule 	Terraco Bebidas	999	f	f	Vodka, Limão e espuma de gengibre.	\N	\N	f	f
1455	906	Budweiser 600ML	\N	21	2	t	2026-11-02 11:50:36.081219-03	budweiser 600ml 	Cerveja	999	t	t	\N	\N	-89	f	f
156	102	SUCOS COPO	Maracujá	12	4	t	2026-11-02 11:50:36.081219-03	sucos copo maracuja	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
93	76	Caranguejo	\N	14	1	t	2026-11-02 11:50:36.081219-03	caranguejo 	Petiscos	999	t	t	Caranguejo acompanhado com vinagrete	\N	-368	f	f
157	102	SUCOS COPO	Morango	16	4	t	2026-11-02 11:50:36.081219-03	sucos copo morango	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
351	248	Coca cola KS 290ml	\N	10	2	t	2026-11-02 11:50:36.081219-03	coca cola ks 290ml 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
2782	2017	Praya lager Long Neck	\N	14	2	t	2026-11-02 11:50:36.081219-03	praya lager long neck 	Cerveja	999	f	t	\N	\N	\N	f	f
1055	673	Coca cola Sem Acucar KS 290ml	\N	10	2	t	2026-11-02 11:50:36.081219-03	coca cola sem acucar ks 290ml 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
159	102	SUCOS COPO	Tangerina	12	4	t	2026-11-02 11:50:36.081219-03	sucos copo tangerina	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
2212	1549	Agua cristal SEM gas 500 ml	\N	10	2	t	2026-11-02 11:50:36.081219-03	agua cristal sem gas 500 ml 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
2812	2045	Mini Risoto de Camarao	\N	12	3	t	2026-11-02 11:50:36.081219-03	mini risoto de camarao 	Petiscos	999	f	f	\N	\N	\N	f	f
2813	2046	Mini Risoto de File	\N	11	\N	t	2026-11-02 11:50:36.081219-03	mini risoto de file 	Petiscos	999	f	f	\N	\N	\N	f	f
2814	2047	Mini Risoto de Costela	\N	11	3	t	2026-11-02 11:50:36.081219-03	mini risoto de costela 	Petiscos	999	f	f	\N	\N	\N	f	f
283	198	Sprite Lata	\N	10	2	t	2026-11-02 11:50:36.081219-03	sprite lata 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
1047	667	Sorvete Cornetto Chocomix	\N	17	4	t	2026-11-02 11:50:36.081219-03	sorvete cornetto chocomix 	Sorvetes	999	t	t	\N	\N	-16	f	f
2821	2054	TERRAÇO ( OCUPAÇAO)	\N	300	\N	t	2026-11-02 11:50:36.081219-03	terraco ( ocupacao) 	Couvert	999	f	f	\N	\N	\N	f	f
2809	2042	MAGNUM BOMBOM COOKIES	\N	24	2	t	2026-11-02 11:50:36.081219-03	magnum bombom cookies 	Sorvetes	999	f	t	\N	\N	\N	f	f
2808	2041	Vinho Tinto CHAC CHAC MALBEC	\N	220	2	t	2026-11-02 11:50:36.081219-03	vinho tinto chac chac malbec 	Vinho	999	f	t	\N	\N	\N	f	f
724	429	Moqueca de lagosta e camarao VG	1 pessoas	160	1	t	2026-11-02 11:50:36.081219-03	moqueca de lagosta e camarao vg 1 pessoas	Moquecas	999	f	t	Deliciosa moqueca sergipana de lagosta e camarão zero de Santa Catarina no coco com legumes frescos, acompanhado de arroz branco, farofa especial da casa, vinagrete bem picadinho e um maravilhoso pirão. ---- English ---- \r\nDelightful Sergipe-style Moqueca featuring lobster and zero shrimp from Santa Catarina cooked in coconut milk with fresh vegetables. Served alongside white rice, the house's special farofa, finely chopped vinaigrette, and a delightful pirão.	\N	\N	f	f
2234	1568	Seleta Prata - Destilado	Garrafa	90	4	t	2026-11-02 11:50:36.081219-03	seleta prata - destilado garrafa	Cachaça	999	f	t	\N	\N	\N	f	f
2239	1573	T VINHO TINTO CALYPTRA PRESTIGE	\N	280	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto calyptra prestige 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2240	1574	T VINHO TINTO ALMA VIVA EPU	\N	980	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto alma viva epu 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
444	317	Laranja	\N	2	\N	t	2026-11-02 11:50:36.081219-03	laranja 	Complemento	999	f	t	\N	\N	\N	f	f
609	390	catchup sache	\N	1	\N	t	2026-11-02 11:50:36.081219-03	catchup sache 	Complemento	999	f	t	\N	\N	\N	f	f
610	391	Maioinese sache	\N	1	\N	t	2026-11-02 11:50:36.081219-03	maioinese sache 	Complemento	999	f	t	\N	\N	\N	f	f
447	320	Limão Siciliano	\N	2	\N	t	2026-11-02 11:50:36.081219-03	limao siciliano 	Complemento	999	f	t	\N	\N	\N	f	f
454	327	Conhaque Domecq	\N	9	4	t	2026-11-02 11:50:36.081219-03	conhaque domecq 	Conhaque	999	f	f	\N	\N	\N	f	f
456	328	Moscow Mule	\N	30	4	t	2026-11-02 11:50:36.081219-03	moscow mule 	Drink	999	f	t	Vodka, Limão e espuma de gengibre.	\N	\N	f	f
459	101	SUCOS JARRA	Limão Siciliano	25	4	t	2026-11-02 11:50:36.081219-03	sucos jarra limao siciliano	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
439	312	H2OH LIMONETO com gas	\N	11	2	t	2026-11-02 11:50:36.081219-03	h2oh limoneto com gas 	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
455	102	SUCOS COPO	Limão Siciliano	15	4	t	2026-11-02 11:50:36.081219-03	sucos copo limao siciliano	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
440	313	Coquetel de frutas SEM alcool	\N	29	4	t	2026-11-02 11:50:36.081219-03	coquetel de frutas sem alcool 	Drink	999	f	t	Agua de coco, frutas vermelhas, leite consensado e calda de chocolate	\N	\N	f	f
277	192	Vinagrete	\N	5	\N	t	2026-11-02 11:50:36.081219-03	vinagrete 	Complemento	999	f	t	\N	\N	\N	f	f
467	333	cachaça	Laranja	23	2	t	2026-11-02 11:50:36.081219-03	cachaca laranja	Drink	999	f	t	\N	\N	\N	f	f
469	333	cachaça	Maracujá	24	2	t	2026-11-02 11:50:36.081219-03	cachaca maracuja	Drink	999	f	t	\N	\N	\N	f	f
132	97	Vodka Nacional	Maracujá	27	4	t	2026-11-02 11:50:36.081219-03	vodka nacional maracuja	Drink	999	f	t	\N	\N	\N	f	f
465	333	cachaça	\N	25	2	t	2026-11-02 11:50:36.081219-03	cachaca 	Drink	999	f	t	\N	\N	\N	f	f
138	99	pastel	Aratu	19	3	t	2026-11-02 11:50:36.081219-03	pastel aratu	Petiscos	999	f	t	Pastel grande crocante com recheio a sua escolha.	\N	\N	f	f
466	333	cachaça	Kiwi	23	2	t	2026-11-02 11:50:36.081219-03	cachaca kiwi	Drink	999	f	t	\N	\N	\N	f	f
279	194	Molho especial Shitaque Shimeji	\N	15	\N	t	2026-11-02 11:50:36.081219-03	molho especial shitaque shimeji 	Complemento	999	f	t	\N	\N	\N	f	f
137	98	Peixe Inteiro frito	Vermelha	165	1	t	2026-11-02 11:50:36.081219-03	peixe inteiro frito vermelha	Pratos	999	f	t	Peixe fresco, tradicionalmente temperado e frito por imersão, servido com arroz branco, farofa molhadinha e vinagrete. ---- English ---- Fresh fish, traditionally seasoned and deep-fried, served with white rice, moistened farofa, and vinaigrette.	\N	\N	f	f
468	333	cachaça	Limão	29	2	t	2026-11-02 11:50:36.081219-03	cachaca limao	Drink	999	f	t	\N	\N	\N	f	f
278	193	Molho Especial Paris	\N	15	\N	t	2026-11-02 11:50:36.081219-03	molho especial paris 	Complemento	999	f	t	\N	\N	\N	f	f
448	321	Acerola	\N	2	\N	t	2026-11-02 11:50:36.081219-03	acerola 	Complemento	999	f	t	\N	\N	\N	f	f
134	97	Vodka Nacional	Morango	29	4	t	2026-11-02 11:50:36.081219-03	vodka nacional morango	Drink	999	f	t	\N	\N	\N	f	f
131	97	Vodka Nacional	Limão	25	4	t	2026-11-02 11:50:36.081219-03	vodka nacional limao	Drink	999	f	t	\N	\N	\N	f	f
133	97	Vodka Nacional	Tangerina	27	4	t	2026-11-02 11:50:36.081219-03	vodka nacional tangerina	Drink	999	f	t	\N	\N	\N	f	f
117	94	Vodka Importada	Morango	34	4	t	2026-11-02 11:50:36.081219-03	vodka importada morango	Drink	999	f	t	\N	\N	\N	f	f
449	322	Kiwi	\N	2	\N	t	2026-11-02 11:50:36.081219-03	kiwi 	Complemento	999	f	t	\N	\N	\N	f	f
282	197	Prato Kids	\N	54	3	t	2026-11-02 11:50:36.081219-03	prato kids 	Pratos	999	f	t	Um prato pensado para os pequenos: carne ou frango grelhado, acompanhado de duas opções à escolha	\N	\N	f	f
192	120	Espumante Casa Perini Brut	\N	135	2	t	2026-11-02 11:50:36.081219-03	espumante casa perini brut 	Espumante	999	f	t	\N	\N	\N	f	f
1426	879	Torta Italiana	\N	22	1	t	2026-11-02 11:50:36.081219-03	torta italiana 	Sobremesa	999	f	t	\N	\N	\N	f	f
176	105	Molho Rosé	\N	7	\N	t	2026-11-02 11:50:36.081219-03	molho rose 	Complemento	999	f	t	\N	\N	\N	f	f
393	289	smirnoff	Dose	20	4	f	2026-11-02 11:50:36.081219-03	smirnoff dose	Vodka	999	f	f	\N	\N	\N	f	f
948	591	Bulldog Gin - Destilado	Garrafa	280	4	t	2026-11-02 11:50:36.081219-03	bulldog gin - destilado garrafa	Gin	999	f	f	\N	\N	\N	f	f
1095	702	Vinho Tinto Cartuxa EA	\N	140	2	t	2026-11-02 11:50:36.081219-03	vinho tinto cartuxa ea 	Vinho	999	f	t	\N	\N	\N	f	f
1639	1044	blue label	\N	140	8	t	2026-11-02 11:50:36.081219-03	blue label 	Whisky	999	f	f	\N	\N	\N	f	f
2360	1691	T Vinho Tinto La Tour de Fontes	\N	219	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto la tour de fontes 	Vinho	999	f	f	\N	\N	\N	f	f
1899	1267	T Moet & Chandon	\N	800	8	t	2026-11-02 11:50:36.081219-03	t moet & chandon 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
1907	1275	T Espumante Rio Sol Brut	\N	120	8	t	2026-11-02 11:50:36.081219-03	t espumante rio sol brut 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2585	1883	T Vinho Tinto Finca Amadeo Malbec	\N	99	8	t	2026-11-02 11:50:36.081219-03	t vinho tinto finca amadeo malbec 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2587	1885	Pure de Banana da Terra	\N	15	\N	t	2026-11-02 11:50:36.081219-03	pure de banana da terra 	Complemento	999	f	t	\N	\N	\N	f	f
2711	1972	SAKE DOURADO	Dose	20	4	t	2026-11-02 11:50:36.081219-03	sake dourado dose	Cachaça	999	f	t	\N	\N	\N	f	f
1719	1091	T Couvert Terraço	\N	20	\N	t	2026-11-02 11:50:36.081219-03	t couvert terraco 	Couvert	999	f	f	\N	\N	\N	f	f
2461	1788	T Espumante Casa Valduga Brut rose	\N	149	8	t	2026-11-02 11:50:36.081219-03	t espumante casa valduga brut rose 	Terraco Bebidas	999	f	f	\N	\N	\N	f	f
2507	1829	T SEM alcool	Kiwi	22	8	t	2026-11-02 11:50:36.081219-03	t sem alcool kiwi	Drink	999	f	f	\N	\N	\N	f	f
1752	1123	Amstel 600ml	\N	21	2	t	2026-11-02 11:50:36.081219-03	amstel 600ml 	Cerveja	999	t	t	\N	\N	-65	f	f
149	101	SUCOS JARRA	Morango	25	4	t	2026-11-02 11:50:36.081219-03	sucos jarra morango	Bebida não alcoolica	999	f	t	\N	\N	\N	f	f
1755	1126	File a Parmigiano	\N	79	1	t	2026-11-02 11:50:36.081219-03	file a parmigiano 	Pratos	999	t	t	Bife de lâmina do filé super macio, empanado e crocante, coberto com molho pomodoro fresco e gratinado com queijo. Escolha entre purê de batatas cremoso ou fettuccine ao pomodoro para acompanhar esta delícia.\r\n ---- English ---- Super tender blade steak breaded and crispy, topped with fresh pomodoro sauce and melted cheese. Served with creamy mashed potatoes or fettuccine pomodoro to complement this delight.	\N	-46	f	f
427	306	Gin	Morango	35	4	t	2026-11-02 11:50:36.081219-03	gin morango	Drink	999	f	t	\N	\N	\N	f	f
432	306	Gin	Uva	30	4	t	2026-11-02 11:50:36.081219-03	gin uva	Drink	999	f	t	\N	\N	\N	f	f
2164	1516	SEM alcool	Laranja	24	4	t	2026-11-02 11:50:36.081219-03	sem alcool laranja	Drink	999	f	t	\N	\N	\N	f	f
725	429	Moqueca de lagosta e camarao VG	2 pessoas	250	1	t	2026-11-02 11:50:36.081219-03	moqueca de lagosta e camarao vg 2 pessoas	Moquecas	999	f	t	Deliciosa moqueca sergipana de lagosta e camarão zero de Santa Catarina no coco com legumes frescos, acompanhado de arroz branco, farofa especial da casa, vinagrete bem picadinho e um maravilhoso pirão. ---- English ---- \r\nDelightful Sergipe-style Moqueca featuring lobster and zero shrimp from Santa Catarina cooked in coconut milk with fresh vegetables. Served alongside white rice, the house's special farofa, finely chopped vinaigrette, and a delightful pirão.	\N	\N	f	f
1029	650	Sorvete Magnum Classico	\N	25	4	t	2026-11-02 11:50:36.081219-03	sorvete magnum classico 	Sorvetes	999	t	t	\N	\N	-12	f	f
1026	647	Sorvete kibon palito Brigadeiro	\N	17	4	t	2026-11-02 11:50:36.081219-03	sorvete kibon palito brigadeiro 	Sorvetes	999	t	t	\N	\N	-19	f	f
1027	648	Sorvete Palito Tablito	\N	18	2	t	2026-11-02 11:50:36.081219-03	sorvete palito tablito 	Sorvetes	999	t	t	\N	\N	-32	f	f
2811	2044	Picadinho de File com Shitaque e Shimeji	\N	15	3	t	2026-11-02 11:50:36.081219-03	picadinho de file com shitaque e shimeji 	Petiscos	999	f	f	\N	\N	\N	f	f
1754	1125	Baden Baden cristal 600 ml	\N	26	2	t	2026-11-02 11:50:36.081219-03	baden baden cristal 600 ml 	Cerveja	999	f	t	\N	\N	\N	f	f
1030	651	Sorvete Magnum Cookies Cream	\N	22	4	t	2026-11-02 11:50:36.081219-03	sorvete magnum cookies cream 	Sorvetes	999	t	t	\N	\N	-11	f	f
2577	1875	Corona extra Long Neck ZERO	\N	15	2	t	2026-11-02 11:50:36.081219-03	corona extra long neck zero 	Cerveja	999	f	t	\N	\N	\N	f	f
\.

ALTER TABLE ONLY public.area
    ADD CONSTRAINT area_pkey PRIMARY KEY (codigo);

ALTER TABLE ONLY public.garcom_pin
    ADD CONSTRAINT garcom_pin_pkey PRIMARY KEY (login);

ALTER TABLE ONLY public.produto_local
    ADD CONSTRAINT produto_local_pkey PRIMARY KEY (codigo_pdv);


CREATE TABLE public.usuario_local (
    login text NOT NULL,
    nome text,
    pin_hash text,
    salt text,
    perms integer[],
    admin boolean DEFAULT false NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    criado_em timestamp with time zone DEFAULT now(),
    criado_por text,
    codigo integer
);
ALTER TABLE ONLY public.usuario_local ADD CONSTRAINT usuario_local_pkey PRIMARY KEY (login);
-- Login da demonstração: teste (admin; o PIN 1234 está em garcom_pin)
INSERT INTO public.usuario_local (login, nome, perms, admin, ativo, criado_por, codigo)
  VALUES ('teste', 'Demonstração', '{}', true, true, 'demo', 5000000);

-- Nomes genéricos (nada das casas do Prainha na demonstração)
UPDATE area SET nome = CASE codigo WHEN 1 THEN 'COZINHA' WHEN 3 THEN 'PETISCOS' WHEN 5 THEN 'PASTEL' WHEN 6 THEN 'DESTILADOS'
  WHEN 7 THEN 'COZINHA 2' WHEN 8 THEN 'BAR 2' WHEN 9 THEN 'EVENTOS' ELSE nome END;
CREATE OR REPLACE FUNCTION pg_temp.generico(t text) RETURNS text LANGUAGE sql AS $$
  SELECT regexp_replace(regexp_replace(regexp_replace(t, 'prainha', 'da Casa', 'gi'), 'tabuar[aá]', 'Especial', 'gi'), 'terra[cç]o', 'Varanda', 'gi') $$;
UPDATE produto_local SET nome = pg_temp.generico(nome), categoria = pg_temp.generico(categoria), descricao = pg_temp.generico(descricao);
UPDATE produto_local SET nome_busca = lower(nome);
UPDATE garcom_pin SET nome = 'Demonstração';
