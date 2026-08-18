'use client';

import Image from 'next/image';
import { useState } from 'react';

type IconProps = { className?: string };
const Svg = (p: IconProps & { children: React.ReactNode }) => (
  <svg className={p.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {p.children}
  </svg>
);
const ChevronLeft = (p: IconProps) => <Svg {...p}><path d="M15 18 9 12l6-6" /></Svg>;
const ChevronRight = (p: IconProps) => <Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>;
const X = (p: IconProps) => <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>;

interface GalleryImage {
  id: string;
  src: string;
  alt: string;
  title?: string;
}

interface TabuaraGalleryProps {
  images?: GalleryImage[];
}

export function TabuaraGallery({ images = [] }: TabuaraGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Placeholder images enquanto as fotos reais não chegam
  const displayImages = images.length > 0 ? images : [
    { id: '1', src: '/placeholder.png', alt: 'Tabuará - Ambiente 1' },
    { id: '2', src: '/placeholder.png', alt: 'Tabuará - Ambiente 2' },
    { id: '3', src: '/placeholder.png', alt: 'Tabuará - Prato 1' },
    { id: '4', src: '/placeholder.png', alt: 'Tabuará - Prato 2' },
    { id: '5', src: '/placeholder.png', alt: 'Tabuará - Vista' },
    { id: '6', src: '/placeholder.png', alt: 'Tabuará - Ambiente 3' },
  ];

  const selected = selectedIndex !== null ? displayImages[selectedIndex] : null;

  return (
    <>
      {/* Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {displayImages.map((img, idx) => (
          <button
            key={img.id}
            onClick={() => setSelectedIndex(idx)}
            className="group relative aspect-square overflow-hidden rounded-lg shadow-md transition-all hover:shadow-xl"
          >
            <Image
              src={img.src}
              alt={img.alt}
              fill
              className="object-cover transition-transform group-hover:scale-105"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
            {img.title && (
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent p-4 opacity-0 transition-opacity group-hover:opacity-100">
                <p className="text-sm font-semibold text-white">{img.title}</p>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
          <div className="relative w-full max-w-4xl">
            <div className="relative aspect-video overflow-hidden rounded-lg">
              <Image
                src={selected.src}
                alt={selected.alt}
                fill
                className="object-contain"
                priority
              />
            </div>

            {/* Navigation */}
            <button
              onClick={() =>
                setSelectedIndex(
                  selectedIndex === null ? 0 : (selectedIndex - 1 + displayImages.length) % displayImages.length
                )
              }
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/20 p-2 text-white transition-all hover:bg-white/40"
              aria-label="Previous"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>

            <button
              onClick={() =>
                setSelectedIndex(selectedIndex === null ? 0 : (selectedIndex + 1) % displayImages.length)
              }
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/20 p-2 text-white transition-all hover:bg-white/40"
              aria-label="Next"
            >
              <ChevronRight className="h-6 w-6" />
            </button>

            {/* Close */}
            <button
              onClick={() => setSelectedIndex(null)}
              className="absolute -top-12 right-0 text-white transition-all hover:text-slate-300"
              aria-label="Close"
            >
              <X className="h-8 w-8" />
            </button>

            {/* Counter */}
            <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-sm text-white">
              {(selectedIndex ?? 0) + 1} / {displayImages.length}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
