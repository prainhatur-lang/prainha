'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { MapPin, Calendar, ShoppingBag, Play, Instagram } from 'lucide-react';

export default function TabuaraPage() {
  const [videoOpen, setVideoOpen] = useState(false);

  return (
    <main className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="text-2xl font-bold text-slate-900">Tabuará</div>
          <nav className="flex items-center gap-6">
            <Link href="/reservas" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Reservas
            </Link>
            <Link href="/delivery" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Delivery
            </Link>
            <a
              href="https://instagram.com/tabuara.se"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-600 hover:text-slate-900 transition-colors"
              title="Instagram"
            >
              <Instagram className="h-5 w-5" />
            </a>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative h-[600px] w-full overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="absolute inset-0 bg-slate-900/40" />
        <div className="relative flex h-full flex-col items-center justify-center px-4 text-center text-white">
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">Tabuará</h1>
          <p className="mt-4 text-xl text-slate-200">Gastronomia, vista e experiência em Aracaju</p>
          <div className="mt-10 flex gap-4">
            <Link
              href="/reservas"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-semibold text-slate-900 transition-transform hover:scale-105"
            >
              <Calendar className="h-5 w-5" />
              Reservar Mesa
            </Link>
            <Link
              href="/delivery/tabuara"
              className="inline-flex items-center gap-2 rounded-lg border-2 border-white px-6 py-3 font-semibold text-white transition-all hover:bg-white hover:text-slate-900"
            >
              <ShoppingBag className="h-5 w-5" />
              Delivery
            </Link>
          </div>
        </div>
      </section>

      {/* Sobre */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <h2 className="text-4xl font-bold text-slate-900">Bem-vindo ao Tabuará</h2>
            <p className="mt-6 text-lg text-slate-600 leading-relaxed">
              Um espaço para desfrutar de uma experiência gastronômica única em Aracaju.
              Nosso cardápio contemporâneo celebra os melhores ingredientes locais
              com técnica e criatividade.
            </p>
            <p className="mt-4 text-lg text-slate-600 leading-relaxed">
              Perfeito para jantares especiais, encontros entre amigos ou momentos
              em família com vista privilegiada da cidade.
            </p>
            <div className="mt-8 flex items-start gap-4">
              <MapPin className="h-6 w-6 text-slate-400 flex-shrink-0 mt-1" />
              <div>
                <p className="font-semibold text-slate-900">Localização</p>
                <p className="text-slate-600">Aracaju, SE</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 p-8">
            <div className="space-y-6 text-slate-700">
              <div>
                <h3 className="font-semibold text-slate-900 mb-2">Atmosfera</h3>
                <p>Ambiente sofisticado com atenção aos detalhes</p>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 mb-2">Cardápio</h3>
                <p>Pratos signature e criações do chef</p>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 mb-2">Serviço</h3>
                <p>Atendimento atencioso e personalizado</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Galeria */}
      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12">
            <h2 className="text-4xl font-bold text-slate-900">Galeria</h2>
            <p className="mt-3 text-lg text-slate-600">Conheça os detalhes, ambientes e pratos que fazem Tabuará especial</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="group relative aspect-square overflow-hidden rounded-lg bg-gradient-to-br from-slate-200 to-slate-300 shadow-md transition-all hover:shadow-xl"
              >
                <div className="absolute inset-0 flex items-center justify-center bg-slate-200">
                  <div className="text-center">
                    <div className="text-6xl mb-2">📷</div>
                    <span className="text-sm font-medium text-slate-600">Foto {i}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-12 text-center">
            <p className="text-slate-600">Mais fotos no nosso</p>
            <a
              href="https://instagram.com/tabuara.se"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-3 font-semibold text-slate-900 hover:text-slate-600 transition-colors"
            >
              <Instagram className="h-5 w-5" />
              @tabuara.se
            </a>
          </div>
        </div>
      </section>

      {/* Video Section */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-4xl font-bold text-slate-900 mb-12">Conheça Tabuará</h2>
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-900">
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
            <button
              onClick={() => setVideoOpen(true)}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-slate-900 transition-transform hover:scale-110"
            >
              <Play className="h-8 w-8 ml-1" />
            </button>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-r from-slate-900 to-slate-800 py-20 text-white">
        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
          <h2 className="text-4xl font-bold">Pronto para uma experiência inesquecível?</h2>
          <p className="mt-4 text-lg text-slate-200">Reserve sua mesa ou aproveite nosso serviço de delivery</p>
          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/reservas"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-8 py-4 font-semibold text-slate-900 transition-transform hover:scale-105"
            >
              <Calendar className="h-5 w-5" />
              Reservar Agora
            </Link>
            <Link
              href="/delivery/tabuara"
              className="inline-flex items-center justify-center gap-2 rounded-lg border-2 border-white px-8 py-4 font-semibold text-white transition-all hover:bg-white hover:text-slate-900"
            >
              <ShoppingBag className="h-5 w-5" />
              Pedir Delivery
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-8 sm:grid-cols-3 mb-8">
            <div>
              <h3 className="font-semibold text-slate-900 mb-4">Tabuará</h3>
              <p className="text-sm text-slate-600">Gastronomia e experiência em Aracaju</p>
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 mb-4">Acesso Rápido</h3>
              <ul className="space-y-2 text-sm text-slate-600">
                <li><Link href="/reservas" className="hover:text-slate-900">Reservar Mesa</Link></li>
                <li><Link href="/delivery" className="hover:text-slate-900">Delivery</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 mb-4">Siga-nos</h3>
              <a
                href="https://instagram.com/tabuara.se"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
              >
                <Instagram className="h-4 w-4" />
                @tabuara.se
              </a>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-8 text-center text-sm text-slate-600">
            <p>© 2026 Tabuará. Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
