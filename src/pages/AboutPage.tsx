import { ArrowRight, BookOpen, Compass, Layers, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BackButton } from '../components/BackButton';
import { PageTransition } from '../components/PageTransition';
import { SafeImage } from '../components/SafeImage';

export function AboutPage() {
  return (
    <PageTransition>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16 space-y-12">
        <div>
          <BackButton fallbackTo="/" label="Back" />
        </div>
        {/* Editorial Intro Split */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-6 space-y-5">
            <p className="text-xs font-semibold text-[#2A9D8F]">
              About ImageLab
            </p>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-[#264653] leading-[1.1] text-balance">
              Turning AI visual discovery into an open craft studio.
            </h1>
            <p className="text-base text-[#264653]/80 leading-relaxed">
              ImageLab was created for visual thinkers, designers, illustrators, and curious explorers who believe the written prompt is as expressive as the final frame. Rather than hiding creative recipes behind closed feeds, every artwork on ImageLab reveals the exact prompt language behind it.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                to="/explore"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold transition-colors"
              >
                <span>Explore Prompts</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#FAF7F2] border border-[#264653]/18 hover:border-[#264653] text-[#264653] text-sm font-semibold transition-colors"
              >
                <span>Get in Touch</span>
              </Link>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="rounded-3xl overflow-hidden bg-[#FAF7F2] border border-[#264653]/12 shadow-sm aspect-[4/3]">
              <SafeImage
                src="/src/assets/images/hero_architectural_atrium_1794836298275.jpg"
                alt="Architectural atrium artwork featured on ImageLab"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </section>

        {/* Core Principles */}
        <section
          data-ad-slot="about_principles"
          data-ad-label="About Core Principles"
          className="pt-10 border-t border-[#264653]/10"
        >
          <div className="max-w-2xl mb-10">
            <p className="text-xs font-semibold text-[#E76F51] mb-1.5">
              Our Principles
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#264653]">
              Built for Clarity, Attribution, and Craft
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: BookOpen,
                title: '01. Transparent Prompt Literacy',
                body: 'Every published artwork pairs high-resolution imagery with its verbatim generation prompt, helping creators understand how words shape light and texture.',
              },
              {
                icon: Users,
                title: '02. Creator-First Attribution',
                body: 'Prompts credit the artists and directors who refined them. Profiles showcase complete bodies of work shared across the community.',
              },
              {
                icon: Layers,
                title: '03. Calm Editorial Curation',
                body: 'Thoughtful typography, spacious galleries, and effortless tools to save and copy prompts without distraction.',
              },
            ].map((pillar) => {
              const Icon = pillar.icon;
              return (
                <div
                  key={pillar.title}
                  className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/10 p-7 space-y-3"
                >
                  <div className="w-11 h-11 rounded-xl bg-[#F4EDE4] text-[#2A9D8F] flex items-center justify-center">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-bold text-[#264653]">{pillar.title}</h3>
                  <p className="text-sm text-[#264653]/75 leading-relaxed">
                    {pillar.body}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Bottom CTA */}
        <section
          data-ad-slot="about_cta"
          data-ad-label="About Call to Action"
          className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 p-8 sm:p-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-6"
        >
          <div className="space-y-2 max-w-xl">
            <h2 className="text-2xl font-bold text-[#264653]">
              Ready to share your visual experiments?
            </h2>
            <p className="text-sm text-[#264653]/75 leading-relaxed">
              Publish an image with its complete prompt or browse trending artworks to study lighting, lenses, and style vocabularies.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Link
              to="/publish"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold transition-colors"
            >
              <span>Publish a Prompt</span>
            </Link>
            <Link
              to="/trending"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] text-white text-sm font-semibold transition-colors"
            >
              <Compass className="w-4 h-4" aria-hidden="true" />
              <span>Explore Trending</span>
            </Link>
          </div>
        </section>
      </div>
    </PageTransition>
  );
}
